/**
 * 小程序分享（补丁 Step 4，对应文档 3.3 / 流程 4）。
 *
 * 为什么不做「全局 mixin」：
 * 微信小程序没有全局默认分享——页面配置在编译期生成，onShareAppMessage
 * 必须由每个页面自己声明；用 mixin 合并的结果无法在真机验证，一旦失效会
 * 静默退化成微信默认卡片（标题变成小程序名、路径变成当前页），排查成本高。
 * 所以这里把「统一文案 + 统一路径」收敛成本模块，各页面只挂一行
 * onShareAppMessage(() => defaultShare())，需要定制时（家庭页带邀请码）再覆盖。
 *
 * 关于卡片图：未设置 imageUrl，微信会用当前页面截图作为卡片图。
 * 项目里没有品牌图素材；宝宝照片存在私有桶、需签名且链接会过期，不适合
 * 放进分享卡片（用户点开时可能已失效）。若要固定品牌图，把一张 5:4 的
 * 封面图放进 src/static/ 后在这里补 imageUrl 即可。
 */
import { trackShare } from './tracker'
import { APP_NAME } from '@/config'

/** 默认分享标题 */
export const SHARE_TITLE = `用${APP_NAME}记录宝宝每一天`

/** 默认分享落地页 */
export const HOME_PATH = '/pages/index/index'

/** 受邀加入的落地页 */
export const JOIN_PATH = '/pages/join-family/join-family'

/** 待使用的邀请码在本地的 key：未登录用户点开邀请卡片时先存下来，登录后再用 */
const PENDING_INVITE_KEY = 'babyup.pendingInviteCode'

/** 暂存邀请码的有效期：超过这个时间就不再自动跳转（用户可能只是随手点开看过） */
const PENDING_INVITE_TTL = 30 * 60 * 1000

/** 默认分享：任何页面都可以直接用它 */
export function defaultShare() {
  trackShare('default')
  return { title: SHARE_TITLE, path: HOME_PATH }
}

/**
 * 邀请分享：把邀请码带在 path 上，接收页解析后自动带出。
 * 没有可用邀请码时退化为普通分享（文档 9.6：解析失败回退手动输入）。
 */
export function inviteShare(code) {
  trackShare('invite')
  const value = String(code || '').trim().toUpperCase()
  if (!value) return { title: '邀请你一起记录宝宝的成长', path: JOIN_PATH }
  return {
    title: '邀请你一起记录宝宝的成长',
    path: `${JOIN_PATH}?code=${encodeURIComponent(value)}`,
  }
}

/** 规范化邀请码：只留大写字母数字，且最多 6 位 */
export function normalizeInviteCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
}

/** 记下从分享卡片带进来的邀请码（未登录时先存着，登录后再用） */
export function rememberInviteCode(code) {
  const value = normalizeInviteCode(code)
  if (value.length !== 6) return ''
  try {
    uni.setStorageSync(PENDING_INVITE_KEY, JSON.stringify({ code: value, at: Date.now() }))
  } catch (err) {
    console.error('[Share] 暂存邀请码失败', err)
  }
  return value
}

/** 取出并清掉待使用的邀请码（登录成功后调用，只消费一次；过期则忽略） */
export function takeInviteCode() {
  let raw = ''
  try {
    raw = uni.getStorageSync(PENDING_INVITE_KEY)
    uni.removeStorageSync(PENDING_INVITE_KEY)
  } catch (err) {
    console.error('[Share] 读取待用邀请码失败', err)
    return ''
  }
  if (!raw) return ''
  let parsed = raw
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (err) {
    console.warn('[Share] 待用邀请码格式异常，忽略', err)
    return ''
  }
  if (!parsed || !parsed.code) return ''
  if (Date.now() - Number(parsed.at || 0) > PENDING_INVITE_TTL) {
    console.log('[Share] 待用邀请码已过期，忽略')
    return ''
  }
  const value = normalizeInviteCode(parsed.code)
  return value.length === 6 ? value : ''
}

/** 清掉暂存的邀请码（不需要登录中转时调用，避免残留到下次登录误跳转） */
export function forgetInviteCode() {
  try {
    uni.removeStorageSync(PENDING_INVITE_KEY)
  } catch (err) {
    console.error('[Share] 清除暂存邀请码失败', err)
  }
}

/**
 * 只读地取出启动参数里的邀请码（不写存储）。
 *
 * 为什么需要它：未登录用户点开邀请卡片时，路由守卫会在接收页 onLoad 之前
 * 就把人送到登录页，接收页根本来不及解析，邀请码会丢；
 * 所以要在启动阶段先读出来。但**要不要暂存**得看后续判定
 * （已登录用户能直接到达接收页，暂存反而会残留），因此读写分开。
 *
 * @param {{ path?: string, query?: object }} options 启动参数
 * @returns {string} 6 位邀请码；没有或不合法时返回空串
 */
export function readInviteFromLaunch(options) {
  const path = String((options && options.path) || '')
  const query = (options && options.query) || {}
  const isJoinPage = path.includes('join-family')
  const raw = query.code || (isJoinPage ? query.invite_code : '')
  const value = normalizeInviteCode(raw)
  return value.length === 6 ? value : ''
}
