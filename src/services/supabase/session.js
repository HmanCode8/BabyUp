/**
 * 登录态（Supabase Session）的本地持久化。
 *
 * 设计要点：
 * - 内存缓存 + uni.storage 双写，避免每次请求都读一次同步存储；
 * - 统一把 Supabase 返回的 expires_in 换算成绝对时间 expires_at，便于判断过期；
 * - 只保存 token 与用户对象，绝不保存密码。
 */
import { SESSION_STORAGE_KEY } from '@/config'

/** @type {{ access_token: string, refresh_token: string, expires_at: number, user: object } | null} */
let cachedSession = null

function normalize(raw) {
  if (!raw || !raw.access_token) return null
  const expiresAt =
    typeof raw.expires_at === 'number'
      ? raw.expires_at
      : Math.floor(Date.now() / 1000) + (raw.expires_in || 3600)
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token || '',
    expires_at: expiresAt,
    user: raw.user || null,
  }
}

/** 读取当前登录态（优先内存，其次本地存储） */
export function getSession() {
  if (cachedSession) return cachedSession
  try {
    const raw = uni.getStorageSync(SESSION_STORAGE_KEY)
    if (!raw) return null
    cachedSession = normalize(typeof raw === 'string' ? JSON.parse(raw) : raw)
    return cachedSession
  } catch (err) {
    console.error('[Session] 读取本地登录态失败', err)
    return null
  }
}

/** 写入登录态 */
export function setSession(raw) {
  const session = normalize(raw)
  cachedSession = session
  try {
    if (session) {
      uni.setStorageSync(SESSION_STORAGE_KEY, JSON.stringify(session))
    } else {
      uni.removeStorageSync(SESSION_STORAGE_KEY)
    }
  } catch (err) {
    console.error('[Session] 持久化登录态失败', err)
  }
  return session
}

/** 清空登录态 */
export function clearSession() {
  cachedSession = null
  try {
    uni.removeStorageSync(SESSION_STORAGE_KEY)
  } catch (err) {
    console.error('[Session] 清除登录态失败', err)
  }
}
