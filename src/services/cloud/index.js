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
import * as membershipApi from './membership'
import * as adminApi from './admin'
import * as flagsApi from './flags'

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
    // 会员权益（families 上的字段 + 云函数读写）也只有云开发版提供
    membership: true,
    // 运维后台（站内）：身份来自云开发的 OPENID，Supabase 版没有这套东西
    admin: true,
    // 功能开关（全局 + 家庭覆盖，落在 app_config / families 上）
    flags: true,
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
    // 下载原件到本地临时文件（照片批量存相册用）
    downloadObject: storageApi.downloadObject,
  },
  /**
   * AI 能力（AI 助手）：wx.cloud.extend.AI 直调云开发托管模型。
   * 业务层统一走 @/services/ai，不直接引本文件。
   */
  ai: {
    streamChat: aiApi.streamChat,
    defaultModel: aiApi.AI_DEFAULT_MODEL,
    // 今日额度只读查询（peek）与回答反馈
    quota: aiApi.quota,
    feedback: aiApi.feedback,
  },
  /**
   * 会员权益（开通码兑换 + 状态查询）。
   * 会员制是否**上线**由服务端开关决定，见 @/services/membership。
   */
  membership: {
    status: membershipApi.status,
    redeem: membershipApi.redeem,
  },
  /**
   * 运维后台（站内）：数据从 data 云函数的 admin* action 拿，
   * 服务端按 openid 白名单鉴权（非运维调用会直接报「没有运维权限」）。
   */
  admin: {
    overview: adminApi.overview,
    families: adminApi.families,
    setTier: adminApi.setTier,
    // 开通码台账：列表 / 批量生成 / 作废恢复
    codes: adminApi.codes,
    createCodes: adminApi.createCodes,
    setCodeStatus: adminApi.setCodeStatus,
    // 功能开关：清单/全局现状 + 改全局或某一家
    flags: adminApi.flags,
    setFlag: adminApi.setFlag,
    // 删家庭（含数据级联）与删残留文件
    deleteFamily: adminApi.deleteFamily,
    deleteFiles: adminApi.deleteFiles,
    // 全部成员一览（只读）
    users: adminApi.users,
    // 进某个家庭管成员：成员列表 / 改角色 / 移除 / 转移创建者
    familyMembers: adminApi.familyMembers,
    setMemberRole: adminApi.setMemberRole,
    removeMember: adminApi.removeMember,
    transferOwner: adminApi.transferOwner,
    // 意见反馈：看全部 + 处理（改状态、写一句回复）+ 换截图链接
    feedbacks: adminApi.feedbacks,
    setFeedbackStatus: adminApi.setFeedbackStatus,
    fileUrls: adminApi.fileUrls,
  },
  /**
   * 功能开关的**读**（所有登录用户读自己家的生效值）。
   * 生效值 = 总闸（全局）压住分闸（各家覆盖），由服务端算好下发。
   * familyDetail / setFamilyFlag 只对家庭创建者开放。
   */
  flags: {
    status: flagsApi.status,
    familyDetail: flagsApi.familyDetail,
    setFamilyFlag: flagsApi.setFamilyFlag,
  },
  ApiError,
}

export default cloud
