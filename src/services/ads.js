/**
 * 广告位（业务层）。
 *
 * 跟「功能开关」是同一套路子（本机快照 + 服务端真源），但有一条关键差别：
 *
 *   功能开关读不到 → 按「开」（宁可多显示入口，也别把功能藏起来）
 *   广告配置读不到 → 按「关」（配置丢了 / 集合没建 / 请求失败，都不该让家人突然看到广告）
 *
 * 默认值正好相反，所以不复用 flags.js，另起一份快照。
 *
 * 现在只有一种形态：工具页底部的 Banner。要加激励视频 / 插屏时，
 * 在这里加一个取值函数，并在 components 下新开一个对应的组件。
 */
import { ref } from 'vue'
import { api, capabilities } from './api'

/**
 * 快照有效期。
 * 超管在运维后台改完开关，已经打开小程序的家人不会立刻知道（服务端没法主动推），
 * 最多这么久之后重新问一次；与功能开关保持一致，取 5 分钟。
 */
const SNAPSHOT_TTL = 5 * 60 * 1000

/** 生效中的广告位配置；页面不要直接读，用下面的取值函数 */
export const adState = ref({ enabled: false, bannerUnitId: '' })

let snapshotAt = 0
/** 复用同一次进行中的请求：多处同时 ensure 只发一次 */
let pending = null

/** 这个后端有没有广告位这套东西（Supabase 侧恒为 false） */
export function adsAvailable() {
  return Boolean(capabilities.ads && api.ads && api.ads.status)
}

/**
 * Banner 广告位 id。
 *
 * **只有「开关打开」且「id 非空」才有值** —— 组件据此决定渲不渲染，
 * 所以拿不到值就等于「这一屏没有广告位」，页面上一点痕迹都不留。
 */
export function bannerUnitId() {
  const state = adState.value
  if (!state.enabled) return ''
  return state.bannerUnitId || ''
}

/** 拉一次广告位配置；命中缓存就直接返回，不会每次都发请求 */
export async function ensureAds({ force = false } = {}) {
  if (!adsAvailable()) return adState.value
  if (!force && snapshotAt && Date.now() - snapshotAt < SNAPSHOT_TTL) return adState.value
  if (pending) return pending

  pending = api.ads
    .status()
    .then((result) => {
      adState.value = {
        enabled: Boolean(result && result.enabled),
        bannerUnitId: (result && result.bannerUnitId) || '',
      }
      snapshotAt = Date.now()
      return adState.value
    })
    .catch((err) => {
      // 失败不写 snapshotAt，也不改现状（默认是关）—— 下次进页面会再试一次。
      // 广告拉不到是小事，不值得为它做一套降级状态。
      console.error('[Ads] 读取广告位配置失败，本次按关闭处理', err)
      return adState.value
    })
    .finally(() => {
      pending = null
    })

  return pending
}
