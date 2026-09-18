/**
 * Supabase Edge Functions 调用层（二期新增）。
 *
 * 依然走 uni.request：微信小程序无法构造官方 SDK 依赖的全局对象，
 * 而 Edge Function 就是普通 HTTPS 接口，用现有请求层调用即可，
 * 401 自动续期、错误归一化等行为与其它请求保持一致。
 */
import { SUPABASE_PUBLISHABLE_KEY } from '@/config'
import { request } from './http'

/**
 * 调用一个 Edge Function。
 *
 * 注意：本项目的函数网关只接受新版密钥格式，因此这里固定用 publishable key
 * （旧版 anon key 会 401 INVALID_API_KEY）；已登录时 Authorization 仍是用户 access_token。
 *
 * @param {string} name 函数名，如 'wechat-login'
 * @param {object} body 请求体
 * @param {object} [options] { withAuth } 默认带当前登录态
 */
export async function invoke(name, body, options = {}) {
  const { withAuth = true } = options
  const res = await request({
    path: `/functions/v1/${name}`,
    method: 'POST',
    authKey: SUPABASE_PUBLISHABLE_KEY,
    withAuth,
    data: body,
  })
  return res.data
}

export const functions = { invoke }
