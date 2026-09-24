/**
 * 自定义 tabBar 的共享状态。
 *
 * 为什么用模块级 ref 而不是官方的 page.getTabBar().setData()：
 * uni-app 编译成小程序后拿不到稳定的 getTabBar 实例，页面和 tabBar 组件其实是
 * 两棵组件树。小程序里 JS 模块是全局缓存的，所以两边 import 到的是同一个 ref，
 * 页面在 onShow 里同步一次，tabBar 就能跟着高亮。
 */
import { ref } from 'vue'

/**
 * 四个 tab。顺序即显示顺序，图标沿用原来的 png。
 * 中间那个凸起的 AI 按钮不是 tab，所以这里只有四项。
 */
export const TAB_BAR_LIST = [
  {
    key: 'index',
    text: '时光',
    pagePath: '/pages/index/index',
    icon: '/static/tabbar/time.png',
    activeIcon: '/static/tabbar/time-active.png',
  },
  {
    key: 'record',
    text: '记录',
    pagePath: '/pages/record/record',
    icon: '/static/tabbar/record.png',
    activeIcon: '/static/tabbar/record-active.png',
  },
  {
    key: 'tools',
    text: '工具',
    pagePath: '/pages/tools/tools',
    icon: '/static/tabbar/tools.png',
    activeIcon: '/static/tabbar/tools-active.png',
  },
  {
    key: 'profile',
    text: '我的',
    pagePath: '/pages/profile/profile',
    icon: '/static/tabbar/mine.png',
    activeIcon: '/static/tabbar/mine-active.png',
  },
]

/** 当前选中的 tab 下标 */
export const activeTabIndex = ref(0)

/**
 * 底栏横条的高度（rpx）：横条本体，不含底部安全区。
 * App.vue 里的 --tabbar-height 是同一个数值（CSS 读不到 JS 常量），改高度时两处一起改。
 * 页面留底部内边距、悬浮按钮算可拖动范围都要用它。
 */
export const TAB_BAR_HEIGHT = 130

/** 路由路径 → tab 下标；不是 tab 页时返回 0 */
function indexOfRoute(route) {
  const normalized = `/${String(route || '')
    .split('?')[0]
    .replace(/^\//, '')}`
  const found = TAB_BAR_LIST.findIndex((item) => item.pagePath === normalized)
  return found >= 0 ? found : 0
}

/**
 * 每个 tab 页在 onShow 里调一次，把高亮同步到当前页。
 * 不写死下标而是按路由反查，这样以后调整 tab 顺序时不用改四个页面。
 */
export function syncActiveTabFromRoute() {
  try {
    const pages = getCurrentPages()
    const current = pages && pages.length ? pages[pages.length - 1] : null
    activeTabIndex.value = indexOfRoute(current && current.route)
  } catch (err) {
    // 取不到路由就保持原样：一次同步失败不值得把 tabBar 的状态弄乱
    console.error('[TabBar] 同步选中态失败', err)
  }
}
