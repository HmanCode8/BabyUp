/**
 * 功能开关（业务层）。
 *
 * 和「会员权益」是同一套路子：维护一份**本机快照**，页面据此决定要不要渲染入口。
 * 开关的真源在服务端（cloudfunctions/data/index.js 的 FEATURE_FLAGS +
 * app_config 的全局值 + families.feature_flags 的家庭覆盖），这里只负责缓存。
 *
 * 两个不变式：
 * 1. **读不到就按「开」**。开关是用来关掉东西的，配置读不到时应该保持现状 ——
 *    不能因为一次请求失败或集合还没建，就把全家的功能藏起来。
 * 2. **前端藏入口只是 UX**。真正要拦住的东西（比如 AI 的额度）在服务端拦；
 *    这里漏判最多是「入口没藏住」，不是「权限被绕过」。
 */
import { ref } from 'vue'
import { api, capabilities } from './api'

/**
 * 快照有效期。
 *
 * 运维按下开关后，已经打开小程序的家人不会立刻知道 —— 服务端没法主动推。
 * 给一个短有效期，最多这么久之后重新问一次；配合「切页面时按需刷新」，
 * 实际生效时间基本等于用户下一次切页。
 */
const SNAPSHOT_TTL = 5 * 60 * 1000

/** 生效中的开关；页面直接读它。形状：{ aiChat: true, solidFood: true, ... } */
export const flagState = ref({})

/** 快照是哪个家庭的、什么时候拉的 */
let snapshotFamilyId = ''
let snapshotAt = 0
/** 复用同一次进行中的请求：多处同时 ensure 只发一次 */
let pending = null

/** 这个后端有没有功能开关这套东西（Supabase 侧恒为 false） */
export function flagsAvailable() {
  return Boolean(capabilities.flags && api.flags && api.flags.status)
}

/**
 * 某个功能开着没有。
 *
 * 没配过 / 还没拉到 / 后端不支持 —— 一律返回 true（见文件头的不变式 1）。
 */
export function flagEnabled(key) {
  const value = flagState.value[key]
  // 布尔才认；undefined（没配过）按开。
  // 刻意不用 `value !== false`：万一服务端手滑存了字符串 'false'，
  // 那样会当成「开」，这里显式判布尔更不容易出意外。
  return typeof value === 'boolean' ? value : true
}

/** 拉一次开关；命中缓存就直接返回，不会每次都发请求 */
export async function ensureFlags({ familyId, force = false } = {}) {
  if (!flagsAvailable()) return flagState.value
  const wanted = familyId || ''
  const fresh = snapshotFamilyId === wanted && Date.now() - snapshotAt < SNAPSHOT_TTL
  if (!force && fresh) return flagState.value
  if (pending) return pending

  pending = api.flags
    .status(wanted)
    .then((result) => {
      flagState.value = (result && result.flags) || {}
      snapshotFamilyId = wanted
      snapshotAt = Date.now()
      return flagState.value
    })
    .catch((err) => {
      // 失败打日志即可：flagEnabled 本来就按「开」兜底，不需要额外的降级状态
      console.error('[Flags] 读取功能开关失败，本次按默认（开）渲染', err)
      return flagState.value
    })
    .finally(() => {
      pending = null
    })

  return pending
}

/** 退出登录 / 换账号时清空快照，避免上一个账号/家庭的开关残留 */
export function clearFlags() {
  flagState.value = {}
  snapshotFamilyId = ''
  snapshotAt = 0
}
