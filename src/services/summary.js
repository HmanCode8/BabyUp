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
import { todayString, localDayRange, clipMinutes } from '@/utils/date'

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
