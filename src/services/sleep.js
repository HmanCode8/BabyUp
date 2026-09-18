/**
 * 睡眠记录的业务数据访问层（二期 P0-3）。
 *
 * 状态不落库：ended_at 为空即「正在睡」，时长一律由 ended_at - started_at 现算，
 * 避免出现「状态字段和实际时间不一致」的脏数据（与疫苗状态同一思路）。
 * 时长用绝对时刻相减，跨天（21:00 入睡次日 6:30 醒）自然算对。
 */
import { supabase } from './supabase'
import { formatMinutes } from '@/utils/date'
import { trackRecordCreated } from '@/utils/tracker'

const SLEEP_COLUMNS = 'id,family_id,baby_id,started_at,ended_at,note,created_by,created_at'

/** 把时间差格式化成「X 小时 Y 分钟」；不足 1 分钟给一句人话 */
export function formatDuration(startIso, endIso) {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return ''
  const totalMinutes = Math.round((end - start) / 60000)
  if (totalMinutes <= 0) return '不到 1 分钟'
  return formatMinutes(totalMinutes)
}

/** 是否正在睡（ended_at 为空） */
export function isSleeping(record) {
  return Boolean(record) && !record.ended_at
}

/** 列表用的一句话描述：'正在睡 · 已 2 小时 15 分钟' / '9 小时 30 分钟' */
export function formatSleep(record, nowIso = new Date().toISOString()) {
  if (!record) return ''
  if (isSleeping(record)) {
    const elapsed = formatDuration(record.started_at, nowIso)
    return elapsed ? `正在睡 · 已 ${elapsed}` : '正在睡'
  }
  const duration = formatDuration(record.started_at, record.ended_at)
  return duration ? `睡了 ${duration}` : '睡眠记录'
}

/**
 * 拉取睡眠记录（入睡时间倒序）。
 * 默认不按「今天」过滤：正在睡的那条可能是昨晚开始的；
 * fromIso 用于按月聚合时把区间外的记录挡在数据库外（跨天的那条靠上界之外的重叠裁剪兜住）。
 */
export async function listSleeps(familyId, babyId, options = {}) {
  if (!familyId || !babyId) return []
  const { fromIso, limit = 20 } = options
  const { data } = await supabase.db.select('sleep_records', {
    select: SLEEP_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    filters: fromIso ? { started_at: `gte.${fromIso}` } : undefined,
    order: 'started_at.desc',
    limit,
  })
  return data || []
}

/** 当前是否有一笔未结束的睡眠（用于页面提示「正在睡」） */
export function findActiveSleep(list) {
  return (list || []).find((item) => isSleeping(item)) || null
}

/** 开始一次睡眠（ended_at 留空 = 正在睡） */
export async function createSleep({ familyId, babyId, startedAt, endedAt, note }) {
  const createdBy = supabase.auth.currentUserId()
  if (!createdBy) throw new supabase.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const rows = await supabase.db.insert('sleep_records', {
    family_id: familyId,
    baby_id: babyId,
    started_at: startedAt,
    ended_at: endedAt || null,
    note: note ? String(note).trim() : null,
    created_by: createdBy,
  })
  const row = rows && rows.length ? rows[0] : null
  if (row) trackRecordCreated('sleep')
  return row
}

/** 修改一条睡眠记录（整行 upsert） */
export async function updateSleep(record, patch) {
  const rows = await supabase.db.upsert('sleep_records', {
    ...supabase.db.pickColumns(record, SLEEP_COLUMNS),
    ...patch,
  })
  return rows && rows.length ? rows[0] : null
}

/** 结束睡眠：补上醒来时间（微信不支持 PATCH，统一走整行 upsert） */
export async function endSleep(record, endedAt) {
  return updateSleep(record, { ended_at: endedAt })
}

/** 删除一条睡眠记录 */
export async function removeSleep(id) {
  await supabase.db.remove('sleep_records', { id })
}
