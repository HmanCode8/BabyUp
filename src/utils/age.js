/**
 * 宝宝月龄计算（补丁 Step 5，对应文档 4.7「月龄计算」/ 5.1）。
 *
 * 规则（文档要求）：
 *   - 不足 1 岁 → 「X个月X天」
 *   - 满 1 岁   → 「X岁X个月X天」
 *   - 跨月按自然月天数差精确计算，不能用 30 天近似
 *
 * 实现要点：月龄 = 满足「生日推进 M 个自然月（日号夹到目标月最后一天）
 * 不超过今天」的最大 M，余下的天数再单独数。这样：
 *   - 不会把 30 天硬当一个月（2 月 28 日对 1 月 31 日出生的宝宝就是「满 1 个月」）；
 *   - 闰日出生（2 月 29 日）在次年 2 月 28 日也算「满 1 岁」，不会卡在 11 个月 30 天。
 *
 * 本文件刻意不 import 任何模块，便于单独做单元测试。
 */

/** 某年某月的天数（month 为 1~12） */
function daysInMonth(year, month) {
  // 下个月的第 0 天 = 本月最后一天，交给 Date 自己处理闰年
  return new Date(year, month, 0).getDate()
}

/** 'YYYY-MM-DD' 或 Date -> { year, month, day }；非法返回 null */
function parseDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() }
  }
  const matched = String(value || '')
    .trim()
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!matched) return null
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (!year || !month || !day || month > 12 || day > 31) return null
  return { year, month, day }
}

/** 两个日期相差的天数（to - from），按本地时区，避免被当 UTC 解析而整体偏移 */
function daysBetween(from, to) {
  const start = new Date(from.year, from.month - 1, from.day).getTime()
  const end = new Date(to.year, to.month - 1, to.day).getTime()
  return Math.round((end - start) / 86400000)
}

/** 比较两个日期：a<b 返回负数，相等 0，a>b 正数 */
function compareDates(a, b) {
  return daysBetween(b, a)
}

/** 生日往后推进 months 个自然月；日号夹到目标月的最后一天（1月31日 + 1月 = 2月28/29日） */
function addMonthsClamped(birth, months) {
  const monthIndex = birth.month - 1 + months
  const year = birth.year + Math.floor(monthIndex / 12)
  const month = (monthIndex % 12) + 1
  const day = Math.min(birth.day, daysInMonth(year, month))
  return { year, month, day }
}

/**
 * 计算月龄。
 *
 * @param {string|Date} birthday 宝宝生日，'YYYY-MM-DD'
 * @param {string|Date} [now] 参照时刻，默认当前时间
 * @returns {{ years: number, months: number, days: number, totalMonths: number } | null}
 *          生日非法或还没出生时返回 null
 */
export function ageParts(birthday, now) {
  const birth = parseDate(birthday)
  const ref = parseDate(now || new Date())
  if (!birth || !ref) return null
  if (daysBetween(birth, ref) < 0) return null

  // 已经满的月数：满足「推进 M 个月不超过今天」的最大 M
  let totalMonths = (ref.year - birth.year) * 12 + (ref.month - birth.month)
  if (totalMonths < 0) totalMonths = 0
  if (compareDates(addMonthsClamped(birth, totalMonths), ref) > 0) totalMonths -= 1
  if (totalMonths < 0) totalMonths = 0

  const anchor = addMonthsClamped(birth, totalMonths)
  const days = Math.max(0, daysBetween(anchor, ref))

  return {
    years: Math.floor(totalMonths / 12),
    months: totalMonths % 12,
    days,
    totalMonths,
  }
}

/**
 * 月龄展示文案。
 * 不满 1 岁 → 「X个月X天」；满 1 岁 → 「X岁X个月X天」。
 * 生日缺失/非法/尚未出生时返回空串，调用方据此不展示。
 */
export function formatAge(birthday, now) {
  const parts = ageParts(birthday, now)
  if (!parts) return ''
  if (parts.years > 0) return `${parts.years}岁${parts.months}个月${parts.days}天`
  return `${parts.months}个月${parts.days}天`
}
