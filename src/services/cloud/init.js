/**
 * 微信云开发初始化。
 *
 * 只在 mp-weixin 平台生效：H5 没有 wx.cloud，由 ../api.js 的 H5 回落
 * 挡在前面，不会走到这里。
 *
 * 环境 ID 从 @/config 的 CLOUD_ENV_ID 读，见《双后端迁移计划》阶段 1。
 */
import { CLOUD_ENV_ID } from '@/config'

let inited = false

/** 幂等：重复调用只生效一次 */
export function initCloud() {
  // #ifdef MP-WEIXIN
  if (inited) return
  if (!CLOUD_ENV_ID) {
    console.warn('[cloud] CLOUD_ENV_ID 为空，跳过云开发初始化')
    return
  }
  wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
  inited = true
  // #endif
}
