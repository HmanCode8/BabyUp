/**
 * Supabase 客户端单例（一期唯一入口）。
 *
 * 页面只与这里打交道，不关心底层是 HTTP 还是官方 SDK；
 * 后续若要换回官方 SDK，只需替换本目录内的实现，页面代码无需改动。
 */
import { SUPABASE_URL, STORAGE_BUCKET } from '@/config'
import { ApiError } from './http'
import * as sessionApi from './session'
import * as authApi from './auth'
import * as dbApi from './db'
import * as storageApi from './storage'
import * as functionsApi from './functions'

export const supabase = {
  /** 项目信息（只读） */
  project: {
    url: SUPABASE_URL,
    storageBucket: STORAGE_BUCKET,
  },
  /**
   * 后端能力开关（页面据此决定是否渲染对应入口）。
   * Supabase 版三项全开：手机号账号密码登录、邮箱找回密码、绑定真实邮箱。
   */
  capabilities: {
    phoneLogin: true,
    emailRecovery: true,
    emailBinding: true,
    // 微信登录是否需要前端先 uni.login 换 code 交给后端（Supabase 的 Edge Function 需要）
    wechatLoginCode: true,
    // AI 助手依赖微信云开发的 wx.cloud.extend.AI，Supabase 版不提供（见 @/services/ai）
    aiChat: false,
  },
  /** 账号体系 */
  auth: {
    signUpWithPhone: authApi.signUpWithPhone,
    signInWithAccount: authApi.signInWithAccount,
    signInWithWechat: authApi.signInWithWechat,
    signOut: authApi.signOut,
    refreshSession: authApi.refreshSession,
    fetchUser: authApi.fetchUser,
    checkConnection: authApi.checkConnection,
    accountToEmail: authApi.accountToEmail,
    isRecoveryEmailBound: authApi.isRecoveryEmailBound,
    updateEmail: authApi.updateEmail,
    requestPasswordReset: authApi.requestPasswordReset,
    currentUserId: authApi.currentUserId,
  },
  /** Edge Functions */
  functions: functionsApi.functions,
  /** 登录态本地读写 */
  session: {
    get: sessionApi.getSession,
    set: sessionApi.setSession,
    clear: sessionApi.clearSession,
  },
  /** 数据表访问 */
  db: dbApi.db,
  /** 文件存储访问 */
  storage: storageApi.storage,
  ApiError,
}

export default supabase
