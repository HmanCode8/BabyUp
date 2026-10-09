/**
 * 照片日记的业务数据访问层。
 *
 * 上传顺序：先传文件到 Storage，成功后再插入 baby_photos；
 * 这样「文件传失败」不会留下脏记录；若插入失败则把刚上传的对象删掉，避免孤儿文件。
 * 删除顺序反过来：先删对象再删记录，任一步失败都可安全重试（删除对象是幂等的）。
 */
import { api } from './api'
import { trackRecordCreated } from '@/utils/tracker'

/** 表结构已预留 video（baby_photos.media_type check in ('image','video')） */
const MEDIA_TYPE_IMAGE = 'image'
const MEDIA_TYPE_VIDEO = 'video'

const PHOTO_COLUMNS =
  'id,family_id,baby_id,album_id,media_type,storage_path,note,taken_at,created_by,created_at'

/** 相册（照片文件夹）的列 */
const ALBUM_COLUMNS = 'id,family_id,baby_id,name,sort_order,created_by,created_at'

/** 文件夹名长度上限：与 data 云函数、前端输入框 maxlength 三处保持一致 */
export const ALBUM_NAME_MAX = 20
/** 每个宝宝最多能建多少个文件夹（服务端也会拦，这里是为了提前提示） */
export const ALBUM_MAX_PER_BABY = 50

/** 「未分类」在文件夹视图里用的伪 id；不落库，只是个视图层的标记 */
export const ALBUM_NONE = '__none__'

/** 文件夹列表扫描照片的上限：只用来算张数与封面，照片上万时不至于越拉越慢 */
const ALBUM_SUMMARY_PAGE = 500
const ALBUM_SUMMARY_MAX = 3000

/** 生成存储对象路径：{family_id}/{baby_id}/{唯一串}.{扩展名} */
function buildObjectPath(familyId, babyId, ext) {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${familyId}/${babyId}/${unique}.${ext}`
}

/**
 * 视频封面的对象路径（命名约定推导，不占数据库字段）：
 *   xxx.mp4 → xxx.poster.jpg
 */
function buildPosterPath(videoPath) {
  return `${String(videoPath).replace(/\.[^./]+$/, '')}.poster.jpg`
}

/**
 * 只保留数据库真实存在的列。
 * url 是前端为显示临时算出来的字段，整行 upsert 时带上会被 PostgREST 拒绝（PGRST204）。
 */
function toWritableRow(photo) {
  return api.db.pickColumns(photo, PHOTO_COLUMNS)
}

/** 给一批记录补上临时可访问地址（一次请求批量签名） */
async function attachUrls(rows) {
  const list = rows || []
  if (!list.length) return list
  // 视频的封面是另一个对象，且路径只能由命名约定推导，这里一并签名
  const paths = []
  list.forEach((row) => {
    paths.push(row.storage_path)
    if (row.media_type === MEDIA_TYPE_VIDEO) paths.push(buildPosterPath(row.storage_path))
  })
  try {
    const signed = await api.storage.createSignedUrls(paths, 3600)
    const map = {}
    signed.forEach((item) => {
      if (item.url) map[item.path] = item.url
    })
    return list.map((row) => ({
      ...row,
      url: map[row.storage_path] || '',
      cover_url: row.media_type === MEDIA_TYPE_VIDEO ? map[buildPosterPath(row.storage_path)] || '' : '',
    }))
  } catch (err) {
    console.error('[Photo] 批量签名失败，图片将无法显示', err)
    return list.map((row) => ({ ...row, url: '', cover_url: '' }))
  }
}

/** 上传照片文件，返回存储对象路径 */
export async function uploadPhotoFile(familyId, babyId, filePath) {
  const path = buildObjectPath(familyId, babyId, 'jpg')
  await api.storage.uploadObject(path, filePath)
  return path
}

/**
 * 上传视频及其封面，返回视频对象路径。
 *
 * 封面用的是 chooseMedia 给的首帧缩略图，传失败不算致命：视频本身仍可播放，
 * 列表侧退化成占位块，所以这里只记日志不抛错。
 */
export async function uploadVideoFile(familyId, babyId, filePath, posterPath) {
  const path = buildObjectPath(familyId, babyId, 'mp4')
  await api.storage.uploadObject(path, filePath)
  if (posterPath) {
    try {
      await api.storage.uploadObject(buildPosterPath(path), posterPath)
    } catch (err) {
      console.warn('[Photo] 视频封面上传失败，列表将显示占位块', err)
    }
  }
  return path
}

/** 新增照片/视频记录 */
export async function createPhoto({
  familyId,
  babyId,
  storagePath,
  note,
  takenAt,
  albumId,
  mediaType = MEDIA_TYPE_IMAGE,
}) {
  const createdBy = api.auth.currentUserId()
  if (!createdBy) throw new api.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const rows = await api.db.insert('baby_photos', {
    family_id: familyId,
    baby_id: babyId,
    // 显式写 null 而不是省略字段：新照片一律带上 album_id，
    // 「未分类」的判定（album_id 为空）就不用依赖「字段不存在」这种隐式状态
    album_id: albumId || null,
    media_type: mediaType,
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
 * @param {object} options { familyId, babyId, limit, offset, fromIso, toIso, albumId }
 *   fromIso/toIso 用于「只看某个区间内的照片」（如今日小结、成长报告）
 *   albumId 三态：不传 = 不按文件夹筛（「按月 / 全部」视图）；
 *                 null = 只看未分类；字符串 = 只看这个文件夹
 */
export async function listPhotos({
  familyId,
  babyId,
  limit = 20,
  offset = 0,
  fromIso,
  toIso,
  albumId,
}) {
  const range = []
  if (fromIso) range.push(`gte.${fromIso}`)
  if (toIso) range.push(`lt.${toIso}`)
  const filters = {}
  if (range.length) filters.taken_at = range
  // PostgREST 的 is.null ⇄ 云开发的 isnull（两边都覆盖「值为 null」与「字段不存在」）
  if (albumId === null) filters.album_id = 'is.null'
  else if (albumId) filters.album_id = `eq.${albumId}`
  const { data, total } = await api.db.select('baby_photos', {
    select: PHOTO_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    filters: Object.keys(filters).length ? filters : undefined,
    order: 'taken_at.desc',
    limit,
    offset,
    count: true,
  })
  const items = await attachUrls(data)
  return { items, total: total === null ? items.length + offset : total }
}

/**
 * 只取「有备注的照片」：给 AI 上下文用。
 *
 * 为什么不复用 listPhotos：它会为每张照片签一条临时地址（多一次云函数往返、
 * 白耗下载流量），而 AI 只关心**备注文字**，图片本身不会发给模型。
 * 这里只取文本字段，最近的 limit 条里挑出有备注的。
 */
export async function listPhotoNotes(familyId, babyId, options = {}) {
  if (!familyId || !babyId) return []
  const { limit = 60 } = options
  const { data } = await api.db.select('baby_photos', {
    select: 'id,note,taken_at,media_type',
    match: { family_id: familyId, baby_id: babyId },
    order: 'taken_at.desc',
    limit,
  })
  return (data || []).filter((row) => row && row.note)
}

/**
 * 批量备份用：把一个家庭的照片/视频行拉全，**不带临时地址**。
 *
 * 与 listPhotos 的两点区别，都是为「保存到相册」这个用途服务的：
 *   1. 不签名。备份是拿原件（按 fileID 直下），签名是给 <image> 显示用的，
 *      给几百张各签一条链接既多一次云函数往返、又白耗下载流量。
 *   2. 不按 baby_id 过滤。一个家可能有两个宝宝，而家长心里「备份宝宝的照片」
 *      就是备份这个家的照片，让他挨个宝宝点一遍不现实。
 *
 * 分页拉全：云函数单次上限 1000，照片涨到上千张也不会漏。
 */
export async function listPhotosForBackup(familyId) {
  if (!familyId) return []
  const PAGE_SIZE = 500
  const all = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data } = await api.db.select('baby_photos', {
      select: 'id,baby_id,media_type,storage_path,note,taken_at',
      match: { family_id: familyId },
      order: 'taken_at.desc',
      limit: PAGE_SIZE,
      offset,
    })
    const rows = data || []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return all
}

/** 查询单张照片（含临时地址） */
export async function fetchPhoto(photoId) {
  if (!photoId) return null
  const row = await api.db.selectOne('baby_photos', {
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
  const rows = await api.db.upsert('baby_photos', {
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
  const rows = await api.db.upsert('baby_photos', {
    ...toWritableRow(photo),
    taken_at: takenAtIso,
  })
  return rows && rows.length ? rows[0] : null
}

/** 删除照片/视频：先删存储对象（幂等），再删数据库记录 */
export async function deletePhoto(photo) {
  if (!photo) return
  const paths = [photo.storage_path]
  if (photo.media_type === MEDIA_TYPE_VIDEO) paths.push(buildPosterPath(photo.storage_path))
  await api.storage.removeObjects(paths)
  await api.db.remove('baby_photos', { id: photo.id })
}

/** 清理刚上传但未成功入库的对象 */
export async function discardUploadedFile(storagePath) {
  if (!storagePath) return
  try {
    await api.storage.removeObjects([storagePath])
  } catch (err) {
    console.error('[Photo] 清理未入库文件失败', storagePath, err)
  }
}

/* ---------------------------------------------------------------------------
 * 照片文件夹（相册）
 *
 * 三条设计约定（详见 docx/guide/data-model.md 的 photo_albums）：
 *   1. 只做一层，不支持嵌套；
 *   2. 挂在「家庭 + 宝宝」下，与「按月」视图口径一致（时光页按当前宝宝看）；
 *   3. **删文件夹不删照片** —— 里面的照片回到「未分类」。
 * ------------------------------------------------------------------------- */

/** 拉某个宝宝的文件夹，按手动排序（sort_order）再按创建时间 */
export async function listAlbums({ familyId, babyId }) {
  if (!familyId || !babyId) return []
  const { data } = await api.db.select('photo_albums', {
    select: ALBUM_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    order: 'sort_order.asc,created_at.asc',
    limit: ALBUM_MAX_PER_BABY,
  })
  return data || []
}

/** 新建文件夹，排在最后 */
export async function createAlbum({ familyId, babyId, name }) {
  const createdBy = api.auth.currentUserId()
  if (!createdBy) throw new api.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const existing = await listAlbums({ familyId, babyId })
  // 取「最大 sort_order + 1」而不是「个数」：删过文件夹后两者不相等，前者才能保证排到最后
  const maxSort = existing.reduce((acc, item) => Math.max(acc, Number(item.sort_order) || 0), -1)
  const rows = await api.db.insert('photo_albums', {
    family_id: familyId,
    baby_id: babyId,
    name: String(name || '').trim(),
    sort_order: maxSort + 1,
    created_by: createdBy,
  })
  return rows && rows.length ? rows[0] : null
}

/** 重命名。重名会被服务端拦下（云开发侧还会撞唯一索引兜底） */
export async function renameAlbum(album, name) {
  const rows = await api.db.upsert('photo_albums', {
    ...api.db.pickColumns(album, ALBUM_COLUMNS),
    name: String(name || '').trim(),
  })
  return rows && rows.length ? rows[0] : null
}

/**
 * 按传入的顺序重写 sort_order（拖拽排序落地）。
 *
 * 整批一次 upsert：云开发侧是一个云函数调用内循环若干行，
 * Supabase 侧是一条 `insert ... on conflict do update`。
 * 文件夹数量很少（上限 50），这个代价可以接受。
 */
export async function reorderAlbums(albums) {
  const list = albums || []
  if (!list.length) return []
  const rows = list.map((album, index) =>
    Object.assign(api.db.pickColumns(album, ALBUM_COLUMNS), { sort_order: index }),
  )
  return api.db.upsert('photo_albums', rows)
}

/**
 * 删除文件夹。**里面的照片不会被删**，只是回到「未分类」。
 * 云开发侧由 data 云函数在删之前把 baby_photos.album_id 置空，
 * Supabase 侧靠外键的 `on delete set null`，两侧行为一致。
 */
export async function deleteAlbum(album) {
  if (!album || !album.id) return
  await api.db.remove('photo_albums', { id: album.id })
}

/**
 * 把一批照片移到某个文件夹（albumId 传 null = 移回「未分类」）。
 *
 * 为什么逐张 upsert 而不是一条批量更新：PostgREST 的部分更新走 PATCH，
 * 而微信小程序不支持 PATCH（见 services/supabase/db.js 顶部的约定），
 * 所以两版统一走「整行 upsert」，与改备注 / 改拍摄时间同一条路。
 * 代价是一次多选 N 张就是 N 次云函数调用 —— 家人使用通常是几张，可以接受；
 * onProgress(done, total) 让页面能显示进度。
 */
export async function movePhotos(photos, albumId, onProgress) {
  const list = (photos || []).filter(Boolean)
  const updated = []
  for (let index = 0; index < list.length; index += 1) {
    const rows = await api.db.upsert('baby_photos', {
      ...toWritableRow(list[index]),
      album_id: albumId || null,
    })
    const row = rows && rows.length ? rows[0] : null
    if (row) updated.push(row)
    if (onProgress) onProgress(index + 1, list.length)
  }
  return updated
}

/**
 * 文件夹列表要用的「每个文件夹有几张、最新一张是哪张、未分类有几张」。
 *
 * 为什么要拉全量：两版后端都没有「按 album_id 分组统计」的通用接口
 * （云开发要写 aggregate，PostgREST 要额外加 RPC），而为家人使用这个量级
 * （几百到几千行）拉一次投影很轻 —— 只取 5 个列，且只为封面那几张签名。
 *
 * @returns {Promise<{byAlbum: Object, unclassified: {count:number, cover:object|null}, total:number}>}
 */
export async function summarizeAlbums({ familyId, babyId }) {
  const byAlbum = {}
  const unclassified = { count: 0, cover: null }
  if (!familyId || !babyId) return { byAlbum, unclassified, total: 0 }

  const rows = []
  for (let offset = 0; offset < ALBUM_SUMMARY_MAX; offset += ALBUM_SUMMARY_PAGE) {
    const { data } = await api.db.select('baby_photos', {
      select: 'id,album_id,media_type,storage_path,taken_at',
      match: { family_id: familyId, baby_id: babyId },
      order: 'taken_at.desc',
      limit: ALBUM_SUMMARY_PAGE,
      offset,
    })
    const page = data || []
    rows.push(...page)
    if (page.length < ALBUM_SUMMARY_PAGE) break
  }

  rows.forEach((row) => {
    const key = row.album_id || ''
    if (!key) {
      unclassified.count += 1
      // 已按 taken_at 倒序，碰到的第一条就是最新那张
      if (!unclassified.cover) unclassified.cover = row
      return
    }
    const bucket = byAlbum[key]
    if (bucket) {
      bucket.count += 1
      return
    }
    byAlbum[key] = { count: 1, cover: row }
  })

  // 只为封面签名：文件夹最多 50 个，一次批量请求就够，不必给全部照片签名
  const covers = Object.keys(byAlbum).map((key) => byAlbum[key].cover)
  if (unclassified.cover) covers.push(unclassified.cover)
  if (covers.length) {
    const signed = await attachUrls(covers)
    const map = {}
    signed.forEach((row) => {
      map[row.id] = row
    })
    Object.keys(byAlbum).forEach((key) => {
      byAlbum[key].cover = map[byAlbum[key].cover.id] || byAlbum[key].cover
    })
    if (unclassified.cover) unclassified.cover = map[unclassified.cover.id] || unclassified.cover
  }

  return { byAlbum, unclassified, total: rows.length }
}
