/**
 * 疫苗记录的业务数据访问层。
 *
 * 状态不在数据库里冗余存储，而是按需求文档 4.6 的规则由 vaccinated_date / scheduled_date 推导，
 * 避免出现"日期与状态不一致"的脏数据。
 */
import { supabase } from './supabase'
import { todayString, diffDays } from '@/utils/date'
import { trackRecordCreated } from '@/utils/tracker'

const VACCINE_COLUMNS =
  'id,family_id,baby_id,name,dose,scheduled_date,vaccinated_date,hospital,note,created_by,created_at'

/** 计划日期距今 ≤ 7 天视为「即将接种」 */
const SOON_DAYS = 7

export const VACCINE_STATUS_LABEL = {
  vaccinated: '已接种',
  overdue: '已逾期',
  soon: '即将接种',
  pending: '待接种',
}

/**
 * 推导疫苗状态：
 * - 有实际接种日期 -> 已接种
 * - 没有计划日期 -> 待接种
 * - 计划日期已过 -> 已逾期
 * - 计划日期在 7 天内 -> 即将接种
 * - 其余 -> 待接种
 */
export function getVaccineStatus(record, today = todayString()) {
  if (!record) return 'pending'
  if (record.vaccinated_date) return 'vaccinated'
  if (!record.scheduled_date) return 'pending'
  const remain = diffDays(today, record.scheduled_date)
  if (remain < 0) return 'overdue'
  if (remain <= SOON_DAYS) return 'soon'
  return 'pending'
}

/** 给记录补上 status 字段，页面直接用 */
export function withStatus(record, today = todayString()) {
  return { ...record, status: getVaccineStatus(record, today) }
}

/**
 * 汇总待办数量，供「我的」页提醒区使用。
 * todo = 未接种的全部（已逾期 + 即将接种 + 待接种）
 */
export function summarizeVaccinations(list, today = todayString()) {
  const summary = { overdue: 0, soon: 0, pending: 0, vaccinated: 0, todo: 0 }
  ;(list || []).forEach((record) => {
    const status = getVaccineStatus(record, today)
    summary[status] += 1
  })
  summary.todo = summary.overdue + summary.soon + summary.pending
  return summary
}

/** 拉取全部疫苗记录（计划日期新的在前，未排期的排最后） */
export async function listVaccinations(familyId, babyId) {
  if (!familyId || !babyId) return []
  const { data } = await supabase.db.select('vaccinations', {
    select: VACCINE_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    order: 'scheduled_date.desc.nullslast',
    limit: 200,
  })
  return data || []
}

/**
 * 添加一条疫苗记录。
 * vaccinatedDate 留空 = 未接种（只排了计划日期）；从推荐库一键添加时，
 * 若用户顺手填了接种日期（补录已完成接种），这里一并落库。
 */
export async function createVaccination({
  familyId,
  babyId,
  name,
  dose,
  scheduledDate,
  vaccinatedDate,
}) {
  const createdBy = supabase.auth.currentUserId()
  if (!createdBy) throw new supabase.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const rows = await supabase.db.insert('vaccinations', {
    family_id: familyId,
    baby_id: babyId,
    name: String(name || '').trim(),
    dose: dose ? String(dose).trim() : null,
    scheduled_date: scheduledDate || null,
    vaccinated_date: vaccinatedDate || null,
    created_by: createdBy,
  })
  // 补丁 Step 7：疫苗也是一条「记录」，创建成功后统一上报
  if (rows && rows.length) trackRecordCreated('vaccine')
  return rows && rows.length ? rows[0] : null
}

/**
 * 标记已接种。
 * 微信小程序不支持 PATCH，统一走 upsert 提交整行（先过滤出数据库真实列）。
 */
export async function markVaccinated(record, vaccinatedDate) {
  const rows = await supabase.db.upsert('vaccinations', {
    ...supabase.db.pickColumns(record, VACCINE_COLUMNS),
    vaccinated_date: vaccinatedDate,
  })
  return rows && rows.length ? rows[0] : null
}

/** 修改一条疫苗记录（名称/剂次/计划日期填错了能改），同样走 upsert 提交整行 */
export async function updateVaccination(record) {
  const rows = await supabase.db.upsert(
    'vaccinations',
    supabase.db.pickColumns(record, VACCINE_COLUMNS),
  )
  return rows && rows.length ? rows[0] : null
}
