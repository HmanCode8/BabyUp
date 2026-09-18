/**
 * 疫苗推荐库（vaccine_library）数据访问层 —— 补丁 Step 6「疫苗知识库」。
 *
 * 这张表是开发者维护的公共知识库：RLS 只开了 select（任何登录用户可读、前端不可写），
 * 所以本文件只有查询与月龄规则，没有增删改。
 * 「一键添加」是把库里的名称/剂次复制进 vaccinations，写入仍走 vaccine.js 的
 * createVaccination，避免两处各写一份插入逻辑。
 */
import { supabase } from './supabase'
import { todayString } from '@/utils/date'

const LIBRARY_COLUMNS = 'id,name,dose,min_age_month,max_age_month,category,sort_order'

/** 类别展示文案（与数据库 check 约束一致）：free=一类(免费) / paid=二类(自费) */
export const VACCINE_CATEGORY_LABEL = {
  free: '一类（免费）',
  paid: '二类（自费）',
}

/** 列表行里的短标签，避免一行里塞太多字 */
export const VACCINE_CATEGORY_TAG = {
  free: '免费',
  paid: '自费',
}

/**
 * 拉取全部推荐库条目，按 sort_order 升序（与迁移 009 的种子顺序一致）。
 * 种子只有二十多条，一次取回、页面内按 tab 过滤，切 tab 不必再发请求。
 */
export async function listVaccineLibrary() {
  const { data } = await supabase.db.select('vaccine_library', {
    select: LIBRARY_COLUMNS,
    order: 'sort_order.asc',
    limit: 200,
  })
  return data || []
}

/** 单个建议月龄的文案：整数不带小数点（2月），numeric(4,1) 的小数保留一位（2.5月） */
function formatMonth(value) {
  const month = Number(value)
  if (!Number.isFinite(month)) return '—'
  return `${Number.isInteger(month) ? month : month.toFixed(1)}月`
}

/**
 * 建议月龄文案：'2月' / '2月~4月' / '18月以上'（max_age_month 为空 = 不限）。
 */
export function formatMonthRange(minAgeMonth, maxAgeMonth) {
  const minText = formatMonth(minAgeMonth)
  if (maxAgeMonth === null || maxAgeMonth === undefined || maxAgeMonth === '') {
    return `${minText}以上`
  }
  const maxText = formatMonth(maxAgeMonth)
  return minText === maxText ? minText : `${minText}~${maxText}`
}

/**
 * 是否与宝宝当前月龄匹配（文档流程 5）：
 * min_age_month ≤ 当前月龄 ≤ max_age_month，max_age_month 为空表示不限。
 *
 * totalMonths 必须来自 utils/age.js 的 ageParts()，保证与档案卡/首页的月龄口径一致；
 * 生日缺失或尚未出生时传 null，一律视为不匹配（不高亮，避免误推荐）。
 */
export function isAgeMatched(item, totalMonths) {
  if (!item || !Number.isFinite(totalMonths)) return false
  const min = Number(item.min_age_month)
  if (!Number.isFinite(min) || totalMonths < min) return false
  if (item.max_age_month === null || item.max_age_month === undefined || item.max_age_month === '') {
    return true
  }
  const max = Number(item.max_age_month)
  return !Number.isFinite(max) || totalMonths <= max
}

/** 'YYYY-MM-DD' -> { year, month, day }；非法返回 null */
function parseDate(value) {
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

/** 本地 Date -> 'YYYY-MM-DD'（不经过 toISOString，避免东八区整体偏移一天） */
function toDateString(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 生日往后推进 months 个自然月，日号夹到目标月最后一天。
 * 与 utils/age.js 同一规则：1月31日 + 1个月 = 2月28/29日，不用 30 天近似。
 */
function addMonths(birth, months) {
  const monthIndex = birth.month - 1 + months
  const year = birth.year + Math.floor(monthIndex / 12)
  const month = (monthIndex % 12) + 1
  const lastDay = new Date(year, month, 0).getDate()
  return new Date(year, month - 1, Math.min(birth.day, lastDay))
}

/**
 * 推荐计划日期 = 出生日期 + min_age_month 个月。
 *
 * - 已过（补种、月龄偏大的宝宝）：退回今天，避免一预填就是个「已逾期」日期；
 * - 生日缺失/非法：同样退回今天，让用户自己改；
 * - numeric(4,1) 允许半岁这类小数月龄，整数月之外的零头按 30 天折算。
 *
 * 接种日期不在这里给默认值：默认留空 = 未接种，由用户按实际补填。
 */
export function suggestScheduledDate(birthday, minAgeMonth, today = todayString()) {
  const birth = parseDate(birthday)
  const months = Number(minAgeMonth)
  if (!birth || !Number.isFinite(months)) return today

  const wholeMonths = Math.floor(months)
  const target = addMonths(birth, wholeMonths)
  const extraDays = Math.round((months - wholeMonths) * 30)
  if (extraDays) target.setDate(target.getDate() + extraDays)

  const suggested = toDateString(target)
  return suggested < today ? today : suggested
}
