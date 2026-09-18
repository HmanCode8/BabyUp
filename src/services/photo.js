/**
 * 照片日记的业务数据访问层。
 *
 * 上传顺序：先传文件到 Storage，成功后再插入 baby_photos；
 * 这样「文件传失败」不会留下脏记录；若插入失败则把刚上传的对象删掉，避免孤儿文件。
 * 删除顺序反过来：先删对象再删记录，任一步失败都可安全重试（删除对象是幂等的）。
 */
import { supabase } from './supabase'
import { trackRecordCreated } from '@/utils/tracker'

/** 一期手机拍照上传，media_type 固定 image；表结构已预留 video */
const MEDIA_TYPE = 'image'

const PHOTO_COLUMNS =
  'id,family_id,baby_id,media_type,storage_path,note,taken_at,created_by,created_at'

/** 生成存储对象路径：{family_id}/{baby_id}/{唯一串}.jpg */
function buildObjectPath(familyId, babyId) {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${familyId}/${babyId}/${unique}.jpg`
}

/**
 * 只保留数据库真实存在的列。
 * url 是前端为显示临时算出来的字段，整行 upsert 时带上会被 PostgREST 拒绝（PGRST204）。
 */
function toWritableRow(photo) {
  return supabase.db.pickColumns(photo, PHOTO_COLUMNS)
}

/** 给一批记录补上临时可访问地址（一次请求批量签名） */
async function attachUrls(rows) {
  const list = rows || []
  if (!list.length) return list
  try {
    const signed = await supabase.storage.createSignedUrls(
      list.map((row) => row.storage_path),
      3600,
    )
    const map = {}
    signed.forEach((item) => {
      if (item.url) map[item.path] = item.url
    })
    return list.map((row) => ({ ...row, url: map[row.storage_path] || '' }))
  } catch (err) {
    console.error('[Photo] 批量签名失败，图片将无法显示', err)
    return list.map((row) => ({ ...row, url: '' }))
  }
}

/** 上传照片文件，返回存储对象路径 */
export async function uploadPhotoFile(familyId, babyId, filePath) {
  const path = buildObjectPath(familyId, babyId)
  await supabase.storage.uploadObject(path, filePath)
  return path
}

/** 新增照片记录 */
export async function createPhoto({ familyId, babyId, storagePath, note, takenAt }) {
  const createdBy = supabase.auth.currentUserId()
  if (!createdBy) throw new supabase.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const rows = await supabase.db.insert('baby_photos', {
    family_id: familyId,
    baby_id: babyId,
    media_type: MEDIA_TYPE,
    storage_path: storagePath,
    note: note ? String(note).trim() : null,
    taken_at: takenAt || new Date().toISOString(),
    created_by: createdBy,
  })
  const row = rows && rows.length ? rows[0] : null
  if (row) trackRecordCreated('photo')
  return row
}

/**
 * 分页查询照片，按拍摄时间倒序。
 * @param {object} options { familyId, babyId, limit, offset, fromIso, toIso }
 *   fromIso/toIso 用于「只看某个区间内的照片」（如今日小结、成长报告）
 */
export async function listPhotos({ familyId, babyId, limit = 20, offset = 0, fromIso, toIso }) {
  const range = []
  if (fromIso) range.push(`gte.${fromIso}`)
  if (toIso) range.push(`lt.${toIso}`)
  const { data, total } = await supabase.db.select('baby_photos', {
    select: PHOTO_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    filters: range.length ? { taken_at: range } : undefined,
    order: 'taken_at.desc',
    limit,
    offset,
    count: true,
  })
  const items = await attachUrls(data)
  return { items, total: total === null ? items.length + offset : total }
}

/** 查询单张照片（含临时地址） */
export async function fetchPhoto(photoId) {
  if (!photoId) return null
  const row = await supabase.db.selectOne('baby_photos', {
    select: PHOTO_COLUMNS,
    match: { id: photoId },
  })
  if (!row) return null
  const [withUrl] = await attachUrls([row])
  return withUrl
}

/**
 * 修改备注。
 * 微信小程序不支持 PATCH，统一走 upsert 提交整行。
 */
export async function updatePhotoNote(photo, note) {
  const rows = await supabase.db.upsert('baby_photos', {
    ...toWritableRow(photo),
    note: note ? String(note).trim() : null,
  })
  return rows && rows.length ? rows[0] : null
}

/**
 * 修改拍摄时间（补录老照片时用，需求文档 2.1 第 7 项）。
 *
 * 为什么不用 PATCH：微信小程序不支持 PATCH，PostgREST 的部分更新走的正是 PATCH，
 * 因此这里统一走 upsert 提交整行（见 services/supabase/db.js 顶部约定）。
 * takenAtIso 必须是绝对时刻（UTC ISO）——页面用 utils/date.js 的 toIsoFromLocal
 * 把本地日期+时间转出来，避免手拼 'YYYY-MM-DDTHH:mm:ss' 被数据库按 UTC 解析（差 8 小时）。
 */
export async function updatePhotoTakenAt(photo, takenAtIso) {
  const rows = await supabase.db.upsert('baby_photos', {
    ...toWritableRow(photo),
    taken_at: takenAtIso,
  })
  return rows && rows.length ? rows[0] : null
}

/** 删除照片：先删存储对象（幂等），再删数据库记录 */
export async function deletePhoto(photo) {
  if (!photo) return
  await supabase.storage.removeObjects([photo.storage_path])
  await supabase.db.remove('baby_photos', { id: photo.id })
}

/** 清理刚上传但未成功入库的对象 */
export async function discardUploadedFile(storagePath) {
  if (!storagePath) return
  try {
    await supabase.storage.removeObjects([storagePath])
  } catch (err) {
    console.error('[Photo] 清理未入库文件失败', storagePath, err)
  }
}
