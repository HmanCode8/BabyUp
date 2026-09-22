/**
 * AI 助手的业务入口（后端切换点）。
 *
 * 当前只有云开发版可用：模型走 wx.cloud.extend.AI 直调云开发托管模型，
 * 实现放在 ./cloud/ai.js，Supabase 版 capabilities.aiChat 恒为 false。
 *
 * 以后要扩到 Supabase，只需新增 ./supabase/ai.js 并在这里按 backendName 分发，
 * 页面与下面的 buildBabyContext / askAssistant 都不用改。
 *
 * 隐私：宝宝的喂养/睡眠/便便记录会作为上下文发给大模型。
 * 目前是「只给家人用、不公开发布」的自用形态，因此没有做脱敏；
 * 若将来对外，需要先在这里加一层脱敏（姓名换成「宝宝」等）再发出去。
 */
import { api, capabilities } from './api'
import { listFeedings, fetchLatestFeeding, resolveFeedInterval, formatFeedInterval, feedOverdueState } from './feeding'
import { listSleeps, findActiveSleep } from './sleep'
import { listDiapers, formatDiaper } from './diaper'
import { formatAge } from '@/utils/age'
import { clipMinutes, formatDateTime, formatMinutes, localDayRange } from '@/utils/date'

/** 上下文覆盖的天数（含今天） */
const CONTEXT_DAYS = 7

/** 最多带最近多少条历史消息进模型（6 轮），避免上下文无限增长吃 token */
const HISTORY_LIMIT = 12

/** AI 助手当前是否可用（页面据此决定是否渲染入口） */
export function isAiChatAvailable() {
  return Boolean(capabilities.aiChat && api.ai && api.ai.streamChat)
}

/** Date -> 'YYYY-MM-DD'（本地时区） */
function localDateKey(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 最近 CONTEXT_DAYS 天的日期键，从早到晚（末尾是今天） */
function recentDayKeys() {
  const now = new Date()
  const keys = []
  for (let offset = CONTEXT_DAYS - 1; offset >= 0; offset -= 1) {
    keys.push(localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)))
  }
  return keys
}

/** 按某个时间字段把记录归到「本地哪一天」 */
function groupByDay(rows, field) {
  const map = {}
  rows.forEach((row) => {
    const iso = row[field]
    if (!iso) return
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return
    const key = localDateKey(date)
    if (!map[key]) map[key] = []
    map[key].push(row)
  })
  return map
}

/**
 * 每天落在当天的睡眠分钟数。
 * 与今日小结同一口径：跨天的睡段只算落在这一天的那部分，正在睡算到此刻。
 */
function sleepMinutesByDay(keys, sleeps, nowIso) {
  const minutes = {}
  keys.forEach((key) => {
    minutes[key] = 0
  })
  sleeps.forEach((row) => {
    keys.forEach((key) => {
      const { startIso, endIso } = localDayRange(key)
      minutes[key] += clipMinutes(row.started_at, row.ended_at, startIso, endIso, nowIso)
    })
  })
  return minutes
}

/** 一天里各类型喂养的量：'母乳 80 分钟、配方奶 360 ml' */
function feedDetail(dayFeeds) {
  const sum = (type, field) =>
    dayFeeds
      .filter((row) => row.feed_type === type)
      .reduce((total, row) => total + (Number(row[field]) || 0), 0)
  const countOf = (type) => dayFeeds.filter((row) => row.feed_type === type).length

  const parts = []
  if (countOf('breast')) parts.push(`母乳 ${sum('breast', 'duration_min')} 分钟`)
  if (countOf('formula')) parts.push(`配方奶 ${sum('formula', 'amount_ml')} ml`)
  if (countOf('water')) parts.push(`水 ${sum('water', 'amount_ml')} ml`)
  if (countOf('solid')) parts.push(`辅食 ${countOf('solid')} 次`)
  // 辅食之外的类型都可能出现「只记了类型没填数量」，兜底说明避免模型误读成 0
  return parts.length ? parts.join('、') : '未填数量'
}

/** 逐日汇总结论，例：'- 2026-09-22：喂养 6 次（母乳 80 分钟）；睡眠 13 小时 20 分钟' */
function dailyLines(keys, feedings, sleeps, diapers, nowIso) {
  const feedMap = groupByDay(feedings, 'record_time')
  const diaperMap = groupByDay(diapers, 'record_time')
  const sleepMinutes = sleepMinutesByDay(keys, sleeps, nowIso)

  return keys.map((key) => {
    const parts = []
    const dayFeeds = feedMap[key] || []
    if (dayFeeds.length) parts.push(`喂养 ${dayFeeds.length} 次（${feedDetail(dayFeeds)}）`)
    if (sleepMinutes[key] > 0) parts.push(`睡眠 ${formatMinutes(sleepMinutes[key])}`)

    const dayDiapers = diaperMap[key] || []
    if (dayDiapers.length) {
      // 列表已按时间倒序，第一条即当天最近一次
      parts.push(`便便 ${dayDiapers.length} 次（最近一次 ${formatDiaper(dayDiapers[0])}）`)
    }

    return `- ${key}：${parts.length ? parts.join('；') : '无记录'}`
  })
}

/**
 * 把宝宝档案 + 最近 7 天情况压成一段中文摘要，作为模型的 system 上下文。
 *
 * 只汇总不逐条罗列：模型按 token 计费，把原始记录全塞进去既贵又对回答没帮助。
 * 没有任何记录时返回空串，由 system 提示词去引导家长先记录。
 */
export async function buildBabyContext({ familyId, babyId, baby }) {
  if (!familyId || !babyId) return ''

  const now = new Date()
  const nowIso = now.toISOString()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (CONTEXT_DAYS - 1), 0, 0, 0, 0)
  const fromIso = firstDay.toISOString()

  const [feedings, sleeps, diapers, latestFeeding] = await Promise.all([
    listFeedings(familyId, babyId, { fromIso, limit: 500 }),
    listSleeps(familyId, babyId, { fromIso, limit: 200 }),
    listDiapers(familyId, babyId, { fromIso, limit: 500 }),
    fetchLatestFeeding(familyId, babyId),
  ])

  const age = formatAge(baby && baby.birthday, now)
  const profile =
    `宝宝档案：${(baby && baby.name) || '未填名字'}` +
    (baby && baby.birthday ? `，生日 ${baby.birthday}` : '，未填生日') +
    (age ? `，当前 ${age}` : '') +
    `。家庭设置的喂养间隔上限：${formatFeedInterval(resolveFeedInterval(baby, now))}。`

  const status = []
  if (latestFeeding) {
    const overdue = feedOverdueState(baby, latestFeeding.record_time, now)
    status.push(
      `最近一次喂养 ${formatDateTime(latestFeeding.record_time)}（已过 ${formatFeedInterval(overdue.minutes)}${
        overdue.overdue ? '，已超过上限' : ''
      }）`,
    )
  } else {
    status.push('还没有任何喂养记录')
  }
  const activeSleep = findActiveSleep(sleeps)
  if (activeSleep) status.push(`当前有一笔睡眠进行中（从 ${formatDateTime(activeSleep.started_at)} 开始）`)

  const hasAnyRecord = feedings.length || sleeps.length || diapers.length
  const daily = hasAnyRecord
    ? dailyLines(recentDayKeys(), feedings, sleeps, diapers, nowIso)
    : [`- 近 ${CONTEXT_DAYS} 天没有任何记录。`]

  return [
    profile,
    `当前状态：${status.join('；')}。`,
    `近 ${CONTEXT_DAYS} 天的记录（按天，最后一行是今天）：`,
    ...daily,
  ].join('\n')
}

/** 人设与回答约束 */
function buildSystemPrompt(context) {
  return [
    '你是育儿小程序「初芽」里的照护助手，服务对象是同一个宝宝家里的几位家长。',
    '',
    '回答要求：',
    '1. 涉及这个宝宝的任何数据，只能依据下面提供的记录；记录里没有的，直说「记录里看不到」，不要猜测或编造。',
    '2. 用中文，语气亲切自然，简短分点，适合手机屏幕阅读，不要长篇大论。',
    '3. 你给的是日常照护经验层面的参考，不能替代医生。涉及发热、便血、持续呕吐、精神差、体重不增、呼吸异常等情况，明确建议尽快就医。',
    '4. 不评判家长的做法，不说教，不给具体用药剂量。',
    '',
    '以下是这个宝宝最近的情况：',
    context || '（暂无记录，可以引导家长先去记录喂养、睡眠、便便。）',
  ].join('\n')
}

/**
 * 问一句，拿完整回答（过程中通过 onDelta 吐增量文本）。
 *
 * @param {object} params
 * @param {string} params.familyId 当前家庭
 * @param {string} params.babyId 当前宝宝
 * @param {object} params.baby 宝宝档案（store.baby），用于算月龄与喂养间隔
 * @param {Array<{role: string, content: string}>} [params.history] 之前的对话（不含本轮提问）
 * @param {string} params.question 本轮问题
 * @param {(delta: string) => void} [params.onDelta] 增量回调
 * @returns {Promise<string>} 完整回答
 */
export async function askAssistant({ familyId, babyId, baby, history = [], question, onDelta }) {
  if (!isAiChatAvailable()) {
    throw new api.ApiError('AI 助手当前不可用（仅微信小程序端 + 云开发后端提供）', 0, 'AI_UNAVAILABLE')
  }
  const text = String(question || '').trim()
  if (!text) throw new api.ApiError('请先输入想问的问题', 0, 'EMPTY_QUESTION')

  const context = await buildBabyContext({ familyId, babyId, baby })
  const messages = [
    { role: 'system', content: buildSystemPrompt(context) },
    ...history
      .slice(-HISTORY_LIMIT)
      .filter((item) => item && item.content)
      .map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: text },
  ]

  console.log('[AI] 提问', { babyId, 历史条数: messages.length - 2, 上下文长度: context.length })
  return api.ai.streamChat({ messages, onDelta })
}

// ---------------------------------------------------------------------------
// 对话记录（只存在这台手机上，不上云）
// ---------------------------------------------------------------------------

/**
 * 按「账号 + 宝宝」分开存：同一台手机可能换人登录，不同宝宝的对话也不该串在一起。
 * 只给家人用的自用形态下，本机存储足够；将来要跨设备再补云端实现，页面不用改。
 */
const HISTORY_KEY_PREFIX = 'ai_chat_history'

/** 最多保留多少条消息（约 100 轮），超了从头截掉，避免本地存储无限膨胀 */
const HISTORY_MAX_MESSAGES = 200

function historyKey(userId, babyId) {
  if (!userId || !babyId) return ''
  return `${HISTORY_KEY_PREFIX}:${userId}:${babyId}`
}

/** 只保留能进模型的两种角色，脏数据直接丢掉 */
function toHistoryRow(item) {
  if (!item || typeof item.content !== 'string' || !item.content) return null
  if (item.role !== 'user' && item.role !== 'assistant') return null
  return { role: item.role, content: item.content }
}

/** 读出本机保存的对话（时间正序）；没有或数据坏了都返回空数组 */
export function loadChatHistory(userId, babyId) {
  const key = historyKey(userId, babyId)
  if (!key) return []
  try {
    const raw = uni.getStorageSync(key)
    if (!raw) return []
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(list)) return []
    return list.map(toHistoryRow).filter(Boolean)
  } catch (err) {
    console.error('[AI] 读取本机对话失败', err)
    return []
  }
}

/** 覆盖保存整段对话（每轮回答结束后写一次，不逐条写） */
export function saveChatHistory(userId, babyId, messages) {
  const key = historyKey(userId, babyId)
  if (!key) return
  try {
    const rows = (messages || []).map(toHistoryRow).filter(Boolean)
    uni.setStorageSync(key, JSON.stringify(rows.slice(-HISTORY_MAX_MESSAGES)))
  } catch (err) {
    // 写失败（多半是本地存储满了）不该把聊天打断，只记日志
    console.error('[AI] 保存本机对话失败', err)
  }
}

/** 清空本机对话 */
export function clearChatHistory(userId, babyId) {
  const key = historyKey(userId, babyId)
  if (!key) return
  try {
    uni.removeStorageSync(key)
  } catch (err) {
    console.error('[AI] 清空本机对话失败', err)
  }
}
