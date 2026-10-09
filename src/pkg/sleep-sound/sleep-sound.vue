<template>
  <view class="page">
    <!-- 环境不支持（H5 / App 端）时的兜底：不进这个页面就看不到，直接说清楚 -->
    <view v-if="!supported" class="notice">
      <text class="notice-title">安睡音暂时不可用</text>
      <text class="notice-text">这个功能只在微信小程序端提供（依赖微信的后台音频播放能力）。</text>
    </view>

    <template v-else>
      <!-- 状态区：呼吸圈 + 当前音源 + 倒计时 -->
      <view class="hero">
        <view class="hero-ring" :class="{ 'hero-ring--on': playing }">
          <view class="hero-core">
            <text class="hero-glyph">{{ currentSound ? currentSound.name.slice(0, 1) : '眠' }}</text>
          </view>
        </view>
        <text class="hero-name">{{ currentSound ? currentSound.name : '选一个声音' }}</text>
        <text class="hero-state">{{ stateText }}</text>
      </view>

      <!-- 音源：只有 6 个固定选项，不做列表 / 搜索 / 曲库（那是「内容平台」，会被判音乐类目） -->
      <view class="grid">
        <view
          v-for="item in sounds"
          :key="item.key"
          class="sound"
          :class="{ 'sound--on': currentKey === item.key && playing }"
          @click="onPick(item)"
        >
          <text class="sound-name">{{ item.name }}</text>
          <text class="sound-desc">{{ item.desc }}</text>
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
        <!-- 后台播放没有音量接口，只能提示用手机侧键 -->
        <view class="row">
          <text class="row-label">音量</text>
          <text class="row-note">用手机侧边的音量键调</text>
        </view>
      </view>

      <view class="ctrl" :class="{ 'ctrl--busy': loading }" @click="toggle">
        <text class="ctrl-text">{{ loading ? '准备中…' : playing ? '暂停' : '播放' }}</text>
      </view>

      <text v-if="errorText" class="error">{{ errorText }}</text>

      <text class="hint">
        播放时手机可以息屏，也可以切到别的应用，声音会一直放；返回上一页会停止。
      </text>
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

/** 本机偏好：上次听的音源 / 定时档 */
const STORAGE_KEY = 'babyup.sleepSound'

const supported = ref(isSleepSoundSupported())
const playing = ref(false)
const loading = ref(false)
const errorText = ref('')
const currentKey = ref(DEFAULT_SOUND_KEY)
const timerMinutes = ref(0)
/** 倒计时剩余秒数；只在「播放中 + 选了定时」时有意义 */
const remain = ref(0)

const currentSound = computed(() => findSound(currentKey.value))
/** 内置的 13 首 + 自己存的。`listSounds()` 内部读了 customSounds 这个 ref，所以是响应式的 */
const sounds = computed(() => listSounds())
const stateText = computed(() => {
  if (loading.value) return '准备中…'
  if (!playing.value) return errorText.value ? '播放失败' : '未播放'
  if (timerMinutes.value > 0) return `正在播放 · 还有 ${formatRemain(remain.value)} 自动关闭`
  return '正在播放'
})

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
  } catch (err) {
    console.error('[SleepSound] 读取本机偏好失败', err)
  }
}

function writePrefs() {
  try {
    uni.setStorageSync(
      STORAGE_KEY,
      JSON.stringify({ key: currentKey.value, minutes: timerMinutes.value }),
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
  min-height: 100vh;
  padding: var(--space-lg);
  box-sizing: border-box;
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
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-xl) 0 var(--space-lg);
}

.hero-ring {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 260rpx;
  height: 260rpx;
  background-color: var(--color-primary-soft);
  border-radius: 50%;
}

/* 播放中才呼吸：安静时才动，反而更容易让人盯着看 */
.hero-ring--on {
  animation: breathe 4s ease-in-out infinite;
}

@keyframes breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.85;
  }
  50% {
    transform: scale(1.08);
    opacity: 1;
  }
}

.hero-core {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 168rpx;
  height: 168rpx;
  background-color: #ffffff;
  border-radius: 50%;
}

.hero-glyph {
  font-size: 60rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.hero-name {
  margin-top: var(--space-lg);
  font-size: 34rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.hero-state {
  margin-top: var(--space-xs);
  font-size: 25rpx;
  color: var(--color-text-muted);
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

.sound-name {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.sound-desc {
  margin-top: var(--space-xs);
  font-size: 20rpx;
  line-height: 1.4;
  color: var(--color-text-muted);
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

/* ---------- 播放键 ---------- */
.ctrl {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  margin-top: var(--space-lg);
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.ctrl--busy {
  opacity: 0.7;
}

.ctrl-text {
  font-size: 32rpx;
  font-weight: 600;
  color: #ffffff;
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
