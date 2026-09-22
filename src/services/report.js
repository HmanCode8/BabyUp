/**
 * 成长报告的聚合逻辑（二期 Step 9 月度 / 三期 Step 5 年度）。
 *
 * 实时聚合、不落库（需求文档 1.3 原则 4）：
 *   月度（range='month'）：照片 9 张 / 生长首末值 / 喂养·睡眠·便便统计 / 里程碑
 *   年度（range='year'）：年龄 / 记录总条数 / 照片数 / 身高体重年初→年末 /
 *                        疫苗·生病·儿保体检次数 / 全部里程碑
 * 时间范围一律本地时区，月度取「当月 1 日 ~ 次月 1 日」，年度取「1 月 1 日 ~ 12 月 31 日」，
 * 睡眠跨期按重叠部分裁剪（复用日小结同一套 clipMinutes）。
 *
 * 年度为什么只用 count 不用明细：云开发单次查询上限 1000 条，一年喂养记录可能两三千条，
 * 拉明细再 `length` 会把总数算少，所以年度用 count 查询取总数（与 Supabase 的
 * Prefer: count=exact 同形），明细只拉「本来就不多」的生长记录和里程碑。
 */
import { api } from './api'
import { listFeedings } from './feeding'
import { listSleeps } from './sleep'
import { listDiapers } from './diaper'
import { listPhotos } from './photo'
import { listGrowthRecords } from './growth'
import { listMilestones } from './milestone'
import { formatAge } from '@/utils/age'
import {
  localMonthRange,
  monthDateRange,
  monthLabel,
  clipMinutes,
  formatMinutes,
  todayString,
} from '@/utils/date'

/** 封面九宫格最多 9 张 */
const MAX_PHOTOS = 9
/** 月度报告里最多列出的里程碑条数（月度图面高度固定，超出部分不再画） */
const MAX_MILESTONES = 3
/** 年度报告要「列出全部里程碑文字」，画布高度会按条数撑开，这里只做兜底上限 */
const MAX_YEAR_MILESTONES = 50
/** 年度报告数据区最多画多少行（画布高度按实际行数撑开，这里只是兜底） */
const MAX_YEAR_DATA_LINES = 10

function sumBy(rows, field) {
  return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0)
}

/** 只取总数不取明细（年度统计用，见文件头说明） */
async function countRows(table, match, filters) {
  const { total } = await api.db.select(table, {
    select: '*',
    match,
    filters,
    limit: 1,
    count: true,
  })
  return total || 0
}

/** 期间文案：'2026-08' -> 2026年8月（本月）；'2026' -> 2026年（本年） */
function periodInfo(range, period) {
  return range === 'year'
    ? { label: `${period}年`, text: '本年' }
    : { label: monthLabel(period), text: '本月' }
}

/** 首末值文案：'身高 62 → 68 cm'；只有一个值时不带箭头 */
function rangeText(label, first, last, unit) {
  if (first == null) return ''
  if (last == null || last === first) return `${label} ${first} ${unit}`
  return `${label} ${first} → ${last} ${unit}`
}

/** 没有家庭/宝宝时的空报告：结构完整（页面读 hasAny 就能兜住），字段全部为 0/空 */
function emptyReport(period, range) {
  const info = periodInfo(range, period)
  return {
    range,
    period,
    periodLabel: info.label,
    periodText: info.text,
    photos: [],
    photoCount: 0,
    totalCount: 0,
    feeding: { total: 0, breastMinutes: 0, formulaMl: 0, waterMl: 0, solidCount: 0 },
    sleep: { totalMinutes: 0, count: 0 },
    diaper: { total: 0 },
    growth: { items: [], lines: [] },
    milestones: [],
    milestoneTotal: 0,
    vaccineCount: 0,
    illnessCount: 0,
    checkupCount: 0,
    hasAny: false,
  }
}

/**
 * 聚合某个宝宝某个月份的报告。
 * @param {object} params { familyId, babyId, month = 'YYYY-MM' }
 */
export async function buildMonthlyReport({ familyId, babyId, month }) {
  if (!familyId || !babyId) return emptyReport(month, 'month')

  const { startIso, endIso } = localMonthRange(month)
  const { startDate, endDate } = monthDateRange(month)
  const nowIso = new Date().toISOString()
  // 睡眠按入睡时间过滤：往前多留一天，保证「上月最后一天入睡、本月 1 日醒来」那条能进来
  const sleepFromIso = new Date(new Date(startIso).getTime() - 86400000).toISOString()

  const [feedingRows, sleepRows, diaperRows, photoResult, growthRows, milestoneRows] =
    await Promise.all([
      listFeedings(familyId, babyId, { fromIso: startIso, toIso: endIso, limit: 500 }),
      listSleeps(familyId, babyId, { fromIso: sleepFromIso, limit: 500 }),
      listDiapers(familyId, babyId, { fromIso: startIso, toIso: endIso, limit: 500 }),
      listPhotos({ familyId, babyId, fromIso: startIso, toIso: endIso, limit: MAX_PHOTOS }),
      listGrowthRecords(familyId, babyId),
      listMilestones(familyId, babyId, { fromDate: startDate, toDate: endDate, limit: 20 }),
    ])

  const feedings = feedingRows
  const photos = (photoResult.items || []).slice(0, MAX_PHOTOS)
  const growths = growthRows.filter(
    (row) => row.record_date >= startDate && row.record_date <= endDate,
  )
  // 跨月睡眠只算落在本月的那一段；正在睡算到此刻
  const sleeps = sleepRows
    .map((row) => ({
      ...row,
      minutes: clipMinutes(row.started_at, row.ended_at, startIso, endIso, nowIso),
    }))
    .filter((row) => row.minutes > 0)

  const growthLines = []
  if (growths.length) {
    const first = growths[0]
    const last = growths[growths.length - 1]
    const height = rangeText('身高', first.height_cm, last.height_cm, 'cm')
    const weight = rangeText('体重', first.weight_kg, last.weight_kg, 'kg')
    const head = rangeText('头围', first.head_cm, last.head_cm, 'cm')
    if (height) growthLines.push(height)
    if (weight) growthLines.push(weight)
    if (head) growthLines.push(head)
  }

  const info = periodInfo('month', month)
  const report = {
    range: 'month',
    period: month,
    periodLabel: info.label,
    periodText: info.text,
    photos,
    photoCount: photoResult.total === null ? photos.length : photoResult.total,
    feeding: {
      total: feedings.length,
      breastMinutes: sumBy(
        feedings.filter((row) => row.feed_type === 'breast'),
        'duration_min',
      ),
      formulaMl: sumBy(
        feedings.filter((row) => row.feed_type === 'formula'),
        'amount_ml',
      ),
      waterMl: sumBy(
        feedings.filter((row) => row.feed_type === 'water'),
        'amount_ml',
      ),
      solidCount: feedings.filter((row) => row.feed_type === 'solid').length,
    },
    sleep: {
      totalMinutes: sleeps.reduce((total, row) => total + row.minutes, 0),
      count: sleeps.length,
    },
    diaper: { total: diaperRows.length },
    growth: { items: growths, lines: growthLines },
    milestones: milestoneRows.slice(0, MAX_MILESTONES).map((row) => ({
      id: row.id,
      title: row.name,
      date: row.achieved_date,
    })),
    milestoneTotal: milestoneRows.length,
  }

  report.hasAny = Boolean(
    photos.length ||
      feedings.length ||
      report.sleep.totalMinutes ||
      diaperRows.length ||
      growths.length ||
      milestoneRows.length,
  )

  return report
}

/**
 * 聚合某个宝宝某一年的报告（三期 P0-5 年度报告）。
 *
 * 与月度报告的口径差异（见文件头）：年度统计一律走 count、不拉明细
 * （云开发单次查询上限 1000 条，一年的喂养/便便记录很容易超过），
 * 只有「本来就不多」的两类拉明细：生长记录（要取年初/年末值）、里程碑（要列出全部文字）。
 *
 * @param {object} params { familyId, babyId, year = 'YYYY', birthday = 'YYYY-MM-DD' }
 */
export async function buildYearlyReport({ familyId, babyId, year, birthday }) {
  if (!familyId || !babyId) return emptyReport(year, 'year')

  const startDate = `${year}-01-01`
  const endDate = `${year}-12-31`
  // 本地「年初 00:00 ~ 次年年初 00:00」左闭右开，与 localMonthRange 同一套算法
  const startIso = new Date(`${startDate}T00:00:00`).toISOString()
  const endIso = new Date(`${Number(year) + 1}-01-01T00:00:00`).toISOString()
  const match = { family_id: familyId, baby_id: babyId }
  /** 时刻字段（timestamp）用左闭右开区间 */
  const momentRange = [`gte.${startIso}`, `lt.${endIso}`]
  /** 日期字段（'YYYY-MM-DD'）用闭区间 */
  const dayRange = [`gte.${startDate}`, `lte.${endDate}`]

  const [
    feedingTotal,
    sleepTotal,
    diaperTotal,
    photoResult,
    growthRows,
    milestoneRows,
    vaccineCount,
    illnessCount,
    checkupCount,
  ] = await Promise.all([
    countRows('feeding_records', match, { record_time: momentRange }),
    countRows('sleep_records', match, { started_at: momentRange }),
    countRows('diaper_records', match, { record_time: momentRange }),
    listPhotos({ familyId, babyId, fromIso: startIso, toIso: endIso, limit: MAX_PHOTOS }),
    listGrowthRecords(familyId, babyId),
    listMilestones(familyId, babyId, { fromDate: startDate, toDate: endDate, limit: 200 }),
    countRows('vaccinations', match, { vaccinated_date: dayRange }),
    countRows('illness_records', match, { occurred_at: momentRange }),
    countRows('checkup_records', match, { checkup_date: dayRange }),
  ])

  const photos = (photoResult.items || []).slice(0, MAX_PHOTOS)
  const photoCount = photoResult.total === null ? photos.length : photoResult.total
  const growths = growthRows.filter(
    (row) => row.record_date >= startDate && row.record_date <= endDate,
  )

  // 身高/体重/头围一律「年初第一条 → 年末最后一条」（listGrowthRecords 已按日期升序）
  const growthLines = []
  if (growths.length) {
    const first = growths[0]
    const last = growths[growths.length - 1]
    const height = rangeText('身高', first.height_cm, last.height_cm, 'cm')
    const weight = rangeText('体重', first.weight_kg, last.weight_kg, 'kg')
    const head = rangeText('头围', first.head_cm, last.head_cm, 'cm')
    if (height) growthLines.push(height)
    if (weight) growthLines.push(weight)
    if (head) growthLines.push(head)
  }

  // 「共记录 N 条」= 这一年所有记录类数据的总数。体检联动出的生长记录会被重复计一次，
  // 但用户视角里「体检」和「生长」本来就是两条记录，这里不特意扣除。
  const totalCount =
    feedingTotal +
    sleepTotal +
    diaperTotal +
    photoCount +
    growths.length +
    milestoneRows.length +
    vaccineCount +
    illnessCount +
    checkupCount

  const info = periodInfo('year', year)
  return {
    range: 'year',
    period: year,
    periodLabel: info.label,
    periodText: info.text,
    ageText: formatAge(birthday, todayString()),
    photos,
    photoCount,
    totalCount,
    counts: {
      feeding: feedingTotal,
      sleep: sleepTotal,
      diaper: diaperTotal,
      photo: photoCount,
      growth: growths.length,
      milestone: milestoneRows.length,
      vaccine: vaccineCount,
      illness: illnessCount,
      checkup: checkupCount,
    },
    growth: { items: growths, lines: growthLines },
    milestones: milestoneRows.slice(0, MAX_YEAR_MILESTONES).map((row) => ({
      id: row.id,
      title: row.name,
      date: row.achieved_date,
    })),
    milestoneTotal: milestoneRows.length,
    vaccineCount,
    illnessCount,
    checkupCount,
    hasAny: totalCount > 0,
  }
}

/** 报告图上的统计文案行（月度固定 6 行位置 / 年度按行数撑开，这里只负责生成内容） */
export function reportTextLines(report) {
  if (report && report.range === 'year') return yearTextLines(report)

  const lines = []
  const { feeding, sleep, diaper } = report

  const feedParts = []
  if (feeding.total) feedParts.push(`喂养 ${feeding.total} 次`)
  if (feeding.breastMinutes) feedParts.push(`母乳 ${feeding.breastMinutes} 分钟`)
  if (feeding.formulaMl) feedParts.push(`配方奶 ${feeding.formulaMl} ml`)
  if (feedParts.length) lines.push(feedParts.join(' · '))

  const otherParts = []
  if (feeding.waterMl) otherParts.push(`水 ${feeding.waterMl} ml`)
  if (feeding.solidCount) otherParts.push(`辅食 ${feeding.solidCount} 次`)
  if (otherParts.length) lines.push(otherParts.join(' · '))

  const sleepText = formatMinutes(sleep.totalMinutes)
  if (sleepText) lines.push(`睡眠 ${sleepText}`)

  if (diaper.total) lines.push(`便便 ${diaper.total} 次`)

  ;(report.growth.lines || []).forEach((line) => lines.push(line))

  if (!lines.length) lines.push(`${report.periodText}暂无数据`)
  return lines.slice(0, 6)
}

/** 年度报告的数据行：年龄 / 共记录条数 / 照片 / 身高体重变化 / 疫苗·生病·儿保次数 */
function yearTextLines(report) {
  const lines = []
  if (report.ageText) lines.push(`年龄 ${report.ageText}`)
  if (report.totalCount) lines.push(`共记录 ${report.totalCount} 条`)
  if (report.photoCount) lines.push(`照片 ${report.photoCount} 张`)
  ;(report.growth.lines || []).forEach((line) => lines.push(line))

  const health = []
  if (report.vaccineCount) health.push(`疫苗 ${report.vaccineCount} 剂`)
  if (report.illnessCount) health.push(`生病 ${report.illnessCount} 次`)
  if (report.checkupCount) health.push(`儿保体检 ${report.checkupCount} 次`)
  if (health.length) lines.push(health.join(' · '))

  if (!lines.length) lines.push(`${report.periodText}暂无数据`)
  return lines.slice(0, MAX_YEAR_DATA_LINES)
}
