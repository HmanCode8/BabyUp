/**
 * 数据层统一入口（后端切换点）。
 *
 * 两套实现并存：
 * - ./supabase  现有 Supabase 后端（PostgREST + GoTrue + Storage）
 * - ./cloud     微信云开发后端
 *
 * 业务代码与页面只从这里取用，不感知底下是哪一版；
 * 切换改 @/config 里的 BACKEND。Supabase 版实现始终保留，
 * 把 BACKEND 改回 'supabase' 即可完全回滚。
 *
 * 迁移计划见《婴儿成长记录小程序-双后端迁移计划.md》。
 */
import { BACKEND } from '@/config'
import { supabase } from './supabase'
import { cloud } from './cloud'

let active = supabase
// H5 平台没有 wx.cloud，无论 BACKEND 配成什么都强制走 Supabase，
// 保证网页端不被云开发方案破坏。
// #ifndef H5
active = BACKEND === 'cloud' ? cloud : supabase
// #endif

/** 当前生效的数据层客户端 */
export const api = active

/**
 * 当前后端的能力开关（随 active 后端走）。
 * 页面据此隐藏后端不支持的入口，例如云开发下没有手机号登录与邮箱找回密码。
 * 注意取的是 active.capabilities 而非 BACKEND：H5 端会被强制回落 Supabase，
 * 能力判断必须与真正生效的后端一致。
 */
export const capabilities = active.capabilities

/** 当前生效的后端名：'supabase' | 'cloud'（仅用于文案与日志区分，勿用作业务分支） */
export const backendName = active === cloud ? 'cloud' : 'supabase'

/** 页面直接引用的独立辅助函数，随当前后端走 */
export function isRecoveryEmailBound(email) {
  return api.auth.isRecoveryEmailBound(email)
}

export default api
