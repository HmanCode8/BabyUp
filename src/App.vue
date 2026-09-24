<script setup>
import { onError, onLaunch, onShow } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { initCloud } from '@/services/cloud/init'
import { decideRedirect, installRouteGuard, redirectTo } from '@/utils/routeGuard'
import { forgetInviteCode, readInviteFromLaunch, rememberInviteCode } from '@/utils/share'
import { trackError } from '@/utils/tracker'
import { loadSubscribeStatus } from '@/utils/subscribe'

/**
 * 启动时实际打开的页面。
 * mp-weixin 与 H5 的 onLaunch 都会给出 path（如 `pages/join-family/join-family`）；
 * 拿不到时按应用首页处理，与旧逻辑一致。
 */
function launchPageOf(options) {
  const path = String((options && options.path) || '')
    .split('?')[0]
    .replace(/^\//, '')
  return path || 'pages/index/index'
}

/**
 * 收起原生（框架自带的那条）tabBar。
 *
 * 底部导航已经换成自定义的 components/AppTabBar（带凹槽和凸起的 AI 按钮），
 * 原来那条留着会和新底栏叠在一起。它的显隐是全局的，所以只在启动时调一次 ——
 * 放到每个 tab 页的 onShow 里会每次切换都闪一下。
 * H5 上也一起隐藏：那边框架同样会渲染一条，不隐藏就是两条底栏。
 */
function hideNativeTabBar() {
  uni.hideTabBar({
    animation: false,
    fail: (err) => console.error('[App] 隐藏原生 tabBar 失败', err),
  })
}

onLaunch(async (options) => {
  // 微信云开发初始化（内部按平台条件编译，H5 上是空操作）
  initCloud()

  hideNativeTabBar()

  const store = useAuthStore()
  installRouteGuard(store)

  // 预热订阅状态缓存：判断「要不要静默攒提醒额度」得在用户点击手势里同步完成，
  // 那时来不及 await 查询（详见 utils/subscribe.js）。查失败不影响启动，只记日志。
  loadSubscribeStatus().catch((err) => console.error('[App] 预热订阅状态失败', err))

  // 补丁 Step 4：先读出启动链接里的邀请码（不能直接暂存，是否暂存要看下面的判定）
  const invited = readInviteFromLaunch(options)

  await store.bootstrap()

  // 按「启动时打开的那个页面」判断要不要改道，而不是一律送回首页：
  // 否则已登录但还没有家庭的用户点开邀请卡片时会被弹去「开始使用」页，
  // 邀请链接携带的邀请码就白带了（引导页在路由守卫里是豁免改道的）。
  const target = decideRedirect(store, launchPageOf(options))

  if (invited) {
    if (target === '/pages/login/login') {
      // 未登录用户点开邀请卡片：接收页来不及解析就被送去登录页，
      // 这里先记下邀请码，登录成功后由登录页把用户带回「加入家庭」。
      rememberInviteCode(invited)
      console.log('[App] 未登录，已暂存分享带来的邀请码')
    } else {
      // 已登录用户能直接到达接收页（由该页 onLoad 解析），
      // 暂存只会残留到下次登录时误跳转，清掉。
      forgetInviteCode()
    }
  }

  redirectTo(target)
})

/**
 * 首次 onShow 与 onLaunch 里的 bootstrap 是同一时刻，跳过避免重复请求；
 * 之后每次回到前台按需重拉一次「家庭 + 我的角色」（store 内有冷却时间，不会每次回前台都发请求）：
 * 家人在别处改了角色、被移除或换了家庭后，不需要重启/重登小程序就能让 UI 跟上
 * （否则缓存里的旧角色会一直显示新增/编辑入口）。
 */
let shownOnce = false

onShow(() => {
  console.log('[App] onShow')
  const store = useAuthStore()
  if (!shownOnce) {
    shownOnce = true
    return
  }
  if (!store.initialized || !store.isLoggedIn) return
  store.refreshContextIfStale()
})

/**
 * 补丁 Step 7：应用级错误上报（文档 4.7 要求 App.onError 与页面 onError 统一上报）。
 * trackError 内部全程 try/catch，绝不会因为上报本身再抛错。
 */
onError((err) => {
  console.error('[App] onError', err)
  trackError('app_error', err)
})
</script>

<style>
page {
  /* 设计变量：温馨亲子风，暖橙主色 + 柔和中性灰 */
  --color-primary: #ff8f6b;
  --color-primary-soft: #ffe9e1;
  --color-primary-deep: #f4703f;
  --color-success: #12b76a;
  --color-warning: #f79009;
  --color-danger: #f04438;

  --color-text-main: #1f2329;
  --color-text-sub: #5c6370;
  --color-text-muted: #8a9099;

  --color-bg-page: #f6f7f9;
  --color-bg-card: #ffffff;
  --color-border: #eef0f3;

  --radius-sm: 12rpx;
  --radius-md: 20rpx;
  --radius-lg: 28rpx;
  --radius-pill: 999rpx;

  --space-xs: 8rpx;
  --space-sm: 16rpx;
  --space-md: 24rpx;
  --space-lg: 32rpx;
  --space-xl: 48rpx;

  /* 自定义底栏（components/AppTabBar）横条的高度。
     tab 页拿它算底部内边距；CSS 读不到 JS 常量，所以 utils/tabbar.js 里
     有一份同名的 TAB_BAR_HEIGHT，改高度时两处一起改 */
  --tabbar-height: 130rpx;

  --shadow-card: 0 4rpx 20rpx rgba(31, 35, 41, 0.06);

  background-color: var(--color-bg-page);
  color: var(--color-text-main);
  font-size: 28rpx;
  line-height: 1.5;
}

/* 通用卡片 */
.app-card {
  padding: var(--space-lg);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

/* 通用主按钮 */
.app-button {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  font-size: 32rpx;
  color: #ffffff;
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.app-button--ghost {
  color: var(--color-primary);
  background-color: var(--color-primary-soft);
}

.app-button--disabled {
  opacity: 0.5;
}
</style>
