/**
 * 儿保体检记录的业务数据访问层（三期 P0-4）。
 *
 * 家庭子表：family_id / baby_id / created_by 由本层注入，页面不拼。
 * month_age 由页面用宝宝生日算好传进来（库里存一份快照，宝宝生日改了也不会串）。
 * 体检本照片存 Storage，路径 {family_id}/{baby_id}/checkup/{唯一串}.jpg，
 * 表里 photos 存对象路径数组，展示时再批量换临时链接。
 *
 * 体检 ↔ 生长的联动（填了身高/体重就同步一条同日期的生长记录）**完全在 data 云函数内**完成，
 * 本层只负责把体检行本身写进去；删除走 rpc，因为「要不要连联动的生长记录一起删」这个选择
 * 没法通过 api.db.remove（只接受 where 条件）传给服务端。
 */
import { api } from './api'
import { trackRecordCreated } from '@/utils/tracker'

const CHECKUP_COLUMNS =
  'id,family_id,baby_id,checkup_date,month_age,growth_id,hospital,height_cm,weight_kg,head_cm,hemoglobin,development,doctor_advice,next_date,photos,created_by,created_at,updated_at'

/** 与 data 云函数的 normalizeCheckupDoc 保持一致，前端先拦一遍给出更快的提示 */
export const CHECKUP_LIMITS = {
  photoMax: 3,
  heightMin: 20,
  heightMax: 150,
  weightMin: 0.5,
  weightMax: 60,
  headMin: 20,
  headMax: 70,
  hemoglobinMin: 10,
  hemoglobinMax: 300,
  textMax: 500,
}

/** 对象路径：{family_id}/{baby_id}/checkup/{唯一串}.jpg */
function buildPhotoPath(familyId, babyId) {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${familyId}/${babyId}/checkup/${unique}.jpg`
}

/** 上传一张体检本照片，返回对象路径 */
export async function uploadCheckupPhoto(familyId, babyId, filePath) {
  const path = buildPhotoPath(familyId, babyId)
  await api.storage.uploadObject(path, filePath)
  return path
}

/** 清理已有的图片对象：传单个路径或路径数组（失败不阻断面上的流程） */
export async function discardCheckupPhoto(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean)
  if (!list.length) return
  try {
    await api.storage.removeObjects(list)
  } catch (err) {
    console.error('[Checkup] 清理图片失败', err)
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
    console.error('[Checkup] 批量签名失败，照片将无法显示', err)
    return list.map(empty)
  }
}

/** 列表：按体检日期倒序（同日按创建时间倒序） */
export async function listCheckupRecords(familyId, babyId, options = {}) {
  if (!familyId || !babyId) return []
  const { limit = 100 } = options
  const { data } = await api.db.select('checkup_records', {
    select: CHECKUP_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    order: 'checkup_date.desc,created_at.desc',
    limit,
  })
  return attachPhotoUrls(data)
}

/** 查单条（编辑回填用，含照片临时地址） */
export async function fetchCheckupRecord(id) {
  if (!id) return null
  const row = await api.db.selectOne('checkup_records', {
    select: CHECKUP_COLUMNS,
    match: { id },
  })
  if (!row) return null
  const [withUrls] = await attachPhotoUrls([row])
  return withUrls
}

/**
 * 新增一条体检记录。
 * monthAge 必传：页面按「体检日期与宝宝生日」算好，生长页看到的月龄口径才一致。
 */
export async function createCheckupRecord({
  familyId,
  babyId,
  checkupDate,
  monthAge,
  hospital,
  heightCm,
  weightKg,
  headCm,
  hemoglobin,
  development,
  doctorAdvice,
  nextDate,
  photos,
}) {
  const createdBy = api.auth.currentUserId()
  if (!createdBy) throw new api.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const rows = await api.db.insert('checkup_records', {
    family_id: familyId,
    baby_id: babyId,
    checkup_date: checkupDate,
    month_age: monthAge == null ? null : monthAge,
    hospital: hospital || null,
    height_cm: heightCm == null || heightCm === '' ? null : heightCm,
    weight_kg: weightKg == null || weightKg === '' ? null : weightKg,
    head_cm: headCm == null || headCm === '' ? null : headCm,
    hemoglobin: hemoglobin == null || hemoglobin === '' ? null : hemoglobin,
    development: development ? String(development).trim() : null,
    doctor_advice: doctorAdvice ? String(doctorAdvice).trim() : null,
    next_date: nextDate || null,
    photos: photos || [],
    created_by: createdBy,
  })
  const row = rows && rows.length ? rows[0] : null
  if (row) trackRecordCreated('checkup')
  return row
}

/** 修改一条体检记录（整行 upsert，photoUrls 等派生字段先剔除；联动的生长记录由云函数同步） */
export async function updateCheckupRecord(record) {
  const row = api.db.pickColumns(record, CHECKUP_COLUMNS)
  const rows = await api.db.upsert('checkup_records', row)
  return rows && rows.length ? rows[0] : null
}

/**
 * 删除体检记录。
 * deleteGrowth 为 true 时，服务端会把联动出来的那条生长记录一并删掉；
 * 顺序是「先删记录再删图片」：记录没删成时图片还在，不会出现「照片没了记录还在」。
 */
export async function removeCheckupRecord(record, options = {}) {
  if (!record) return
  await api.db.rpc('remove_checkup_record', {
    p_id: record.id,
    p_delete_growth: options.deleteGrowth === true,
  })
  await discardCheckupPhoto(record.photos)
}
