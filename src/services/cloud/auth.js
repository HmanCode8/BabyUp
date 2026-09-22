/**
 * 账号体系（迁移计划 · 阶段 3）——微信云开发版。
 *
 * 与 ../supabase/auth.js 同形（12 个方法），页面与 store 一行不用改；
 * 差异全部收在本文件里。
 *
 * 缩水点（见迁移计划「已锁定的决策」）：云开发只保留微信一键登录。
 * 云函数天然拿得到 openid，身份由微信侧保证，因此这里没有
 * access_token / refresh_token、没有密码、没有邮箱：
 * 手机号注册登录、绑定邮箱、找回密码一律抛「当前后端不支持」，
 * 页面按 api.capabilities 隐藏这些入口。
 */
import { ApiError } from '../supabase/http'
import { getSession, setSession, clearSession } from '../supabase/session'

/** 登录云函数名，与 src/cloudfunctions/login 对应 */
const LOGIN_FUNCTION = 'login'

const NOT_SUPPORTED_MESSAGE = '当前为微信云开发后端，请使用微信一键登录'

/** 云开发版所有「账号密码体系」的方法都抛这个错，页面据此隐藏入口 */
function notSupported() {
  throw new ApiError(NOT_SUPPORTED_MESSAGE, 0, 'NOT_SUPPORTED')
}

/**
 * 调用 login 云函数。
 * 成功返回整个 { ok: true, user, created }；业务失败与网络失败都抛 ApiError。
 */
function callLogin() {
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    if (typeof wx === 'undefined' || !wx.cloud) {
      reject(new ApiError('当前环境不支持微信云开发', 0, 'CLOUD_UNAVAILABLE'))
      return
    }
    wx.cloud.callFunction({
      name: LOGIN_FUNCTION,
      data: {},
      success: (res) => {
        const result = res && res.result
        if (!result) {
          reject(new ApiError('登录服务返回异常', 0, 'BAD_RESPONSE', res))
          return
        }
        if (result.ok) {
          resolve(result)
          return
        }
        reject(new ApiError(result.message || '微信登录失败，请重试', 0, result.code || ''))
      },
      fail: (err) => {
        console.error('[Auth] 调用 login 云函数失败', err)
        reject(new ApiError('网络连接失败，请检查网络后重试', 0, 'NETWORK_ERROR', err))
      },
    })
    // #endif

    // #ifndef MP-WEIXIN
    reject(new ApiError('云开发后端仅在微信小程序端可用', 0, 'CLOUD_UNAVAILABLE'))
    // #endif
  })
}

/**
 * 写入本地登录态。
 *
 * 注意 access_token：session 模块的 normalize() 要求它非空（supabase/session.js），
 * 否则整份登录态会被当成 null，而 isLoggedIn 也是看它。
 * 云开发没有令牌，这里放用户的 openid 作占位 —— 它不会被发往任何服务端
 * （云函数只认 cloud.getWXContext().OPENID，前端传什么都不信）。
 */
function persistUser(user) {
  return setSession({ access_token: user.id, refresh_token: '', user })
}

/**
 * 微信一键登录。
 *
 * 入参由页面传 uni.login 拿到的 code，云开发用不上（openid 由微信侧注入），故忽略。
 *
 * @returns {Promise<{ user: object }>}
 */
export async function signInWithWechat() {
  console.log('[Auth] 微信一键登录（云开发：直接调 login 云函数）')
  const res = await callLogin()
  const user = res && res.user
  if (!user || !user.id) {
    console.error('[Auth] 微信登录返回体异常', res)
    throw new ApiError('微信登录失败，请重试', 0, 'WECHAT_LOGIN_FAILED', res)
  }
  const next = persistUser(user)
  console.log('[Auth] 微信登录成功', next && next.user && next.user.id)
  return { user: next.user }
}

/**
 * 续期登录态。
 *
 * 云开发的登录态由微信 openid 决定，不存在过期与续期，
 * 因此这里不发任何请求，只按契约返回当前登录态。
 */
export async function refreshSession() {
  return getSession()
}

/**
 * 退出登录。
 *
 * 云开发没有服务端会话可吊销（身份来自微信），清掉本地登录态即可；
 * 下次进来仍需点「微信一键登录」才会重新写入。
 */
export async function signOut() {
  clearSession()
  console.log('[Auth] 已退出登录（云开发无需通知服务端）')
}

/** 当前登录用户 id（即 openid）；未登录返回空串 */
export function currentUserId() {
  const session = getSession()
  return session && session.user ? session.user.id : ''
}

/**
 * 取回最新用户信息（页面刷新绑定状态等场景）。
 * 云开发下等同于再调一次 login 云函数，并把最新的用户对象写回本地登录态。
 */
export async function fetchUser() {
  const session = getSession()
  if (!session) throw new ApiError('登录态已失效，请重新登录', 401, 'UNAUTHORIZED')
  const res = await callLogin()
  const user = res && res.user
  if (!user || !user.id) {
    console.error('[Auth] 获取用户信息返回体异常', res)
    throw new ApiError('获取用户信息失败，请重试', 0, 'BAD_RESPONSE', res)
  }
  persistUser(user)
  return user
}

/** 连通性探测：能调通 login 云函数即视为后端可用 */
export async function checkConnection() {
  await callLogin()
  return { ok: true, backend: 'cloud' }
}

/** 云开发没有邮箱体系，恒为 false（页面据此隐藏找回密码入口） */
export function isRecoveryEmailBound() {
  return false
}

export function accountToEmail() {
  return notSupported()
}

export function signUpWithPhone() {
  return notSupported()
}

export function signInWithAccount() {
  return notSupported()
}

export function updateEmail() {
  return notSupported()
}

export function requestPasswordReset() {
  return notSupported()
}

export { getSession }
