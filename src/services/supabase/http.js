/**
 * Supabase HTTP 请求底层。
 *
 * 为什么不直接用官方 @supabase/supabase-js：
 * 官方 SDK 依赖 Headers / URL / AbortController / FormData / Blob / Response 等浏览器全局对象，
 * 微信小程序运行时不存在这些对象，且官方只开放了 global.fetch 一个注入点，无法补齐其余全局对象。
 * 因此这里基于 uni.request 自建轻量请求层，接口语义与 Supabase REST API 保持一致。
 *
 * 职责：
 * - 拼接 URL（支持 PostgREST 的查询参数写法）
 * - 注入 apikey 与 Authorization
 * - 统一错误结构
 * - access_token 过期时自动刷新并重放一次请求
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/config'
import { getSession, clearSession } from './session'

/** 业务可识别的错误对象 */
export class ApiError extends Error {
  constructor(message, status = 0, code = '', payload = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.payload = payload
  }
}

/** 由 auth 模块注册的「刷新登录态」实现，用于打破 http <-> auth 的循环依赖 */
let sessionRefresher = null
export function setSessionRefresher(fn) {
  sessionRefresher = fn
}

/** 同一时刻只允许一个刷新请求在飞 */
let refreshInFlight = null
export function runSingleFlightRefresh() {
  if (!sessionRefresher) return Promise.resolve(null)
  if (!refreshInFlight) {
    refreshInFlight = Promise.resolve()
      .then(() => sessionRefresher())
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

/** 把对象拼成 query string；数组会展开为同名重复参数 */
export function encodeQuery(params) {
  if (!params) return ''
  const parts = []
  Object.keys(params).forEach((key) => {
    const value = params[key]
    if (value === undefined || value === null || value === '') return
    const list = Array.isArray(value) ? value : [value]
    list.forEach((item) => {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(item)}`)
    })
  })
  return parts.length ? `?${parts.join('&')}` : ''
}

/** 把 Supabase 各种错误返回体归一化成一句人话 */
function extractErrorMessage(status, payload) {
  if (!payload) return `请求失败（HTTP ${status}）`
  if (typeof payload === 'string') return payload
  const message =
    payload.error_description || payload.msg || payload.message || payload.error || ''
  if (message) return message
  return `请求失败（HTTP ${status}）`
}

/**
 * 发起一次 Supabase REST 请求。
 *
 * @param {object} options
 * @param {string} options.path          例如 '/auth/v1/token'、'/rest/v1/families'
 * @param {string} [options.method]      GET / POST / DELETE ...
 * @param {object} [options.query]       拼到 URL 上的查询参数
 * @param {object} [options.data]        请求体
 * @param {object} [options.headers]     额外请求头
 * @param {boolean} [options.withAuth]   是否附带当前用户的 access_token
 * @param {boolean} [options.retryOnAuth] 遇到 401 是否自动刷新后重放
 * @param {string} [options.authKey]     覆盖 apikey（调 Edge Function 时用新版 publishable key）
 */
export function request(options) {
  const {
    path,
    method = 'GET',
    query,
    data,
    headers = {},
    withAuth = true,
    retryOnAuth = true,
    authKey,
  } = options

  const session = getSession()
  const url = `${SUPABASE_URL}${path}${encodeQuery(query)}`
  // 未登录（或明确要求匿名）时用它兜底：Edge Functions 网关只认新版密钥，其它接口认 anon key
  const fallbackKey = authKey || SUPABASE_ANON_KEY
  const header = {
    apikey: fallbackKey,
    'Content-Type': 'application/json',
    ...headers,
  }
  header.Authorization = `Bearer ${withAuth && session ? session.access_token : fallbackKey}`

  console.log(`[Http] ${method} ${path}`, query ? { query } : '')

  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method,
      header,
      data,
      success: (res) => {
        const { statusCode, data: body } = res
        if (statusCode >= 200 && statusCode < 300) {
          resolve({ data: body, header: res.header, status: statusCode })
          return
        }
        const message = extractErrorMessage(statusCode, body)
        console.error(`[Http] ${method} ${path} 失败`, statusCode, body)
        reject(new ApiError(message, statusCode, body && body.code, body))
      },
      fail: (err) => {
        console.error(`[Http] ${method} ${path} 网络异常`, err)
        reject(new ApiError('网络连接失败，请检查网络后重试', 0, 'NETWORK_ERROR', err))
      },
    })
  }).catch(async (err) => {
    const session = getSession()
    const canRetry =
      retryOnAuth &&
      err instanceof ApiError &&
      err.status === 401 &&
      Boolean(session && session.refresh_token)
    if (!canRetry) throw err
    console.warn('[Http] access_token 失效，尝试刷新后重放', path)
    const refreshed = await runSingleFlightRefresh()
    if (!refreshed) {
      clearSession()
      throw err
    }
    return request({ ...options, retryOnAuth: false })
  })
}
