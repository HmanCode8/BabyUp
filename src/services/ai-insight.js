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
import { formatDate, formatMinutes, formatTime, shiftDate, todayString } from '@/utils/date'

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

/** 距上次便便超过这么多小时才提（比「一天一次」明显久） */
const POOP_GAP_HOURS = 48
/** 近 3 天比之前 4 天平均每天多这么多次便便才算「变多」 */
const POOP_MANY_DELTA = 1.5
/** 单日便便不到这个次数就不算多：本来一天 1 次、变 2 次不值得提 */
const POOP_MANY_MIN = 3
/** 夜里睡段平均多这么多段才算「夜醒变多」 */
const NIGHT_WAKE_DELTA = 1.5
/** 之前平均不到 1 段（基本一觉到天亮）时不比：样本太小 */
const MIN_NIGHT_SEGMENTS = 1

/** 只算真的拉了：纯尿不算（类型见 services/diaper.js 的 DIAPER_TYPES） */
function isPoop(row) {
  return row.diaper_type === 'poop' || row.diaper_type === 'mixed'
}

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
 * 观察要用的原始行（近 WINDOW_DAYS 天的喂养 / 睡眠 / 便便 + 全部疫苗）。
 *
 * 单独抽出来是为了让记录页「今日小结」复用同一批数据：
 * 小结看今天、观察看近 7 天（含今天），本来各查一遍这四张表，等于同一批数据
 * 问了服务端两次。现在记录页先调这里一次，再把结果同时喂给两个模块。
 *
 * 查不到不抛错，交给调用方决定（观察是附加信息，安静地不显示就好）。
 */
export async function loadInsightRows({ familyId, babyId }) {
  if (!familyId || !babyId) return null
  const fromIso = new Date(`${dayKeys(WINDOW_DAYS)[0]}T00:00:00`).toISOString()
  const [feedings, sleeps, diapers, vaccinations] = await Promise.all([
    listFeedings(familyId, babyId, { fromIso, limit: 300 }),
    listSleeps(familyId, babyId, { fromIso, limit: 300 }),
    listDiapers(familyId, babyId, { fromIso, limit: 300 }),
    listVaccinations(familyId, babyId),
  ])
  return { feedings, sleeps, diapers, vaccinations }
}

/**
 * 生成一条观察。
 *
 * @param {object} params
 * @param {string} params.familyId
 * @param {string} params.babyId
 * @param {object} [params.rows] loadInsightRows() 的结果。
 *        记录页已经拉过就传进来，省掉这里的四个查询；不传则自己拉。
 * @returns {Promise<null | {key: string, warn: boolean, text: string, question: string}>}
 *   没有任何记录时返回 null（首页不显示这张卡）；warn 为 true 表示值得留意；
 *   question 是给 AI 助手的追问建议，点卡片进聊天时自动填进输入框
 */
export async function buildInsight({ familyId, babyId, rows }) {
  if (!familyId || !babyId) return null

  const keys = dayKeys(WINDOW_DAYS)
  const recentKeys = keys.slice(WINDOW_DAYS - RECENT_DAYS)
  const earlierKeys = keys.slice(0, WINDOW_DAYS - RECENT_DAYS)

  let feedings = []
  let sleeps = []
  let diapers = []
  let vaccinations = []
  if (rows) {
    feedings = rows.feedings || []
    sleeps = rows.sleeps || []
    diapers = rows.diapers || []
    vaccinations = rows.vaccinations || []
  } else {
    try {
      const fetched = await loadInsightRows({ familyId, babyId })
      feedings = fetched.feedings
      sleeps = fetched.sleeps
      diapers = fetched.diapers
      vaccinations = fetched.vaccinations
    } catch (err) {
      // 观察是附加信息，查不到就安静地不显示，不能影响首页
      console.error('[AI 观察] 读取记录失败', err)
      return null
    }
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

  // 3) 距上次便便太久：可能是漏记，也可能真的攒肚，两种都值得家长看一眼
  if (diapers.length) {
    // 列表按时间倒序，第一条就是最近一次
    const last = diapers[0]
    const hours = (Date.now() - new Date(last.record_time).getTime()) / 3600000
    if (Number.isFinite(hours) && hours >= POOP_GAP_HOURS) {
      return {
        key: 'poop-gap',
        warn: true,
        question: '宝宝两天多没便便了，正常吗？',
        text: `距上次便便记录已经 ${Math.floor(hours / 24)} 天了（${shortDate(formatDate(last.record_time))}）。先看看是不是这几天漏记了；如果确实这么久没拉，可以去 AI 助手里聊聊要不要紧。`,
      }
    }
  }

  // 4) 便便次数明显变多：单看次数说明不了什么，提示家长把性状一起看
  const poopCountOf = (dayList) => dayList.map((key) => (diaperMap[key] || []).filter(isPoop).length)
  const recentPoop = average(poopCountOf(recentKeys))
  const earlierPoop = average(poopCountOf(earlierKeys))
  if (recentPoop >= POOP_MANY_MIN && recentPoop - earlierPoop >= POOP_MANY_DELTA) {
    return {
      key: 'poop-many',
      warn: true,
      question: '宝宝最近便便次数变多了，需要担心吗？',
      text: `近 ${RECENT_DAYS} 天平均每天便便 ${recentPoop.toFixed(1)} 次，比之前 ${WINDOW_DAYS - RECENT_DAYS} 天的 ${earlierPoop.toFixed(1)} 次多。次数本身不一定是问题，把性状（稀/软/硬、颜色）一起看才准 —— 可以去 AI 助手里描述一下。`,
    }
  }

  // 5) 喂养次数明显变少
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

  // 6) 睡眠时长明显变短
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

  // 7) 夜醒变多：按「夜里（20:00 后入睡或凌晨 6:00 前入睡）分成几段睡」来数
  const nightCount = {}
  keys.forEach((key) => {
    nightCount[key] = 0
  })
  sleeps.forEach((row) => {
    if (!row.started_at) return
    const started = new Date(row.started_at)
    if (Number.isNaN(started.getTime())) return
    const hour = started.getHours()
    if (hour < 20 && hour >= 6) return
    const key = formatDate(row.started_at)
    if (nightCount[key] !== undefined) nightCount[key] += 1
  })
  const recentNight = average(recentKeys.map((key) => nightCount[key]))
  const earlierNight = average(earlierKeys.map((key) => nightCount[key]))
  if (earlierNight >= MIN_NIGHT_SEGMENTS && recentNight - earlierNight >= NIGHT_WAKE_DELTA) {
    return {
      key: 'night-wake',
      warn: true,
      question: '宝宝最近夜醒变多了，怎么办？',
      text: `近 ${RECENT_DAYS} 天夜里平均分成 ${recentNight.toFixed(1)} 段睡（之前 ${WINDOW_DAYS - RECENT_DAYS} 天是 ${earlierNight.toFixed(1)} 段），比之前醒得频繁。`,
    }
  }

  // 8) 都正常：给一句平淡的现状，让家长知道这个「AI 在看着」
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

/* ---------------------------------------------------------------------------
 * 作息预测：观察是「回头看」，这里是「往前看」
 * ------------------------------------------------------------------------- */

/** 中位数；空数组返回 null。比平均值抗异常值，所以节律类一律用它 */
function median(list) {
  if (!list.length) return null
  const sorted = list.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** 喂养间隔的合理区间：太短多半是补记、太长多半是漏记，都不该算进节律 */
const FEED_GAP_MIN_MINUTES = 30
const FEED_GAP_MAX_MINUTES = 8 * 60
/** 样本下限：少于这些就不说，宁可不显示，也不给一个「基于两天数据的规律」 */
const RHYTHM_MIN_GAPS = 5
const RHYTHM_MIN_DAYS = 3
/** 晚上几点之后开始的那段睡眠算「夜觉」 */
const NIGHT_FROM_HOUR = 18

/**
 * 按**自家**近几天的实际节律，给出接下来大概什么时候。
 *
 * 为什么也是规则而不是模型：这种「几点几分」的话，算错了比不说更糟 ——
 * 规则能一行行查，而且零额度、打开就有。
 * 与「AI 观察」互补：观察看最近发生了什么变化，这里看接下来大概的节奏。
 *
 * 只做两条，都是家长真的会拿来安排的：下一次喂养、夜里通常几点入睡。
 *
 * @param {object} params
 * @param {object} params.rows loadInsightRows() 的结果（近 7 天的喂养 / 睡眠）
 * @returns {Array<{key: string, text: string}>} 样本不够时返回空数组
 */
export function predictRhythm({ rows, now = new Date() } = {}) {
  const list = []
  const feedings = (rows && rows.feedings) || []
  const sleeps = (rows && rows.sleeps) || []

  // 1) 下一次喂养：相邻两次间隔的中位数
  const times = feedings
    .map((row) => new Date(row.record_time).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
  const gaps = []
  for (let i = 1; i < times.length; i += 1) {
    const minutes = (times[i] - times[i - 1]) / 60000
    if (minutes >= FEED_GAP_MIN_MINUTES && minutes <= FEED_GAP_MAX_MINUTES) gaps.push(minutes)
  }
  const feedDays = new Set(feedings.map((row) => formatDate(row.record_time))).size
  const medianGap = median(gaps)
  if (medianGap && gaps.length >= RHYTHM_MIN_GAPS && feedDays >= RHYTHM_MIN_DAYS && times.length) {
    const next = new Date(times[times.length - 1] + medianGap * 60000)
    const label = `最近 ${feedDays} 天平均间隔 ${formatMinutes(medianGap)}`
    list.push({
      key: 'rhythm-feed',
      text:
        next.getTime() <= now.getTime()
          ? `${label}，这会儿差不多该喂了。`
          : `${label}，下一次喂养大约 ${formatTime(next)}。`,
    })
  }

  // 2) 夜里入睡：每天取「18:00 之后开始的第一段睡眠」，再取这些时刻的中位数。
  //    用「18 点以后」而不是「零点以后」，是为了让跨零点的夜觉仍算在前一天那一晚，
  //    否则「22:00 睡」和「00:30 睡」会被算成两个不同的口径。
  const nightStarts = []
  const firstOfDay = {}
  sleeps.forEach((row) => {
    if (!row.started_at) return
    const started = new Date(row.started_at)
    if (Number.isNaN(started.getTime())) return
    if (started.getHours() < NIGHT_FROM_HOUR) return
    const key = formatDate(row.started_at)
    if (firstOfDay[key] === undefined || started.getTime() < firstOfDay[key]) {
      firstOfDay[key] = started.getTime()
    }
  })
  Object.keys(firstOfDay).forEach((key) => {
    const started = new Date(firstOfDay[key])
    nightStarts.push((started.getHours() - NIGHT_FROM_HOUR) * 60 + started.getMinutes())
  })
  const medianNight = median(nightStarts)
  if (medianNight !== null && nightStarts.length >= RHYTHM_MIN_DAYS) {
    const total = NIGHT_FROM_HOUR * 60 + Math.round(medianNight)
    const at = new Date(now)
    at.setHours(Math.floor(total / 60) % 24, total % 60, 0, 0)
    list.push({
      key: 'rhythm-night',
      text: `最近 ${nightStarts.length} 天，通常 ${formatTime(at)} 前后开始睡夜觉。`,
    })
  }

  return list
}
