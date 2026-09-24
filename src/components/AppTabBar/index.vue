<template>
  <view class="tabbar">
    <!-- 横条本身就是那道凹槽：SVG 背景，顶部中间挖圆谷，凸起按钮落在谷里 -->
    <view class="bar">
      <view v-for="slot in slots" :key="slot.key" class="slot">
        <!-- 中间那一列放 AI 按钮（它不是 tab，所以不走 switchTab） -->
        <view v-if="slot.type === 'ai'" class="ai" @click="openAi">
          <text class="ai-text">AI</text>
        </view>

        <view
          v-else
          class="tab"
          :class="{ 'tab--active': active === slot.index }"
          @click="switchTo(slot.index)"
        >
          <image
            class="tab-icon"
            :src="active === slot.index ? slot.activeIcon : slot.icon"
            mode="aspectFit"
          />
          <text class="tab-text" :class="{ 'tab-text--active': active === slot.index }">
            {{ slot.text }}
          </text>
        </view>
      </view>
    </view>

    <!-- 底部安全区：横条只画到 130rpx，剩下一段用纯白补上 -->
    <view class="safe" />
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { isAiChatAvailable } from '@/services/ai'
import { TAB_BAR_LIST, activeTabIndex } from '@/utils/tabbar'

/**
 * 五个等宽槽位：四个 tab 分列两侧，AI 按钮占最中间那一列。
 * 凹槽的圆心就画在 375rpx（= 屏幕正中），所以按钮正好落在谷里。
 */
const slots = computed(() => {
  const tabs = TAB_BAR_LIST.map((item, index) => ({ type: 'tab', index, ...item }))
  return [tabs[0], tabs[1], { type: 'ai', key: 'ai' }, tabs[2], tabs[3]]
})

const active = computed(() => activeTabIndex.value)

/** AI 只有云开发后端才有；没有就点了给个提示，别把人带到打不开的页面 */
const aiReady = isAiChatAvailable()

function switchTo(index) {
  if (index === activeTabIndex.value) return
  const previous = activeTabIndex.value
  // 先改高亮再跳转，手感更跟手；跳转失败（比如页面没注册）再退回去
  activeTabIndex.value = index
  uni.switchTab({
    url: TAB_BAR_LIST[index].pagePath,
    fail: (err) => {
      console.error('[TabBar] 切换失败', index, err)
      activeTabIndex.value = previous
    },
  })
}

function openAi() {
  if (!aiReady) {
    uni.showToast({ title: '当前版本不支持 AI 助手', icon: 'none' })
    return
  }
  uni.navigateTo({
    url: '/pages/ai-chat/ai-chat',
    fail: (err) => console.error('[TabBar] 打开 AI 助手失败', err),
  })
}
</script>

<style scoped>
/*
 * 为什么不用微信原生的自定义 tabBar（pages.json 里 custom: true）：
 * uni-app 不会把 custom-tab-bar 目录下的 vue 文件编译成小程序需要的
 * js/json/wxml/wxss，而是原样拷过去，结果是整条底栏直接不渲染（已实测）。
 * 所以这里保留原生 tabBar 配置、在 App.vue 启动时把它隐藏，
 * 再用这个组件接管底部 —— 组件是普通 Vue 组件，渲染是确定的。
 */
.tabbar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
}

/*
 * 凹槽是一段 SVG（750×130 的 rpx 坐标系）：白底横条，上边缘中间往下挖一道圆谷，
 * 谷底 44rpx、圆心在 y = -12rpx、半径 56rpx —— 正好比 92rpx 的按钮大 10rpx，
 * 按钮嵌进去四周留一圈白，不会漏出页面内容。
 * 因为 750rpx 恒等于屏幕宽度、高度也写成 rpx，两边缩放比例一致，圆谷不会被压扁。
 */
.bar {
  position: relative;
  display: flex;
  flex-direction: row;
  height: 130rpx;
  background-image: url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA3NTAgMTMwIiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIj48cGF0aCBkPSJNMCAyOCBRMCAwIDI4IDAgTDMyMC4zIDAgQTU2IDU2IDAgMCAwIDQyOS43IDAgTDcyMiAwIFE3NTAgMCA3NTAgMjggTDc1MCAxMzAgTDAgMTMwIFoiIGZpbGw9IiNmZmZmZmYiLz48L3N2Zz4=');
  background-repeat: no-repeat;
  background-position: top left;
  background-size: 100% 130rpx;
}

.slot {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}

/* 选中时往上弹一下并放大：cubic-bezier 的过冲让「弹」的手感出来 */
.tab-icon {
  width: 46rpx;
  height: 46rpx;
  transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.tab--active .tab-icon {
  transform: translateY(-4rpx) scale(1.12);
}

.tab-text {
  margin-top: 4rpx;
  font-size: 20rpx;
  color: #9aa0a6;
  transition: color 0.2s;
}

.tab-text--active {
  font-weight: 600;
  color: #ff8f6b;
}

/*
 * AI 按钮：圆心落在横条上边缘上方 12rpx（= 凹槽圆心），
 * 所以 top = -12 - 46。下半部分嵌在凹槽里，上半部分越过横条顶边凸出来。
 */
.ai {
  position: absolute;
  top: -58rpx;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 92rpx;
  height: 92rpx;
  margin-left: -46rpx;
  background-image: linear-gradient(135deg, #ffb199 0%, #ff8f6b 55%, #f4703f 100%);
  border-radius: 50%;
  box-shadow: 0 8rpx 22rpx rgba(244, 112, 63, 0.38);
  animation: ai-breathe 3.2s ease-in-out infinite;
}

.ai-text {
  font-size: 30rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  color: #ffffff;
}

@keyframes ai-breathe {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-4rpx);
  }
}

.safe {
  height: constant(safe-area-inset-bottom);
  height: env(safe-area-inset-bottom);
  background-color: #ffffff;
}
</style>
