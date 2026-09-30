/**
 * 会员权益（业务层）。
 *
 * 职责只有一件：维护一份**本机权益快照**（响应式），页面据此渲染。
 *
 * ⚠️ 快照不是裁决者：AI 额度、明细上下文天数最终都由云函数按真实权益算
 * （见 cloudfunctions/data/index.js 的 MEMBERSHIP_PLANS / resolveTier）。
 * 所以快照过期或加载失败，最坏结果只是界面上的数字不准，
 * 不会让谁多拿到东西 —— 也因此这里可以放心地「加载失败按会员档渲染」。
 *
 * 会员制是否**上线**由服务端下发（data 云函数的 MEMBERSHIP_ENABLED）：
 * 关着的时候 tier 恒为 member、enabled 为 false，前端就不会出现任何会员入口。
 */
import { ref } from 'vue'
import { api, capabilities } from './api'

/** 拿不到服务端结果时的保底：按会员档（宁可多给，也别在加载失败时把家人挡在外面） */
const FALLBACK = { tier: 'member', until: null, plans: {}, familyId: '', superAdmin: false, at: 0 }

/**
 * 快照有效期。
 *
 * 开关是服务端管的，而快照会缓存到本机 —— 不设过期的话，把开关关掉之后
 * 已经打开过小程序的用户会一直看到会员入口，直到彻底重启小程序。
 * 这里给一个短有效期：最多这么多时间之后重新问一次服务端。
 */
const SNAPSHOT_TTL = 5 * 60 * 1000

/** 权益快照；页面直接读它 */
export const membershipState = ref({ loaded: false, enabled: false, ...FALLBACK })

/** 复用同一次进行中的请求：多处同时 ensure 只发一次 */
let pending = null

/** 这个后端有没有会员这套东西（Supabase 侧恒为 false） */
export function membershipAvailable() {
  return Boolean(capabilities.membership && api.membership && api.membership.status)
}

/** 当前是不是会员；会员制没上线时恒为 true（全功能） */
export function isMember() {
  return membershipState.value.tier === 'member'
}

/**
 * 当前账号是不是**超级管理员**（唯一能进运维后台的人）。
 *
 * 只用于 UX：决定「我的」页要不要显示运维入口、运维页要不要渲染。
 * 真门在服务端：每个 admin action 第一句都是 assertSuperAdmin，
 * 前端就算把入口画出来、把手搓的请求发出去，也只会拿到 403。
 *
 * 权限只有两层 —— 超级管理员（跨家庭）与家庭创建者（只管自己那个家，
 * 走 role='owner' 那套 assertOwner），没有「全局管理员」这一层。
 */
export function isSuperAdmin() {
  return membershipState.value.superAdmin === true
}

/** AI 明细层天数（免费 7 天 / 会员 30 天），由服务端下发的 plans 决定 */
export function contextDays() {
  const plans = membershipState.value.plans || {}
  const plan = plans[membershipState.value.tier] || plans.member
  return (plan && plan.contextDays) || 7
}

/** 今日 AI 问答上限（只用于文案展示；真正的拦截在云函数） */
export function chatPerDay(tier) {
  const plans = membershipState.value.plans || {}
  const plan = plans[tier || membershipState.value.tier] || plans.member
  return (plan && plan.chatPerDay) || 0
}

/** 到期时间文案，例：'2027-01-01 到期'；永久会员返回 '长期有效' */
export function untilText() {
  const value = membershipState.value.until
  if (!value) return '长期有效'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '长期有效'
  const pad = (item) => String(item).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} 到期`
}

/**
 * 拉一次权益。命中缓存就直接返回，不会每次都发请求。
 *
 * @param {object} [params] { familyId, force }
 *        force=true 用于「兑换成功后」「进会员页时」强制刷新；
 *        换了家庭（familyId 变了）也会自动重拉，避免拿上一个家庭的档位。
 */
export async function ensureMembership({ familyId, force = false } = {}) {
  if (!membershipAvailable()) return membershipState.value
  const wanted = familyId || ''
  const snapshot = membershipState.value
  const fresh = snapshot.loaded && snapshot.familyId === wanted && Date.now() - snapshot.at < SNAPSHOT_TTL
  if (!force && fresh) return snapshot
  if (pending) return pending

  pending = api.membership
    .status(wanted)
    .then((result) => {
      membershipState.value = {
        loaded: true,
        enabled: Boolean(result.enabled),
        tier: result.tier === 'free' ? 'free' : 'member',
        until: result.until || null,
        plans: result.plans || {},
        familyId: wanted,
        // 是不是超级管理员（服务端判定：写死在代码里的那个 openid）。
        // 云函数没更新时没有这个字段，Boolean(undefined) = false ——
        // 宁可不显示运维入口，也不要让普通家长看到。
        superAdmin: Boolean(result.superAdmin),
        at: Date.now(),
      }
      return membershipState.value
    })
    .catch((err) => {
      // 标成 loaded 是为了不在每次 AI 调用时都白跑一趟；失败就按会员档渲染。
      // 想重试的页面（会员页）用 force: true 再问一次。
      console.error('[Membership] 读取权益失败，本次按会员档渲染', err)
      // 已经确认过是超级管理员的，失败时保留这个结论：网络抖一下就让运维入口
      // 消失太难受了 —— 权限的真门在服务端，这里多显示一个入口不会放开任何东西。
      membershipState.value = {
        loaded: true,
        enabled: false,
        ...FALLBACK,
        superAdmin: membershipState.value.superAdmin === true,
      }
      return membershipState.value
    })
    .finally(() => {
      pending = null
    })

  return pending
}

/** 退出登录 / 换账号时清空快照，避免上一个账号的会员状态残留 */
export function clearMembership() {
  membershipState.value = { loaded: false, enabled: false, ...FALLBACK }
}

/**
 * 用开通码开通或续期（仅家庭创建者）。
 * 成功后立刻强制刷新快照，页面不用自己再拉一次。
 */
export async function redeemMembership({ familyId, code }) {
  if (!membershipAvailable()) {
    throw new api.ApiError('会员功能仅在微信小程序端（云开发后端）提供', 0, 'NOT_SUPPORTED')
  }
  const result = await api.membership.redeem(familyId, code)
  await ensureMembership({ familyId, force: true })
  return result
}
