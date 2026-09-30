<template>
  <!-- 整屏可点：不想等的人随手一点就跳过 -->
  <view class="splash" :class="{ 'splash--out': leaving }" @click="finish">
    <view class="body">
      <!-- 光圈套在 logo 外面，这样圆心天然跟 logo 重合 -->
      <view class="logo-wrap">
        <view class="ring ring--a" />
        <view class="ring ring--b" />
        <view class="logo">
          <text class="logo-text">{{ APP_LOGO_TEXT }}</text>
        </view>
      </view>
      <text class="brand">{{ APP_NAME }}</text>
      <text class="slogan">记录宝宝的每一个第一次</text>
    </view>

    <view class="dots">
      <view class="dot dot--a" />
      <view class="dot dot--b" />
      <view class="dot dot--c" />
    </view>

    <text class="skip">跳过</text>
  </view>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { APP_LOGO_TEXT, APP_NAME } from '@/config'

/**
 * 启动动画：logo 缩放淡入 + 光圈扩散，放完自动淡出。
 *
 * 挂在记录页（pages.json 的第一项 = 启动页）最上层，由页面决定什么时候放、放几次。
 * 只在冷启动第一次进记录页时出现，切 tab 回来不会重放（判断在页面里）。
 */
const emit = defineEmits(['done'])

/** 出现多久后自动收尾（不含淡出那段时间） */
const HOLD_MS = 1400
/** 淡出过渡时长，必须与下面 .splash 的 transition 一致 */
const FADE_MS = 400

const leaving = ref(false)
let holdTimer = null
let doneTimer = null

/** 收尾：先淡出，过渡结束再通知页面卸载本组件 */
function finish() {
  // 点跳过和定时器可能撞在一起，只认第一次
  if (leaving.value) return
  leaving.value = true
  doneTimer = setTimeout(() => emit('done'), FADE_MS)
}

onMounted(() => {
  holdTimer = setTimeout(finish, HOLD_MS)

  /*
   * 原生导航栏盖不住，只能临时把它抹平：标题清空、底色换成与顶部同色，
   * 这样动画看起来才是整屏的（否则顶上是白条 + 一行「书遥贝贝」，跟大 logo 打架）。
   * 只在小程序端做 —— H5 那边 setNavigationBarTitle 改的是浏览器标签页标题。
   */
  // #ifdef MP-WEIXIN
  uni.setNavigationBarTitle({ title: '' })
  uni.setNavigationBarColor({ frontColor: '#000000', backgroundColor: '#fff4ef' })
  // #endif
})

onBeforeUnmount(() => {
  clearTimeout(holdTimer)
  clearTimeout(doneTimer)
  // #ifdef MP-WEIXIN
  uni.setNavigationBarTitle({ title: APP_NAME })
  uni.setNavigationBarColor({ frontColor: '#000000', backgroundColor: '#ffffff' })
  // #endif
})
</script>

<style scoped>
/*
 * 层级约定（见 components/AppTabBar）：页面内浮层 ≤20、底栏 50、弹层 ≥100。
 * 启动动画要盖住一切（含底栏），所以取 200。
 */
.splash {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-image: linear-gradient(160deg, #fff4ef 0%, #ffe9e1 45%, #ffd9cb 100%);
  opacity: 1;
  transition: opacity 400ms ease;
}

.splash--out {
  opacity: 0;
}

/* 光圈圆心与 logo 重合，所以按整屏正中定位再靠负 margin 居中 */
.ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 168rpx;
  height: 168rpx;
  margin-top: -84rpx;
  margin-left: -84rpx;
  background-color: rgba(255, 143, 107, 0.18);
  border-radius: 50%;
  opacity: 0;
}

.ring--a {
  animation: ring 2000ms ease-out infinite;
}

.ring--b {
  animation: ring 2000ms ease-out 700ms infinite;
}

@keyframes ring {
  0% {
    opacity: 0.55;
    transform: scale(0.6);
  }
  100% {
    opacity: 0;
    transform: scale(2.2);
  }
}

/* 抬到光圈之上 */
.body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.logo-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 168rpx;
  height: 168rpx;
}

.logo {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 168rpx;
  height: 168rpx;
  background-color: var(--color-primary, #ff8f6b);
  border-radius: 52rpx;
  box-shadow: 0 20rpx 44rpx rgba(255, 143, 107, 0.38);
  /* cubic-bezier 的过冲让 logo 「弹」出来，不是干巴巴地放大 */
  animation: logo-in 720ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.logo-text {
  font-size: 76rpx;
  font-weight: 600;
  color: #ffffff;
}

@keyframes logo-in {
  0% {
    opacity: 0;
    transform: scale(0.5);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

.brand {
  margin-top: var(--space-lg, 32rpx);
  font-size: 48rpx;
  font-weight: 600;
  color: var(--color-text-main, #1f2329);
  letter-spacing: 4rpx;
  animation: fade-up 600ms ease 280ms both;
}

.slogan {
  margin-top: var(--space-xs, 8rpx);
  font-size: 26rpx;
  color: var(--color-text-sub, #5c6370);
  animation: fade-up 600ms ease 440ms both;
}

@keyframes fade-up {
  0% {
    opacity: 0;
    transform: translateY(18rpx);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

.dots {
  position: absolute;
  bottom: 200rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
}

.dot {
  width: 12rpx;
  height: 12rpx;
  margin: 0 8rpx;
  background-color: var(--color-primary, #ff8f6b);
  border-radius: 50%;
  animation: dot 1000ms ease-in-out infinite;
}

.dot--b {
  animation-delay: 160ms;
}

.dot--c {
  animation-delay: 320ms;
}

@keyframes dot {
  0%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-12rpx);
  }
}

.skip {
  position: absolute;
  top: 32rpx;
  right: 40rpx;
  padding: 12rpx 28rpx;
  font-size: 26rpx;
  color: var(--color-text-muted, #8a9099);
  background-color: rgba(255, 255, 255, 0.75);
  border-radius: 999rpx;
}
</style>
