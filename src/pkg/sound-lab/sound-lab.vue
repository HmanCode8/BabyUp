<template>
  <view class="page">
    <!-- 环境不支持（H5 / 非微信端）时的兜底 -->
    <view v-if="!supported" class="notice">
      <text class="notice-title">声音工坊暂时不可用</text>
      <text class="notice-text">这个功能只在微信小程序端提供（依赖微信的音频实时合成能力）。</text>
    </view>

    <template v-else>
      <!-- 状态区：和安睡音页同一套「呼吸圈 + 名字 + 状态」 -->
      <view class="hero">
        <view class="hero-ring" :class="{ 'hero-ring--on': playing }">
          <view class="hero-core">
            <text class="hero-glyph">调</text>
          </view>
        </view>
        <text class="hero-name">{{ previewName }}</text>
        <text class="hero-state">{{ stateText }}</text>
      </view>

      <view class="panel">
        <view class="row row--wrap">
          <text class="row-label">底色</text>
          <view class="chips">
            <view
              v-for="item in BED_OPTIONS"
              :key="item.key"
              class="chip"
              :class="{ 'chip--on': recipe.bed === item.key }"
              @click="pickBed(item.key)"
            >
              <text class="chip-text">{{ item.name }}</text>
            </view>
          </view>
        </view>

        <view class="row row--wrap">
          <text class="row-label">混入</text>
          <view class="chips">
            <view
              v-for="item in LAYER_OPTIONS"
              :key="item.key"
              class="chip"
              :class="{ 'chip--on': hasLayer(item.key) }"
              @click="toggleLayer(item.key)"
            >
              <text class="chip-text">{{ item.name }}</text>
            </view>
          </view>
        </view>

        <!--
          三条连续滑杆。用 @change（松手时）而不是 @changing（拖动中）：
          每次改动都要把 12 秒的样本重算一遍，拖动中连着算会把界面拖卡。
        -->
        <view class="row">
          <text class="row-label">亮度</text>
          <slider
            class="vol"
            :value="pct(recipe.brightness)"
            :min="0"
            :max="100"
            activeColor="#ff8f6b"
            backgroundColor="#e6e8ec"
            block-size="20"
            @change="onBrightness"
          />
          <text class="row-value">{{ brightnessLabel }}</text>
        </view>

        <view class="row">
          <text class="row-label">起伏快慢</text>
          <slider
            class="vol"
            :value="pct(recipe.motion)"
            :min="0"
            :max="100"
            activeColor="#ff8f6b"
            backgroundColor="#e6e8ec"
            block-size="20"
            @change="onMotion"
          />
        </view>

        <view class="row">
          <text class="row-label">起伏幅度</text>
          <slider
            class="vol"
            :value="pct(recipe.depth)"
            :min="0"
            :max="100"
            activeColor="#ff8f6b"
            backgroundColor="#e6e8ec"
            block-size="20"
            @change="onDepth"
          />
        </view>

        <!-- 各层强度：只列已经选上的，没选的不占地方 -->
        <template v-if="activeLayers.length">
          <text class="sub-title">各层强度</text>
          <view v-for="item in activeLayers" :key="item.id" class="row">
            <text class="row-label">{{ item.name }}</text>
            <slider
              class="vol"
              :value="pct(item.value)"
              :min="0"
              :max="100"
              activeColor="#ff8f6b"
              backgroundColor="#e6e8ec"
              block-size="20"
              @change="onLayerGain(item, $event)"
            />
          </view>
        </template>

        <view class="row">
          <text class="row-label">音量</text>
          <slider
            class="vol"
            :value="volume"
            :min="0"
            :max="100"
            activeColor="#ff8f6b"
            backgroundColor="#e6e8ec"
            block-size="20"
            @changing="onVolume"
            @change="onVolume"
          />
        </view>
      </view>

      <view class="ctrl" :class="{ 'ctrl--busy': loading }" @click="toggle">
        <text class="ctrl-text">{{ loading ? '生成中…' : playing ? '停一下' : '试听' }}</text>
      </view>

      <view class="ctrl ctrl--ghost" :class="{ 'ctrl--busy': saving }" @click="save">
        <text class="ctrl-text ctrl-text--ghost">{{ saving ? '正在保存…' : '存下来' }}</text>
      </view>

      <text v-if="errorText" class="error">{{ errorText }}</text>

      <!-- 自己存过的：只在工坊里能删（安睡音/放映页那边只负责用） -->
      <view v-if="customSounds.length" class="mine">
        <text class="mine-title">我存的（{{ customSounds.length }} / {{ CUSTOM_LIMIT }}）</text>
        <view v-for="item in customSounds" :key="item.key" class="mine-row">
          <text class="mine-name">{{ item.name }}</text>
          <text class="mine-del" @click="removeCustom(item)">删除</text>
        </view>
      </view>

      <text class="hint">
        改任一条件会立刻重算、接着响。声音是在手机内存里现算的，不联网、不占存储；
        也正因为这样，它只在前台响 —— 息屏或切到别的应用就会停。
        满意之后点「存下来」，它才会变成一段固定音频，能在安睡音和放映页里选到、也能息屏放。
      </text>
    </template>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShareAppMessage, onShow, onUnload } from '@dcloudio/uni-app'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'
import {
  BED_OPTIONS,
  CUSTOM_SAMPLE_RATE,
  CUSTOM_SECONDS,
  defaultRecipe,
  describeRecipe,
  LAYER_OPTIONS,
  recipeHasSound,
  renderRecipe,
  toWavBytes,
} from '@/pkg/utils/sound-gen.mjs'
import {
  addCustomSound,
  CUSTOM_LIMIT,
  customSounds,
  loadCustomSounds,
  removeCustomSound,
} from '@/pkg/utils/sound-library'
import { createLabPlayer, isSoundLabSupported } from '@/pkg/utils/sound-lab-player'

const PAGE_PATH = 'pkg/sound-lab/sound-lab'

/** 改条件后隔多久才重算。连着点几下只算最后一次，不然会一直重算 */
const REBUILD_DELAY = 200
/** 显示给用户看时，参数 0~1 一律按 0~100 走 */
const pct = (value) => Math.round((value || 0) * 100)
const fromPct = (value) => Math.min(1, Math.max(0, value / 100))

const supported = ref(false)
const playing = ref(false)
const loading = ref(false)
const saving = ref(false)
const errorText = ref('')
const volume = ref(60)
/** 当前配方；整体替换而不是改字段，省得担心响应式没触发 */
const recipe = ref(defaultRecipe())

const previewName = computed(() => describeRecipe(recipe.value))
const stateText = computed(() => {
  if (loading.value) return '生成中…'
  if (errorText.value) return '没生成出来'
  return playing.value ? '正在响' : '还没开始'
})

/** 亮度给一句人话，比甩一个 Hz 数字有用 */
const brightnessLabel = computed(() => {
  const v = recipe.value.brightness
  if (v < 0.3) return '很闷'
  if (v < 0.55) return '偏闷'
  if (v < 0.8) return '适中'
  return '偏亮'
})

/** 已经在响的层（底色 + 勾中的混入），用来渲染「各层强度」那几行 */
const activeLayers = computed(() => {
  const list = []
  if (recipe.value.bed && recipe.value.bed !== 'none') {
    const bed = BED_OPTIONS.find((item) => item.key === recipe.value.bed)
    list.push({ id: 'bed', name: bed ? bed.name : '底色', kind: 'bed', value: recipe.value.bedGain })
  }
  for (const item of recipe.value.layers) {
    const layer = LAYER_OPTIONS.find((option) => option.key === item.key)
    list.push({ id: item.key, name: layer ? layer.name : item.key, kind: 'layer', key: item.key, value: item.gain })
  }
  return list
})

let player = null
let rebuildTimer = 0
/** 上一条已经弹过的错误，避免同一个错反复弹 */
let lastError = ''

function hasLayer(key) {
  return recipe.value.layers.some((item) => item.key === key)
}

/** 改了条件：正在响就重新算一遍接着响；没响就只更新预览名字 */
function restartIfPlaying() {
  if (!player || !playing.value) return
  if (rebuildTimer) clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(() => {
    rebuildTimer = 0
    if (player && playing.value) player.start(recipe.value)
  }, REBUILD_DELAY)
}

function pickBed(key) {
  if (recipe.value.bed === key) return
  recipe.value = { ...recipe.value, bed: key }
  restartIfPlaying()
}

function toggleLayer(key) {
  const has = hasLayer(key)
  const layers = has
    ? recipe.value.layers.filter((item) => item.key !== key)
    : recipe.value.layers.concat({ key, gain: 0.8 })
  recipe.value = { ...recipe.value, layers }
  restartIfPlaying()
}

function onBrightness(event) {
  recipe.value = { ...recipe.value, brightness: fromPct(event.detail.value) }
  restartIfPlaying()
}

function onMotion(event) {
  recipe.value = { ...recipe.value, motion: fromPct(event.detail.value) }
  restartIfPlaying()
}

function onDepth(event) {
  recipe.value = { ...recipe.value, depth: fromPct(event.detail.value) }
  restartIfPlaying()
}

function onLayerGain(item, event) {
  const value = fromPct(event.detail.value)
  if (item.kind === 'bed') {
    recipe.value = { ...recipe.value, bedGain: value }
  } else {
    recipe.value = {
      ...recipe.value,
      layers: recipe.value.layers.map((layer) => (layer.key === item.key ? { ...layer, gain: value } : layer)),
    }
  }
  restartIfPlaying()
}

function onVolume(event) {
  const value = event.detail.value
  volume.value = value
  if (player) player.setVolume(value / 100)
}

function toggle() {
  if (!player) return
  if (playing.value) player.stop()
  else player.start(recipe.value)
}

/* ---------- 存下来 ---------- */

function uploadToCloud(cloudPath, filePath) {
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => resolve(res && res.fileID),
      fail: (err) => reject(err),
    })
  })
}

/**
 * 把当前配方算成一段固定 WAV、传上云存储、记进本机音源列表。
 *
 * 为什么要落成文件：实时的那套只在前台响，息屏就停；只有"真实文件 +
 * 后台播放器"才能放一晚上（见 src/pkg/utils/bgm.js 与 noise.js 的对比说明）。
 */
async function save() {
  if (!player || saving.value) return
  if (!recipeHasSound(recipe.value)) {
    uni.showToast({ title: '至少留一层再存', icon: 'none' })
    return
  }
  if (customSounds.value.length >= CUSTOM_LIMIT) {
    uni.showToast({ title: `最多存 ${CUSTOM_LIMIT} 条，先删一个`, icon: 'none' })
    return
  }
  if (!wx.env || !wx.env.USER_DATA_PATH) {
    uni.showToast({ title: '当前环境不支持保存', icon: 'none' })
    return
  }

  saving.value = true
  uni.showLoading({ title: '正在保存…', mask: true })
  // 先让 loading 画出来：下面的合成是同步的 CPU 活，会占住这一帧
  await new Promise((resolve) => setTimeout(resolve, 40))

  const stamp = Date.now()
  const filePath = `${wx.env.USER_DATA_PATH}/sound-lab-${stamp}.wav`
  const fs = wx.getFileSystemManager()
  try {
    const bytes = toWavBytes(
      renderRecipe(recipe.value, { sampleRate: CUSTOM_SAMPLE_RATE, seconds: CUSTOM_SECONDS }),
      CUSTOM_SAMPLE_RATE,
    )
    fs.writeFileSync(filePath, bytes.buffer)
    const fileID = await uploadToCloud(`sleep-sound/custom-${stamp}.wav`, filePath)
    if (!fileID) throw new Error('上传没有返回 fileID')
    addCustomSound({
      key: `custom_${stamp}`,
      name: describeRecipe(recipe.value),
      desc: '自己调的',
      fileId: fileID,
      recipe: recipe.value,
      createdAt: stamp,
    })
    uni.hideLoading()
    uni.showToast({ title: '存下了，去安睡音里能找到', icon: 'none' })
  } catch (err) {
    console.error('[SoundLab] 保存失败', err)
    uni.hideLoading()
    uni.showToast({ title: '保存失败，检查网络后重试', icon: 'none' })
  } finally {
    // 本地临时文件用完就删，别占着 10MB 的用户空间
    try {
      fs.unlinkSync(filePath)
    } catch (err) {
      console.warn('[SoundLab] 清理临时文件失败', err)
    }
    saving.value = false
  }
}

/** 删除：先删云文件，再删本机记录 */
function removeCustom(item) {
  uni.showModal({
    title: '删掉这个声音？',
    content: `「${item.name}」会从安睡音和放映页里一起消失。`,
    confirmText: '删除',
    confirmColor: '#f04438',
    success: (res) => {
      if (!res.confirm) return
      wx.cloud.deleteFile({
        fileList: [item.fileId],
        complete: () => {
          removeCustomSound(item.key)
          uni.showToast({ title: '已删除', icon: 'none' })
        },
      })
    },
  })
}

onShow(() => {
  ensurePageAccess(PAGE_PATH)
  loadCustomSounds()
  if (!isSoundLabSupported()) {
    supported.value = false
    return
  }
  if (!player) {
    player = createLabPlayer({
      onChange: (state) => {
        playing.value = state.playing
        loading.value = state.loading
        errorText.value = state.error
        if (state.error && state.error !== lastError) {
          uni.showToast({ title: state.error, icon: 'none' })
        }
        lastError = state.error
      },
    })
    if (player) player.setVolume(volume.value / 100)
  }
  supported.value = Boolean(player)
})

onUnload(() => {
  if (rebuildTimer) {
    clearTimeout(rebuildTimer)
    rebuildTimer = 0
  }
  // 退出页面就停：实时合成只在前台有意义，留着白耗电
  if (player) {
    player.destroy()
    player = null
  }
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
  width: 220rpx;
  height: 220rpx;
  background-color: var(--color-primary-soft);
  border-radius: 50%;
}

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
  width: 142rpx;
  height: 142rpx;
  background-color: #ffffff;
  border-radius: 50%;
}

.hero-glyph {
  font-size: 52rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.hero-name {
  margin-top: var(--space-lg);
  padding: 0 var(--space-lg);
  font-size: 32rpx;
  font-weight: 600;
  text-align: center;
  color: var(--color-text-main);
}

.hero-state {
  margin-top: var(--space-xs);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

/* ---------- 条件面板 ---------- */
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
  padding: 6rpx 0;
}

.row--wrap {
  flex-wrap: wrap;
  align-items: flex-start;
}

.row-label {
  width: 140rpx;
  font-size: 26rpx;
  color: var(--color-text-sub);
}

.row-value {
  width: 80rpx;
  font-size: 23rpx;
  text-align: right;
  color: var(--color-text-muted);
}

.chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  flex: 1;
}

.chip {
  padding: 10rpx 22rpx;
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

.vol {
  flex: 1;
  margin: 0 var(--space-xs);
}

.sub-title {
  display: block;
  padding: var(--space-sm) 0 0;
  font-size: 23rpx;
  color: var(--color-text-muted);
}

/* ---------- 按钮 ---------- */
.ctrl {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  margin-top: var(--space-lg);
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.ctrl--ghost {
  margin-top: var(--space-sm);
  background-color: var(--color-bg-card);
  border: 2rpx solid var(--color-primary);
}

.ctrl--busy {
  opacity: 0.6;
}

.ctrl-text {
  font-size: 30rpx;
  font-weight: 600;
  color: #ffffff;
}

.ctrl-text--ghost {
  color: var(--color-primary-deep);
}

.error {
  display: block;
  margin-top: var(--space-md);
  font-size: 24rpx;
  color: var(--color-danger);
}

/* ---------- 我存的 ---------- */
.mine {
  margin-top: var(--space-lg);
  padding: var(--space-md) var(--space-lg);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.mine-title {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.mine-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-sm) 0;
  border-bottom: 1rpx solid var(--color-bg-page);
}

.mine-name {
  flex: 1;
  font-size: 25rpx;
  color: var(--color-text-sub);
}

.mine-del {
  padding: 6rpx 18rpx;
  font-size: 23rpx;
  color: var(--color-danger);
}

.hint {
  display: block;
  margin-top: var(--space-lg);
  font-size: 23rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
}
</style>
