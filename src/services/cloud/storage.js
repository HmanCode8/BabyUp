/**
 * 微信云开发 云存储访问层（阶段 4）。
 *
 * 与 supabase/storage.js 同形：uploadObject / createSignedUrl / createSignedUrls / removeObjects，
 * 业务层（services/photo.js、baby.js、milestone.js）调用方式完全不变。
 *
 * 三处必须知道的差异：
 * 1. 云开发后续操作（换链接、删文件）都基于「文件 ID」（cloud://<环境ID>.<存储桶ID>/<路径>），
 *    而业务表里存的仍是相对路径（{family_id}/{baby_id}/xxx.jpg，与 Supabase 版语义一致），
 *    因此这里统一做「相对路径 → 文件 ID」的拼接，前缀取自 config 的 CLOUD_FILE_ID_PREFIX。
 * 2. 云开发没有「签发」概念：getTempFileURL 换到的是平台固定的 2 小时有效 https 链接，
 *    入参 expiresIn 无法自定义（保留形参只为与 Supabase 版同签名）。
 * 3. 换链接与删文件都走 data 云函数（管理员身份），不在客户端直接调 wx.cloud 对应接口：
 *    客户端调用受「云存储安全规则」约束，权限一旦不是「公有读」，成员就换不出别人上传的
 *    文件的链接 —— 表现为同一家庭成员之间互相看不到照片。云函数不受安全规则限制。
 *    上传仍留在客户端（同一 cloudPath 覆盖写，走云函数反而要中转文件内容，得不偿失）。
 */
import { CLOUD_FILE_ID_PREFIX } from '@/config'
import { ApiError } from '../supabase/http'
import { callData } from './db'

/** getTempFileURL / deleteFile 单次调用的数量上限（官方：一次最多 50 个） */
const CLOUD_STORAGE_BATCH = 50

function assertPrefix() {
  if (!CLOUD_FILE_ID_PREFIX) {
    throw new ApiError(
      '云存储未配置：请在 src/config/index.js 填写 CLOUD_FILE_ID_PREFIX（云开发控制台 → 云存储 → 任一文件的 File ID，去掉文件名部分）',
      0,
      'STORAGE_NOT_CONFIGURED',
    )
  }
}

/**
 * 相对路径 → 文件 ID。
 * 文件 ID 的完整格式是 cloud://<环境ID>.<存储桶ID>/<相对路径>，
 * 而 config 里的前缀按官方说明去掉了 `cloud://`（复制 File ID 时要手动去掉的部分），
 * 所以这里必须补回协议头，否则拼出来的不是合法 fileID，换链接/删文件都会失败。
 * 已是 cloud:// 或 http(s) 的原样返回（兼容将来直接存文件 ID 的情况）。
 *
 * 导出是为了让「运维删残留文件」（services/cloud/admin.js）复用同一套前缀规则，
 * 避免两处各拼一遍、改前缀时漏掉一处。
 */
export function toFileId(path) {
  if (!path) return ''
  if (/^(cloud|https?):\/\//.test(path)) return path
  assertPrefix()
  return `cloud://${CLOUD_FILE_ID_PREFIX}${path}`
}

/** 按上限切块 */
function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** 在客户端调用 wx.cloud 的存储接口（目前只剩上传：换链接/删文件已改走云函数），统一成 Promise */
function callCloud(method, params) {
  const args = { ...params }
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    if (typeof wx === 'undefined' || !wx.cloud) {
      reject(new ApiError('当前环境不支持微信云存储', 0, 'CLOUD_UNAVAILABLE'))
      return
    }
    wx.cloud[method]({
      ...args,
      success: resolve,
      fail: (err) => {
        console.error(`[Storage] ${method} 调用失败`, err)
        reject(new ApiError('网络连接失败，请检查网络后重试', 0, 'NETWORK_ERROR', err))
      },
    })
    return
    // #endif
    // #ifndef MP-WEIXIN
    reject(new ApiError('云存储仅在微信小程序端可用', 0, 'CLOUD_UNAVAILABLE'))
    // #endif
  })
}

/**
 * 上传本地文件到云存储。
 * @param {string} path     对象路径，如 {family_id}/{baby_id}/avatar.jpg
 * @param {string} filePath 本地临时文件路径（chooseImage/chooseMedia 返回）
 * @param {{ upsert?: boolean }} options upsert 在云开发里天然成立（同一 cloudPath 即覆盖写）
 * @returns {Promise<void>}
 */
export async function uploadObject(path, filePath, options = {}) {
  const { upsert = false } = options
  console.log('[Storage] 上传', path, { upsert })
  await callCloud('uploadFile', { cloudPath: path, filePath })
  // 同一路径被覆盖写（换头像就是这么做的）：清掉旧链接，否则页面还显示上一张
  SIGNED_URL_CACHE.delete(path)
}

/**
 * 签名 URL 缓存：对象路径 → { url, expiresAt }。
 *
 * 照片桶是私有的，每次进列表页都要把一页照片的链接换一遍；同一个路径在有效期内
 * 换多少次得到的都是等价的链接，重复换只是白发一次请求 —— 弱网下这一步要等好几秒。
 * 所以按路径复用，只在剩余有效期不足 5 分钟时才重新签。
 *
 * 覆盖写同一个路径时要主动清掉（见 uploadObject），否则会一直显示旧图。
 */
const SIGNED_URL_CACHE = new Map()
/** 剩余有效期少于这个值就重新签，避免刚好在加载途中过期 */
const SIGN_URL_REFRESH_MARGIN = 5 * 60 * 1000

/** 生成对象的临时访问地址。
 * @returns {Promise<string>} https 链接（有效期 2 小时）
 */
export async function createSignedUrl(path, expiresIn = 3600) {
  const [item] = await createSignedUrls([path], expiresIn)
  if (!item || !item.url) {
    console.error('[Storage] 换取临时链接失败', path)
    throw new ApiError('获取图片地址失败', 0, 'SIGN_FAILED')
  }
  return item.url
}

/**
 * 批量换取临时访问地址：一页照片只需一次请求。
 * 命中缓存的不再请求；超过 50 个自动分批（里程碑列表一次最多取 100 条，必须分批）。
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
    const fileIds = pending.map(toFileId)
    const fresh = {}
    for (const ids of chunk(fileIds, CLOUD_STORAGE_BATCH)) {
      // 走 data 云函数（管理员身份）：客户端直接调限制在「公有读」才可用，家人之间会换不出链接
      const res = await callData({ action: 'tempFileURL', fileList: ids })
      const rows = (res && res.data) || []
      rows.forEach((row) => {
        if (row && row.tempFileURL) fresh[row.fileID] = row.tempFileURL
      })
    }
    const expiresAt = Date.now() + expiresIn * 1000
    pending.forEach((path, index) => {
      const url = fresh[fileIds[index]]
      if (!url) return
      urlMap[path] = url
      SIGNED_URL_CACHE.set(path, { url, expiresAt })
    })
    const failed = pending.filter((path) => !urlMap[path])
    if (failed.length) console.error('[Storage] 部分文件换取临时链接失败', failed)
  }

  return list.map((path) => {
    const url = urlMap[path] || ''
    return { path, url, error: url ? null : 'SIGN_FAILED' }
  })
}

/** 批量删除对象（删除照片/换头像时清理旧文件），同样走 data 云函数的管理员身份 */
export async function removeObjects(paths) {
  const list = (paths || []).filter(Boolean)
  if (!list.length) return
  const fileIds = list.map(toFileId)
  console.log('[Storage] 删除对象', list)
  for (const ids of chunk(fileIds, CLOUD_STORAGE_BATCH)) {
    await callData({ action: 'deleteFile', fileList: ids })
  }
  // 删掉的文件不留在缓存里，免得后面还拿着一个指向空对象的链接
  list.forEach((path) => SIGNED_URL_CACHE.delete(path))
}

/**
 * 把对象下载到本地临时文件，返回临时路径（备份照片存相册时要用原件）。
 *
 * 按文件 ID 走 wx.cloud.downloadFile，而不是先换签名 URL 再 uni.downloadFile：
 * 后者要求云存储域名加进小程序的「downloadFile 合法域名」，漏配就直接失败；
 * 前者走云开发通道，不需要配域名，也不白耗一次换链接的调用。
 */
export async function downloadObject(path) {
  const res = await callCloud('downloadFile', { fileID: toFileId(path) })
  if (!res || !res.tempFilePath) {
    throw new ApiError('下载失败，请重试', 0, 'DOWNLOAD_FAILED')
  }
  return res.tempFilePath
}

export const storage = {
  uploadObject,
  createSignedUrl,
  createSignedUrls,
  removeObjects,
  downloadObject,
}
