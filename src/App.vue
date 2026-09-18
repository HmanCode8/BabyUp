<script setup>
import { onError, onLaunch, onShow } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { decideRedirect, installRouteGuard, redirectTo } from '@/utils/routeGuard'
import { forgetInviteCode, readInviteFromLaunch, rememberInviteCode } from '@/utils/share'
import { trackError } from '@/utils/tracker'

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

onLaunch(async (options) => {
  const store = useAuthStore()
  installRouteGuard(store)

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

onShow(() => {
  console.log('[App] onShow')
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
