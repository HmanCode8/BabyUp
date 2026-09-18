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
 * 生成对象的临时访问地址（私有桶必须走签名 URL）。
 * @returns {Promise<string>} 带 token 的完整 URL
 */
export async function createSignedUrl(path, expiresIn = 3600) {
  const res = await request({
    path: `/storage/v1/object/sign/${STORAGE_BUCKET}/${path}`,
    method: 'POST',
    data: { expiresIn },
  })
  const signed = res.data && (res.data.signedURL || res.data.signedUrl)
  if (!signed) {
    console.error('[Storage] 签名返回体异常', res.data)
    throw new ApiError('获取图片地址失败', 0, 'SIGN_FAILED', res.data)
  }
  return toAbsoluteUrl(signed)
}

/**
 * 批量生成临时访问地址：一页照片只需一次请求，避免逐张签名。
 * @returns {Promise<Array<{path: string, url: string, error: string|null}>>}
 */
export async function createSignedUrls(paths, expiresIn = 3600) {
  const list = (paths || []).filter(Boolean)
  if (!list.length) return []
  const res = await request({
    path: `/storage/v1/object/sign/${STORAGE_BUCKET}`,
    method: 'POST',
    data: { expiresIn, paths: list },
  })
  const rows = Array.isArray(res.data) ? res.data : []
  if (!rows.length) {
    console.error('[Storage] 批量签名返回体异常', res.data)
    throw new ApiError('获取图片地址失败', 0, 'SIGN_FAILED', res.data)
  }
  return rows.map((row) => ({
    path: row.path,
    url: toAbsoluteUrl(row.signedURL),
    error: row.error || null,
  }))
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
}

export const storage = { uploadObject, createSignedUrl, createSignedUrls, removeObjects }
