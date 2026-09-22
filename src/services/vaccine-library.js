/**
 * 疫苗名字典（vaccine_library）数据访问层。
 *
 * 这张表是开发者维护的公共字典：RLS 只开了 select（任何登录用户可读、前端不可写），
 * 所以本文件只有查询，没有增删改。
 * 字典提供名称/剂次/类别，以及推荐接种月龄（min_age_month ~ max_age_month）与备注：
 * 月龄只用于「匹配当前宝宝月龄时高亮/置顶 + 推算计划日期」的录入辅助，
 * 不构成接种建议——实际什么时候打仍以当地接种门诊的安排为准（补丁文档 9.2）。
 * 「一键添加」是把字典里的名称/剂次复制进 vaccinations，写入仍走 vaccine.js 的
 * createVaccination，避免两处各写一份插入逻辑。
 */
import { api } from './api'

const LIBRARY_COLUMNS = 'id,name,dose,min_age_month,max_age_month,category,sort_order,note'

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

/** 月龄字段 -> 数字；空值/非数字统一返回 null（max_age_month 为空 = 不限） */
function monthValue(value) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/**
 * 条目是否匹配当前月龄：min_age_month ≤ 月龄 ≤ max_age_month（max 为空表示不限）。
 * 月龄未知（宝宝生日缺失）或字典没填起始月龄时返回 false，调用方据此不高亮。
 */
export function isAgeMatched(item, totalMonths) {
  if (!item || totalMonths === null || totalMonths === undefined) return false
  const min = monthValue(item.min_age_month)
  if (min === null) return false
  if (totalMonths < min) return false
  const max = monthValue(item.max_age_month)
  return max === null || totalMonths <= max
}

/** 推荐月龄区间文案：'2 月龄' / '12~15 月龄' / '6 月龄起' / '不限月龄' */
export function ageRangeText(item) {
  if (!item) return ''
  const min = monthValue(item.min_age_month)
  const max = monthValue(item.max_age_month)
  if (min === null) return '不限月龄'
  if (max === null) return `${min} 月龄起`
  return min === max ? `${min} 月龄` : `${min}~${max} 月龄`
}

/**
 * 拉取全部字典条目，按 sort_order 升序（与迁移 009 的种子顺序一致）。
 * 种子只有二十多条，一次取回、页面内按 tab 过滤，切 tab 不必再发请求。
 */
export async function listVaccineLibrary() {
  const { data } = await api.db.select('vaccine_library', {
    select: LIBRARY_COLUMNS,
    order: 'sort_order.asc',
    limit: 200,
  })
  return data || []
}
