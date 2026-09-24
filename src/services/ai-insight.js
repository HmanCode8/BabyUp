/**
 * 「AI 观察」：从记录里主动发现一件值得说的事，显示在首页。
 *
 * 为什么刻意用规则而不是模型：
 *   1. 观察要的是准确。规则是确定的，算错了能一行行查；模型每次措辞都不同，
 *      反而分不清哪句是真的、哪句是它顺口编的。
 *   2. 打开首页就该看到，不该等几秒，也不该每次花 AI 额度。
 * 所以这里的「AI」体现在「帮你盯着数据」，而不是「让模型自由发挥」。
 *
 * 边界：只陈述数据上发生了什么，以及什么情况该就医（沿用便便颜色已有的就医提示口径），
 *      不下任何医学结论。真的要看趋势、问怎么办，引导到 AI 助手里去。
 */
import { listFeedings } from './feeding'
import { listSleeps } from './sleep'
import { listDiapers, POOP_ALERT_COLORS } from './diaper'
import { listVaccinations, summarizeVaccinations } from './vaccine'
import { sleepMinutesByDay } from './ai'
import { formatDate, formatMinutes, shiftDate, todayString } from '@/utils/date'

/** 观察窗口：近 7 天，与 AI 助手的明细窗口保持一致 */
const WINDOW_DAYS = 7
/** 近 3 天与「之前 4 天」对比 */
const RECENT_DAYS = 3
/** 喂养次数下降超过这个比例才提（避免正常波动刷屏） */
const FEED_DROP_RATIO = 0.25
/** 睡眠时长下降超过这个比例才提 */
const SLEEP_DROP_RATIO = 0.2
/** 前 4 天本来就很少时不做对比：样本太小，报了反而误导 */
const MIN_FEED_BASELINE = 3
const MIN_SLEEP_BASELINE = 8 * 60

/** 近 N 天的本地日期键，从早到晚（末尾是今天） */
function dayKeys(days) {
  const today = todayString()
  const keys = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    keys.push(shiftDate(today, -offset))
  }
  return keys
}

/** 以本地日期把记录分到各天，只留窗口内的 */
function bucketByDay(rows, field, keys) {
  const map = {}
  keys.forEach((key) => {
    map[key] = []
  })
  rows.forEach((row) => {
    const value = row[field]
    if (!value) return
    const key = formatDate(value)
    if (map[key]) map[key].push(row)
  })
  return map
}

/** 平均（空数组返回 0） */
function average(list) {
  return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0
}

/** 'YYYY-MM-DD' -> '9/21'，文案里用 */
function shortDate(key) {
  const [, month, day] = String(key).split('-')
  return `${Number(month)}/${Number(day)}`
}

/**
 * 生成一条观察。
 *
 * @param {object} params
 * @param {string} params.familyId
 * @param {string} params.babyId
 * @returns {Promise<null | {key: string, warn: boolean, text: string, question: string}>}
 *   没有任何记录时返回 null（首页不显示这张卡）；warn 为 true 表示值得留意；
 *   question 是给 AI 助手的追问建议，点卡片进聊天时自动填进输入框
 */
export async function buildInsight({ familyId, babyId }) {
  if (!familyId || !babyId) return null

  const keys = dayKeys(WINDOW_DAYS)
  const recentKeys = keys.slice(WINDOW_DAYS - RECENT_DAYS)
  const earlierKeys = keys.slice(0, WINDOW_DAYS - RECENT_DAYS)
  const fromIso = new Date(`${keys[0]}T00:00:00`).toISOString()

  let feedings = []
  let sleeps = []
  let diapers = []
  let vaccinations = []
  try {
    ;[feedings, sleeps, diapers, vaccinations] = await Promise.all([
      listFeedings(familyId, babyId, { fromIso, limit: 300 }),
      listSleeps(familyId, babyId, { fromIso, limit: 300 }),
      listDiapers(familyId, babyId, { fromIso, limit: 300 }),
      listVaccinations(familyId, babyId),
    ])
  } catch (err) {
    // 观察是附加信息，查不到就安静地不显示，不能影响首页
    console.error('[AI 观察] 读取记录失败', err)
    return null
  }

  // 一条记录都没有（含疫苗）就不显示卡片
  if (!feedings.length && !sleeps.length && !diapers.length && !vaccinations.length) return null

  const feedMap = bucketByDay(feedings, 'record_time', keys)
  const diaperMap = bucketByDay(diapers, 'record_time', keys)
  const nowIso = new Date().toISOString()
  const sleepMap = sleepMinutesByDay(keys, sleeps, nowIso)

  // 1) 便便颜色异常最要紧，先看它（口径与便便记录页的就医提示一致）
  const alertRow = diapers.find((row) => POOP_ALERT_COLORS.indexOf(row.poop_color) >= 0)
  if (alertRow) {
    return {
      key: 'poop-alert',
      warn: true,
      question: '最近便便颜色有点异常，需要注意什么？',
      text: `${shortDate(formatDate(alertRow.record_time))} 有一次便便颜色需要留意。如果这两天还有，建议尽快带宝宝去看医生；只有一次的话可以先继续观察。`,
    }
  }

  // 2) 有疫苗逾期：这是「该做的事」，比趋势更值得先提
  const vaccine = summarizeVaccinations(vaccinations, todayString())
  if (vaccine.overdue > 0) {
    return {
      key: 'vaccine-overdue',
      warn: true,
      question: '有疫苗逾期了，要怎么安排？',
      text: `有 ${vaccine.overdue} 针疫苗到了接种时间、但还没记录接种，去疫苗页看看是哪几针。`,
    }
  }

  // 3) 喂养次数明显变少
  const recentFeed = average(recentKeys.map((key) => feedMap[key].length))
  const earlierFeed = average(earlierKeys.map((key) => feedMap[key].length))
  if (earlierFeed >= MIN_FEED_BASELINE && (earlierFeed - recentFeed) / earlierFeed >= FEED_DROP_RATIO) {
    const drop = Math.round(((earlierFeed - recentFeed) / earlierFeed) * 100)
    return {
      key: 'feeding-drop',
      warn: true,
      question: '最近喂养次数变少了，可能是什么原因？',
      text: `近 ${RECENT_DAYS} 天平均每天喂 ${recentFeed.toFixed(1)} 次，比之前 ${WINDOW_DAYS - RECENT_DAYS} 天的 ${earlierFeed.toFixed(1)} 次少了约 ${drop}%。先看看是不是有记录漏了；如果确实吃得少，可以去 AI 助手里聊聊。`,
    }
  }

  // 4) 睡眠时长明显变短
  const recentSleep = average(recentKeys.map((key) => sleepMap[key]))
  const earlierSleep = average(earlierKeys.map((key) => sleepMap[key]))
  if (
    earlierSleep >= MIN_SLEEP_BASELINE &&
    (earlierSleep - recentSleep) / earlierSleep >= SLEEP_DROP_RATIO
  ) {
    return {
      key: 'sleep-drop',
      warn: true,
      question: '最近睡眠时间变短了，怎么办？',
      text: `近 ${RECENT_DAYS} 天平均每天睡 ${formatMinutes(recentSleep)}，比之前 ${WINDOW_DAYS - RECENT_DAYS} 天的 ${formatMinutes(earlierSleep)} 少了 ${formatMinutes(earlierSleep - recentSleep)}。`,
    }
  }

  // 5) 都正常：给一句平淡的现状，让家长知道这个「AI 在看着」
  const steady = []
  if (recentFeed) steady.push(`每天喂 ${recentFeed.toFixed(1)} 次`)
  if (recentSleep) steady.push(`睡 ${formatMinutes(recentSleep)}`)
  const recentDiaper = average(recentKeys.map((key) => diaperMap[key].length))
  if (recentDiaper) steady.push(`换尿布 ${recentDiaper.toFixed(1)} 次`)
  if (!steady.length) return null

  return {
    key: 'steady',
    warn: false,
    question: '帮我看看最近的记录，作息算规律吗？',
    text: `近 ${RECENT_DAYS} 天平均${steady.join('、')}，和前几天差不多，继续保持。`,
  }
}
