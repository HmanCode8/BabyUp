/**
 * Supabase Storage 访问层。
 *
 * 上传必须走 uni.uploadFile：微信小程序无法构造 FormData/Blob，
 * 只能由原生上传能力把本地临时文件以 multipart 形式提交。
 * 生成临时访问地址与删除对象则走 REST 接口。
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, STORAGE_BUCKET } from '@/config'
import { request, ApiError } from './http'
import { getSession } from './session'

function authHeader(extra = {}) {
  const session = getSession()
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session ? session.access_token : SUPABASE_ANON_KEY}`,
    ...extra,
  }
}

/**
 * 上传本地文件到存储桶。
 * @param {string} path     对象路径，如 {family_id}/{baby_id}/avatar.jpg
 * @param {string} filePath 本地临时文件路径（chooseImage/chooseMedia 返回）
 * @param {{ upsert?: boolean }} options upsert=true 表示同路径覆盖
 * @returns {Promise<void>}
 */
export function uploadObject(path, filePath, options = {}) {
  const { upsert = false } = options
  const url = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`
  console.log('[Storage] 上传', path, { upsert })
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url,
      filePath,
      name: 'file',
      header: authHeader(upsert ? { 'x-upsert': 'true' } : {}),
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 同一路径被覆盖写（换头像就是这么做的）：清掉旧链接，否则页面还显示上一张
          SIGNED_URL_CACHE.delete(path)
          resolve()
          return
        }
        console.error('[Storage] 上传失败', res.statusCode, res.data)
        reject(
          new ApiError(`图片上传失败（HTTP ${res.statusCode}）`, res.statusCode, 'UPLOAD_FAILED', res.data),
        )
      },
      fail: (err) => {
        console.error('[Storage] 上传网络异常', err)
        reject(new ApiError('图片上传失败，请检查网络后重试', 0, 'NETWORK_ERROR', err))
      },
    })
  })
}

/** storage-api 返回的是相对路径，这里统一补成完整 URL */
function toAbsoluteUrl(signed) {
  if (!signed) return ''
  if (signed.startsWith('http')) return signed
  if (signed.startsWith('/storage/v1')) return `${SUPABASE_URL}${signed}`
  return `${SUPABASE_URL}/storage/v1${signed}`
}

/**
 * 签名 URL 缓存：对象路径 → { url, expiresAt }。
 *
 * 与 cloud/storage.js 里的同名缓存同一套口径：私有桶每次进页面都要重签一遍，
 * 有效期内重复签是白花一次请求（弱网下要等好几秒），所以按路径复用，
 * 剩余有效期不足 5 分钟才重新签；覆盖写与删除时清掉。
 */
const SIGNED_URL_CACHE = new Map()
const SIGN_URL_REFRESH_MARGIN = 5 * 60 * 1000

/**
 * 生成对象的临时访问地址（私有桶必须走签名 URL）。
 * @returns {Promise<string>} 带 token 的完整 URL
 */
export async function createSignedUrl(path, expiresIn = 3600) {
  const [item] = await createSignedUrls([path], expiresIn)
  if (!item || !item.url) {
    throw new ApiError('获取图片地址失败', 0, 'SIGN_FAILED')
  }
  return item.url
}

/**
 * 批量生成临时访问地址：一页照片只需一次请求，避免逐张签名。
 * 命中缓存的不再请求。
 * @returns {Promise<Array<{path: string, url: string, error: string|null}>>}
 */
export async function createSignedUrls(paths, expiresIn = 3600) {
  const list = (paths || []).filter(Boolean)
  if (!list.length) return []

  const now = Date.now()
  const urlMap = {}
  const pending = []
  list.forEach((path) => {
    const hit = SIGNED_URL_CACHE.get(path)
    if (hit && hit.expiresAt - now > SIGN_URL_REFRESH_MARGIN) {
      urlMap[path] = hit.url
      return
    }
    if (pending.indexOf(path) < 0) pending.push(path)
  })

  if (pending.length) {
    const res = await request({
      path: `/storage/v1/object/sign/${STORAGE_BUCKET}`,
      method: 'POST',
      data: { expiresIn, paths: pending },
    })
    const rows = Array.isArray(res.data) ? res.data : []
    if (!rows.length) {
      console.error('[Storage] 批量签名返回体异常', res.data)
      throw new ApiError('获取图片地址失败', 0, 'SIGN_FAILED', res.data)
    }
    const expiresAt = Date.now() + expiresIn * 1000
    rows.forEach((row) => {
      if (!row || !row.path || !row.signedURL || row.error) return
      const url = toAbsoluteUrl(row.signedURL)
      urlMap[row.path] = url
      SIGNED_URL_CACHE.set(row.path, { url, expiresAt })
    })
  }

  return list.map((path) => {
    const url = urlMap[path] || ''
    return { path, url, error: url ? null : 'SIGN_FAILED' }
  })
}

/** 批量删除对象（删除照片/换头像时清理旧文件） */
export async function removeObjects(paths) {
  const list = (paths || []).filter(Boolean)
  if (!list.length) return
  console.log('[Storage] 删除对象', list)
  await request({
    path: `/storage/v1/object/${STORAGE_BUCKET}`,
    method: 'DELETE',
    data: { prefixes: list },
  })
  list.forEach((path) => SIGNED_URL_CACHE.delete(path))
}

/**
 * 把对象下载到本地临时文件，返回临时路径（备份照片存相册时要用原件）。
 * 私有桶必须先换签名 URL 再下，与 cloud 版同一个用途、同一个签名。
 */
export async function downloadObject(path) {
  const url = await createSignedUrl(path)
  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res.tempFilePath)
          return
        }
        console.error('[Storage] 下载对象失败', res.statusCode, path)
        reject(new ApiError(`下载失败（HTTP ${res.statusCode}）`, res.statusCode || 0, 'DOWNLOAD_FAILED'))
      },
      fail: (err) => {
        console.error('[Storage] 下载对象网络异常', path, err)
        reject(new ApiError('下载失败，请检查网络后重试', 0, 'NETWORK_ERROR', err))
      },
    })
  })
}

export const storage = {
  uploadObject,
  createSignedUrl,
  createSignedUrls,
  removeObjects,
  downloadObject,
}
