/**
 * 日期工具。
 *
 * 不用 toISOString()：它按 UTC 输出，东八区下午 16 点后取到的日期会少一天，
 * 导致「今天」不能被选中。
 */

/** 本地时区的今天，格式 YYYY-MM-DD */
export function todayString() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** ISO 时间 -> { key: '2026-9', label: '2026年9月' }，按本地时区归月 */
export function localMonth(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return { key: 'unknown', label: '未知时间' }
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  return { key: `${year}-${month}`, label: `${year}年${month}月` }
}

/** ISO 时间 -> '2026-09-17 16:30'（本地时区） */
export function formatDateTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

/** ISO 时间 -> '2026-09-17'（本地时区） */
export function formatDate(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** ISO 时间 -> '16:30'（本地时区） */
export function formatTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 本地时区的当前时刻，格式 HH:mm（表单时间默认值） */
export function nowTimeString() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/**
 * 本地日期 + 本地时间 -> ISO 绝对时刻。
 * 必须走本地 Date 再 toISOString：直接拼 'YYYY-MM-DDTHH:mm:ss' 交给 PostgreSQL
 * 会被当成 UTC 解析，东八区整体差 8 小时（一期踩过这个坑）。
 */
export function toIsoFromLocal(dateStr, timeStr = '00:00') {
  const [year, month, day] = String(dateStr).split('-').map(Number)
  const [hour, minute] = String(timeStr || '00:00').split(':').map(Number)
  const date = new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0, 0)
  return date.toISOString()
}

/**
 * 本地某一天的起点 ISO（用于 timestamptz 的 gte 过滤）。
 * 例：'2026-09-17' -> 本地 2026-09-17 00:00 对应的 UTC 时刻。
 */
export function localDayStartIso(dateStr) {
  const [year, month, day] = String(dateStr).split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0).toISOString()
}

/**
 * 本地某一天的完整区间 [当日 00:00, 次日 00:00)。
 * 聚合「今日」数据用它，避免跨时区/跨天错账（需求文档 9.5）。
 */
export function localDayRange(dateStr) {
  const [year, month, day] = String(dateStr).split('-').map(Number)
  const start = new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0)
  const end = new Date(year, (month || 1) - 1, (day || 1) + 1, 0, 0, 0, 0)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

/** 分钟数 -> '9 小时 30 分钟'；0 或负数返回空串 */
export function formatMinutes(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0))
  if (minutes <= 0) return ''
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours && rest) return `${hours} 小时 ${rest} 分钟`
  if (hours) return `${hours} 小时`
  return `${rest} 分钟`
}

/**
 * 一段区间落在 [rangeStartIso, rangeEndIso) 内的分钟数（跨天/跨月裁剪）。
 * endIso 为空表示还在进行中，按 nowIso 算。用于睡眠时长统计，对不重叠返回 0。
 */
export function clipMinutes(startIso, endIso, rangeStartIso, rangeEndIso, nowIso) {
  const start = Math.max(new Date(startIso).getTime(), new Date(rangeStartIso).getTime())
  const end = Math.min(
    new Date(endIso || nowIso || new Date().toISOString()).getTime(),
    new Date(rangeEndIso).getTime(),
  )
  if (!(end > start)) return 0
  return Math.round((end - start) / 60000)
}

/** 'YYYY-MM' -> '2026年8月' */
export function monthLabel(monthStr) {
  const [year, month] = String(monthStr).split('-').map(Number)
  if (!year || !month) return String(monthStr || '')
  return `${year}年${month}月`
}

/** 本地当前月份，格式 YYYY-MM */
export function currentMonthString() {
  return todayString().slice(0, 7)
}

/** 本地上一个月，格式 YYYY-MM（报告默认选中上月） */
export function previousMonthString() {
  const now = new Date()
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${date.getFullYear()}-${month}`
}

/**
 * 本地某个月的完整区间 [当月 1 日 00:00, 次月 1 日 00:00)。
 * 与 localDayRange 同一思路：月末天数交给 Date 自己算，避免手写 28/30/31。
 */
export function localMonthRange(monthStr) {
  const [year, month] = String(monthStr).split('-').map(Number)
  const start = new Date(year, (month || 1) - 1, 1, 0, 0, 0, 0)
  const end = new Date(year, month || 1, 1, 0, 0, 0, 0)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

/**
 * 本地某个月的日期区间，给 date 类型字段（record_date / achieved_date）过滤用。
 * 例：'2026-02' -> { startDate: '2026-02-01', endDate: '2026-02-28' }
 */
export function monthDateRange(monthStr) {
  const [year, month] = String(monthStr).split('-').map(Number)
  const lastDay = new Date(year, month || 1, 0).getDate()
  const mm = String(month || 1).padStart(2, '0')
  return {
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  }
}

/**
 * 两个 YYYY-MM-DD 相差的天数（to - from），负数表示 to 已过去。
 * 显式补 T00:00:00 走本地时区，避免被当成 UTC 解析而整体偏移一天。
 */
export function diffDays(from, to) {
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0
  return Math.round((end.getTime() - start.getTime()) / 86400000)
}
