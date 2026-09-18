/**
 * 喂养记录的业务数据访问层（二期 P0-2）。
 *
 * 数量字段按类型分工（需求文档 4.8 数据流约定）：
 *   breast  -> 只填 duration_min
 *   formula -> 只填 amount_ml
 *   water   -> 只填 amount_ml
 *   solid   -> 两者都空（辅食只记次数，次数 = 当日记录条数）
 * 入库前统一归一化，避免出现「选了母乳却带着上次填的毫升数」这类脏数据。
 *
 * 更新同样走 upsert（微信小程序不支持 PATCH），喂奶记录由本人当场记录，
 * 家属可代为修改，故 update 策略放行所有非 viewer 成员。
 */
import { supabase } from './supabase'
import { trackRecordCreated } from '@/utils/tracker'

const FEEDING_COLUMNS =
  'id,family_id,baby_id,feed_type,amount_ml,duration_min,record_time,note,created_by,created_at'

/** 前端常量表：类型 -> 中文名与数量单位（不落库，只有 code 进数据库） */
export const FEED_TYPES = [
  { key: 'breast', label: '母乳', unit: '分钟' },
  { key: 'formula', label: '配方奶', unit: 'ml' },
  { key: 'water', label: '水', unit: 'ml' },
  { key: 'solid', label: '辅食', unit: '' },
]

export const FEED_TYPE_LABEL = FEED_TYPES.reduce((acc, item) => {
  acc[item.key] = item.label
  return acc
}, {})

/** 单次喂养的数量上限，用于拦住明显的手滑输入 */
export const FEED_LIMITS = {
  amountMl: { min: 1, max: 500, label: '奶量' },
  durationMin: { min: 1, max: 240, label: '时长' },
}

/** 按类型挑出该用的数量字段，另一个强制置空 */
function normalizeAmount(feedType, amountMl, durationMin) {
  if (feedType === 'breast') {
    return { amount_ml: null, duration_min: durationMin == null ? null : durationMin }
  }
  if (feedType === 'formula' || feedType === 'water') {
    return { amount_ml: amountMl == null ? null : amountMl, duration_min: null }
  }
  return { amount_ml: null, duration_min: null }
}

/** 列表用的一句话描述，例：'母乳 15 分钟' / '配方奶 120 ml' / '辅食' */
export function formatFeeding(record) {
  if (!record) return ''
  const label = FEED_TYPE_LABEL[record.feed_type] || '喂养'
  if (record.feed_type === 'breast' && record.duration_min != null) {
    return `${label} ${record.duration_min} 分钟`
  }
  if (record.amount_ml != null) return `${label} ${record.amount_ml} ml`
  return label
}

/**
 * 拉取喂养记录（时间倒序）。
 * @param {object} [options] { fromIso, toIso } 只看该区间内的记录（左闭右开，UTC 时刻）
 */
export async function listFeedings(familyId, babyId, options = {}) {
  if (!familyId || !babyId) return []
  const { fromIso, toIso, limit = 200 } = options
  const range = []
  if (fromIso) range.push(`gte.${fromIso}`)
  if (toIso) range.push(`lt.${toIso}`)
  const { data } = await supabase.db.select('feeding_records', {
    select: FEEDING_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    filters: range.length ? { record_time: range } : undefined,
    order: 'record_time.desc',
    limit,
  })
  return data || []
}

/**
 * 取当前家庭 + 当前宝宝最近的一次喂养（今日小结里的「距上次喂养」用）。
 * 按 record_time 倒序只取 1 条，不为此拉全表；没有记录时返回 null。
 */
export async function fetchLatestFeeding(familyId, babyId) {
  if (!familyId || !babyId) return null
  return supabase.db.selectOne('feeding_records', {
    select: FEEDING_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    order: 'record_time.desc',
  })
}

/** 新增一条喂养记录 */
export async function createFeeding({
  familyId,
  babyId,
  feedType,
  amountMl,
  durationMin,
  recordTime,
  note,
}) {
  const createdBy = supabase.auth.currentUserId()
  if (!createdBy) throw new supabase.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const rows = await supabase.db.insert('feeding_records', {
    family_id: familyId,
    baby_id: babyId,
    feed_type: feedType,
    ...normalizeAmount(feedType, amountMl, durationMin),
    record_time: recordTime,
    note: note ? String(note).trim() : null,
    created_by: createdBy,
  })
  const row = rows && rows.length ? rows[0] : null
  if (row) trackRecordCreated('feeding')
  return row
}

/** 修改一条喂养记录（整行 upsert） */
export async function updateFeeding(record) {
  const row = supabase.db.pickColumns(record, FEEDING_COLUMNS)
  const rows = await supabase.db.upsert('feeding_records', {
    ...row,
    ...normalizeAmount(row.feed_type, row.amount_ml, row.duration_min),
  })
  return rows && rows.length ? rows[0] : null
}

/** 删除一条喂养记录 */
export async function removeFeeding(id) {
  await supabase.db.remove('feeding_records', { id })
}
