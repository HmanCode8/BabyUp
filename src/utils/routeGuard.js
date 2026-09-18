/**
 * 全局路由守卫（对应需求文档 Step 2）。
 *
 * 页面分五类：
 *  - 公开页（login / forgot-password）：仅未登录可停留；已登录访问会被送回正确的入口
 *  - 免登录页（privacy / terms）：未登录（从登录页进入）与已登录都能查看
 *  - 引导页（setup / join-family）：需登录即可，不再要求「还没有家庭」
 *    （二期加强后一个用户可属于多个家庭，「创建新家庭 / 加入已有家庭」
 *      是已有用户的正常入口，若仍一律改道回首页，这两个入口就点不动了）
 *  - 受保护页（其余全部）：需登录 + 已有家庭（一个家庭都没有时送去引导页）
 */
import { useAuthStore } from '@/stores/auth'

/** 仅未登录可停留 */
export const PUBLIC_PAGES = ['pages/login/login', 'pages/forgot-password/forgot-password']

/** 免登录即可查看（合规文档在登录前就要能读到） */
export const OPEN_PAGES = ['pages/privacy/privacy', 'pages/terms/terms']

/**
 * 引导页：只要登录就能停留。
 *
 * 必须豁免，否则会「自我改道」：
 * 还没建家庭的用户被送到 /pages/setup/setup 后，若这里对同一路径仍返回
 * /pages/setup/setup，导航拦截器会误判为「需要改道」而把这次导航取消，
 * 结果是注册/登录成功后卡在登录页、进不去引导页（join-family 同理，
 * 会让 setup 页的「加入已有家庭」点不动）。
 */
export const GUIDE_PAGES = ['pages/setup/setup', 'pages/join-family/join-family']

/** 应用声明首页（pages.json 中 pages 的第一项） */
const ENTRY_PAGE = 'pages/index/index'

function normalize(path) {
  return String(path || '')
    .split('?')[0]
    .replace(/^\//, '')
}

/** 已登录用户应该落在哪个入口页；返回空串表示就停在首页 */
export function resolveEntryPath(store) {
  if (!store.isLoggedIn) return '/pages/login/login'
  if (!store.hasFamily) return '/pages/setup/setup'
  return ''
}

/**
 * 判断访问 path 是否需要改道。
 * @returns {string} 空串=放行；否则为应跳转到的目标路径
 */
export function decideRedirect(store, path) {
  const target = normalize(path)

  if (PUBLIC_PAGES.includes(target)) {
    return store.isLoggedIn ? resolveEntryPath(store) : ''
  }
  if (OPEN_PAGES.includes(target)) return ''
  if (!store.isLoggedIn) return '/pages/login/login'
  // 引导页登录后就能停留：不豁免会变成「自我改道」，导航会被拦截器取消
  if (GUIDE_PAGES.includes(target)) return ''
  // 受保护页：一个家庭都没有时先去引导页把家建起来/加进去
  return store.hasFamily ? '' : '/pages/setup/setup'
}

let redirectInFlight = false

/** 统一的改道入口：同一时刻只发一次 reLaunch，避免重复导航 */
export function redirectTo(path) {
  if (!path || redirectInFlight) return
  redirectInFlight = true
  console.log('[RouteGuard] 改道 ->', path)
  uni.reLaunch({
    url: path,
    complete: () => {
      redirectInFlight = false
    },
  })
  // 导航被路由拦截器取消时 complete 不一定触发，这里兜底解锁：
  // 否则一次被取消的导航会让之后所有改道都被静默丢弃（表现为页面再也跳不动）
  setTimeout(() => {
    redirectInFlight = false
  }, 1000)
}

/** 安装导航拦截器，防止登录态变化后仍能跳进无权访问的页面 */
export function installRouteGuard(store) {
  const interceptor = {
    invoke(args) {
      if (!store.initialized) return args
      const target = decideRedirect(store, args.url)
      if (!target) return args
      redirectTo(target)
      return false
    },
  }
  ;['navigateTo', 'redirectTo', 'switchTab', 'reLaunch'].forEach((name) => {
    uni.addInterceptor(name, interceptor)
  })
}

/** 页面 onShow 时校验访问权限（应对登录态在页面停留期间发生变化） */
export function ensurePageAccess(path) {
  const store = useAuthStore()
  if (!store.initialized) return
  redirectTo(decideRedirect(store, path || ENTRY_PAGE))
}
