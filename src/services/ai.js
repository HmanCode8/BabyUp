/**
 * AI 助手的业务入口（后端切换点）。
 *
 * 当前只有云开发版可用：模型走 wx.cloud.extend.AI 直调云开发托管模型，
 * 实现放在 ./cloud/ai.js，Supabase 版 capabilities.aiChat 恒为 false。
 *
 * 以后要扩到 Supabase，只需新增 ./supabase/ai.js 并在这里按 backendName 分发，
 * 页面与下面的 buildBabyContext / askAssistant 都不用改。
 *
 * 隐私：宝宝的喂养/睡眠/便便/生病/生长/疫苗/体检/里程碑记录会作为上下文发给大模型。
 * 目前是「只给家人用、不公开发布」的自用形态，因此没有做脱敏；
 * 若将来对外，需要先在这里加一层脱敏（姓名换成「宝宝」等）再发出去。
 */
import { api, capabilities } from './api'
import { listFeedings, fetchLatestFeeding, resolveFeedInterval, formatFeedInterval, feedOverdueState, formatFeeding, FEED_TYPE_LABEL, FEED_LIMITS } from './feeding'
import { listSleeps, findActiveSleep } from './sleep'
import { listDiapers, formatDiaper, DIAPER_TYPES, POOP_CHARACTERS, POOP_COLORS } from './diaper'
import { listIllnessRecords, symptomText, ILLNESS_SYMPTOMS, ILLNESS_LIMITS } from './illness'
import { listGrowthRecords, GROWTH_RANGES } from './growth'
import { listVaccinations, summarizeVaccinations } from './vaccine'
import { listCheckupRecords } from './checkup'
import { listMilestones, milestoneTitle, MILESTONE_PRESETS, CUSTOM_KEY } from './milestone'
import { buildKnowledgeContext } from './parenting-knowledge'
import { APP_NAME } from '@/config'
import { formatAge } from '@/utils/age'
import { clipMinutes, formatDate, formatDateTime, formatMinutes, formatTime, localDayRange, todayString } from '@/utils/date'

/** 逐日明细覆盖的天数（含今天） */
const CONTEXT_DAYS = 7

/** 喂养/睡眠/便便的汇总窗口：只算总量与日均，用来回答「找规律」类问题 */
const OVERVIEW_DAYS = 30

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

/** 最近 days 天的日期键，从早到晚（末尾是今天） */
function recentDayKeys(days = CONTEXT_DAYS) {
  const now = new Date()
  const keys = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
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
export function sleepMinutesByDay(keys, sleeps, nowIso) {
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
 * 一段睡眠的时长（分钟）：还在睡就按此刻算。
 * 这里看的是这一段本身，不按天裁剪，所以跨夜的那段会给出完整时长。
 */
function sleepLength(row, nowIso) {
  const start = new Date(row.started_at).getTime()
  const end = new Date(row.ended_at || nowIso).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(Math.round((end - start) / 60000), 0)
}

/**
 * 近几天「逐条明细」：每条记录一行「时刻 + 内容 + 家长备注」。
 *
 * 上面按天汇总只说得出「这天吃了多少」，答不了「哪一次吐奶了、隔了多久」，
 * 而这恰恰是家长提问时最常指着问的东西；备注里往往就是关键线索（吐奶、闹觉、出牙）。
 * 数据取自同一批查询结果，不额外发请求。
 */
function detailLines(keys, feedings, sleeps, diapers, nowIso) {
  const feedMap = groupByDay(feedings, 'record_time')
  const sleepMap = groupByDay(sleeps, 'started_at')
  const diaperMap = groupByDay(diapers, 'record_time')

  const lines = []
  keys.forEach((key) => {
    const entries = []
    ;(feedMap[key] || []).forEach((row) => {
      entries.push({ at: row.record_time, text: `喂养 ${formatFeeding(row)}`, note: row.note })
    })
    ;(sleepMap[key] || []).forEach((row) => {
      const parts = [row.ended_at ? `→ ${formatTime(row.ended_at)}` : '→ 正在睡']
      const duration = formatMinutes(sleepLength(row, nowIso))
      if (duration) parts.push(duration)
      // 跨夜的睡段点一下，免得模型把两天的时长算重
      if (row.ended_at && localDateKey(new Date(row.ended_at)) !== key) parts.push('睡到第二天')
      entries.push({ at: row.started_at, text: `睡眠 ${parts.join(' · ')}`, note: row.note })
    })
    ;(diaperMap[key] || []).forEach((row) => {
      entries.push({ at: row.record_time, text: `便便 ${formatDiaper(row)}`, note: row.note })
    })

    if (!entries.length) return
    // 一天之内按时间正序，读起来就是一条时间轴
    entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    lines.push(`- ${key}：`)
    entries.forEach((entry) => {
      const note = entry.note ? String(entry.note).trim() : ''
      lines.push(`  - ${formatTime(entry.at)} ${entry.text}${note ? `（备注：${note}）` : ''}`)
    })
  })
  return lines
}

/**
 * 近 days 天的概览：只有总量与日均，不逐日铺开。
 * 7 天明细看不出趋势，这一层专门用来回答「最近睡得怎么样、奶量够不够」这类找规律的问题。
 */
function windowOverview(days, keys, feedings, sleeps, diapers, nowIso) {
  const feedMap = groupByDay(feedings, 'record_time')
  const diaperMap = groupByDay(diapers, 'record_time')
  const sleepMinutes = sleepMinutesByDay(keys, sleeps, nowIso)

  const feedDays = keys.filter((key) => (feedMap[key] || []).length).length
  const diaperDays = keys.filter((key) => (diaperMap[key] || []).length).length
  const sleepDays = keys.filter((key) => sleepMinutes[key] > 0).length
  if (!feedDays && !diaperDays && !sleepDays) return []

  const lines = []
  if (feedDays) {
    const sumOf = (type, field) =>
      feedings
        .filter((row) => row.feed_type === type)
        .reduce((total, row) => total + (Number(row[field]) || 0), 0)
    const parts = [
      `共 ${feedings.length} 次，有记录 ${feedDays} 天，日均 ${(feedings.length / feedDays).toFixed(1)} 次`,
    ]
    const breastMinutes = sumOf('breast', 'duration_min')
    const formulaMl = sumOf('formula', 'amount_ml')
    if (breastMinutes) parts.push(`母乳合计 ${formatMinutes(breastMinutes)}`)
    if (formulaMl) parts.push(`配方奶合计 ${formulaMl} ml（日均 ${Math.round(formulaMl / feedDays)} ml）`)
    lines.push(`- 喂养：${parts.join('，')}`)
  }
  if (sleepDays) {
    const total = keys.reduce((sum, key) => sum + sleepMinutes[key], 0)
    lines.push(
      `- 睡眠：合计 ${formatMinutes(total)}，有记录 ${sleepDays} 天，日均 ${formatMinutes(total / sleepDays)}`,
    )
  }
  if (diaperDays) {
    lines.push(
      `- 便便/尿布：共 ${diapers.length} 次，有记录 ${diaperDays} 天，日均 ${(diapers.length / diaperDays).toFixed(1)} 次`,
    )
  }
  return lines
}

/**
 * 长期记录的摘要：生病 / 生长 / 疫苗 / 体检 / 里程碑。
 * 这几类不按天铺开，只给能支撑回答的结论与最近几条，控制上下文体量。
 */
function longTermLines({ illnesses, growths, vaccinations, checkups, milestones, today }) {
  const lines = []

  if (illnesses.length) {
    const recent = illnesses.slice(0, 5).map((row) => {
      const parts = [symptomText(row.symptoms)]
      if (row.temperature) parts.push(`${row.temperature} ℃`)
      if (row.diagnosis) parts.push(`诊断：${row.diagnosis}`)
      return `${formatDate(row.occurred_at)}（${parts.join('，')}）`
    })
    lines.push(`- 生病记录：共 ${illnesses.length} 条，最近几次 ${recent.join('；')}`)
  }

  if (growths.length) {
    // 生长记录按日期升序返回，首条是最早、末条是最近
    const measure = (row) =>
      [
        row.height_cm ? `身高 ${row.height_cm} cm` : '',
        row.weight_kg ? `体重 ${row.weight_kg} kg` : '',
        row.head_cm ? `头围 ${row.head_cm} cm` : '',
      ]
        .filter(Boolean)
        .join('、')
    const first = growths[0]
    const last = growths[growths.length - 1]
    lines.push(
      growths.length === 1
        ? `- 生长记录：只有 ${first.record_date} 一次，${measure(first) || '未填数值'}`
        : `- 生长记录：共 ${growths.length} 次，${first.record_date} ${measure(first) || '未填数值'} → ${last.record_date} ${
            measure(last) || '未填数值'
          }`,
    )
  }

  if (vaccinations.length) {
    const summary = summarizeVaccinations(vaccinations, today)
    // 列表是按计划日期倒序的，这里按日期升序挑最近要打的几针
    const upcoming = vaccinations
      .filter((row) => !row.vaccinated_date && row.scheduled_date)
      .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))
      .slice(0, 3)
      .map((row) => `${row.name}${row.dose ? ` ${row.dose}` : ''}（计划 ${row.scheduled_date}）`)
    lines.push(
      `- 疫苗：已接种 ${summary.vaccinated} 针，已逾期 ${summary.overdue} 针，即将接种 ${summary.soon} 针，待接种 ${summary.pending} 针` +
        (upcoming.length ? `；最近待办 ${upcoming.join('、')}` : ''),
    )
  }

  if (checkups.length) {
    const latest = checkups[0]
    const parts = []
    if (latest.height_cm) parts.push(`身高 ${latest.height_cm} cm`)
    if (latest.weight_kg) parts.push(`体重 ${latest.weight_kg} kg`)
    if (latest.head_cm) parts.push(`头围 ${latest.head_cm} cm`)
    if (latest.development) parts.push(`发育评估：${latest.development}`)
    if (latest.doctor_advice) parts.push(`医生建议：${latest.doctor_advice}`)
    lines.push(
      `- 体检：共 ${checkups.length} 次，最近一次 ${latest.checkup_date}${parts.length ? `（${parts.join('，')}）` : ''}` +
        (latest.next_date ? `，建议下次 ${latest.next_date}` : ''),
    )
  }

  if (milestones.length) {
    const achieved = milestones
      .slice(0, 8)
      .map((row) => `${milestoneTitle(row)}（${row.achieved_date}）`)
    lines.push(`- 里程碑：已达成 ${milestones.length} 个，最近 ${achieved.join('、')}`)
  }

  return lines
}

/**
 * 把宝宝档案 + 记录压成一段中文文本，作为模型的「宝宝的情况」上下文。
 *
 * 分三层，取舍都在「模型按 token 计费」上：
 *   近 7 天   —— 逐条明细（时刻 + 内容 + 备注）+ 按天汇总，答得了「哪一次、隔了多久」；
 *   近 30 天  —— 只有总量与日均，答「最近规律怎么样」；
 *   长期记录  —— 生病/生长/疫苗/体检/里程碑只给结论与最近几条。
 * 没有逐日记录时返回的仍是档案与长期记录，由 system 提示词去引导家长先记录。
 *
 * @returns {Promise<{text: string, basis: string}>} text 是喂给模型的上下文，
 *   basis 是「依据」那行小字（页面显示在回答下面，让家长知道 AI 读了多少东西）
 */
export async function buildBabyContext({ familyId, babyId, baby }) {
  if (!familyId || !babyId) return { text: '', basis: '' }

  const now = new Date()
  const nowIso = now.toISOString()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (OVERVIEW_DAYS - 1), 0, 0, 0, 0)
  const fromIso = firstDay.toISOString()

  const [feedings, sleeps, diapers, latestFeeding, illnesses, growths, vaccinations, checkups, milestones] =
    await Promise.all([
      listFeedings(familyId, babyId, { fromIso, limit: 800 }),
      listSleeps(familyId, babyId, { fromIso, limit: 500 }),
      listDiapers(familyId, babyId, { fromIso, limit: 800 }),
      fetchLatestFeeding(familyId, babyId),
      listIllnessRecords(familyId, babyId, { limit: 20 }),
      listGrowthRecords(familyId, babyId),
      listVaccinations(familyId, babyId),
      listCheckupRecords(familyId, babyId, { limit: 5 }),
      listMilestones(familyId, babyId, { limit: 20 }),
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
  // 明细只铺近 CONTEXT_DAYS 天：答「哪一次、隔了多久」靠它，再往前只留趋势
  const detail = hasAnyRecord ? detailLines(recentDayKeys(), feedings, sleeps, diapers, nowIso) : []

  const overview = windowOverview(OVERVIEW_DAYS, recentDayKeys(OVERVIEW_DAYS), feedings, sleeps, diapers, nowIso)
  const longTerm = longTermLines({
    illnesses,
    growths,
    vaccinations,
    checkups,
    milestones,
    today: todayString(),
  })

  const sections = [
    profile,
    `当前状态：${status.join('；')}。`,
    `近 ${CONTEXT_DAYS} 天汇总（按天，最后一行是今天）：`,
    ...daily,
  ]
  if (detail.length) {
    sections.push(`近 ${CONTEXT_DAYS} 天明细（时间正序，括号里是家长随手记的备注）：`, ...detail)
  }
  if (overview.length) {
    sections.push(`近 ${OVERVIEW_DAYS} 天汇总（含上面的 ${CONTEXT_DAYS} 天）：`, ...overview)
  }
  if (longTerm.length) {
    sections.push('长期记录：', ...longTerm)
  }

  // 「依据」不交给模型写：让它自己报读了多少条，每次措辞都不一样，还可能是编的。
  // 这里由我们数出来，页面直接显示。
  const recordCount = feedings.length + sleeps.length + diapers.length
  const basis = `依据：近 ${CONTEXT_DAYS} 天明细、近 ${OVERVIEW_DAYS} 天汇总与长期记录，共 ${recordCount} 条原始记录`

  return { text: sections.join('\n'), basis }
}

/** 人设与回答约束 */
function buildSystemPrompt(context, knowledge) {
  return [
    `你是育儿小程序「${APP_NAME}」里的照护助手，服务对象是同一个宝宝家里的几位家长。`,
    '',
    '回答要求：',
    '1. 涉及这个宝宝的具体数据（吃奶、睡眠、便便、生病、生长、疫苗、体检、里程碑等），只能依据下面「宝宝的情况」里的记录；记录里没有的，直说「记录里看不到」，不要猜测或编造具体数字。明细里带「（备注：…）」的是家长随手记的特殊情况（如吐奶、闹觉、出牙），回答时要一并考虑。',
    '2. 日常照护经验、发育规律、「这个阶段该做什么」这类通用问题，可以正常回答；但要用「一般来说」之类的话说明是通用建议，不是这个宝宝的记录。',
    '3. 回答时先讲记录里的事实，再给建议；依据不足就说明依据不足，不要硬下结论。引用具体记录时带上日期时间（例如「9/23 22:10 睡了 8 小时」），方便家长回记录里核对。',
    '4. 用中文，语气亲切自然，简短分点，适合手机屏幕阅读，不要长篇大论。',
    '5. 你给的是日常照护经验层面的参考，不能替代医生。涉及发热、便血、持续呕吐、精神差、体重不增、呼吸异常等情况，明确建议尽快就医。',
    '6. 不评判家长的做法，不说教，不给具体用药剂量。',
    '',
    '以下是宝宝的情况（来自家长记录）：',
    context || '（暂无记录，可以引导家长先去记录喂养、睡眠、便便。）',
    '',
    '以下是通用的育儿参考（不是这个宝宝的记录）：',
    knowledge || '（这次的问题没有匹配到对应的通用参考。）',
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
 * @returns {Promise<{text: string, basis: string}>} 完整回答 + 依据说明（页面显示在回答下方）
 */
export async function askAssistant({ familyId, babyId, baby, history = [], question, onDelta }) {
  if (!isAiChatAvailable()) {
    throw new api.ApiError('AI 助手当前不可用（仅微信小程序端 + 云开发后端提供）', 0, 'AI_UNAVAILABLE')
  }
  const text = String(question || '').trim()
  if (!text) throw new api.ApiError('请先输入想问的问题', 0, 'EMPTY_QUESTION')

  const { text: context, basis } = await buildBabyContext({ familyId, babyId, baby })
  // 通用育儿参考按「当前月龄 + 提问命中的话题」挑，只有这两块都为空时才是空串
  const knowledge = buildKnowledgeContext({ baby, question: text })
  const messages = [
    { role: 'system', content: buildSystemPrompt(context, knowledge) },
    ...history
      .slice(-HISTORY_LIMIT)
      .filter((item) => item && item.content)
      .map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: text },
  ]

  console.log('[AI] 提问', {
    babyId,
    历史条数: messages.length - 2,
    上下文长度: context.length,
    通用参考长度: knowledge.length,
  })
  const answer = await api.ai.streamChat({ messages, onDelta })
  // basis 交给页面显示在回答下面：让家长看得见 AI 读了哪些数据
  return { text: answer, basis }
}

// ---------------------------------------------------------------------------
// 每日小结：让 AI 主动说一句「今天怎么样」
// ---------------------------------------------------------------------------

/**
 * 生成「今天的小结」—— 一段 3~4 句、可以直接发到家庭群的话。
 *
 * 与问答共用同一份上下文，只是指令不同：这里要的是总结，不是答疑。
 * 每次调用都是一次模型请求，所以页面按「宝宝 + 日期」缓存在本机，同一天只生成一次，
 * 用户点「重新生成」才会再花一次额度。
 *
 * @returns {Promise<string>} 小结正文
 */
export async function summarizeDay({ familyId, babyId, baby }) {
  if (!isAiChatAvailable()) {
    throw new api.ApiError('AI 助手当前不可用（仅微信小程序端 + 云开发后端提供）', 0, 'AI_UNAVAILABLE')
  }
  const { text: context } = await buildBabyContext({ familyId, babyId, baby })
  const messages = [
    { role: 'system', content: buildDailySummaryPrompt(context) },
    { role: 'user', content: '请写一段今天的小结。' },
  ]
  const answer = await api.ai.streamChat({ messages })
  return String(answer || '').trim()
}

/** 每日小结的提示词：要的是能给家人看的一段话，不是问答体 */
function buildDailySummaryPrompt(context) {
  return [
    `你是育儿小程序「${APP_NAME}」里的照护助手。请写一段「宝宝今天的小结」，家长会把它发到家庭群里。`,
    '',
    '要求：',
    '1. 3~4 句话，中文，语气亲切自然，像家人之间说话，不要客套话开场。',
    '2. 只讲记录里的事实：今天喂了几次、睡了多少、便便几次，并和最近几天比一比（多了还是少了）。',
    '3. 记录里带备注的特殊情况（吐奶、闹觉、出牙等）要点出来，这是家长最关心的细节。',
    '4. 最后给一条具体、可执行的小建议（例如今晚可以早一点哄睡）。',
    '5. 不下医学结论、不判断病情、不用「建议咨询医生」这类笼统话收尾；不评判家长；不用 markdown 符号。',
    '6. 直接输出小结正文，不要标题、不要分点编号。',
    '',
    '以下是宝宝的情况（来自家长记录）：',
    context || '（暂无记录，可以引导家长先去记录喂养、睡眠、便便。）',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 一句话记一笔：把家长随口说的一句话解析成一条结构化记录
// ---------------------------------------------------------------------------

/** 解析结果的取值范围，全部由业务常量表推导，避免两处枚举写岔 */
const QUICK_KINDS = ['feeding', 'sleep', 'diaper', 'growth', 'illness', 'milestone']
const QUICK_FEED_TYPES = Object.keys(FEED_TYPE_LABEL)
const QUICK_DIAPER_TYPES = DIAPER_TYPES.map((item) => item.key)
const QUICK_POOP_CHARACTERS = POOP_CHARACTERS.map((item) => item.key)
const QUICK_POOP_COLORS = POOP_COLORS.map((item) => item.key)
const QUICK_SYMPTOMS = ILLNESS_SYMPTOMS.map((item) => item.key)
/** 里程碑预置项（key=中文名 形式喂给模型，让它照着选） */
const QUICK_MILESTONES = MILESTONE_PRESETS.filter((item) => item.key !== CUSTOM_KEY)
/** 允许的 milestone.key：预置项 + 自定义 */
const QUICK_MILESTONE_KEYS = QUICK_MILESTONES.map((item) => item.key).concat(CUSTOM_KEY)

/** 睡眠时长与体温的合理区间（体温复用生病模块的常量） */
const SLEEP_DURATION_RANGE = { min: 1, max: 24 * 60, label: '睡眠时长' }
const TEMPERATURE_RANGE = {
  min: ILLNESS_LIMITS.temperatureMin,
  max: ILLNESS_LIMITS.temperatureMax,
  label: '体温',
}

/** 一句话记一笔的提示词。要的是 JSON，不是回答，所以不用 buildSystemPrompt */
function buildQuickRecordPrompt(now) {
  return [
    '你是记录解析器。把家长说的一句话解析成一条宝宝记录，只输出一个 JSON 对象，',
    '不要输出任何解释，也不要用 markdown 代码块包裹。',
    '',
    `现在是 ${formatDateTime(now.toISOString())}（北京时间）。`,
    '',
    '输出格式（没有提到的字段填 null）：',
    '{',
    '  "kind": "feeding" | "sleep" | "diaper" | "growth" | "illness" | "milestone" | "unknown",',
    '  "minutesAgo": 0,',
    '  "note": "",',
    '  "feeding": { "type": null, "amountMl": null, "durationMin": null },',
    '  "sleep": { "durationMin": null },',
    '  "diaper": { "type": null, "character": null, "color": null },',
    '  "growth": { "heightCm": null, "weightKg": null, "headCm": null },',
    '  "illness": { "symptoms": [], "temperature": null },',
    '  "milestone": { "key": null, "name": null }',
    '}',
    '',
    '规则：',
    '1. kind 只能选一个，按这个顺序判断：',
    '   - 量了身高/体重/头围、称重 → growth；',
    '   - 发烧、咳嗽、流鼻涕、呕吐、腹泻、起疹子、食欲差、去医院看病 → illness；',
    '   - 第一次笑 / 第一次翻身 / 会坐 / 长牙 / 会爬 / 会站 / 走路 / 叫爸妈这类成长节点 → milestone；',
    '   - 吃奶/喝奶/喂奶/母乳/配方奶/奶粉/辅食/喝水 → feeding；',
    '   - 睡觉/睡了/刚醒 → sleep；',
    '   - 尿/便便/拉臭臭/换尿布 → diaper；',
    '   - 都不像就填 unknown。',
    '2. 「吐奶/溢奶」是喂养时的小状况，算 feeding 的备注，不要当 illness 的呕吐；',
    '   一句话里同时提到两件事时，只记最主要的那一件，其余放进 note。',
    '3. minutesAgo 是这件事发生在多少分钟前（"刚刚"填 0，"半小时前"填 30，"下午三点量的"按当前时间换算成分钟数），拿不准就填 0。',
    '4. feeding.type 取值：breast=母乳，formula=配方奶/奶粉，water=水，solid=辅食。amountMl 是毫升数；母乳没有毫升数就把 amountMl 填 null、用 durationMin 填分钟数。',
    `5. diaper.type 取值：${QUICK_DIAPER_TYPES.join('/')}；character 只能从 ${QUICK_POOP_CHARACTERS.join('/')} 里选；color 只能从 ${QUICK_POOP_COLORS.join('/')} 里选；没说就填 null。`,
    '6. sleep.durationMin 是这一觉睡了多久（分钟）。',
    '7. growth 的 heightCm / weightKg / headCm 都是数字，单位分别是厘米、公斤、厘米（例如"身高 74、体重 9.1"就填 heightCm=74、weightKg=9.1）；只说了一个就只填一个，其余填 null。',
    `8. illness.symptoms 是数组，只能从这些里选：${QUICK_SYMPTOMS.join('/')}（fever=发热 cough=咳嗽 runny_nose=流涕 vomit=呕吐 diarrhea=腹泻 rash=皮疹 poor_appetite=食欲差 other=其他），可以多选；temperature 是摄氏度数字（例如 38.5），没量过就填 null。`,
    `9. milestone.key 只能从这些里选：${QUICK_MILESTONES.map((item) => `${item.key}=${item.label}`).join(' ')}；如果家长说的成长节点不在这个表里，key 填 custom，并把家长的说法原样填进 name。`,
    '10. note 放家长话里其余值得记的描述（例如"边吃边睡""有点闹"），没有就填空字符串；不要把类型和数字重复写进 note。',
    '11. 不确定的字段一律填 null，不要猜。',
  ].join('\n')
}

/**
 * 从模型输出里剥出 JSON 对象。
 * 模型有时会包一层 ```json 代码块、或在前后多说一句话，所以取第一个 { 到最后一个 } 之间的内容。
 */
function extractJson(text) {
  const raw = String(text || '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch (err) {
    console.error('[AI] 记录 JSON 解析失败', err, raw.slice(0, 200))
    return null
  }
}

/** 只接受表里的值，其余一律 null：宁可少记一个字段，也不能把模型猜的值写进数据库 */
function pickEnum(value, allowed) {
  return allowed.indexOf(value) >= 0 ? value : null
}

/** 只认正整数，顺手取整（模型偶尔会给出 "120ml" 这种字符串） */
function toPositiveInt(value) {
  const number = Number.parseInt(value, 10)
  return Number.isFinite(number) && number > 0 ? number : null
}

/** 只认数字（模型偶尔给出 "74cm" / "9.1 公斤"），取不出来返回 null */
function toNumber(value) {
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : null
}

/**
 * 区间校验：数值在合理区间内才留，明显不合理的直接抛错交给家长手动记。
 *
 * 为什么是抛错而不是丢掉字段：模型给的值属于外部输入，安静地丢掉一个数字，
 * 家长会以为记上了；抛错会带着具体数值提示，比「没听清」有用得多。
 *
 * @param {number|null} value 已解析出的数字
 * @param {{min: number, max: number, label: string}} range 业务区间（取自各 service 的常量表）
 */
function assertRange(value, range) {
  if (value == null) return null
  if (value < range.min || value > range.max) {
    throw new api.ApiError(
      `${range.label} ${value} 超出正常范围（${range.min}~${range.max}），请手动记录`,
      0,
      'OUT_OF_RANGE',
    )
  }
  return value
}

/**
 * 逐字段校验并归一化（顺手把输入框里的字符串转成数字），不合法就抛 ApiError。
 *
 * 解析完跑一次，页面提交前再跑一次 —— 确认卡上的字段是可编辑的，
 * 用户改过的值同样是外部输入，不能直接写库。
 *
 * @param {object|null} result parseQuickRecord 的结果（会被就地归一化）
 * @returns {object|null} 同一个对象，便于链式使用
 */
export function assertQuickRecord(result) {
  if (!result) return result
  const { kind } = result

  if (kind === 'feeding') {
    result.feeding.amountMl = assertRange(toNumber(result.feeding.amountMl), FEED_LIMITS.amountMl)
    result.feeding.durationMin = assertRange(toNumber(result.feeding.durationMin), FEED_LIMITS.durationMin)
  } else if (kind === 'sleep') {
    const minutes = assertRange(toNumber(result.sleep.durationMin), SLEEP_DURATION_RANGE)
    if (!minutes) throw new api.ApiError('睡眠时长要填一个大于 0 的分钟数', 0, 'INVALID_FIELD')
    result.sleep.durationMin = minutes
  } else if (kind === 'growth') {
    result.growth.heightCm = assertRange(toNumber(result.growth.heightCm), GROWTH_RANGES.heightCm)
    result.growth.weightKg = assertRange(toNumber(result.growth.weightKg), GROWTH_RANGES.weightKg)
    result.growth.headCm = assertRange(toNumber(result.growth.headCm), GROWTH_RANGES.headCm)
    if (!result.growth.heightCm && !result.growth.weightKg && !result.growth.headCm) {
      throw new api.ApiError('身高、体重、头围至少要填一项', 0, 'INVALID_FIELD')
    }
  } else if (kind === 'illness') {
    result.illness.temperature = assertRange(toNumber(result.illness.temperature), TEMPERATURE_RANGE)
    if (!result.illness.symptoms.length && result.illness.temperature == null) {
      throw new api.ApiError('至少选一个症状，或者填一下体温', 0, 'INVALID_FIELD')
    }
  } else if (kind === 'milestone') {
    const name = String(result.milestone.name || '').trim()
    if (!name) throw new api.ApiError('里程碑名称不能为空', 0, 'INVALID_FIELD')
    result.milestone.name = name
  }

  return result
}

/**
 * 解析一句话，返回能直接填进表单、也能直接入库的结构。
 *
 * 支持六类：喂养 / 睡眠 / 便便 / 生长（身高体重头围）/ 生病（症状 + 体温）/ 里程碑。
 * 疫苗与体检不做：它们要跟疫苗库、体检记录对上号，说错一个名称记错一条，不如手动排。
 *
 * ⚠️ 这里只是「解析」，不写库。落到数据库前必须由用户在确认卡上过一眼 ——
 *    模型偶尔会听岔，写错一条记录比记不上更糟。
 *
 * @param {object} params
 * @param {string} params.text 家长说的话
 * @param {Date} [params.now] 当前时间，默认取系统时间（便于测试）
 * @returns {Promise<null | {kind: string, at: string, note: string, feeding: object|null, sleep: object|null, diaper: object|null, growth: object|null, illness: object|null, milestone: object|null}>}
 *   完全没听懂返回 null；听懂了但数值明显不合理会抛 ApiError（带具体数值，便于提示家长）
 */
export async function parseQuickRecord({ text, now = new Date() }) {
  if (!isAiChatAvailable()) {
    throw new api.ApiError('AI 助手当前不可用（仅微信小程序端 + 云开发后端提供）', 0, 'AI_UNAVAILABLE')
  }
  const question = String(text || '').trim()
  if (!question) throw new api.ApiError('先说一句话吧', 0, 'EMPTY_QUESTION')

  const answer = await api.ai.streamChat({
    messages: [
      { role: 'system', content: buildQuickRecordPrompt(now) },
      { role: 'user', content: question },
    ],
  })

  const parsed = extractJson(answer)
  if (!parsed) return null
  const kind = pickEnum(parsed.kind, QUICK_KINDS)
  if (!kind) return null

  // 时间一律由「几分钟前」换算：让模型算相对时间比让它拼日期靠谱
  const minutesAgo = Math.min(toPositiveInt(parsed.minutesAgo) || 0, 24 * 60)
  const at = new Date(now.getTime() - minutesAgo * 60000)
  const atIso = at.toISOString()

  const result = {
    kind,
    at: atIso,
    note: typeof parsed.note === 'string' ? parsed.note.trim() : '',
    feeding: null,
    sleep: null,
    diaper: null,
    growth: null,
    illness: null,
    milestone: null,
  }

  if (kind === 'feeding') {
    const source = parsed.feeding || {}
    const type = pickEnum(source.type, QUICK_FEED_TYPES)
    // 连类型都没听出来就不给结果，由页面引导手动记录
    if (!type) return null
    result.feeding = {
      type,
      amountMl: toPositiveInt(source.amountMl),
      durationMin: toPositiveInt(source.durationMin),
    }
  } else if (kind === 'sleep') {
    const durationMin = toPositiveInt((parsed.sleep || {}).durationMin)
    if (!durationMin) return null
    result.sleep = {
      durationMin,
      // 从「睡着的时间点」到「说话的时间点」算一段完整睡眠
      startedAt: new Date(at.getTime() - durationMin * 60000).toISOString(),
      endedAt: atIso,
    }
  } else if (kind === 'diaper') {
    const source = parsed.diaper || {}
    const type = pickEnum(source.type, QUICK_DIAPER_TYPES)
    if (!type) return null
    result.diaper = {
      type,
      // 纯尿不记性状与颜色，与 services/diaper.js 的归一化口径保持一致
      character: type === 'pee' ? null : pickEnum(source.character, QUICK_POOP_CHARACTERS),
      color: type === 'pee' ? null : pickEnum(source.color, QUICK_POOP_COLORS),
    }
  } else if (kind === 'growth') {
    const source = parsed.growth || {}
    const growth = {
      heightCm: toNumber(source.heightCm),
      weightKg: toNumber(source.weightKg),
      headCm: toNumber(source.headCm),
    }
    // 三项一个都没听出来就不给结果
    if (!growth.heightCm && !growth.weightKg && !growth.headCm) return null
    result.growth = { ...growth, date: formatDate(atIso) }
  } else if (kind === 'illness') {
    const source = parsed.illness || {}
    const raw = Array.isArray(source.symptoms) ? source.symptoms : []
    const symptoms = [...new Set(raw.map((key) => pickEnum(key, QUICK_SYMPTOMS)).filter(Boolean))]
    const temperature = toNumber(source.temperature)
    if (!symptoms.length && temperature == null) return null
    // 记下事实，不替家长判断严重程度（该不该就医交给页面上的医生提示与家长自己）
    result.illness = { symptoms, temperature }
  } else {
    const source = parsed.milestone || {}
    const key = pickEnum(source.key, QUICK_MILESTONE_KEYS)
    if (!key) return null
    const preset = QUICK_MILESTONES.find((item) => item.key === key)
    // 预置项用表里的中文名；自定义必须有家长自己的说法，否则会记成一条没有名字的里程碑
    const name = preset ? preset.label : String(source.name || '').trim()
    if (!name) return null
    result.milestone = { key, name, date: formatDate(atIso) }
  }

  // 解析出的数值同样要过一遍区间校验（模型给的是外部输入）
  assertQuickRecord(result)

  console.log('[AI] 一句话记一笔', { kind: result.kind, minutesAgo, 原始长度: answer.length })
  return result
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

// ---------------------------------------------------------------------------
// 每日小结的本机缓存（同一天只生成一次，省额度）
// ---------------------------------------------------------------------------

const DAILY_SUMMARY_PREFIX = 'ai_daily_summary'

function dailySummaryKey(userId, babyId, date) {
  if (!userId || !babyId || !date) return ''
  return `${DAILY_SUMMARY_PREFIX}:${userId}:${babyId}:${date}`
}

/** 读出某天已生成的小结；没有或坏掉都返回空串 */
export function loadDailySummary(userId, babyId, date) {
  const key = dailySummaryKey(userId, babyId, date)
  if (!key) return ''
  try {
    const raw = uni.getStorageSync(key)
    if (!raw) return ''
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed && typeof parsed.text === 'string' ? parsed.text : ''
  } catch (err) {
    console.error('[AI] 读取每日小结失败', err)
    return ''
  }
}

/** 存下某天的小结（重新生成会覆盖） */
export function saveDailySummary(userId, babyId, date, text) {
  const key = dailySummaryKey(userId, babyId, date)
  if (!key) return
  try {
    uni.setStorageSync(key, JSON.stringify({ text: String(text || ''), at: Date.now() }))
  } catch (err) {
    console.error('[AI] 保存每日小结失败', err)
  }
}
