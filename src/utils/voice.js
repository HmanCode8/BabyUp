/**
 * 语音转文字（微信官方插件「微信同声传译」，WechatSI）。
 *
 * 为什么用插件而不是自己接 ASR：小程序端没有免费的录音转文字能力，自建要么花钱
 * 要么得配服务器。同声传译是微信自研插件，免费、个人主体可用，语音输入配额
 * 250 条/分钟、3 万条/天（家人自用连零头都用不到），实时流式返回结果，单次上限 60 秒。
 *
 * ⚠️ 两个前提，缺一个都用不了（缺了这里会返回 unsupported，页面自动隐藏麦克风）：
 *   1. 微信公众平台 → 设置 → 第三方服务 → 插件管理 → 添加「同声传译」；
 *   2. manifest.json 的 mp-weixin.plugins 声明 WechatSI，version 与后台一致。
 *
 * ⚠️ 只在微信小程序端可用：H5 / App 端统一返回 false，页面显示「用键盘上的麦克风」兜底提示。
 *
 * ⚠️ 插件把识别结果交给我们，我们只把它当「输入的文字」用 —— 语音不直接写库，
 *    仍然要经过 AI 解析和用户确认（见 pages/ai-quick-record）。
 */

/** 单次录音上限（ms）。插件本身最大 60000，够说一句话了 */
const VOICE_MAX_DURATION = 60000

/** 识别语言（插件支持 zh_CN / en_US / zh_HK / sichuanhua） */
const VOICE_LANG = 'zh_CN'

// #ifdef MP-WEIXIN
/**
 * 插件管理器是「全局唯一」的，所以缓存一份；回调是赋值式（manager.onStop = fn），
 * 每次开始前都要重新挂一遍，否则会残留上一轮的回调。
 */
let manager = null
let managerBroken = false

function getManager() {
  if (manager || managerBroken) return manager
  try {
    manager = requirePlugin('WechatSI').getRecordRecognitionManager()
  } catch (err) {
    // 后台没加插件、或 manifest 里的 version 与后台不一致时会走到这里
    console.error('[Voice] 同声传译插件不可用（先在后台添加插件、并核对版本号）', err)
    managerBroken = true
    manager = null
  }
  return manager
}
// #endif

/** 当前环境是否支持语音输入；不支持时页面隐藏麦克风按钮 */
export function isVoiceSupported() {
  // #ifdef MP-WEIXIN
  return Boolean(getManager())
  // #endif
  // #ifndef MP-WEIXIN
  return false
  // #endif
}

/**
 * 开始识别（按住说话时调用）。
 *
 * @param {object} handlers
 * @param {Function} [handlers.onStart] 录音真正开始
 * @param {Function} [handlers.onPartial] 实时中间结果，用来边说边出字
 * @param {Function} [handlers.onResult] 最终结果（松手后回调），参数为去掉首尾空格的文本
 * @param {Function} [handlers.onError] 出错，参数是插件返回的错误对象
 * @returns {boolean} 是否成功启动
 */
export function startVoiceRecognize(handlers = {}) {
  // #ifdef MP-WEIXIN
  const instance = getManager()
  if (!instance) return false

  instance.onStart = () => {
    if (handlers.onStart) handlers.onStart()
  }
  instance.onRecognize = (res) => {
    if (handlers.onPartial) handlers.onPartial(String((res && res.result) || ''))
  }
  instance.onStop = (res) => {
    if (handlers.onResult) handlers.onResult(String((res && res.result) || '').trim())
  }
  instance.onError = (res) => {
    console.error('[Voice] 识别出错', res)
    if (handlers.onError) handlers.onError(res)
  }

  try {
    instance.start({ duration: VOICE_MAX_DURATION, lang: VOICE_LANG })
    return true
  } catch (err) {
    console.error('[Voice] 启动识别失败', err)
    if (handlers.onError) handlers.onError(err)
    return false
  }
  // #endif
  // #ifndef MP-WEIXIN
  if (handlers.onError) handlers.onError(new Error('当前环境不支持语音输入'))
  return false
  // #endif
}

/** 结束识别（松手时调用）。识别结果在 onResult 回调里返回 */
export function stopVoiceRecognize() {
  // #ifdef MP-WEIXIN
  const instance = getManager()
  if (!instance) return
  try {
    instance.stop()
  } catch (err) {
    // 没在识别中时调用 stop 会报 -30012，属于正常时序问题，不当错误刷日志
    console.warn('[Voice] 结束识别失败', err)
  }
  // #endif
}
