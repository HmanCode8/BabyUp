/**
 * 成长报告的聚合逻辑（二期 Step 9）。
 *
 * 实时聚合、不落库（需求文档 1.3 原则 4），口径见 4.8：
 *   照片：所选月份内最多 9 张（封面九宫格）
 *   生长：当月身高/体重/头围的首末值
 *   喂养/睡眠/便便：当月统计数字
 *   里程碑：当月打卡列表
 * 时间范围一律「本地当月 1 日 00:00 ~ 次月 1 日 00:00」，
 * 睡眠跨月按重叠部分裁剪（复用日小结同一套 clipMinutes）。
 */
import { listFeedings } from './feeding'
import { listSleeps } from './sleep'
import { listDiapers } from './diaper'
import { listPhotos } from './photo'
import { listGrowthRecords } from './growth'
import { listMilestones } from './milestone'
import {
  localMonthRange,
  monthDateRange,
  monthLabel,
  clipMinutes,
  formatMinutes,
} from '@/utils/date'

/** 封面九宫格最多 9 张 */
const MAX_PHOTOS = 9
/** 报告里最多列出的里程碑条数（图面高度固定，超出部分不再画） */
const MAX_MILESTONES = 3

function sumBy(rows, field) {
  return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0)
}

/** 首末值文案：'身高 62 → 68 cm'；只有一个值时不带箭头 */
function rangeText(label, first, last, unit) {
  if (first == null) return ''
  if (last == null || last === first) return `${label} ${first} ${unit}`
  return `${label} ${first} → ${last} ${unit}`
}

/**
 * 聚合某个宝宝某个月份的报告。
 * @param {object} params { familyId, babyId, month = 'YYYY-MM' }
 */
export async function buildMonthlyReport({ familyId, babyId, month }) {
  if (!familyId || !babyId) return emptyReport(month)

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

  const report = {
    month,
    monthLabel: monthLabel(month),
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

/** 报告图上的统计文案行（图面固定 6 行位置，这里只负责生成内容） */
export function reportTextLines(report) {
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

  if (!lines.length) lines.push('本月暂无数据')
  return lines.slice(0, 6)
}
