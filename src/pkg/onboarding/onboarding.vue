<template>
  <view class="page">
    <OnboardingGuide @done="onDone" />
  </view>
</template>

<script setup>
import { onShow } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { ensurePageAccess } from '@/utils/routeGuard'
import OnboardingGuide from '@/components/OnboardingGuide/index.vue'

/**
 * 新手引导页（从「我的 → 新手引导」进来）。
 *
 * 为什么做成独立页而不是「我的」页上的浮层：
 * 引导是整屏内容，做成浮层要跟底栏比 z-index，还要在页内切换显隐，
 * 一旦哪里不对就会变成「点了没反应」，很难判断。独立页一进去就是一次页面跳转，
 * 成没成一眼就知道。
 *
 * 首次使用时的引导不走这里：那条在记录页放启动动画后紧接着弹，更连贯。
 */
const PAGE_PATH = 'pkg/onboarding/onboarding'

const store = useAuthStore()

onShow(() => {
  ensurePageAccess(PAGE_PATH)
  // 直接输错路径进来时上下文可能还没加载（正常从「我的」进来是加载好的）
  if (!store.initialized) store.bootstrap()
})

/** 看完（或点跳过）原路返回；理论上退不回去时才兜底回记录页 */
function onDone() {
  uni.navigateBack({
    fail: () => uni.switchTab({ url: '/pages/record/record' }),
  })
}
</script>

<style scoped>
.page {
  height: 100%;
}
</style>
