/**
 * 生长记录（身高/体重/头围）的业务数据访问层。
 * 一期数据量小，曲线需要全量点，所以一次取回全部（上限 500 条兜底）。
 */
import { api } from './api'
import { trackRecordCreated } from '@/utils/tracker'

const GROWTH_COLUMNS =
  'id,family_id,baby_id,record_date,height_cm,weight_kg,head_cm,note,created_by,created_at'

/** 按日期升序拉取生长记录（升序便于直接画折线） */
export async function listGrowthRecords(familyId, babyId) {
  if (!familyId || !babyId) return []
  const { data } = await api.db.select('growth_records', {
    select: GROWTH_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    order: 'record_date.asc',
    limit: 500,
  })
  return data || []
}

/** 新增一条生长记录；身高/体重/头围允许只填其中几项 */
export async function createGrowthRecord({
  familyId,
  babyId,
  recordDate,
  heightCm,
  weightKg,
  headCm,
  note,
}) {
  const createdBy = api.auth.currentUserId()
  if (!createdBy) throw new api.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const rows = await api.db.insert('growth_records', {
    family_id: familyId,
    baby_id: babyId,
    record_date: recordDate,
    height_cm: heightCm === '' || heightCm == null ? null : heightCm,
    weight_kg: weightKg === '' || weightKg == null ? null : weightKg,
    head_cm: headCm === '' || headCm == null ? null : headCm,
    note: note ? String(note).trim() : null,
    created_by: createdBy,
  })
  const row = rows && rows.length ? rows[0] : null
  if (row) trackRecordCreated('growth')
  return row
}

/**
 * 修改一条生长记录（填错了能改）。
 * 微信小程序不支持 PATCH，统一走 upsert 提交整行：record 传原行 + 要覆盖的字段。
 */
export async function updateGrowthRecord(record) {
  const rows = await api.db.upsert(
    'growth_records',
    api.db.pickColumns(record, GROWTH_COLUMNS),
  )
  return rows && rows.length ? rows[0] : null
}

/** 删除一条生长记录（量一量记错了能删掉） */
export async function removeGrowthRecord(id) {
  await api.db.remove('growth_records', { id })
}
