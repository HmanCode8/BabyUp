/**
 * 账号体系（对应需求文档 3.2：微信一键登录为主 + 手机号密码兜底）。
 *
 * 手机号方案：把手机号映射成 Supabase 邮箱账号 `{手机号}@{PHONE_EMAIL_DOMAIN}`，
 * 复用 Supabase Auth 的邮箱密码能力。
 * 微信方案：小程序 uni.login 拿 code 交给 Edge Function 换 openid 并签发 Session，
 * 前端只拿 access_token / refresh_token，不接触 AppSecret，也不保存 code / session_key。
 *
 * 补丁 Step 2（绑定真实邮箱 / 找回密码）：绑定后 auth.users.email 变为真实邮箱，
 * 登录标识随之切换，因此登录要同时支持「手机号」与「邮箱」两种输入，
 * 见 accountToEmail()。
 */
import {
  PHONE_EMAIL_DOMAIN,
  PHONE_LOGIN_FUNCTION,
  WECHAT_EMAIL_DOMAIN,
  WECHAT_LOGIN_FUNCTION,
  SUPABASE_PUBLISHABLE_KEY,
} from '@/config'
import { request, ApiError, setSessionRefresher } from './http'
import { getSession, setSession, clearSession } from './session'

/** 中国大陆手机号 */
const PHONE_PATTERN = /^1[3-9]\d{9}$/

/** 手机号 -> Supabase 邮箱账号 */
export function phoneToEmail(phone) {
  return `${String(phone || '').trim()}@${PHONE_EMAIL_DOMAIN}`
}

/**
 * 登录账号 -> Supabase 邮箱账号。
 *
 * 兼容两种输入：11 位手机号走一期映射规则；其余按真实邮箱处理。
 * 绑定邮箱后手机号登录会失效（登录邮箱已换成真实邮箱），
 * 用户必须用邮箱登录，所以这里必须同时认两种。
 */
export function accountToEmail(account) {
  const value = String(account || '').trim()
  if (PHONE_PATTERN.test(value)) return phoneToEmail(value)
  return value.toLowerCase()
}

/**
 * 账号邮箱是否为「用户自己绑定的真实邮箱」。
 *
 * 手机号账号邮箱是 {手机号}@phone.babyup.app、微信账号是 wx_{openid}@wechat.local，
 * 这两个地址都收不到邮件，只有真实邮箱才能用于找回密码（见 Step 2 实测结论：
 * GoTrue 只给账号登录邮箱发重置信）。
 */
export function isRecoveryEmailBound(email) {
  const value = String(email || '').trim().toLowerCase()
  if (!value || !value.includes('@')) return false
  return !value.endsWith(`@${PHONE_EMAIL_DOMAIN}`) && !value.endsWith(`@${WECHAT_EMAIL_DOMAIN}`)
}

/** 日志脱敏：13800138000 -> 138****8000；someone@qq.com -> so***@qq.com */
function maskAccount(account) {
  const value = String(account || '').trim()
  if (PHONE_PATTERN.test(value)) return value.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
  return value.replace(/^(.{2}).*(@.*)$/, '$1***$2')
}

/** 把 Supabase 的英文错误转成用户能看懂的中文提示 */
function toFriendlyMessage(err) {
  const raw = (err && err.message) || ''
  const errorCode = (err && err.payload && err.payload.error_code) || ''
  // GoTrue 的邮件/请求频控：文案里只有「after N seconds」，靠 error_code 识别
  if (errorCode === 'over_email_send_rate_limit' || errorCode === 'over_request_rate_limit') {
    return '操作过于频繁，请稍后再试'
  }
  const map = {
    'Invalid login credentials': '手机号/邮箱或密码错误',
    'User already registered': '该手机号已注册，请直接登录',
    'Email not confirmed':
      '账号邮箱未确认。请在 Supabase 后台关闭「Confirm email」后重新登录',
    'Password should be at least 6 characters': '密码至少 6 位',
    'Signups not allowed for this instance': '当前项目已关闭注册，请在 Supabase 后台开启',
    'User not found': '该手机号尚未注册',
    'Invalid Refresh Token: Refresh Token Not Found': '登录态已失效，请重新登录',
  }
  if (map[raw]) return map[raw]
  // 改邮箱的两个可识别分支（实测：格式错 400 validation_failed / 被占用 422 email_exists）
  if (errorCode === 'email_exists') return '该邮箱已被其他账号使用，请换一个'
  if (errorCode === 'validation_failed' || /validate email address/i.test(raw)) {
    return '邮箱格式不正确，请检查后重试'
  }
  // 发信失败（如项目 SMTP 未配置或凭据失效）：GoTrue 只回一句英文，
  // 这里换成用户能看懂的话；真实原因看服务端 Auth 日志
  if (/error sending/i.test(raw) || errorCode === 'unexpected_failure') {
    return '邮件发送失败，请稍后重试'
  }
  if (/rate limit|too many requests/i.test(raw)) return '操作过于频繁，请稍后再试'
  return raw || '操作失败，请重试'
}

/** 把 Supabase 的错误包装成带中文提示的 ApiError */
function wrapError(err) {
  const message = toFriendlyMessage(err)
  const status = err instanceof ApiError ? err.status : 0
  const code = err instanceof ApiError ? err.code : 'UNKNOWN'
  return new ApiError(message, status, code, err && err.payload)
}

/** 手机号 + 密码注册；若项目已开启邮箱确认导致无 session，会自动补一次登录 */
export async function signUpWithPhone(phone, password) {
  const email = phoneToEmail(phone)
  console.log('[Auth] 注册手机号', maskAccount(phone))
  let res
  try {
    res = await request({
      path: '/auth/v1/signup',
      method: 'POST',
      withAuth: false,
      data: { email, password },
    })
  } catch (err) {
    throw wrapError(err)
  }
  if (res.data && res.data.access_token) {
    setSession(res.data)
    return { user: res.data.user, needConfirmEmail: false }
  }
  // 开启了邮箱确认：注册接口只返回用户、不返回 session，这里补一次登录以便明确告知用户
  return signInWithAccount(phone, password)
}

/** 账号（手机号或真实邮箱）+ 密码登录 */
export async function signInWithAccount(account, password) {
  const value = String(account || '').trim()
  const email = accountToEmail(value)
  console.log('[Auth] 登录请求', maskAccount(value))
  let res
  try {
    res = await request({
      path: '/auth/v1/token',
      method: 'POST',
      query: { grant_type: 'password' },
      withAuth: false,
      retryOnAuth: false,
      data: { email, password },
    })
  } catch (err) {
    // 手机号直登失败时兜底：绑定过真实邮箱的账号，其登录邮箱已不是
    // {手机号}@phone.babyup.app，需要服务端按手机号反查当前登录邮箱再登录一次。
    // 只在「凭据错误」时兜底，网络/频控等其它失败直接抛出，不做无谓的第二次请求。
    if (PHONE_PATTERN.test(value) && isInvalidCredentials(err)) {
      console.log('[Auth] 手机号直登未通过，改走服务端反查')
      try {
        const session = await signInByPhoneLookup(value, password)
        return { user: session.user, needConfirmEmail: false }
      } catch (lookupErr) {
        // 400 = 服务端明确判定「手机号或密码错误」，直接用它；
        // 其它（函数未部署、网络异常、5xx）属通道问题，回退到原始错误，
        // 不把基础设施故障暴露成奇怪的文案。
        if (lookupErr instanceof ApiError && lookupErr.status === 400) throw lookupErr
        console.error('[Auth] 手机号兜底登录通道异常，回退原始错误', lookupErr)
      }
    }
    throw wrapError(err)
  }
  const session = setSession(res.data)
  console.log('[Auth] 登录成功', session && session.user && session.user.id)
  return { user: session.user, needConfirmEmail: false }
}

/** 是否为「账号或密码错误」这类可兜底的失败 */
function isInvalidCredentials(err) {
  return Boolean(err instanceof ApiError && err.payload && err.payload.error_code === 'invalid_credentials')
}

/**
 * 手机号兜底登录：交给 Edge Function 按手机号反查账号当前的登录邮箱后完成登录。
 *
 * 为什么不在前端做：反查需要读 profiles.phone（RLS 只允许本人读自己那行）
 * 并取得 auth 账号的登录邮箱，这两件事只有服务端的 service_role 能做；
 * 且邮箱不下发前端，避免把「手机号 → 邮箱」映射暴露成查询接口。
 */
async function signInByPhoneLookup(phone, password) {
  const res = await request({
    path: `/functions/v1/${PHONE_LOGIN_FUNCTION}`,
    method: 'POST',
    // 函数网关只认新版密钥；此处未登录，用 publishable key
    authKey: SUPABASE_PUBLISHABLE_KEY,
    withAuth: false,
    retryOnAuth: false,
    data: { phone, password },
  })
  const session = res.data && res.data.session
  if (!session || !session.access_token) {
    console.error('[Auth] 手机号兜底登录返回体异常', res.data)
    throw new ApiError('手机号或密码错误', 0, 'PHONE_LOGIN_FAILED', res.data)
  }
  const next = setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    user: session.user,
  })
  console.log('[Auth] 手机号兜底登录成功', next && next.user && next.user.id)
  return next
}

/**
 * 绑定（更换）真实邮箱 —— 补丁 Step 2，文档 4.7「路线 1：真实邮箱即账号邮箱」。
 *
 * 走 GoTrue 原生改邮箱接口，调用后邮箱进入「待确认」状态（返回体的 new_email），
 * Supabase 会往新邮箱发一封确认信，用户点击链接后才真正生效。
 * 生效后登录标识由 `{手机号}@phone.babyup.app` 切换为真实邮箱，
 * 该手机号将无法再登录（用户改用邮箱 + 原密码登录）。
 *
 * 实测要点（2026-09-18）：
 * - 请求本身返回 200，此时 user.email 仍是旧值，待确认邮箱在 new_email；
 * - 只发信给新邮箱（项目未开启 secure email change，无需旧邮箱也确认）；
 * - 因此这里不做任何「立即生效」的假设，只把待确认邮箱回传给页面展示。
 *
 * @returns {Promise<{ user: object, pendingEmail: string }>}
 */
export async function updateEmail(email) {
  const next = String(email || '').trim().toLowerCase()
  console.log('[Auth] 提交绑定邮箱', maskAccount(next))
  let res
  try {
    res = await request({
      path: '/auth/v1/user',
      method: 'PUT',
      retryOnAuth: false,
      data: { email: next },
    })
  } catch (err) {
    throw wrapError(err)
  }
  const user = res.data || {}
  return { user, pendingEmail: user.new_email || user.email_change || '' }
}

/**
 * 找回密码：向指定邮箱发送重置邮件（未登录即可调用）。
 *
 * 注意（Step 2 实测结论）：GoTrue 只给「账号登录邮箱」发信——
 * 未注册/非账号邮箱会静默返回成功但不发信。
 * 所以调用前必须先用 isRecoveryEmailBound() 拦住一期假邮箱，
 * 并引导用户使用真实邮箱或先绑定邮箱。
 */
export async function requestPasswordReset(email) {
  const target = String(email || '').trim().toLowerCase()
  console.log('[Auth] 请求重置密码邮件', maskAccount(target))
  try {
    await request({
      path: '/auth/v1/recover',
      method: 'POST',
      withAuth: false,
      retryOnAuth: false,
      data: { email: target },
    })
  } catch (err) {
    throw wrapError(err)
  }
  return true
}

/**
 * 微信一键登录（对应需求文档 3.2 / 流程 1）。
 *
 * code 由调用方通过 uni.login 拿到；本函数只负责把它交给 Edge Function，
 * 拿到服务端签发的 access_token / refresh_token 后写回本地登录态。
 * 之后所有请求与手机号登录完全一致（同一套 RLS 身份）。
 *
 * @param {string} code uni.login 返回的临时登录凭证
 * @returns {Promise<{ user: object }>}
 */
export async function signInWithWechat(code) {
  if (!code) throw new ApiError('未获取到微信登录凭证，请重试', 400, 'NO_CODE')
  console.log('[Auth] 微信登录请求 Edge Function', WECHAT_LOGIN_FUNCTION)
  let res
  try {
    res = await request({
      path: `/functions/v1/${WECHAT_LOGIN_FUNCTION}`,
      method: 'POST',
      // 函数网关只认新版密钥；此处未登录，用 publishable key 兜底
      authKey: SUPABASE_PUBLISHABLE_KEY,
      withAuth: false,
      retryOnAuth: false,
      data: { code },
    })
  } catch (err) {
    throw wrapError(err)
  }

  const session = res.data && res.data.session
  if (!session || !session.access_token) {
    console.error('[Auth] 微信登录返回体异常', res.data)
    throw new ApiError('微信登录失败，请改用手机号登录', 0, 'WECHAT_LOGIN_FAILED', res.data)
  }

  const next = setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    user: session.user,
  })
  console.log('[Auth] 微信登录成功', next && next.user && next.user.id)
  return { user: next.user }
}

/** 用 refresh_token 换新 session（access_token 过期、或主动续期时调用） */
export async function refreshSession() {
  const session = getSession()
  if (!session || !session.refresh_token) return null
  try {
    const res = await request({
      path: '/auth/v1/token',
      method: 'POST',
      query: { grant_type: 'refresh_token' },
      withAuth: false,
      retryOnAuth: false,
      data: { refresh_token: session.refresh_token },
    })
    const next = setSession(res.data)
    console.log('[Auth] 登录态已刷新')
    return next
  } catch (err) {
    console.error('[Auth] 刷新登录态失败，清除本地登录态', err)
    clearSession()
    return null
  }
}

/** 退出登录：先通知服务端吊销 refresh_token，无论成功与否都清掉本地登录态 */
export async function signOut() {
  try {
    await request({ path: '/auth/v1/logout', method: 'POST' })
  } catch (err) {
    console.error('[Auth] 服务端登出失败（本地登录态仍会被清除）', err)
  }
  clearSession()
  console.log('[Auth] 已退出登录')
}

/** 读取本地登录态（不发起网络请求） */
export function currentSession() {
  return getSession()
}

/** 当前登录用户 id；未登录返回空串 */
export function currentUserId() {
  const session = getSession()
  return session && session.user ? session.user.id : ''
}

/** 向服务端校验当前 access_token 并取回最新用户信息 */
export async function fetchUser() {
  const res = await request({ path: '/auth/v1/user', method: 'GET', retryOnAuth: false })
  return res.data
}

/** 连通性探测：打 Auth 服务健康检查接口，用于自检与弱网提示 */
export async function checkConnection() {
  const res = await request({
    path: '/auth/v1/health',
    method: 'GET',
    withAuth: false,
    retryOnAuth: false,
  })
  return res.data
}

// 注册刷新实现，供 http 层在 401 时自动续期（避免 http <-> auth 循环依赖）
setSessionRefresher(refreshSession)

export { getSession }
