/**
 * 生病 / 用药记录的业务数据访问层（三期 P0-3）。
 *
 * 家庭子表：family_id / baby_id / created_by 由本层注入，页面不拼。
 * 症状在库里存英文 key（数组），中文标签写死在前端常量表 ——
 * 与里程碑的 milestone_key 同一套做法：库里存 key，改名只改前端。
 * 图片存 Storage，路径 {family_id}/{baby_id}/illness/{唯一串}.jpg，
 * 表里 photos 存的是对象路径数组，展示时再批量换临时链接。
 */
import { api } from './api'
import { trackRecordCreated } from '@/utils/tracker'

const ILLNESS_COLUMNS =
  'id,family_id,baby_id,occurred_at,symptoms,temperature,medicines,hospital,doctor,diagnosis,allergy_note,photos,note,created_by,created_at,updated_at'

/** 症状标签（文档 4.3 的 8 项固定枚举，key 与 data 云函数里的 ILLNESS_SYMPTOMS 一致） */
export const ILLNESS_SYMPTOMS = [
  { key: 'fever', label: '发热' },
  { key: 'cough', label: '咳嗽' },
  { key: 'runny_nose', label: '流涕' },
  { key: 'vomit', label: '呕吐' },
  { key: 'diarrhea', label: '腹泻' },
  { key: 'rash', label: '皮疹' },
  { key: 'poor_appetite', label: '食欲差' },
  { key: 'other', label: '其他' },
]

export const ILLNESS_SYMPTOM_LABEL = ILLNESS_SYMPTOMS.reduce((acc, item) => {
  acc[item.key] = item.label
  return acc
}, {})

/** 与 data 云函数的 normalizeIllnessDoc 保持一致，前端先拦一遍给出更快的提示 */
export const ILLNESS_LIMITS = {
  photoMax: 3,
  medicineMax: 10,
  temperatureMin: 30,
  temperatureMax: 45,
  noteMax: 200,
}

/** 症状 key 数组 → 中文标签数组（未知 key 直接丢弃，避免界面出现英文） */
export function symptomLabels(keys) {
  return (keys || []).map((key) => ILLNESS_SYMPTOM_LABEL[key]).filter(Boolean)
}

/** 列表卡片一行字：主要症状（最多显示 3 个，其余折叠成「等 N 项」） */
export function symptomText(keys) {
  const labels = symptomLabels(keys)
  if (!labels.length) return '未记录症状'
  if (labels.length <= 3) return labels.join(' · ')
  return `${labels.slice(0, 3).join(' · ')} 等 ${labels.length} 项`
}

/** 对象路径：{family_id}/{baby_id}/illness/{唯一串}.jpg */
function buildPhotoPath(familyId, babyId) {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${familyId}/${babyId}/illness/${unique}.jpg`
}

/** 上传一张病情照片，返回对象路径 */
export async function uploadIllnessPhoto(familyId, babyId, filePath) {
  const path = buildPhotoPath(familyId, babyId)
  await api.storage.uploadObject(path, filePath)
  return path
}

/** 清理已有的图片对象：传单个路径或路径数组（失败不阻断面上的流程） */
export async function discardIllnessPhoto(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean)
  if (!list.length) return
  try {
    await api.storage.removeObjects(list)
  } catch (err) {
    console.error('[Illness] 清理图片失败', err)
  }
}

/** 给一批记录补照片临时地址（一次请求批量签名；photoUrls 与 photos 严格一一对应，失败位为空串） */
async function attachPhotoUrls(rows) {
  const list = rows || []
  const paths = []
  list.forEach((row) => {
    const own = Array.isArray(row.photos) ? row.photos.filter(Boolean) : []
    own.forEach((path) => {
      if (paths.indexOf(path) < 0) paths.push(path)
    })
  })
  const empty = (row) => ({ ...row, photoUrls: (row.photos || []).map(() => '') })
  if (!paths.length) return list.map(empty)
  try {
    const signed = await api.storage.createSignedUrls(paths, 3600)
    const map = {}
    signed.forEach((item) => {
      if (item.url) map[item.path] = item.url
    })
    return list.map((row) => ({
      ...row,
      photoUrls: (Array.isArray(row.photos) ? row.photos : []).map((path) => map[path] || ''),
    }))
  } catch (err) {
    console.error('[Illness] 批量签名失败，照片将无法显示', err)
    return list.map(empty)
  }
}

/** 列表：按发病时间倒序（同日按创建时间倒序） */
export async function listIllnessRecords(familyId, babyId, options = {}) {
  if (!familyId || !babyId) return []
  const { limit = 100 } = options
  const { data } = await api.db.select('illness_records', {
    select: ILLNESS_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    order: 'occurred_at.desc,created_at.desc',
    limit,
  })
  return attachPhotoUrls(data)
}

/** 查单条（编辑回填用，含照片临时地址） */
export async function fetchIllnessRecord(id) {
  if (!id) return null
  const row = await api.db.selectOne('illness_records', {
    select: ILLNESS_COLUMNS,
    match: { id },
  })
  if (!row) return null
  const [withUrls] = await attachPhotoUrls([row])
  return withUrls
}

/** 新增一条生病记录 */
export async function createIllnessRecord({
  familyId,
  babyId,
  occurredAt,
  symptoms,
  temperature,
  medicines,
  hospital,
  doctor,
  diagnosis,
  allergyNote,
  photos,
  note,
}) {
  const createdBy = api.auth.currentUserId()
  if (!createdBy) throw new api.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const rows = await api.db.insert('illness_records', {
    family_id: familyId,
    baby_id: babyId,
    occurred_at: occurredAt,
    symptoms: symptoms || [],
    temperature: temperature == null ? null : temperature,
    medicines: medicines || [],
    hospital: hospital || null,
    doctor: doctor || null,
    diagnosis: diagnosis || null,
    allergy_note: allergyNote || null,
    photos: photos || [],
    note: note ? String(note).trim() : null,
    created_by: createdBy,
  })
  const row = rows && rows.length ? rows[0] : null
  if (row) trackRecordCreated('illness')
  return row
}

/** 修改一条生病记录（整行 upsert，photoUrls 等派生字段先剔除） */
export async function updateIllnessRecord(record) {
  const row = api.db.pickColumns(record, ILLNESS_COLUMNS)
  const rows = await api.db.upsert('illness_records', row)
  return rows && rows.length ? rows[0] : null
}

/** 删除生病记录：先删照片对象（幂等），再删记录 */
export async function removeIllnessRecord(record) {
  if (!record) return
  await discardIllnessPhoto(record.photos)
  await api.db.remove('illness_records', { id: record.id })
}
