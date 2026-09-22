/**
 * 微信云开发客户端（后端切换用）。
 *
 * 导出结构与 ../supabase/index.js 完全同形，
 * 业务代码通过 ../api 取用，不感知底层是哪一版。
 *
 * 当前进度：阶段 0~5 全部落地（data / auth / storage / functions 均为真实实现），
 * 与 Supabase 版一样可以直接对外提供，不再有 NOT_IMPLEMENTED 占位。
 */
import { CLOUD_ENV_ID, STORAGE_BUCKET } from '@/config'
import { ApiError } from '../supabase/http'
import { getSession, setSession, clearSession } from '../supabase/session'
import { db } from './db'
import * as authApi from './auth'
import * as storageApi from './storage'
import * as functionsApi from './functions'
import * as aiApi from './ai'

export const cloud = {
  /** 项目信息（只读） */
  project: {
    url: '',
    envId: CLOUD_ENV_ID,
    storageBucket: STORAGE_BUCKET,
  },
  /**
   * 后端能力开关（页面据此决定是否渲染对应入口）。
   * 云开发版只保留微信一键登录，三项全关：
   * 手机号账号密码登录、邮箱找回密码、绑定真实邮箱均不提供。
   */
  capabilities: {
    phoneLogin: false,
    emailRecovery: false,
    emailBinding: false,
    // 云开发的 openid 由微信侧注入 login 云函数，前端无需 uni.login 换 code
    wechatLoginCode: false,
    // AI 助手（模型直调）只有云开发版提供，Supabase 版恒为 false
    aiChat: true,
  },
  /** 账号体系（阶段 3：除账号密码/邮箱四项外全部可用） */
  auth: {
    signInWithWechat: authApi.signInWithWechat,
    signOut: authApi.signOut,
    refreshSession: authApi.refreshSession,
    fetchUser: authApi.fetchUser,
    checkConnection: authApi.checkConnection,
    currentUserId: authApi.currentUserId,
    accountToEmail: authApi.accountToEmail,
    // 云开发版没有邮箱体系，恒为 false，页面据此隐藏「找回密码」入口
    isRecoveryEmailBound: authApi.isRecoveryEmailBound,
    // 以下四项云开发版不提供（见迁移计划「已锁定的决策」），调用即抛 NOT_SUPPORTED
    signUpWithPhone: authApi.signUpWithPhone,
    signInWithAccount: authApi.signInWithAccount,
    updateEmail: authApi.updateEmail,
    requestPasswordReset: authApi.requestPasswordReset,
  },
  /** 云函数（阶段 5：export-data / delete-account 均走 wx.cloud.callFunction） */
  functions: {
    invoke: functionsApi.invoke,
  },
  /** 登录态本地读写（与后端无关，复用既有实现） */
  session: {
    get: getSession,
    set: setSession,
    clear: clearSession,
  },
  /** 数据集合访问（阶段 2：全部读写走 data 云函数，客户端不直连数据库） */
  db,
  /** 云存储访问（阶段 4：与 supabase/storage.js 同形，业务层零改动） */
  storage: {
    uploadObject: storageApi.uploadObject,
    createSignedUrl: storageApi.createSignedUrl,
    createSignedUrls: storageApi.createSignedUrls,
    removeObjects: storageApi.removeObjects,
  },
  /**
   * AI 能力（AI 助手）：wx.cloud.extend.AI 直调云开发托管模型。
   * 业务层统一走 @/services/ai，不直接引本文件。
   */
  ai: {
    streamChat: aiApi.streamChat,
    defaultModel: aiApi.AI_DEFAULT_MODEL,
  },
  ApiError,
}

export default cloud
