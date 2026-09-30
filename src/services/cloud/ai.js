/**
 * 微信云开发 AI 能力（AI 助手 · 小程序端直调模型）。
 *
 * 走基础库内置的 wx.cloud.extend.AI（要求基础库 >= 3.15.1），
 * 不需要额外 npm 包、不需要单独登录：复用 wx.cloud.init 已有的鉴权。
 *
 * ⚠️ createModel 的入参是「模型分组（GroupName）」而不是模型名，只有三种合法形态：
 *      'cloudbase'      云开发托管模型池（本项目用这个，官方主推）
 *      'hunyuan-exp'    旧的内置分组（仅当环境里确实存在时）
 *      'custom-<name>'  控制台自建的模型分组
 *    具体用哪个模型放在 data.model 字段里，别写进 createModel。
 *
 * 计费：不需要在控制台「开通」任何开关。小程序成长计划赠送的 AI 资源包会自动下发到环境
 *       （10 亿 token / 生图 10 万张，可在控制台「AI+ → 用量」看到），调用按 token 从资源包扣；
 *       只要是从小程序端或云开发服务端发起，就在免费额度覆盖范围内。
 */
import { ApiError } from '../supabase/http'
import { setQuota } from '../ai-quota'
import { callData } from './db'

/** 模型提供商（GroupName），不是模型名 */
const AI_PROVIDER = 'cloudbase'

/**
 * 默认模型；换模型只改这一行（下面这些都在成长计划额度覆盖范围内）：
 *   hy3              默认，当前在用
 *   deepseek-v4-flash / qwen3.5-flash / glm-5.2 / kimi-k2.6 / minimax-m3
 * 具体可用的清单以控制台「AI+ → 模型」为准。
 */
export const AI_DEFAULT_MODEL = 'hy3'

/**
 * 本机模型覆盖（A/B 对比用，不改代码也不用重新编译）。
 *
 * 在微信开发者工具的控制台里执行（模拟器上下文里可以直接调 wx）：
 *   wx.setStorageSync('ai.model', 'kimi-k2.6')   // 临时换成别的模型
 *   wx.removeStorageSync('ai.model')             // 回到默认
 * 对比完记得清掉，否则会一直用覆盖的模型。
 */
const AI_MODEL_STORAGE_KEY = 'ai.model'

/** 优先级：调用方指定 > 本机覆盖 > 默认 */
function resolveModel(model) {
  if (model) return model
  try {
    const override = uni.getStorageSync(AI_MODEL_STORAGE_KEY)
    if (override) {
      console.log('[Cloud] 使用本机覆盖的模型', override)
      return String(override)
    }
  } catch (err) {
    console.error('[Cloud] 读取模型覆盖失败', err)
  }
  return AI_DEFAULT_MODEL
}

/** 取模型实例：createModel 返回的是无状态对象，每次现取，避免拿到热更新后失效的旧实例 */
function createChatModel() {
  // #ifdef MP-WEIXIN
  if (typeof wx === 'undefined' || !wx.cloud) {
    throw new ApiError('当前环境不支持微信云开发', 0, 'CLOUD_UNAVAILABLE')
  }
  if (!wx.cloud.extend || !wx.cloud.extend.AI) {
    throw new ApiError('当前微信版本过低，请更新微信后重试', 0, 'AI_UNAVAILABLE')
  }
  return wx.cloud.extend.AI.createModel(AI_PROVIDER)
  // #endif

  // #ifndef MP-WEIXIN
  throw new ApiError('AI 助手仅在微信小程序端可用', 0, 'AI_UNAVAILABLE')
  // #endif
}

/** 把底层抛出的各种错误归一成 ApiError（错误提示直接沿用，便于排查额度/模型问题） */
function toApiError(err) {
  if (err instanceof ApiError) return err
  const message = (err && (err.errMsg || err.message)) || 'AI 服务暂时不可用，请稍后重试'
  return new ApiError(message, 0, 'AI_ERROR', err)
}

/**
 * 领一次今天的 AI 额度（服务端按「人 + 今天」记账，上限见 data 云函数的 AI_DAILY_LIMIT）。
 *
 * ⚠️ 这是**防滥用**，不是安全边界：模型调用本身是客户端直连的（wx.cloud.extend.AI），
 * 改客户端就能绕过这一层。真要拦死得把调用搬到云函数，代价是失去流式打字机效果。
 *
 * 失败策略：
 * - 超限（AI_QUOTA_EXCEEDED）→ 抛出，页面原样显示「今天的次数用完了」；
 * - 集合还没建 → 记一条显眼的错误日志后**放行**，免得刚上线就把 AI 整个卡住；
 * - 其他错误（网络抖动等）→ 记日志后放行，可用性优先。
 */
async function consumeQuota(familyId) {
  try {
    const result = await callData({ action: 'aiUsage', familyId: familyId || '' })
    console.log('[Cloud] AI 今日用量', `${result.used}/${result.limit}`, `档位 ${result.tier}`)
    // 服务端已经把最新用量给了，顺手更新共享快照，AI 页那一行不用再单独查一次
    setQuota(result)
  } catch (err) {
    if (err && err.code === 'AI_QUOTA_EXCEEDED') throw err
    // data 云函数还是旧版：它不认识 aiUsage 这个 action，会回 BAD_REQUEST
    if (err && err.code === 'BAD_REQUEST') {
      console.error('[Cloud] data 云函数不认识 aiUsage，AI 额度不生效：请重新上传该云函数', err)
      return
    }
    const message = String((err && err.message) || '')
    if (/collection/i.test(message) && /not exist|不存在/i.test(message)) {
      console.error(
        '[Cloud] ai_usage 集合不存在，AI 额度不生效：请建集合，或重新部署并执行一次 init-db 云函数',
        err,
      )
      return
    }
    console.error('[Cloud] 查询 AI 额度失败，本次放行', err)
  }
}

/**
 * 流式对话。
 *
 * @param {object} params
 * @param {Array<{role: string, content: string}>} params.messages 对话历史，首条通常是 system
 * @param {string} [params.model] 模型 id，缺省用 AI_DEFAULT_MODEL
 * @param {(delta: string) => void} [params.onDelta] 每段增量文本的回调（打字机效果用）
 * @param {string} [params.familyId] 当前家庭；额度按家庭的权益档位算（免费 5 次/天、会员 50 次/天）
 * @param {boolean} [params.counted] 是否占用当日问答额度，默认 true。
 *        每日小结、一句话记一笔解析传 false：免费档只有 5 次/天，
 *        让这两个也去吃那 5 次等于把免费用户直接劝退。
 * @returns {Promise<string>} 本次生成的完整文本
 */
export async function streamChat({ messages, model, onDelta, familyId, counted = true }) {
  // 额度闸门放在这里：问答走的就是本函数，一处拦住
  if (counted) await consumeQuota(familyId)

  const chatModel = createChatModel()

  let result
  try {
    result = await chatModel.streamText({
      data: { model: resolveModel(model), messages },
    })
  } catch (err) {
    console.error('[Cloud] AI 请求发起失败', err)
    throw toApiError(err)
  }

  let full = ''
  try {
    for await (const chunk of result.textStream) {
      full += chunk
      if (onDelta) onDelta(chunk)
    }
  } catch (err) {
    console.error('[Cloud] AI 流式返回中断', err)
    throw toApiError(err)
  }

  return full
}

/**
 * 只读查一次今日额度（服务端 peek，不扣次数）。
 * AI 页顶部靠它显示「今天还能问几次」；集合没建或后端不支持时抛出，由调用方降级。
 *
 * ⚠️ 用独立的 aiQuota action，而不是给 aiUsage 传 peek：
 * 云函数还没更新时，旧版会把 aiUsage 当成一次真实扣费（打开一次页面白扣一次），
 * 而 aiQuota 在旧版只会回「不支持的 action」，前端静默降级即可。
 */
export async function quota(familyId) {
  const result = await callData({ action: 'aiQuota', familyId: familyId || '' })
  setQuota(result)
  return result
}

/**
 * 提交一条回答反馈（👍 / 👎 + 可选原因）。
 * 失败不影响对话本身，调用方只记日志并允许重试。
 */
export async function feedback({ familyId, babyId, rating, reason, question, answer, basis }) {
  return callData({
    action: 'aiFeedback',
    familyId: familyId || '',
    babyId: babyId || '',
    rating,
    reason: reason || '',
    question: question || '',
    answer: answer || '',
    basis: basis || '',
  })
}

export const ai = { streamChat, quota, feedback, defaultModel: AI_DEFAULT_MODEL }

export default ai
