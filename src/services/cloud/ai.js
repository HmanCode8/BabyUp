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

/** 模型提供商（GroupName），不是模型名 */
const AI_PROVIDER = 'cloudbase'

/** 默认模型；换模型只改这一行（hy3 在成长计划免费额度的覆盖范围内） */
export const AI_DEFAULT_MODEL = 'hy3'

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
 * 流式对话。
 *
 * @param {object} params
 * @param {Array<{role: string, content: string}>} params.messages 对话历史，首条通常是 system
 * @param {string} [params.model] 模型 id，缺省用 AI_DEFAULT_MODEL
 * @param {(delta: string) => void} [params.onDelta] 每段增量文本的回调（打字机效果用）
 * @returns {Promise<string>} 本次生成的完整文本
 */
export async function streamChat({ messages, model, onDelta }) {
  const chatModel = createChatModel()

  let result
  try {
    result = await chatModel.streamText({
      data: { model: model || AI_DEFAULT_MODEL, messages },
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

export const ai = { streamChat, defaultModel: AI_DEFAULT_MODEL }

export default ai
