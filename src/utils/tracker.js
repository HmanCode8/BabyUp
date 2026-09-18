/**
 * 轻量埋点与错误上报（补丁 Step 7，对应文档 2.1 第 11 项 / 4.7）。
 *
 * 三条硬约束（文档 1.2 / 10.6）：
 * 1. **绝不影响业务**：所有上报都是「发完就不管」，失败只打日志、不抛错、不阻塞；
 * 2. **app_logs 只写不可读**：表上没有 select 策略，所以必须用 db.insertSilent
 *    （不带 return=representation），否则 PostgREST 会因回读被 RLS 拒掉整条写入；
 * 3. **payload 不放敏感信息**：不记录照片 URL、备注正文、邮箱手机号等。
 *
 * 未登录时不上报：app_logs 的写策略是 `auth.uid() = user_id`，
 * 没有 session 时写不进去，硬发只会白跑一次请求。
 */
import { SELECTION_STORAGE_KEY } from '@/config'
import { supabase } from '@/services/supabase'

const TABLE = 'app_logs'
/** stack 只留前若干字符，避免把整份堆栈塞进 jsonb */
const MAX_STACK_LENGTH = 600
/** 「首次记录」标记的本地 key 前缀（按账号区分） */
const FIRST_RECORD_KEY_PREFIX = 'babyup.firstRecord.'

/** 当前家庭 id：直接读本地保存的选择，避免 utils 反向依赖 Pinia store */
function currentFamilyId() {
  try {
    const raw = uni.getStorageSync(SELECTION_STORAGE_KEY)
    const parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null
    return (parsed && parsed.familyId) || null
  } catch (err) {
    return null
  }
}

/** 当前登录用户 id（未登录返回空串） */
function currentUserId() {
  const session = supabase.session.get()
  return session && session.user ? session.user.id : ''
}

/**
 * 上报一条埋点。
 *
 * @param {'error'|'page_view'|'action'} eventType 事件类型（数据库有 check 约束）
 * @param {string} eventName 事件名，如 photo_upload_fail / report_generate
 * @param {object} [payload] 附加信息（禁止放敏感数据）
 */
export function track(eventType, eventName, payload) {
  try {
    const userId = currentUserId()
    if (!userId) {
      console.log('[Tracker] 未登录，跳过埋点', eventType, eventName)
      return
    }
    // 不 await：埋点是旁路，业务不等它；失败也只在内部吞掉
    supabase.db
      .insertSilent(TABLE, {
        user_id: userId,
        family_id: currentFamilyId(),
        event_type: eventType,
        event_name: eventName,
        payload: payload || null,
      })
      .catch((err) => {
        console.error('[Tracker] 埋点上报失败（不影响业务）', eventName, err && err.message)
      })
  } catch (err) {
    console.error('[Tracker] 埋点异常（不影响业务）', eventName, err)
  }
}

/**
 * 上报一个错误（全局错误捕获用）。
 * 只取 message 与前若干字符的 stack，不把整个 error 对象塞进 jsonb。
 */
export function trackError(eventName, error) {
  const message = error && error.message ? String(error.message) : String(error || '未知错误')
  const stack = error && error.stack ? String(error.stack).slice(0, MAX_STACK_LENGTH) : ''
  track('error', eventName || 'global_error', {
    msg: message.slice(0, 300),
    stack,
    page: currentPagePath(),
  })
}

/** 当前页面路径（仅用于排障，不含参数） */
function currentPagePath() {
  try {
    const pages = getCurrentPages ? getCurrentPages() : []
    const current = pages && pages.length ? pages[pages.length - 1] : null
    return current && current.route ? current.route : ''
  } catch (err) {
    return ''
  }
}

/**
 * 分享卡片生成时上报。
 *
 * 微信没有「用户是否真的发出去了」的回调，onShareAppMessage 被调用
 * 就是最接近的信号，因此以「卡片被生成」作为分享事件。
 *
 * @param {'default'|'invite'} kind 分享类型
 */
export function trackShare(kind) {
  track('action', 'share', { kind, page: currentPagePath() })
}

/**
 * 记录一条业务记录的产生（喂养/睡眠/便便/照片/生长/里程碑都走这里）。
 *
 * 除了每次都报 record_created，还会在**该账号第一次**产生记录时额外报一次
 * first_record —— 文档把「首次记录」列为关键事件，用它衡量新手是否真正用起来了。
 */
export function trackRecordCreated(recordType, extra) {
  const payload = { type: recordType, ...(extra || {}) }
  track('action', 'record_created', payload)

  try {
    const userId = currentUserId()
    if (!userId) return
    const key = `${FIRST_RECORD_KEY_PREFIX}${userId}`
    if (uni.getStorageSync(key)) return
    uni.setStorageSync(key, '1')
    track('action', 'first_record', payload)
  } catch (err) {
    console.error('[Tracker] 首次记录埋点失败（不影响业务）', err)
  }
}
