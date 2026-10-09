<template>
  <view class="page">
    <!-- 准备中 / 没有照片：都用同一个居中状态页兜住，别留黑屏 -->
    <view v-if="loading" class="state">
      <text class="state-text">正在准备照片…</text>
    </view>
    <view v-else-if="!photos.length" class="state">
      <text class="state-text">还没有可以放映的照片</text>
      <view class="state-btn" @click="goBack">
        <text class="state-btn-text">返回</text>
      </view>
    </view>

    <template v-else>
      <!-- 全屏放映：自动播放、循环、可左右手动翻；点画面任意处暂停/继续 -->
      <swiper
        class="stage"
        :autoplay="playing"
        :circular="items.length > 1"
        :interval="INTERVAL"
        :duration="600"
        @change="onChange"
      >
        <swiper-item v-for="(item, i) in items" :key="item.id" class="frame" @click="togglePlay">
          <image
            v-if="item.url"
            class="frame-img"
            :class="{ 'frame-img--zoom': i === index, 'frame-img--paused': !playing }"
            :style="{ animationDuration: ZOOM_DURATION + 'ms' }"
            :src="item.url"
            mode="aspectFit"
            @error="onImageError(item)"
          />
          <view v-else class="frame-fallback">
            <text class="frame-fallback-text">这张图暂时打不开</text>
          </view>

          <!--
            照片说明层：日期 + 拍照当时的月龄 + 备注。
            「纯轮播」和「幻灯片」的区别主要就在这一层 —— 只有图没有字，
            看的人不知道这是哪一天、宝宝多大，也没有情绪落点。
            底部那条由透明到黑的渐变是文字的可读性底衬（照片深浅都能看清）。
          -->
          <view class="caption">
            <view v-if="dateText(item) || ageText(item)" class="caption-line">
              <text class="caption-date">{{ dateText(item) }}</text>
              <text v-if="ageText(item)" class="caption-age">· {{ ageText(item) }}</text>
            </view>
            <text v-if="item.note" class="caption-note">{{ item.note }}</text>
          </view>
        </swiper-item>
      </swiper>

      <!--
        顶栏只放「返回 + 名字」。
        ⚠️ 右上角是微信的胶囊（···），custom 导航栏下它浮在最上层且点击优先级最高 ——
        原来把「选片」放在这儿，用户一点就点成胶囊的分享菜单（踩过）。
        所以：可点的东西一律不往右上角放（选片移到下方操作条），并且用 topBarStyle
        把胶囊那块区域整个让出来。
      -->
      <view class="top" :style="topBarStyle">
        <text class="top-back" @click="goBack">‹</text>
        <text class="top-title">{{ title || '宝宝时光' }}</text>
        <!--
          背景声入口放在标题右边（也就是胶囊左边、topBarStyle 让出来的那块），
          **不能放右上角**：那里是微信胶囊，点上去会弹出胶囊的分享菜单（踩过）。
        -->
        <text
          v-if="bgmAvailable"
          class="top-music"
          :class="{ 'top-music--on': bgmPlaying, 'top-music--busy': bgmLoading }"
          @click="openBgm"
        >
          ♪
        </text>
      </view>

      <view class="bottom">
        <view class="bar">
          <view class="bar-track">
            <!--
              进度由 JS 按「这张已播了多久」算出来，写进 transform（见 script 的 startTick）。
              ⚠️ 原来用「:key 绑 index + CSS 动画」想让它每张重跑一遍，但**微信小程序
              不会因为普通元素的 key 变化而重建节点** —— 只有第一张动过，之后一直停在
              animation-fill-mode: forwards 的满格（踩过）。改 JS 后暂停也能冻在中途。
            -->
            <view class="bar-fill" :style="{ transform: `scaleX(${progress})` }" />
          </view>
          <text class="bar-count">{{ index + 1 }} / {{ items.length }}</text>
          <text class="bar-pick" @click="openPick">选片</text>
          <view class="play" @click="togglePlay">
            <text class="play-text">{{ playing ? '暂停' : '播放' }}</text>
          </view>
        </view>
      </view>

      <!--
        选片面板：默认不勾 = 全部播放；勾了就只播勾中的那些。
        网格放在 scroll-view 里配 lazy-load，只下载屏幕里能看到的那几张缩略图。
      -->
      <view v-if="picking" class="picker">
        <view class="picker-head" :style="topBarStyle">
          <text class="picker-title">选择要放映的照片</text>
          <text class="picker-count">{{ picked.length ? `已选 ${picked.length} 张` : '不选 = 全部播放' }}</text>
          <text class="picker-close" @click="closePick">✕</text>
        </view>

        <view class="picker-body">
          <scroll-view class="picker-grid" scroll-y>
            <!-- 三列用 flex-wrap 排：比 inline-block 稳，不会因为标签间的空白把第三列挤下去 -->
            <view class="picker-inner">
              <view v-for="photo in photos" :key="photo.id" class="picker-cell" @click="togglePick(photo)">
                <image class="picker-img" :src="photo.url" mode="aspectFill" lazy-load />
                <view v-if="isPicked(photo)" class="picker-tick">
                  <text class="picker-tick-text">✓</text>
                </view>
                <text v-if="photo.taken_at && shortDate(photo)" class="picker-date">
                  {{ shortDate(photo) }}
                </text>
              </view>
            </view>
          </scroll-view>
        </view>

        <view class="picker-actions">
          <text class="picker-link" @click="pickAll">全选</text>
          <text class="picker-link" @click="clearPick">清空</text>
          <view class="picker-done" @click="closePick">
            <text class="picker-done-text">放映 {{ picked.length ? `这 ${picked.length} 张` : '全部' }}</text>
          </view>
        </view>
      </view>

      <!--
        背景声面板：底部弹出的小抽屉，列出与安睡音**同一份**音源库（关闭 + 9 首）。
        选了立刻生效并记住 —— 下次进来自动放，不用每次再点。
        用网格不用竖排列表：10 项竖排在小屏上会顶破屏幕，网格排 4 行刚刚好。
      -->
      <view v-if="bgmPanel" class="bgm-mask" @click="bgmPanel = false">
        <view class="bgm-sheet" @click.stop>
          <view class="bgm-head">
            <text class="bgm-title">背景声</text>
            <text class="bgm-close" @click="bgmPanel = false">✕</text>
          </view>
          <view class="bgm-grid">
            <view class="bgm-cell" :class="{ 'bgm-cell--on': !bgmKey }" @click="pickBgm('')">
              <text class="bgm-cell-name">关闭</text>
              <text class="bgm-cell-desc">不放声音</text>
            </view>
            <view
              v-for="sound in bgmSounds"
              :key="sound.key"
              class="bgm-cell"
              :class="{ 'bgm-cell--on': bgmKey === sound.key }"
              @click="pickBgm(sound.key)"
            >
              <text class="bgm-cell-name">{{ sound.name }}</text>
              <!-- 自己存的声音可能没写备注，那就别留一行空的 -->
              <text v-if="sound.desc" class="bgm-cell-desc">{{ sound.desc }}</text>
            </view>
          </view>
          <text class="bgm-hint">声音只在放映时响，退出这一页会自动停；和安睡音共用同一套音源。</text>
        </view>
      </view>
    </template>
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { onHide, onLoad, onShow, onShareAppMessage, onUnload } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { listPhotos } from '@/services/photo'
import { flagEnabled } from '@/services/flags'
import { ensurePageAccess } from '@/utils/routeGuard'
import { formatAge } from '@/utils/age'
import { formatDate } from '@/utils/date'
import { createBgmPlayer, isBgmSupported } from '@/pkg/utils/bgm'
import { findSound, listSounds, loadCustomSounds } from '@/pkg/utils/sound-library'

const PAGE_PATH = 'pkg/slideshow/slideshow'

/** 每张停留多久（毫秒）。4 秒是给「看日期和备注」留的时间，3 秒读不完 */
const INTERVAL = 4000
/**
 * 缓慢放大的时长：刻意比停留时间略长，让照片在被换掉之前一直在动。
 * 暂停时会和进度条一起冻住（见 .frame-img--paused）。
 */
const ZOOM_DURATION = INTERVAL + 1500
/**
 * 一次最多处理多少张：既是「全部播放」的上限，也是「选片」列表的长度。
 *
 * 4 秒一张 × 60 ≈ 4 分钟，再多没人看完；这个数同时压着内存 ——
 * **`swiper` 会把所有 slide 一次渲染出来**。实测 60 张在手机上正常，
 * 以后若有人反馈卡顿，先把这个数调小，或改成「只渲染当前 ±1 张」的自研播放器。
 */
const MAX_PHOTOS = 60
/** 从库里拉多少行来筛：视频会被剔掉，所以多拉一些垫着 */
const FETCH_LIMIT = 100
/**
 * 本机记住「上次选的背景声」。空串 = 关闭（默认）。
 * 存用户偏好而不是存服务端：它是个纯粹的本机听感选择，换设备没必要跟着走。
 */
const BGM_STORAGE_KEY = 'babyup.slideshowBgm'

const store = useAuthStore()

const loading = ref(true)
/** 本次可用的照片池（已剔除视频），选片和「全部播放」都从这里面取 */
const photos = ref([])
/** 用户勾选的 id；**空数组 = 全部播放**（默认状态） */
const picked = ref([])
/** 选片面板开着没有 */
const picking = ref(false)

/* ---------- 背景声 ---------- */
/**
 * 背景声入口是否显示：既要环境支持（微信端），也要功能开关开着。
 * 开关是留的合规退路 —— 放映配乐比安睡音更像「音乐播放」，万一审核卡类目，
 * 在运维后台点一下就能整块收起，不用重新发版。
 */
const bgmAvailable = computed(() => isBgmSupported() && flagEnabled('slideshowBgm'))
/** 内置的 13 首 + 自己存的；和安睡音用的是同一份清单 */
const bgmSounds = computed(() => listSounds())
/** 选中的曲子 key；空串 = 关闭（默认）。onLoad 里从本机偏好读 */
const bgmKey = ref('')
const bgmPanel = ref(false)
const bgmPlaying = ref(false)
const bgmLoading = ref(false)
/** 播放器实例；懒创建，退出页面时销毁 */
let bgmPlayer = null

const index = ref(0)
const playing = ref(true)
/** 顶栏名字；由入口页传进来，省一次「查家庭/宝宝名」的请求 */
const title = ref('')
/** custom 导航栏：自己留出状态栏高度，否则顶栏会被手机的时钟/电量压住 */
const statusBarHeight = ref(20)
/** 屏幕宽度，用来算「胶囊左边离右边多远」 */
const windowWidth = ref(375)
/** 右上角胶囊的位置；读不到就退化成「只留状态栏高度」 */
const menuRect = ref(null)

try {
  const info = typeof uni.getWindowInfo === 'function' ? uni.getWindowInfo() : uni.getSystemInfoSync()
  if (info && info.statusBarHeight) statusBarHeight.value = info.statusBarHeight
  if (info && info.windowWidth) windowWidth.value = info.windowWidth
} catch (err) {
  // 读不到就用默认值，顶栏只是稍微偏上一点，不影响看
  console.warn('[Slideshow] 读状态栏高度失败，用默认值', err)
}

try {
  if (typeof uni.getMenuButtonBoundingClientRect === 'function') {
    const rect = uni.getMenuButtonBoundingClientRect()
    if (rect && rect.width) menuRect.value = rect
  }
} catch (err) {
  console.warn('[Slideshow] 读胶囊位置失败，顶栏不预留胶囊区域', err)
}

/**
 * 顶栏（和选片面板的标题栏）的样式。
 *
 * ⚠️ 必须避开右上角的微信胶囊：`navigationStyle: custom` 下胶囊浮在最上层，
 * 点击优先级也最高 —— 底下的按钮一旦和它重叠，用户点按钮就会点出胶囊的分享菜单（踩过）。
 * 所以：① 可点的元素不往右上角放；② 这里把胶囊那一整块用 padding-right 让出来，
 * 顺便把顶栏的上下留白对齐胶囊，视觉上齐平。
 */
const topBarStyle = computed(() => {
  const rect = menuRect.value
  if (!rect) return { paddingTop: statusBarHeight.value + 'px' }
  const gap = Math.max(0, rect.top - statusBarHeight.value)
  return {
    paddingTop: rect.top + 'px',
    paddingBottom: gap + 'px',
    // 胶囊左边到屏幕右边缘的距离 + 8px 间隙
    paddingRight: windowWidth.value - rect.left + 8 + 'px',
  }
})

/**
 * 实际要播的序列。
 * 没勾过（`picked` 为空）→ 全部播放；勾过 → 只播勾中的，**按原有的时间顺序**排，
 * 不按点击顺序 —— 幻灯片是「时间流」，顺序要和时间轴一致。
 */
const items = computed(() => {
  if (!picked.value.length) return photos.value
  const ids = picked.value
  return photos.value.filter((photo) => ids.indexOf(photo.id) >= 0)
})

// 换了播放集合（从全部切成选中的几张，或反过来）就从头开始，别停在上一个集合的序号上
watch(items, () => {
  index.value = 0
  restartProgress()
})

/* ---------- 进度条 ---------- */

/**
 * 当前这张照片的播放进度（0~1），直接写进 bar-fill 的 transform。
 *
 * ⚠️ 为什么不用 CSS 动画：原来靠「给 bar-fill 绑 :key，换一张就重建元素、动画重头跑一遍」，
 * 但**微信小程序的渲染层不会因为普通元素（非 v-for 项）的 key 变化而重建节点** ——
 * 于是只有第一张动过一次，之后就一直停在 animation-fill-mode: forwards 的满格上（踩过）。
 * 改成用定时器算 elapsed、写到 transform：行为可控，暂停/继续也能精确冻在中途。
 */
const progress = ref(0)
/** 刷新间隔：一张 4 秒，60ms 约刷 60 多次，够顺滑又不费 */
const TICK_MS = 60
let tickTimer = 0
/** 当前这张已经播了多少毫秒（暂停时保留，继续时接着走） */
let elapsed = 0
let lastTick = 0

function stopTick() {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = 0
  }
}

function startTick() {
  stopTick()
  if (!playing.value) return
  lastTick = Date.now()
  tickTimer = setInterval(() => {
    const now = Date.now()
    elapsed += now - lastTick
    lastTick = now
    if (elapsed >= INTERVAL) {
      // 满格就收手：剩下的交给 swiper 的 autoplay 翻页，翻完 onChange 再从头来过
      elapsed = INTERVAL
      progress.value = 1
      stopTick()
      return
    }
    progress.value = elapsed / INTERVAL
  }, TICK_MS)
}

/** 换了一张：进度归零，正在播就接着跑 */
function restartProgress() {
  elapsed = 0
  progress.value = 0
  startTick()
}

// 暂停/继续统一在这里收口（播放按钮、点画面、选片面板都改的是 playing）
watch(playing, (on) => {
  if (on) startTick()
  else stopTick()
})

/**
 * 说明文字用到的两个小格式化，都放在模板里按需调用（一行就一点计算，不做缓存）。
 * 拿不到值的场合一律返回空串，模板据此不渲染那一截 —— 缺日期就只显示月龄，
 * 缺月龄就只显示日期，都没有就整行不出现。
 */

/** 拍摄日期，'2026年9月17日' */
function dateText(item) {
  const day = formatDate(item.taken_at)
  if (!day) return ''
  const parts = day.split('-')
  return `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日`
}

/** 拍这张照片时的月龄；宝宝生日没填时 formatAge 返回空串 */
function ageText(item) {
  const baby = store.baby
  if (!baby || !baby.birthday) return ''
  return formatAge(baby.birthday, item.taken_at)
}

/** 选片网格里的短日期，'9/17'；同一年就不显示年份，格子小 */
function shortDate(photo) {
  const day = formatDate(photo.taken_at)
  if (!day) return ''
  const parts = day.split('-')
  const thisYear = String(new Date().getFullYear())
  return parts[0] === thisYear ? `${Number(parts[1])}/${Number(parts[2])}` : `${parts[0].slice(2)}/${Number(parts[1])}`
}

function goBack() {
  // 直接点分享卡片进来时没有上一页，退回时光页兜住
  uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/index/index' }) })
}

/** 暂停 / 继续；点画面和点按钮是同一个动作 */
function togglePlay() {
  playing.value = !playing.value
}

function onChange(event) {
  index.value = event.detail.current
  // 新的一张进场：进度从头开始（swiper 自动翻页和手动左右滑都走这里）
  restartProgress()
}

/** 单张加载失败就把地址清掉，让那一张显示占位，而不是一直转圈 */
function onImageError(item) {
  item.url = ''
}

/* ---------- 选片 ---------- */

/** 打开选片时先暂停（正在播的动画会干扰一眼看清格子），关掉时恢复原来的状态 */
let wasPlaying = false

function openPick() {
  wasPlaying = playing.value
  playing.value = false
  picking.value = true
}

function closePick() {
  picking.value = false
  playing.value = wasPlaying
}

function isPicked(photo) {
  return picked.value.indexOf(photo.id) >= 0
}

function togglePick(photo) {
  if (isPicked(photo)) {
    picked.value = picked.value.filter((id) => id !== photo.id)
    return
  }
  picked.value = picked.value.concat(photo.id)
}

function pickAll() {
  picked.value = photos.value.map((photo) => photo.id)
}

/** 清空 = 回到默认的「全部播放」，而不是「一张都不播」 */
function clearPick() {
  picked.value = []
}

/* ---------- 背景声 ---------- */

/** 上一条已经弹过的错误文案，避免同一个错误反复弹 toast */
let lastBgmError = ''

function readBgmPref() {
  try {
    const saved = uni.getStorageSync(BGM_STORAGE_KEY)
    if (saved && findSound(saved)) bgmKey.value = saved
  } catch (err) {
    console.warn('[Slideshow] 读取背景声偏好失败，按关闭处理', err)
  }
}

function writeBgmPref(key) {
  try {
    uni.setStorageSync(BGM_STORAGE_KEY, key)
  } catch (err) {
    console.warn('[Slideshow] 保存背景声偏好失败', err)
  }
}

/** 播放器懒创建：只有真的选了曲子才会用到 */
function ensureBgmPlayer() {
  if (bgmPlayer) return bgmPlayer
  bgmPlayer = createBgmPlayer({
    onChange: (state) => {
      bgmPlaying.value = state.playing
      bgmLoading.value = state.loading
      if (state.error && state.error !== lastBgmError) {
        uni.showToast({ title: state.error, icon: 'none' })
      }
      lastBgmError = state.error
    },
  })
  return bgmPlayer
}

function openBgm() {
  bgmPanel.value = true
}

/** 选了某一首（或空串 = 关闭）：立刻生效并记住 */
function pickBgm(key) {
  bgmKey.value = key
  writeBgmPref(key)
  bgmPanel.value = false
  if (!key) {
    stopBgm()
    return
  }
  const player = ensureBgmPlayer()
  const sound = findSound(key)
  if (player && sound) player.play(sound)
}

/**
 * onShow 里用：按记住的偏好把声音放起来。
 * 已经放着就不重来 —— 否则从后台切回来会从头响一遍，接不上。
 */
function startBgm() {
  if (!bgmAvailable.value || !bgmKey.value) return
  const sound = findSound(bgmKey.value)
  const player = ensureBgmPlayer()
  if (player && sound && !player.playing) player.play(sound)
}

function stopBgm() {
  if (bgmPlayer) bgmPlayer.pause()
}

onLoad((options) => {
  const raw = (options && options.title) || ''
  try {
    title.value = raw ? decodeURIComponent(raw) : ''
  } catch (err) {
    console.warn('[Slideshow] title 参数解析失败，按原文使用', err)
    title.value = raw
  }
  // 先读本机的自定义音源，否则「上次选的正好是自己存的」会查不到
  loadCustomSounds()
  readBgmPref()
  load()
})

onShow(() => {
  ensurePageAccess(PAGE_PATH)
  startBgm()
  // 从后台切回来：进度接着冻住的那一点继续走。定时器在 onHide 里已停 —— 否则
  // 「离开多久」会被一次性算进 elapsed，直接顶到满格。
  if (items.value.length && playing.value) startTick()
})

/**
 * 切到别的应用 / 息屏就停声。
 * 背景声本来就只在前台有意义，这里主动停既是省电，也避免「退出了还在响」。
 * 进度定时器一并停掉，理由见 onShow。
 */
onHide(() => {
  stopBgm()
  stopTick()
})

onUnload(() => {
  stopBgm()
  stopTick()
  if (bgmPlayer) {
    bgmPlayer.destroy()
    bgmPlayer = null
  }
})

async function load() {
  const membership = store.membership
  const baby = store.baby
  if (!membership || !baby) {
    loading.value = false
    return
  }
  try {
    const { items: rows } = await listPhotos({
      familyId: membership.family_id,
      babyId: baby.id,
      limit: FETCH_LIMIT,
      offset: 0,
    })
    // 只放照片：视频在幻灯片里没法自动播（点了才出声），混进来会停在那儿不动
    photos.value = (rows || [])
      .filter((row) => row.media_type !== 'video' && row.url)
      .slice(0, MAX_PHOTOS)
    console.log('[Slideshow] 可放映照片', photos.value.length)
  } catch (err) {
    console.error('[Slideshow] 加载照片失败', err)
    uni.showToast({ title: err.message || '加载失败，请重试', icon: 'none' })
  } finally {
    loading.value = false
  }
}

/**
 * 分享这一场放映：家人点开卡片就是同一个全屏播放页。
 *
 * ⚠️ 两个已知点：
 *   1. 已登录的家人直接进得来；没登录的会被路由守卫送去登录页，登录后落在记录页（不是这里）—— 与项目里其它分享一致。
 *   2. **分享的是「全部」，不带你这次勾选的那几张** —— 把一串 id 塞进 path 既长又易失效，先不做。
 */
onShareAppMessage(() => ({
  title: `宝宝时光 · ${title.value || '放映'}`,
  path: `/pkg/slideshow/slideshow?title=${encodeURIComponent(title.value || '宝宝时光')}`,
}))
</script>

<style scoped>
/* 放映页走深色：照片在浅底上会被背景抢走注意力 */
.page {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background-color: #111111;
}

.stage,
.frame {
  width: 100%;
  height: 100%;
}

/* 说明层是绝对定位，得有个定位基准（swiper-item 默认不保证是 relative） */
.frame {
  position: relative;
}

.frame-img {
  width: 100%;
  height: 100%;
  transform-origin: center center;
}

/*
 * 缓慢放大（Ken Burns）—— 照片电影最标志性的那个动效。
 *
 * 只有「当前这张」挂这个类：切到时才从头跑一遍。要是所有图都挂上，
 * 它们在进页面那一刻就一起把动画跑完了，之后每一张都是静止的，等于白做。
 */
.frame-img--zoom {
  animation-name: ken-burns;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}

.frame-img--paused {
  animation-play-state: paused;
}

@keyframes ken-burns {
  from {
    transform: scale(1);
  }

  to {
    transform: scale(1.08);
  }
}

.frame-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.frame-fallback-text {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.6);
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
}

.state-text {
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.75);
}

.state-btn {
  padding: 16rpx 56rpx;
  margin-top: var(--space-lg);
  border: 1rpx solid rgba(255, 255, 255, 0.35);
  border-radius: var(--radius-pill);
}

.state-btn-text {
  font-size: 28rpx;
  color: #ffffff;
}

.top {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  /* padding-top / padding-bottom / padding-right 由 topBarStyle 内联给
     （要按胶囊的位置和高度算），这里只管左边距 */
  padding-left: var(--space-lg);
}

.top-back {
  width: 64rpx;
  font-size: 46rpx;
  line-height: 1;
  color: #ffffff;
}

.top-title {
  flex: 1;
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.9);
}

/*
 * 背景声按钮。位置在标题右侧 —— 也就是 topBarStyle 让出来的胶囊左边，
 * 不会和微信胶囊（···）重叠。
 */
.top-music {
  padding: 6rpx 20rpx;
  margin-left: var(--space-sm);
  font-size: 32rpx;
  line-height: 1.2;
  color: rgba(255, 255, 255, 0.6);
  background-color: rgba(255, 255, 255, 0.14);
  border-radius: var(--radius-pill);
}

/* 真的在响：整颗按钮点亮，一眼看出「有声音」 */
.top-music--on {
  color: #ffffff;
  background-color: var(--color-primary);
}

/* 正在准备（首次要下载音频）：半透明，别让人以为点了没反应 */
.top-music--busy {
  opacity: 0.5;
}

.bottom {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  padding: var(--space-md) var(--space-lg) calc(var(--space-lg) + env(safe-area-inset-bottom));
}

/*
 * 照片说明层。
 *
 * 贴着底边，底下留出控制条的高度（进度条 + 播放按钮约 150rpx），
 * 所以那层「由透明到黑」的渐变是从照片中部一直铺到最底下 ——
 * 白字落在深色渐变上，深色浅色照片都能看清，控制条也顺带有了底衬。
 */
.caption {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  padding: var(--space-xl) var(--space-lg) calc(150rpx + env(safe-area-inset-bottom));
  background-image: linear-gradient(to bottom, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.78));
}

.caption-line {
  display: flex;
  flex-direction: row;
  align-items: baseline;
}

.caption-date {
  font-size: 34rpx;
  font-weight: 600;
  color: #ffffff;
  text-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.55);
}

.caption-age {
  margin-left: 12rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.78);
  text-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.55);
}

.caption-note {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.88);
  text-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.55);
}

.bar {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.bar-track {
  flex: 1;
  height: 6rpx;
  margin-right: var(--space-md);
  overflow: hidden;
  background-color: rgba(255, 255, 255, 0.25);
  border-radius: var(--radius-pill);
}

/*
 * 进度条的填充。宽度铺满，靠 transform: scaleX(0~1) 从左往右长（比改 width 触发重排便宜）。
 * 值由 JS 按「这张已播了多久」写进内联 style（见 script 的 startTick）——
 * 不能用 CSS 动画：mp 里普通元素的 key 变化不会重建节点，动画只会跑第一张（踩过）。
 */
.bar-fill {
  width: 100%;
  height: 6rpx;
  background-color: #ffffff;
  transform: scaleX(0);
  transform-origin: left center;
}

.bar-count {
  margin-right: var(--space-sm);
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.7);
}

/*
 * 「选片」放在这儿而不是顶栏 —— 顶栏右上角是微信胶囊（···），
 * 按钮和它重叠时点上去会弹出胶囊的分享菜单（踩过）。
 * 底部操作条既没有遮挡，也离拇指更近。
 */
.bar-pick {
  padding: 8rpx 22rpx;
  margin-right: var(--space-sm);
  font-size: 24rpx;
  color: #ffffff;
  background-color: rgba(255, 255, 255, 0.18);
  border-radius: var(--radius-pill);
}

.play {
  padding: 12rpx 34rpx;
  background-color: rgba(255, 255, 255, 0.18);
  border-radius: var(--radius-pill);
}

.play-text {
  font-size: 26rpx;
  color: #ffffff;
}

/* ---------- 选片面板 ---------- */

.picker {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  background-color: #111111;
}

.picker-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  /* 和顶栏同一套内联间距：右上角的关闭按钮也要避开微信胶囊 */
  padding-left: var(--space-lg);
}

.picker-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #ffffff;
}

.picker-count {
  flex: 1;
  margin-left: var(--space-sm);
  font-size: 23rpx;
  color: rgba(255, 255, 255, 0.6);
}

.picker-close {
  padding: 8rpx 12rpx;
  font-size: 32rpx;
  color: rgba(255, 255, 255, 0.8);
}

/*
 * scroll-view 必须有一个「确定的高度」才会滚动，光靠 flex: 1 在微信端不保险（踩过：
 * 选片列表滑不动）。所以外面套一层普通 view —— flex: 1 的普通 view 能拿到剩余高度，
 * 再让 scroll-view 用绝对定位铺满它，高度就确定了。
 */
.picker-body {
  position: relative;
  flex: 1;
  overflow: hidden;
}

.picker-grid {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 0 var(--space-sm);
  box-sizing: border-box;
}

.picker-inner {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.picker-cell {
  position: relative;
  width: 33.33%;
  padding: var(--space-xs);
  box-sizing: border-box;
}

.picker-img {
  width: 100%;
  height: 220rpx;
  background-color: rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-md);
}

/* 选中态：外圈描边 + 右下角一个勾，隔着缩略图也能一眼看出选没选 */
.picker-tick {
  position: absolute;
  right: 18rpx;
  bottom: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40rpx;
  height: 40rpx;
  background-color: var(--color-primary);
  border-radius: 50%;
}

.picker-tick-text {
  font-size: 24rpx;
  color: #ffffff;
}

.picker-date {
  position: absolute;
  bottom: 22rpx;
  left: 22rpx;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.85);
  text-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.6);
}

.picker-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-md) var(--space-lg) calc(var(--space-lg) + env(safe-area-inset-bottom));
}

.picker-link {
  margin-right: var(--space-lg);
  font-size: 27rpx;
  color: rgba(255, 255, 255, 0.8);
}

.picker-done {
  flex: 1;
  padding: 20rpx 0;
  text-align: center;
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.picker-done-text {
  font-size: 29rpx;
  font-weight: 600;
  color: #ffffff;
}

/* ---------- 背景声面板 ---------- */

/*
 * 底部抽屉。z-index 要压过选片面板（10），理论上两者不会同时开，
 * 但真撞上了也应该是最新点开的那个盖在上面。
 */
.bgm-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background-color: rgba(0, 0, 0, 0.5);
}

.bgm-sheet {
  padding: var(--space-lg) var(--space-lg) calc(var(--space-lg) + env(safe-area-inset-bottom));
  background-color: #1c1c1e;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.bgm-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: var(--space-md);
}

.bgm-title {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: #ffffff;
}

.bgm-close {
  padding: 8rpx 12rpx;
  font-size: 32rpx;
  color: rgba(255, 255, 255, 0.8);
}

/*
 * 音源网格：3 列，与安睡音页的排法一致（关掉 + 9 首 = 10 格，排 4 行）。
 * 用网格而不是竖排列表 —— 10 项竖排在小屏上会顶破屏幕。
 */
.bgm-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
}

.bgm-cell {
  width: 31.5%;
  padding: 18rpx 14rpx;
  margin-bottom: var(--space-sm);
  box-sizing: border-box;
  background-color: rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-md);
}

/* 选中态：整格换成主题色，比只描个边好认 */
.bgm-cell--on {
  background-color: var(--color-primary);
}

.bgm-cell-name {
  font-size: 26rpx;
  color: #ffffff;
}

.bgm-cell-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 20rpx;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.62);
}

.bgm-cell--on .bgm-cell-desc {
  color: rgba(255, 255, 255, 0.85);
}

.bgm-hint {
  display: block;
  margin-top: var(--space-xs);
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.5);
}
</style>
