<template>
  <view class="guide" :class="{ 'guide--out': leaving }">
    <text class="guide-skip" @click="finish">跳过</text>

    <swiper class="track" :current="current" :duration="320" @change="onChange">
      <swiper-item v-for="item in SLIDES" :key="item.key">
        <scroll-view class="slide" scroll-y>
          <view class="slide-inner">
            <view class="badge" :class="`badge--${item.key}`">
              <text class="badge-text">{{ item.badge }}</text>
            </view>

            <text class="slide-title">{{ item.title }}</text>
            <text class="slide-desc">{{ item.desc }}</text>

            <view class="points">
              <view
                v-for="(point, index) in item.points"
                :key="point"
                class="point"
                :class="{ 'point--sep': index > 0 }"
              >
                <view class="point-dot" :class="`point-dot--${item.key}`" />
                <text class="point-text">{{ point }}</text>
              </view>
            </view>
          </view>
        </scroll-view>
      </swiper-item>
    </swiper>

    <view class="foot">
      <view class="dots">
        <view
          v-for="(item, index) in SLIDES"
          :key="item.key"
          class="dot"
          :class="{ 'dot--on': index === current }"
        />
      </view>
      <view class="next" @click="onNext">
        <text class="next-text">{{ isLast ? '开始使用' : '下一步' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'

/**
 * 新手引导：六屏，讲清「这个小程序到底能干些啥」。
 *
 * 布局约定（这一版专门为此重写）：
 *   - 所有容器都用绝对定位给死边界（top/right/bottom/left），不靠 height:100% 撑 ——
 *     小程序里 swiper-item 的子元素用百分比高度经常量不出来，内容会挤成一条。
 *   - 凡是写了 padding 的元素一律带 box-sizing: border-box。
 *     漏了它，元素实际宽度会变成「父宽 + 左右 padding」，整块内容会往一边偏（就是之前那样）。
 *   - 内容放在 scroll-view 里：小屏手机上功能点排不下时能上下滑，不会把按钮压住。
 *
 * 由记录页（首次）与 pages/onboarding 控制显示时机，看完或跳过都算完。
 */
const emit = defineEmits(['done'])

/**
 * 六屏内容。顺序有意：记录 → AI → 时光 → 工具 → 提醒 → 家人，
 * 从「怎么记」讲到「记了能干嘛」，再讲「该做什么有人提醒」，最后讲协作。
 * points 每条控制在一行内（约 20 字），小屏幕上不至于挤成三行。
 */
const SLIDES = [
  {
    key: 'record',
    badge: '记录',
    title: '宝宝的一天，随手就记下',
    desc: '不用打字，点一下就记好；今日小结自动汇总，还能翻历史每天对比。',
    points: [
      '喂奶、睡觉、便便，一键记录',
      '照片、身高体重、疫苗、体检',
      '生病和里程碑也有专门入口',
      '一句话记一笔，说一句就填好',
    ],
  },
  {
    key: 'ai',
    badge: 'AI',
    title: 'AI 会读记录再回答',
    desc: '它看得到宝宝的喂养、睡眠、便便等记录，答案下面会标出读了哪些。',
    points: [
      '底部中间的 AI 按钮，随时问',
      '记录里没有的会直说，不编数字',
      'AI 观察：主动挑出值得留意的事',
      '每日小结：几句话总结今天',
    ],
  },
  {
    key: 'time',
    badge: '时光',
    title: '照片自动排成时间轴',
    desc: '拍下的照片和视频按月份排好，随手翻就是一本成长相册。',
    points: [
      '一次最多选 9 张，视频也能传',
      '按月分组看，或整屏瀑布流浏览',
      '点开看大图，随手分享给家人',
      '首页自动轮播最近的照片',
    ],
  },
  {
    key: 'tools',
    badge: '工具',
    title: '该做什么，工具帮你查',
    desc: '从辅食到疫苗，按宝宝月龄给参考，不用再到外面搜。',
    points: [
      '辅食资料库：按月龄找食谱与做法',
      '生长曲线：身高体重头围看趋势',
      '每日小结：每天一张卡，纵向对比',
      '成长报告：按月生成，可分享',
    ],
  },
  {
    key: 'remind',
    badge: '提醒',
    title: '该喂奶、该打疫苗，微信提醒你',
    desc: '不用自己盯着钟表，到点了微信给你发条消息；提醒要先在页面里点一次授权。',
    points: [
      '喂奶提醒：从上次喂奶算间隔，超时提醒',
      '间隔默认按宝宝月龄推荐，可自己调',
      '记录一次喂奶就重新计时，不会误报',
      '疫苗提醒：接种当天上午提醒，逾期标红',
    ],
  },
  {
    key: 'family',
    badge: '家人',
    title: '一家人一起记',
    desc: '邀请家人加入，谁记录、谁只能看，权限由你分配。',
    points: [
      '多人共同记录，标明是谁记的',
      '创建者可给家人设可编辑或只读',
      '支持多个宝宝、多个家庭',
      '记录存在云端，换手机不丢',
    ],
  },
]

/** 淡出过渡时长，必须与下面 .guide 的 transition 一致 */
const FADE_MS = 300

const leaving = ref(false)
const current = ref(0)
const isLast = computed(() => current.value === SLIDES.length - 1)

let doneTimer = null

function onChange(event) {
  current.value = event.detail.current
}

function onNext() {
  if (isLast.value) {
    finish()
    return
  }
  current.value += 1
}

/** 收尾：先淡出，过渡结束再通知页面卸载本组件 */
function finish() {
  if (leaving.value) return
  leaving.value = true
  doneTimer = setTimeout(() => emit('done'), FADE_MS)
}

onBeforeUnmount(() => {
  clearTimeout(doneTimer)
})
</script>

<style scoped>
/* 压在启动动画（200）之上：动画淡出后紧接着换它出场，别在中间闪回页面内容 */
.guide {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 210;
  background-image: linear-gradient(180deg, #fff7f3 0%, #ffffff 62%);
  opacity: 1;
  transition: opacity 300ms ease;
}

.guide--out {
  opacity: 0;
}

.guide-skip {
  position: absolute;
  top: 28rpx;
  right: 36rpx;
  z-index: 3;
  padding: 12rpx 28rpx;
  box-sizing: border-box;
  font-size: 26rpx;
  color: var(--color-text-sub, #5c6370);
  /* 底色是浅暖渐变，纯白胶囊几乎看不见，加一圈描边把它托出来 */
  background-color: rgba(255, 255, 255, 0.95);
  border: 1rpx solid var(--color-border, #eef0f3);
  border-radius: 999rpx;
}

/*
 * 滑动的轨道占满整屏。
 *
 * ⚠️ 必须显式写 height：swiper 自带 `height: 150px` 的默认样式，
 * 只要高度不是 auto，top+bottom 这对定位就会被它顶掉（CSS 规则如此），
 * 于是 swiper 只有 150px 高，里面的内容全被裁掉（实测过：正文一片空白）。
 * height: 100% 与 top/bottom 一起写是双保险：哪个生效都是整屏高。
 */
.track {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  height: 100%;
}

/*
 * 每屏的可滚区域：上边从 0 起，下边留 330rpx 给指示点与按钮。
 * 用绝对定位是为了拿到确定高度，scroll-view 没有确定高度就不会滚。
 */
.slide {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 330rpx;
  left: 0;
}

/* 内容不满一屏时靠中，超出时才从顶部开始滚 */
.slide-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 24rpx 56rpx 16rpx;
  box-sizing: border-box;
}

.badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  box-shadow: 0 16rpx 40rpx rgba(255, 143, 107, 0.26);
}

/* 六屏各一个色系：与站内对应模块的颜色呼应 */
.badge--record {
  background-image: linear-gradient(135deg, #ffb199 0%, #ff8f6b 100%);
}

.badge--ai {
  background-image: linear-gradient(135deg, #b9a6ff 0%, #7a5af8 100%);
  box-shadow: 0 16rpx 40rpx rgba(122, 90, 248, 0.26);
}

.badge--time {
  background-image: linear-gradient(135deg, #8fd3ff 0%, #4f9bf5 100%);
  box-shadow: 0 16rpx 40rpx rgba(79, 155, 245, 0.26);
}

.badge--tools {
  background-image: linear-gradient(135deg, #8ce0bb 0%, #12b76a 100%);
  box-shadow: 0 16rpx 40rpx rgba(18, 183, 106, 0.24);
}

/* 提醒用琥珀色：跟「记录」的橙、「工具」的绿都拉开了，一眼能认出来 */
.badge--remind {
  background-image: linear-gradient(135deg, #ffd28a 0%, #f79009 100%);
  box-shadow: 0 16rpx 40rpx rgba(247, 144, 9, 0.26);
}

.badge--family {
  background-image: linear-gradient(135deg, #ffb3c8 0%, #f5698f 100%);
  box-shadow: 0 16rpx 40rpx rgba(245, 105, 143, 0.26);
}

.badge-text {
  font-size: 36rpx;
  font-weight: 600;
  color: #ffffff;
  letter-spacing: 2rpx;
}

.slide-title {
  margin-top: 24rpx;
  font-size: 42rpx;
  font-weight: 600;
  line-height: 1.35;
  color: var(--color-text-main, #1f2329);
  text-align: center;
}

.slide-desc {
  margin-top: var(--space-sm, 16rpx);
  font-size: 26rpx;
  line-height: 1.65;
  color: var(--color-text-sub, #5c6370);
  text-align: center;
}

/* 功能清单：白卡片 + 彩色圆点，比一串纯文字好扫读 */
.points {
  width: 100%;
  margin-top: 24rpx;
  padding: 6rpx 32rpx;
  box-sizing: border-box;
  background-color: #ffffff;
  border-radius: var(--radius-lg, 28rpx);
  box-shadow: 0 8rpx 32rpx rgba(31, 35, 41, 0.07);
}

.point {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  padding: 15rpx 0;
}

/* 分隔线用类来加，避开 WXSS 里对兄弟选择器的支持差异 */
.point--sep {
  border-top: 1rpx solid var(--color-border, #eef0f3);
}

/* 圆点跟第一行文字对齐，多行时不会被拉到中间 */
.point-dot {
  flex-shrink: 0;
  width: 12rpx;
  height: 12rpx;
  margin-top: 13rpx;
  border-radius: 50%;
}

.point-dot--record {
  background-color: #ff8f6b;
}

.point-dot--ai {
  background-color: #7a5af8;
}

.point-dot--time {
  background-color: #4f9bf5;
}

.point-dot--tools {
  background-color: #12b76a;
}

.point-dot--remind {
  background-color: #f79009;
}

.point-dot--family {
  background-color: #f5698f;
}

.point-text {
  flex: 1;
  margin-left: 20rpx;
  font-size: 26rpx;
  line-height: 1.55;
  color: var(--color-text-main, #1f2329);
}

.foot {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 3;
  padding: 0 64rpx calc(56rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.dots {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  margin-bottom: 40rpx;
}

.dot {
  width: 14rpx;
  height: 14rpx;
  margin: 0 8rpx;
  background-color: #ffd9cb;
  border-radius: 50%;
  transition: width 240ms ease, background-color 240ms ease;
}

/* 当前那条拉长成小横条，比只变色更好认 */
.dot--on {
  width: 40rpx;
  background-color: var(--color-primary, #ff8f6b);
  border-radius: 999rpx;
}

.next {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  background-color: var(--color-primary, #ff8f6b);
  border-radius: 999rpx;
  box-shadow: 0 12rpx 28rpx rgba(255, 143, 107, 0.32);
}

.next-text {
  font-size: 32rpx;
  color: #ffffff;
}
</style>
