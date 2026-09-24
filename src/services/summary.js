/**
 * 每日小结的聚合逻辑（二期 P0-5）。
 *
 * 实时聚合、不落库（需求文档 1.3 原则 4）；口径见 4.8：
 *   喂养：总次数 / 母乳总时长 / 配方奶总毫升 / 水总毫升 / 辅食次数
 *   睡眠：总时长（跨天睡眠只算落在「今天」的那一段，正在睡算到此刻）
 *   便便：次数 + 最近一次的性状/颜色
 *   照片：当日新增张数
 *   生长：当日有记录则展示
 *   疫苗：已逾期 / 近 7 天到期 条数
 *
 * 时间范围一律「本地今天 00:00 ~ 次日 00:00」，查询只加下界（gte），
 * 上界在内存里裁掉——数据量很小，省掉 PostgREST 同列区间的复杂写法。
 */
import { listFeedings } from './feeding'
import { listSleeps } from './sleep'
import { listDiapers } from './diaper'
import { listPhotos } from './photo'
import { listGrowthRecords } from './growth'
import { listVaccinations, summarizeVaccinations } from './vaccine'
import {
  todayString,
  localDayRange,
  clipMinutes,
  formatDate,
  shiftDate,
} from '@/utils/date'

/** 空小结：页面据此显示空态 */
function emptySummary(date) {
  return {
    date,
    hasAny: false,
    feeding: { total: 0, breastMinutes: 0, formulaMl: 0, waterMl: 0, solidCount: 0, items: [] },
    sleep: { totalMinutes: 0, items: [] },
    diaper: { total: 0, last: null, items: [] },
    photo: { count: 0, items: [] },
    growth: { items: [] },
    vaccine: { overdue: 0, soon: 0, pending: 0, vaccinated: 0, todo: 0 },
  }
}

function sumBy(rows, field) {
  return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0)
}

/**
 * 聚合某个宝宝某一天的小结。
 * @param {object} params { familyId, babyId, date } date 默认本地今天
 */
export async function buildDailySummary({ familyId, babyId, date = todayString() }) {
  if (!familyId || !babyId) return emptySummary(date)

  const { startIso, endIso } = localDayRange(date)
  const endTime = new Date(endIso).getTime()
  const now = Date.now()
  const withinDay = (iso) => new Date(iso).getTime() < endTime

  const [feedingRows, sleepRows, diaperRows, photoResult, growthRows, vaccineRows] =
    await Promise.all([
      listFeedings(familyId, babyId, { fromIso: startIso, limit: 100 }),
      listSleeps(familyId, babyId, { limit: 20 }),
      listDiapers(familyId, babyId, { fromIso: startIso, limit: 100 }),
      listPhotos({ familyId, babyId, fromIso: startIso, limit: 30 }),
      listGrowthRecords(familyId, babyId),
      listVaccinations(familyId, babyId),
    ])

  const feedings = feedingRows.filter((row) => withinDay(row.record_time))
  const diapers = diaperRows.filter((row) => withinDay(row.record_time))
  const photos = (photoResult.items || []).filter((row) => withinDay(row.taken_at))
  const growths = growthRows.filter((row) => row.record_date === date)

  // 睡眠：只保留落在今天的时段（跨天睡眠计入今天的那部分，正在睡算到此刻）
  const sleeps = sleepRows
    .map((row) => ({
      ...row,
      minutes: clipMinutes(row.started_at, row.ended_at, startIso, endIso, now),
      sleeping: !row.ended_at,
    }))
    .filter((row) => row.minutes > 0)

  const breast = feedings.filter((row) => row.feed_type === 'breast')
  const formula = feedings.filter((row) => row.feed_type === 'formula')
  const water = feedings.filter((row) => row.feed_type === 'water')
  const solid = feedings.filter((row) => row.feed_type === 'solid')

  const summary = {
    date,
    feeding: {
      total: feedings.length,
      breastMinutes: sumBy(breast, 'duration_min'),
      formulaMl: sumBy(formula, 'amount_ml'),
      waterMl: sumBy(water, 'amount_ml'),
      solidCount: solid.length,
      items: feedings,
    },
    sleep: {
      totalMinutes: sleeps.reduce((total, row) => total + row.minutes, 0),
      items: sleeps,
    },
    diaper: {
      total: diapers.length,
      // 列表已按时间倒序，第一条就是最近一次
      last: diapers.length
        ? {
            type: diapers[0].diaper_type,
            character: diapers[0].poop_character,
            color: diapers[0].poop_color,
          }
        : null,
      // 「最近一次性状/颜色」取最近一条带性状或颜色的记录：
      // 纯尿没有性状颜色可展示，若只取第一条，刚换完尿布后就会把便便的性状颜色挤掉
      lastPoop: (() => {
        const found = diapers.find((row) => row.poop_character || row.poop_color)
        return found
          ? { type: found.diaper_type, character: found.poop_character, color: found.poop_color }
          : null
      })(),
      items: diapers,
    },
    photo: { count: photos.length, items: photos },
    growth: { items: growths },
    vaccine: summarizeVaccinations(vaccineRows, date),
  }

  summary.hasAny = Boolean(
    summary.feeding.total ||
      summary.sleep.totalMinutes ||
      summary.diaper.total ||
      summary.photo.count ||
      summary.growth.items.length ||
      summary.vaccine.overdue ||
      summary.vaccine.soon,
  )

  return summary
}

/**
 * 一天的空桶。
 * 除了每日小结页要的三个汇总数字，还顺手留住原始记录（items）——
 * 页面上「展开明细」要按时间看这一天具体做了什么，而这些行本来就已经查出来了，
 * 不留下来就得为每一次展开再发一轮请求。
 */
function emptyDay(date) {
  return {
    date,
    feeding: { total: 0, breastMinutes: 0, formulaMl: 0, waterMl: 0, solidCount: 0, items: [] },
    sleep: { totalMinutes: 0, items: [] },
    diaper: { total: 0, items: [] },
  }
}

/** 这一天有没有任何记录（页面据此显示空态、并决定要不要摆「与前一天对比」） */
function hasAnyRecord(day) {
  return Boolean(day.feeding.total || day.sleep.totalMinutes || day.diaper.total)
}

/**
 * 连续多天的每日小结（「每日小结」历史页用）。
 *
 * 与 buildDailySummary 的三点差别：
 *  1. 只聚合每日小结页需要的一类：喂养 / 睡眠 / 便便（不查照片、生长、疫苗）；
 *  2. 整段区间只发 3 个请求，再在内存里按「本地天」分桶，
 *     而不是「一天 6 个请求 × N 天」，避免把免费额度打满；
 *  3. 区间往前多算一天当基准，让返回的每一天都有可对比的「前一天」。
 *
 * 睡眠按入睡时间取整段区间，再逐天做重叠裁剪：21:00 睡到次日 6:30 的一觉，
 * 两天的时长各自只算落在自己那一段的部分（与今日小结同一套 clipMinutes）。
 *
 * @param {object} params { familyId, babyId, days = 7, endDate = todayString() }
 * @returns {Promise<Array>} 按日期升序，每项 { date, feeding, sleep, diaper, hasAny, prev, prevHasAny }
 */
export async function buildDailySummaries({ familyId, babyId, days = 7, endDate = todayString() }) {
  const count = Math.max(1, Math.floor(Number(days) || 1))
  const lastDate = endDate
  const firstDate = shiftDate(lastDate, -(count - 1))
  // 基准日：不返回，只用来给 firstDate 提供「前一天」的对比数据
  const baselineDate = shiftDate(firstDate, -1)

  const dayKeys = []
  for (let index = 0; index <= count; index += 1) {
    dayKeys.push(shiftDate(baselineDate, index))
  }
  const buckets = new Map(dayKeys.map((key) => [key, emptyDay(key)]))

  if (familyId && babyId) {
    const { startIso } = localDayRange(baselineDate)
    const { endIso } = localDayRange(lastDate)
    // 睡眠的过滤字段是入睡时间，往前多留一天，才能把「基准日前一晚入睡」那条捞进来
    const sleepFromIso = new Date(new Date(startIso).getTime() - 86400000).toISOString()
    const nowIso = new Date().toISOString()

    const [feedingRows, sleepRows, diaperRows] = await Promise.all([
      listFeedings(familyId, babyId, { fromIso: startIso, toIso: endIso, limit: 500 }),
      listSleeps(familyId, babyId, { fromIso: sleepFromIso, limit: 500 }),
      listDiapers(familyId, babyId, { fromIso: startIso, toIso: endIso, limit: 500 }),
    ])

    feedingRows.forEach((row) => {
      const bucket = buckets.get(formatDate(row.record_time))
      if (!bucket) return
      bucket.feeding.total += 1
      if (row.feed_type === 'breast') {
        bucket.feeding.breastMinutes += Number(row.duration_min) || 0
      } else if (row.feed_type === 'formula') {
        bucket.feeding.formulaMl += Number(row.amount_ml) || 0
      } else if (row.feed_type === 'water') {
        bucket.feeding.waterMl += Number(row.amount_ml) || 0
      } else if (row.feed_type === 'solid') {
        bucket.feeding.solidCount += 1
      }
      bucket.feeding.items.push(row)
    })

    diaperRows.forEach((row) => {
      const bucket = buckets.get(formatDate(row.record_time))
      if (!bucket) return
      bucket.diaper.total += 1
      bucket.diaper.items.push(row)
    })

    sleepRows.forEach((row) => {
      dayKeys.forEach((key) => {
        const { startIso: dayStartIso, endIso: dayEndIso } = localDayRange(key)
        const minutes = clipMinutes(row.started_at, row.ended_at, dayStartIso, dayEndIso, nowIso)
        if (minutes > 0) {
          const bucket = buckets.get(key)
          bucket.sleep.totalMinutes += minutes
          // minutes 是这一天的裁剪值、dayDate 是它落在哪一天：
          // 跨夜那一觉会同时进两天，明细里靠 dayDate 判断要不要标「跨夜」
          bucket.sleep.items.push({ ...row, minutes, dayDate: key, sleeping: !row.ended_at })
        }
      })
    })
  }

  // 丢掉基准日，只返回页面上要显示的这些天；每天带上「前一天」供页面算增减
  return dayKeys.slice(1).map((key) => {
    const day = buckets.get(key)
    const prev = buckets.get(shiftDate(key, -1))
    return {
      ...day,
      hasAny: hasAnyRecord(day),
      prev,
      prevHasAny: hasAnyRecord(prev),
    }
  })
}
