/**
 * AI 今日问答额度的共享快照。
 *
 * 两个地方都会写它，所以单放一个模块（避免 services/ai.js 与 services/cloud/ai.js 互相 import）：
 *   - services/cloud/ai.js：每次扣额度时服务端已经把最新用量返回来了，顺手写进来，不额外发请求；
 *   - services/ai.js：AI 页进场时主动查一次（只读，不扣次数）。
 *
 * 只用于「显示」。真正的裁决在云端（data 云函数的 actionAiUsage），前端这里不参与判断。
 */
import { ref } from 'vue'

export const aiQuota = ref({
  /** 服务端查得到才有意义；集合还没建、后端不支持时保持 false，页面就不显示那一行 */
  known: false,
  used: 0,
  limit: 0,
  tier: '',
  /** 记下拿到这份数据的时刻，便于判断显示是不是隔天的旧值 */
  at: 0,
})

/** 写入一份服务端返回的用量（形状不符就忽略，宁可不说也不说错） */
export function setQuota(data) {
  if (!data || typeof data.limit !== 'number') return
  aiQuota.value = {
    known: true,
    used: Number(data.used) || 0,
    limit: Number(data.limit) || 0,
    tier: String(data.tier || ''),
    at: Date.now(),
  }
}

/** 退出登录 / 换账号时清掉，免得显示上一个人的用量 */
export function clearQuota() {
  aiQuota.value = { known: false, used: 0, limit: 0, tier: '', at: 0 }
}

/** 还剩几次 */
export function remainingQuota() {
  const { known, used, limit } = aiQuota.value
  if (!known || !limit) return 0
  return Math.max(limit - used, 0)
}
