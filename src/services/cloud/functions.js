/**
 * 云开发云函数调用层（迁移计划 · 阶段 5）。
 *
 * 与 ../supabase/functions.js 同形：业务层（account.js）只调 invoke(name, body)，
 * 不感知底层是 HTTPS 的 Edge Function 还是 wx.cloud.callFunction。
 *
 * 身份无需参数：云函数里的 OPENID 由微信侧注入，客户端伪造不了，
 * 所以没有 Supabase 侧的 Authorization 头 / withAuth 选项（保留形参以兼容调用处）。
 *
 * 约定：云函数统一返回
 *   成功 { ok: true, ...业务字段 }
 *   失败 { ok: false, code, message }
 * 成功时把整个 result 交回给业务层（与 Supabase 侧「返回函数响应体」一致），
 * 失败时抛 ApiError（错误归一化与 data 云函数、Supabase 侧保持同一套）。
 */
import { ApiError } from '../supabase/http'

/**
 * 调用一个云函数。
 *
 * @param {string} name 云函数名，如 'export-data'
 * @param {object} body 请求体（即云函数的 event）
 */
export async function invoke(name, body) {
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    if (typeof wx === 'undefined' || !wx.cloud) {
      reject(new ApiError('当前环境不支持微信云开发', 0, 'CLOUD_UNAVAILABLE'))
      return
    }
    wx.cloud.callFunction({
      name,
      data: body || {},
      success: (res) => {
        const result = res && res.result
        if (!result) {
          reject(new ApiError('服务返回异常，请稍后重试', 0, 'BAD_RESPONSE', res))
          return
        }
        if (result.ok) {
          resolve(result)
          return
        }
        reject(new ApiError(result.message || '操作失败，请稍后重试', 0, result.code || ''))
      },
      fail: (err) => {
        console.error('[Cloud] 调用云函数失败', name, err)
        reject(new ApiError('网络连接失败，请检查网络后重试', 0, 'NETWORK_ERROR', err))
      },
    })
    // #endif

    // #ifndef MP-WEIXIN
    reject(new ApiError('云开发后端仅在微信小程序端可用', 0, 'CLOUD_UNAVAILABLE'))
    // #endif
  })
}

export const functions = { invoke }
