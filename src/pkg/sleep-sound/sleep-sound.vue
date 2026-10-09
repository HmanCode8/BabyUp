<template>
  <view class="page">
    <!-- 环境不支持（H5 / App 端）时的兜底：不进这个页面就看不到，直接说清楚 -->
    <view v-if="!supported" class="notice">
      <text class="notice-title">安睡音暂时不可用</text>
      <text class="notice-text">这个功能只在微信小程序端提供（依赖微信的后台音频播放能力）。</text>
    </view>

    <template v-else>
      <!--
        头部：一屏「播放器」的样子 —— 图 + 名字 + 状态 + 剩余 + 控件都归在这一块。
        音源列表和设置收在圆环背后，默认不占地方。

        圆环本身就是「展开 / 收起」的开关：
        收起时它是一屏的主角（最大），展开后缩小让位给列表 —— 缩放带过渡，看着是「缩进去/长回来」。
      -->
      <view class="hero">
        <view class="stage" :class="{ 'stage--mini': more }" @click="toggleMore">
          <view class="aura" :class="{ 'aura--mini': more }">
            <view class="glow" :class="{ 'glow--on': playing }" />

            <!-- 涟漪：只在播放中出现，一圈圈向外荡开再淡掉，像声音落在水面上 -->
            <view v-if="playing" class="ripple ripple--1" />
            <view v-if="playing" class="ripple ripple--2" />
            <view v-if="playing" class="ripple ripple--3" />

            <view class="ring" :class="{ 'ring--on': playing }">
              <view class="core">
                <text class="glyph">{{ glyph }}</text>
              </view>
            </view>
          </view>
        </view>

        <text class="name">{{ currentSound ? currentSound.name : '选一个声音' }}</text>
        <text class="state">{{ stateText }}</text>

        <!-- 定了时长才出现：像沙漏一样一点点退掉，比只看文字直观 -->
        <view v-if="showTimer" class="timer">
          <view class="timer-fill" :style="{ width: timerPercent + '%' }" />
        </view>

        <!--
          操作条全用图标，不带文字（三角形的边框画的，不依赖任何字体，mp 里最稳）。
          ⚠️ 只做「上一个 / 下一个」不做「上一首 / 下一首」：那个说法是音乐播放器的，会往音乐类目靠。
        -->
        <view class="transport">
          <view class="side" @click="stepPrev">
            <view class="ic">
              <view class="tri tri--left" />
              <view class="tri tri--left tri--gap" />
            </view>
          </view>

          <view
            class="ctrl"
            :class="{ 'ctrl--busy': loading, 'ctrl--playing': playing && !loading }"
            @click="toggle"
          >
            <view v-if="loading" class="spinner" />
            <view v-else-if="playing" class="ic-pause">
              <view class="pause-bar" />
              <view class="pause-bar" />
            </view>
            <view v-else class="tri tri--play" />
          </view>

          <view class="side" @click="stepNext">
            <view class="ic">
              <view class="tri tri--right" />
              <view class="tri tri--right tri--gap" />
            </view>
          </view>
        </view>
      </view>

      <!-- 出错要立刻看得见，不藏在展开区里面 -->
      <text v-if="errorText" class="error">{{ errorText }}</text>

      <!-- 展开区：进场带一点「升上来」的过渡，不要硬邦邦地弹出来 -->
      <view v-if="more" class="extra">

      <!-- 音源：固定的十几个选项，不做列表 / 搜索 / 曲库（那是「内容平台」，会被判音乐类目） -->
      <view class="grid">
        <view
          v-for="item in sounds"
          :key="item.key"
          class="sound"
          :class="{ 'sound--on': isActive(item) }"
          @click="onPick(item)"
        >
          <view class="sound-head">
            <view class="sound-glyph">
              <text class="sound-glyph-text">{{ glyphOf(item) }}</text>
            </view>
            <text class="sound-name">{{ item.name }}</text>
            <!-- 正在响的那一首：一排跳动的电平条，比只有一圈描边更醒目 -->
            <view v-if="isActive(item)" class="eq">
              <view class="eq-bar eq-bar--1" />
              <view class="eq-bar eq-bar--2" />
              <view class="eq-bar eq-bar--3" />
            </view>
          </view>
          <text v-if="item.desc" class="sound-desc">{{ item.desc }}</text>
        </view>
      </view>

      <!--
        入口：固定的 9 首之外，让用户自己叠一个。
        放分包页而不是做成本页的一块 —— 那一堆条件会把这里撑得很长。
      -->
      <view class="lab" @click="goLab">
        <text class="lab-title">没找到合适的？自己调一个</text>
        <text class="lab-arrow">›</text>
      </view>

      <view class="panel">
        <view class="row row--wrap">
          <text class="row-label">定时关闭</text>
          <view class="chips">
            <view
              v-for="item in TIMER_OPTIONS"
              :key="item.value"
              class="chip"
              :class="{ 'chip--on': timerMinutes === item.value }"
              @click="onTimer(item.value)"
            >
              <text class="chip-text">{{ item.label }}</text>
            </view>
          </view>
        </view>
        <!--
          「切换顺序」而不是「播放顺序」：换一个声音这事本身没问题，
          但「播放顺序」是音乐播放器的说法，能避就避（类目风险）。
        -->
        <view class="row row--wrap">
          <text class="row-label">切换顺序</text>
          <view class="chips">
            <view
              v-for="item in ORDER_OPTIONS"
              :key="String(item.value)"
              class="chip"
              :class="{ 'chip--on': shuffle === item.value }"
              @click="setShuffle(item.value)"
            >
              <text class="chip-text">{{ item.label }}</text>
            </view>
          </view>
        </view>
        <!-- 后台播放没有音量接口，只能提示用手机侧键 -->
        <view class="row">
          <text class="row-label">音量</text>
          <text class="row-note">用手机侧边的音量键调</text>
        </view>
      </view>

      <text class="hint">
        播放时手机可以息屏，也可以切到别的应用，声音会一直放；返回上一页会停止。
      </text>
      </view>
    </template>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShareAppMessage, onShow, onUnload } from '@dcloudio/uni-app'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'
import { createSleepPlayer, isSleepSoundSupported } from '@/pkg/utils/noise'
import { DEFAULT_SOUND_KEY, findSound, listSounds, loadCustomSounds } from '@/pkg/utils/sound-library'

const PAGE_PATH = 'pkg/sleep-sound/sleep-sound'

/** 定时关闭的档位；0 = 不关 */
const TIMER_OPTIONS = [
  { value: 0, label: '不关' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '60 分钟' },
]

/** 换下一个时怎么挑：按列表顺序走，还是随机挑一个 */
const ORDER_OPTIONS = [
  { value: false, label: '按顺序' },
  { value: true, label: '随机' },
]

/** 本机偏好：上次听的音源 / 定时档 */
const STORAGE_KEY = 'babyup.sleepSound'

const supported = ref(isSleepSoundSupported())
const playing = ref(false)
const loading = ref(false)
const errorText = ref('')
const currentKey = ref(DEFAULT_SOUND_KEY)
const timerMinutes = ref(0)
/** 播放顺序：false = 按列表顺序，true = 随机 */
const shuffle = ref(false)
/**
 * 是否展开「更多声音与设置」。
 * 默认收起：进页面就是干干净净一屏播放器，列表不抢视线。
 */
const more = ref(false)
/** 倒计时剩余秒数；只在「播放中 + 选了定时」时有意义 */
const remain = ref(0)

const currentSound = computed(() => findSound(currentKey.value))

/**
 * 每首音源配一个「形象字」，放在圆里当图标 —— 比直接取名字第一个字更像那么回事
 * （「白噪音」取「沙」、「钟摆」取「嗒」）。自己调的（工坊存下来的）没配，退回名字首字。
 */
const GLYPHS = {
  white: '沙',
  pink: '绵',
  brown: '瀑',
  rain: '雨',
  wave: '浪',
  wind: '风',
  stream: '溪',
  fan: '扇',
  heartbeat: '咚',
  pendulum: '嗒',
  lullaby: '摇',
  musicbox: '铃',
  starlight: '星',
}

function glyphOf(sound) {
  if (!sound) return '眠'
  return GLYPHS[sound.key] || (sound.name ? sound.name.slice(0, 1) : '眠')
}

/** 状态区那个大圆里的字 */
const glyph = computed(() => glyphOf(currentSound.value))

/** 这一首是不是「正在响」—— 卡片高亮和电平条都看它 */
function isActive(item) {
  return currentKey.value === item.key && playing.value
}

/** 内置的 13 首 + 自己存的。`listSounds()` 内部读了 customSounds 这个 ref，所以是响应式的 */
const sounds = computed(() => listSounds())
const stateText = computed(() => {
  if (loading.value) return '准备中…'
  if (!playing.value) return errorText.value ? '播放失败' : '未播放'
  if (timerMinutes.value > 0) return `正在播放 · 还有 ${formatRemain(remain.value)} 自动关闭`
  return '正在播放'
})

/** 定时总时长（秒）；没定时就是 0 */
const timerTotal = computed(() => timerMinutes.value * 60)
/** 剩余比例（0~100）。没在播、没定时都为 0，模板据此不渲染那条 */
const timerPercent = computed(() => {
  if (!playing.value || timerTotal.value <= 0) return 0
  return Math.max(0, Math.min(100, (remain.value / timerTotal.value) * 100))
})
const showTimer = computed(() => playing.value && timerMinutes.value > 0)

let player = null
let tickTimer = 0

function formatRemain(seconds) {
  const total = Math.max(Math.floor(seconds), 0)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function readPrefs() {
  try {
    const raw = uni.getStorageSync(STORAGE_KEY)
    const saved = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null
    if (!saved) return
    if (findSound(saved.key)) currentKey.value = saved.key
    if (TIMER_OPTIONS.some((item) => item.value === saved.minutes)) timerMinutes.value = saved.minutes
    if (typeof saved.shuffle === 'boolean') shuffle.value = saved.shuffle
    if (typeof saved.more === 'boolean') more.value = saved.more
  } catch (err) {
    console.error('[SleepSound] 读取本机偏好失败', err)
  }
}

function writePrefs() {
  try {
    uni.setStorageSync(
      STORAGE_KEY,
      JSON.stringify({
        key: currentKey.value,
        minutes: timerMinutes.value,
        shuffle: shuffle.value,
        more: more.value,
      }),
    )
  } catch (err) {
    console.error('[SleepSound] 保存本机偏好失败', err)
  }
}

function stopTick() {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = 0
  }
}

/** 起倒计时。到点直接停 —— 后台播放没有音量接口，做不了「渐弱」 */
function startTick() {
  stopTick()
  if (!timerMinutes.value || !playing.value) return
  remain.value = timerMinutes.value * 60
  tickTimer = setInterval(() => {
    remain.value -= 1
    if (remain.value <= 0) {
      stopTick()
      stopPlaying()
    }
  }, 1000)
}

function stopPlaying() {
  stopTick()
  remain.value = 0
  if (player) player.pause()
}

async function startPlaying() {
  const sound = findSound(currentKey.value)
  if (!player || !sound) return
  errorText.value = ''
  await player.play(sound)
  startTick()
}

function toggle() {
  if (loading.value) return
  if (playing.value) stopPlaying()
  else startPlaying()
}

/** 点某个音源：切过去并开始放（正在放同一个就保持，不打断） */
function onPick(item) {
  currentKey.value = item.key
  writePrefs()
  if (playing.value && player && player.current === item.key) return
  startPlaying()
}

/* ---------- 上一个 / 下一个 ---------- */

/**
 * 随机模式下「走过的路」。按「上一个」时沿原路退回去 ——
 * 再随机挑一个的话，用户会觉得「上一个」根本回不去。
 */
let trail = []
/** 记这么多就够回退了，再长没意义还占内存 */
const TRAIL_MAX = 20

/** 换到某个音源并开始放（上一个/下一个都走它，复用点卡片那套） */
function switchTo(key) {
  const sound = findSound(key)
  if (sound) onPick(sound)
}

/** 当前音源在列表里的位置；找不到返回 -1 */
function indexOfCurrent() {
  return sounds.value.findIndex((item) => item.key === currentKey.value)
}

/** 按步长在列表里挪一格，越界就绕回另一头 */
function neighbor(step) {
  const list = sounds.value
  if (!list.length) return ''
  const at = indexOfCurrent()
  if (at < 0) return list[0].key
  return list[(at + step + list.length) % list.length].key
}

/** 随机挑一个「不是现在这个」的；只剩一个时只能还是它 */
function randomOther() {
  const list = sounds.value
  if (list.length <= 1) return currentKey.value
  let key = currentKey.value
  while (key === currentKey.value) {
    key = list[Math.floor(Math.random() * list.length)].key
  }
  return key
}

function stepNext() {
  if (shuffle.value) {
    trail.push(currentKey.value)
    if (trail.length > TRAIL_MAX) trail.shift()
    switchTo(randomOther())
    return
  }
  switchTo(neighbor(1))
}

function stepPrev() {
  if (shuffle.value) {
    // 随机模式下优先沿原路退；退到头了才重新随机
    if (trail.length) switchTo(trail.pop())
    else switchTo(randomOther())
    return
  }
  switchTo(neighbor(-1))
}

function setShuffle(value) {
  shuffle.value = value
  writePrefs()
  // 换了方式就把走过的路清掉，否则退回去的方向和现在的顺序对不上
  trail = []
}

function toggleMore() {
  more.value = !more.value
  writePrefs()
}

function goLab() {
  uni.navigateTo({ url: '/pkg/sound-lab/sound-lab' })
}

function onTimer(minutes) {
  timerMinutes.value = minutes
  writePrefs()
  if (!playing.value) return
  if (minutes > 0) startTick()
  else stopTick()
}

onShow(() => {
  ensurePageAccess(PAGE_PATH)
  // 工坊里可能刚存过新声音，每次回到页面都重读一遍本机列表
  loadCustomSounds()
  readPrefs()
  if (!supported.value) return
  if (!player) {
    player = createSleepPlayer({
      // 状态必须由播放器回传：用户可能在锁屏的媒体面板上直接暂停，
      // 那种操作页面收不到点击，只能靠系统事件同步
      onChange: (state) => {
        playing.value = state.playing
        loading.value = state.loading
        errorText.value = state.error
        if (!state.playing) stopTick()
      },
    })
  }
  if (!player) {
    supported.value = false
    return
  }
  // 从别的页面切回来时，播放器可能已经在放（后台播放就是这个目的），同步一次状态
  playing.value = player.playing
})

onUnload(() => {
  // 退出本页就停：后台播放的「离开」是息屏/切应用（走 onHide，不停），
  // 而返回上一页是 onUnload —— 不停的话会变成一段没人管的播放
  stopPlaying()
  player = null
})

onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding: var(--space-lg);
  box-sizing: border-box;
  /* 顶部一抹暖色往下化开，比一整片灰底柔和；下面接回全局的页面底色 */
  background-image: linear-gradient(180deg, #fff4ef 0%, #f6f7f9 420rpx);
}

.notice {
  padding: var(--space-lg);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.notice-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.notice-text {
  display: block;
  margin-top: var(--space-sm);
  font-size: 25rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
}

/* ---------- 状态区 ---------- */
.hero {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  /* 收起态：这一块把剩下的高度全占了、内容垂直居中 —— 就是「一屏播放器」的样子 */
  justify-content: center;
  padding: var(--space-lg) 0;
}

/*
 * 背后那团暖光。用径向渐变做「软」，不用 filter: blur（mp 里 filter 支持不稳）。
 * 不播时 8s 一个来回，像在缓缓呼吸；播起来换 4.2s，和上面那圈同频，状态一眼可辨。
 */
.glow {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 560rpx;
  height: 560rpx;
  /* 压在圈心上（用 margin 而不是 transform —— transform 被呼吸动画占用了） */
  margin: -280rpx 0 0 -280rpx;
  background-image: radial-gradient(circle, rgba(255, 143, 107, 0.2) 0%, rgba(255, 143, 107, 0) 68%);
  border-radius: 50%;
  pointer-events: none;
  animation-name: glow-breathe;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-duration: 8s;
}

.glow--on {
  animation-duration: 4.2s;
}

@keyframes glow-breathe {
  0%,
  100% {
    opacity: 0.65;
    transform: scale(0.94);
  }

  50% {
    opacity: 1;
    transform: scale(1.06);
  }
}

/* 涟漪的活动场地；圈本身 240rpx，涟漪放大后会稍稍溢出，默认不裁剪，正好 */
.stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 240rpx;
  height: 240rpx;
  /* 展开时这一块要「缩回去」：宽高一并过渡，hero 才会跟着变矮，而不是留一块空地 */
  transition: width 340ms cubic-bezier(0.22, 0.61, 0.36, 1),
    height 340ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* 收起态 = 一屏的主角；展开后缩到角上，把地方让给列表 */
.stage--mini {
  width: 150rpx;
  height: 150rpx;
}

/*
 * 光晕 + 涟漪 + 圈三合一的整体。
 * 缩放放在这一层、不放 .ring 上：.ring 的 transform 被呼吸动画占着了，
 * 同一个元素上两个 transform 会互相顶掉；分成两层就各管各的。
 */
.aura {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 240rpx;
  height: 240rpx;
  transition: transform 340ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.aura--mini {
  transform: scale(0.62);
}

/* 涟漪：从圈的位置一圈圈往外荡开，越远越淡 */
.ripple {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 240rpx;
  height: 240rpx;
  /* 绝对定位的子元素在小程序里不一定会跟着 flex 居中，这里手动压在圈心上
     （用 margin 而不是 transform，因为 transform 被扩散动画占用了） */
  margin-top: -120rpx;
  margin-left: -120rpx;
  background-color: rgba(255, 143, 107, 0.3);
  border-radius: 50%;
  opacity: 0;
  animation-name: ripple;
  animation-timing-function: ease-out;
  animation-iteration-count: infinite;
  animation-duration: 4.2s;
}

/* 三条各错开 1/3 个周期，看起来是「一直有圈在往外走」而不是一涌一涌 */
.ripple--2 {
  animation-delay: 1.4s;
}

.ripple--3 {
  animation-delay: 2.8s;
}

@keyframes ripple {
  0% {
    transform: scale(0.86);
    opacity: 0.45;
  }

  70% {
    opacity: 0.12;
  }

  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}

.ring {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 240rpx;
  height: 240rpx;
  background-image: linear-gradient(160deg, #ffe9e1 0%, #fff5f0 100%);
  border-radius: 50%;
  box-shadow: 0 16rpx 40rpx rgba(255, 143, 107, 0.22);
}

/* 播放中才呼吸：安静时才动，反而更容易让人盯着看 */
.ring--on {
  animation: breathe 4.2s ease-in-out infinite;
}

@keyframes breathe {
  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.07);
  }
}

.core {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 160rpx;
  height: 160rpx;
  background-color: #ffffff;
  border-radius: 50%;
  box-shadow: inset 0 2rpx 10rpx rgba(255, 143, 107, 0.12);
}

.glyph {
  font-size: 64rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.name {
  margin-top: var(--space-lg);
  font-size: 34rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.state {
  margin-top: var(--space-xs);
  font-size: 25rpx;
  color: var(--color-text-muted);
  text-align: center;
}

/* 定时剩余条：每秒退一点，transition 让它退得平滑而不是一跳一跳 */
.timer {
  width: 300rpx;
  height: 8rpx;
  margin-top: var(--space-md);
  overflow: hidden;
  background-color: rgba(255, 143, 107, 0.16);
  border-radius: var(--radius-pill);
}

.timer-fill {
  height: 8rpx;
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
  transition: width 1s linear;
}

/* ---------- 展开区 ---------- */
/*
 * 一层薄薄的「升上来」动效。内容是 v-if 挂上来的，挂上那一刻跑一遍，
 * 比硬邦邦地弹出来舒服一点；收起时不跑（直接卸载）。
 */
.extra {
  animation-name: rise;
  animation-duration: 280ms;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(-16rpx);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ---------- 音源 ---------- */
.grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
}

.sound {
  display: flex;
  flex-direction: column;
  width: 31.5%;
  padding: var(--space-md) var(--space-sm);
  margin-bottom: var(--space-sm);
  box-sizing: border-box;
  background-color: var(--color-bg-card);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  border: 2rpx solid transparent;
}

.sound--on {
  border-color: var(--color-primary);
  background-color: var(--color-primary-soft);
}

/* 头上那一行：形象字 + 名字 +（在响的话）电平条 */
.sound-head {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.sound-glyph {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 44rpx;
  height: 44rpx;
  margin-right: 10rpx;
  background-color: var(--color-primary-soft);
  border-radius: 50%;
}

/* 高亮那张的底色本来就是 soft 了，小圆得改成白的才看得出边界 */
.sound--on .sound-glyph {
  background-color: #ffffff;
}

.sound-glyph-text {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.sound-name {
  flex: 1;
  font-size: 26rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.sound-desc {
  margin-top: var(--space-xs);
  font-size: 20rpx;
  line-height: 1.4;
  color: var(--color-text-muted);
}

/* 电平条：三根高低不同的小竖条错开跳，像音量在动 */
.eq {
  display: flex;
  flex-shrink: 0;
  flex-direction: row;
  align-items: flex-end;
  height: 30rpx;
  margin-left: 6rpx;
}

.eq-bar {
  width: 5rpx;
  margin-left: 4rpx;
  background-color: var(--color-primary);
  border-radius: 3rpx;
  transform-origin: bottom center;
  animation-name: eq-bounce;
  animation-duration: 900ms;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  /* 后两根有延迟，加这个让它们在等待期间就停在起跳姿势，不然会先满格再跳一下 */
  animation-fill-mode: backwards;
}

/* 高度和延迟都错开，三根才不会整齐划一（那样像在闪，不像在跳） */
.eq-bar--1 {
  height: 18rpx;
}

.eq-bar--2 {
  height: 30rpx;
  animation-delay: 150ms;
}

.eq-bar--3 {
  height: 22rpx;
  animation-delay: 300ms;
}

@keyframes eq-bounce {
  0%,
  100% {
    transform: scaleY(0.4);
  }

  50% {
    transform: scaleY(1);
  }
}

/* ---------- 自己调一个（进分包页） ---------- */
.lab {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-top: var(--space-md);
  padding: var(--space-md) var(--space-lg);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.lab-title {
  flex: 1;
  font-size: 27rpx;
  color: var(--color-text-sub);
}

.lab-arrow {
  font-size: 34rpx;
  color: var(--color-text-muted);
}

/* ---------- 设置面板 ---------- */
.panel {
  margin-top: var(--space-md);
  padding: var(--space-md) var(--space-lg);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-sm) 0;
}

.row--wrap {
  flex-wrap: wrap;
  align-items: flex-start;
}

.row-label {
  width: 150rpx;
  font-size: 27rpx;
  color: var(--color-text-sub);
}

.row-note {
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  flex: 1;
}

.chip {
  padding: 10rpx 24rpx;
  margin: 0 var(--space-sm) var(--space-xs) 0;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.chip--on {
  background-color: var(--color-primary-soft);
}

.chip-text {
  font-size: 24rpx;
  color: var(--color-text-sub);
}

.chip--on .chip-text {
  color: var(--color-primary-deep);
  font-weight: 600;
}

/* ---------- 操作条：上一个 / 播放暂停 / 下一个（全是图标） ---------- */
.transport {
  display: flex;
  flex-direction: row;
  align-items: center;
  /* 居中的三颗，两两之间留足空档 —— 挤在一起正是它们原来最难看的地方 */
  justify-content: center;
  margin-top: var(--space-xl);
}

/* 两边那两个：圆形浅底按钮，和中间的播放键拉开主次 */
.side {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 100rpx;
  height: 100rpx;
  box-sizing: border-box;
  background-color: var(--color-bg-card);
  border-radius: 50%;
  box-shadow: var(--shadow-card);
}

/* 三角图标一律用 border 画：不依赖任何字体，各机型渲染一致 */
.ic {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.tri {
  width: 0;
  height: 0;
  border-top: 14rpx solid transparent;
  border-bottom: 14rpx solid transparent;
}

.tri--left {
  border-right: 17rpx solid var(--color-primary-deep);
}

.tri--right {
  border-left: 17rpx solid var(--color-primary-deep);
}

/* 两个三角之间拉开一段距离（原来是叠在一起的，所以看着挤） */
.tri--gap {
  margin-left: 7rpx;
}

/* 播放键上那颗：白色三角，往右挪一点才看着居中（三角形的重心偏左） */
.tri--play {
  border-top-width: 17rpx;
  border-bottom-width: 17rpx;
  border-left: 26rpx solid #ffffff;
  margin-left: 8rpx;
}

/* 暂停：两根竖条 */
.ic-pause {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  width: 34rpx;
  height: 38rpx;
}

.pause-bar {
  width: 12rpx;
  height: 38rpx;
  background-color: var(--color-primary-deep);
  border-radius: 3rpx;
}

/* 准备中：转个圈，比干写「准备中…」好看 */
.spinner {
  width: 36rpx;
  height: 36rpx;
  border: 5rpx solid rgba(255, 255, 255, 0.35);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation-name: spin;
  animation-duration: 800ms;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

/* 中间那颗：圆的，比两个侧键大一号，一眼看出是主按钮 */
.ctrl {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 124rpx;
  height: 124rpx;
  margin: 0 40rpx;
  box-sizing: border-box;
  /* 边框常驻（只是透明），免得切「暂停/播放」时大小跳一下 */
  border: 2rpx solid transparent;
  background-image: linear-gradient(135deg, #ffab90 0%, #f4703f 100%);
  border-radius: 50%;
  box-shadow: 0 12rpx 28rpx rgba(244, 112, 63, 0.28);
}

/* 正在放的时候换成描边样式：一眼看出「再点一下是暂停」 */
.ctrl--playing {
  background-image: none;
  background-color: var(--color-bg-card);
  border-color: var(--color-primary);
  box-shadow: none;
}

.ctrl--busy {
  opacity: 0.7;
}

.error {
  display: block;
  margin-top: var(--space-md);
  font-size: 24rpx;
  color: var(--color-danger);
  text-align: center;
}

.hint {
  display: block;
  margin-top: var(--space-md);
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
  text-align: center;
}
</style>
