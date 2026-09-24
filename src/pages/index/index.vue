<template>
  <view class="page">
    <!-- 宝宝信息头：整块可点，弹出「家人环绕」守护动画 -->
    <view class="hero" @click="openOrbit">
      <view class="hero-avatar">
        <image v-if="babyAvatar" class="hero-avatar-img" :src="babyAvatar" mode="aspectFill" />
        <text v-else-if="babyInitial" class="hero-avatar-text">{{ babyInitial }}</text>
      </view>
      <view class="hero-info">
        <text class="hero-name">{{ babyName }}</text>
        <text class="hero-sub">{{ babySub }}</text>
      </view>
    </view>

    <!-- AI 观察：从记录里主动发现一件值得说的事（规则判断，见 services/ai-insight.js） -->
    <view v-if="insight" class="insight" :class="{ 'insight--warn': insight.warn }" @click="goAiChat">
      <view class="insight-head">
        <text class="insight-glyph">AI</text>
        <text class="insight-title">AI 观察</text>
      </view>
      <text class="insight-text">{{ insight.text }}</text>
      <text v-if="aiReady" class="insight-more">去 AI 助手里聊聊 ›</text>
    </view>

    <!-- 顶部幻灯片：进入本页自动轮播最近的照片（视频显示封面） -->
    <swiper
      v-if="slides.length"
      class="slides"
      :autoplay="slides.length > 1"
      :circular="slides.length > 1"
      :interval="3000"
      :duration="600"
      :indicator-dots="slides.length > 1"
      indicator-color="rgba(255, 255, 255, 0.45)"
      indicator-active-color="#ffffff"
    >
      <swiper-item v-for="item in slides" :key="item.id" class="slide" @click="openPhoto(item)">
        <image
          v-if="item.cover_url || item.url"
          class="slide-img"
          :src="item.cover_url || item.url"
          mode="aspectFill"
          @error="onImageError(item)"
        />
        <view v-else class="slide-fallback">
          <text class="cell-fallback-text">图片加载失败</text>
        </view>
        <view v-if="item.media_type === 'video'" class="slide-badge">
          <text class="slide-badge-text">▶</text>
        </view>
      </swiper-item>
    </swiper>

    <!-- 空态 -->
    <view v-if="!groups.length && !loading" class="empty">
      <view class="empty-icon" />
      <text class="empty-title">还没有记录</text>
      <text class="empty-desc">
        {{ canWrite ? '点右下角按钮，拍下宝宝的第一张照片' : '家人记录的照片会出现在这里' }}
      </text>
    </view>

    <!-- 视图切换：按月分组（三列方格）/ 全部（瀑布流） -->
    <view v-if="photos.length" class="modes">
      <view
        v-for="item in VIEW_MODES"
        :key="item.key"
        class="mode"
        :class="{ 'mode--active': viewMode === item.key }"
        @click="viewMode = item.key"
      >
        <text class="mode-text" :class="{ 'mode-text--active': viewMode === item.key }">
          {{ item.label }}
        </text>
      </view>
    </view>

    <!-- 按月分组：三列方格，缩略图统一裁成正方形 -->
    <template v-if="viewMode === 'month'">
      <view v-for="group in groups" :key="group.key" class="group">
        <text class="group-title">{{ group.label }}</text>
        <view class="grid">
          <view v-for="photo in group.items" :key="photo.id" class="cell grid-cell" @click="openPhoto(photo)">
            <image
              v-if="photo.cover_url || photo.url"
              class="cell-img"
              :src="photo.cover_url || photo.url"
              mode="aspectFill"
              @error="onImageError(photo)"
            />
            <view v-else class="cell-fallback">
              <text class="cell-fallback-text">{{ photo.media_type === 'video' ? '视频' : '图片加载失败' }}</text>
            </view>
            <view v-if="photo.media_type === 'video'" class="cell-badge">
              <text class="cell-badge-text">▶</text>
            </view>
          </view>
        </view>
      </view>
    </template>

    <!-- 全部：不分组，三列瀑布流，按原图比例排布 -->
    <view v-else class="waterfall">
      <view v-for="(column, columnIndex) in allColumns" :key="columnIndex" class="waterfall-col">
        <view
          v-for="photo in column"
          :key="photo.id"
          class="cell waterfall-cell"
          :style="cellStyle(photo)"
          @click="openPhoto(photo)"
        >
          <image
            v-if="photo.cover_url || photo.url"
            class="cell-img"
            :src="photo.cover_url || photo.url"
            mode="aspectFill"
            @load="onImageLoad(photo, $event)"
            @error="onImageError(photo)"
          />
          <view v-else class="cell-fallback">
            <text class="cell-fallback-text">{{ photo.media_type === 'video' ? '视频' : '图片加载失败' }}</text>
          </view>
          <view v-if="photo.media_type === 'video'" class="cell-badge">
            <text class="cell-badge-text">▶</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="loading" class="footer">
      <text class="footer-text">加载中…</text>
    </view>
    <view v-else-if="photos.length && !hasMore" class="footer">
      <text class="footer-text">没有更多了</text>
    </view>

    <PhotoComposer v-if="canWrite" ref="composer" @saved="onPhotoSaved" />

    <FamilyOrbit ref="orbit" />

    <!-- 悬浮「+」：可以拖着换位置，见 onFabTouchStart 那一组；轻点仍然是拍照 -->
    <view
      v-if="canWrite"
      class="fab"
      :class="{ 'fab--dragging': fabDragging }"
      :style="fabStyle"
      @touchstart.stop="onFabTouchStart"
      @touchmove.stop.prevent="onFabTouchMove"
      @touchend.stop="onFabTouchEnd"
    >
      <text class="fab-plus">+</text>
    </view>

    <AppTabBar />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow, onHide, onPullDownRefresh, onReachBottom, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { listPhotos } from '@/services/photo'
import { formatAge } from '@/utils/age'
import { localMonth } from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'
import PhotoComposer from '@/components/PhotoComposer/index.vue'
import FamilyOrbit from '@/components/FamilyOrbit/index.vue'
import AppTabBar from '@/components/AppTabBar/index.vue'
import { syncActiveTabFromRoute, TAB_BAR_HEIGHT } from '@/utils/tabbar'
import { buildInsight } from '@/services/ai-insight'
import { isAiChatAvailable } from '@/services/ai'

const PAGE_PATH = 'pages/index/index'
const PAGE_SIZE = 20
/**
 * 缓存有效期：图片地址签名只有 1 小时，超过这个时长就重新拉取（顺带重新签名），避免裂图。
 * 取得比 1 小时短，留出余量。
 */
const CACHE_TTL = 30 * 60 * 1000

const store = useAuthStore()

const photos = ref([])
const total = ref(0)
const loading = ref(false)
/** 是否成功加载过（失败时保持 false，下次显示会重试） */
const hasLoaded = ref(false)
/** 上次成功加载时的「家庭:宝宝」标记与时间，用于判断能否复用已有结果 */
const loadedKey = ref('')
const loadedAt = ref(0)

const composer = ref(null)
const orbit = ref(null)

const baby = computed(() => store.baby)
// 启动恢复家庭/宝宝上下文期间先不显示空态文案：多家庭多宝宝后要连查几张表，
// 期间直接渲染「还没有宝宝档案」会闪一下错误提示
const babyName = computed(() =>
  baby.value ? baby.value.name : store.initialized ? '还没有宝宝档案' : '',
)
const babyAvatar = computed(() => store.babyAvatarUrl)
/** 无档案时不显示首字占位，避免把空态文案的首字当成头像文字 */
const babyInitial = computed(() => (baby.value && baby.value.name ? baby.value.name.slice(0, 1) : ''))
const babySub = computed(() => {
  if (!baby.value) return store.initialized ? '去「我的」页完善宝宝资料' : ''
  // 补丁 Step 5：档案卡展示月龄（不足 1 岁「X个月X天」，满 1 岁「X岁X个月X天」）
  const age = formatAge(baby.value.birthday)
  if (!baby.value.birthday) return '未填写生日'
  return age ? `${age} · 生日 ${baby.value.birthday}` : `生日 ${baby.value.birthday}`
})

const hasMore = computed(() => photos.value.length < total.value)

/** 顶部幻灯片只取最近若干条，太多会让首屏变重 */
const SLIDE_COUNT = 20
const slides = computed(() => photos.value.slice(0, SLIDE_COUNT))

/** viewer 只读：不渲染拍照入口 */
const canWrite = computed(() => store.canWrite)

/** 视图模式：按月分组（原三列方格）/ 全部（瀑布流） */
const VIEW_MODES = [
  { key: 'month', label: '按月' },
  { key: 'all', label: '全部' },
]
const viewMode = ref('month')

/** 照片墙列数：3 列 */
const COLUMN_COUNT = 3
/** 瀑布流单元格默认高宽比：图片真实比例要等 @load 才知道，先用正方形占位，避免首屏高度为 0 */
const DEFAULT_ASPECT = 1
/** 高宽比上限：超过就按上限裁切（超长图在列表里只露一段，点开详情看全图） */
const MAX_ASPECT = 3

/** 图片真实高宽比缓存（photo.id → height / width） */
const imageRatios = ref({})

/** 按月模式：taken_at 倒序的结果按本地时区归月，跨月自动断组 */
const groups = computed(() => {
  const result = []
  photos.value.forEach((photo) => {
    const { key, label } = localMonth(photo.taken_at)
    const last = result[result.length - 1]
    if (!last || last.key !== key) {
      result.push({ key, label, items: [photo] })
    } else {
      last.items.push(photo)
    }
  })
  return result
})

/**
 * 全部模式：所有照片按顺序轮流分到 3 列——分列只看序号，不依赖图片比例，
 * 这样图片陆续加载出来时不会重新排版把位置换乱。
 */
const allColumns = computed(() => {
  const columns = Array.from({ length: COLUMN_COUNT }, () => [])
  photos.value.forEach((photo, index) => {
    columns[index % COLUMN_COUNT].push(photo)
  })
  return columns
})

/** 图片加载完成后记录真实比例，驱动 cellStyle 重算高度 */
function onImageLoad(photo, e) {
  const width = e && e.detail && e.detail.width
  const height = e && e.detail && e.detail.height
  if (!width || !height) return
  const ratio = height / width
  if (imageRatios.value[photo.id] === ratio) return
  imageRatios.value[photo.id] = ratio
}

/**
 * 单元格高度：用百分比 padding-top 撑出「列宽 × 高宽比」的高度
 * （百分比 padding 以容器宽度为基准），图片绝对定位铺满，超出部分被裁掉。
 */
function cellStyle(photo) {
  const raw = imageRatios.value[photo.id] || DEFAULT_ASPECT
  const ratio = Math.min(raw, MAX_ASPECT)
  return { paddingTop: `${(ratio * 100).toFixed(2)}%` }
}

function contextKey() {
  if (!store.membership || !store.baby) return ''
  return `${store.membership.family_id}:${store.baby.id}`
}

async function loadPage({ reset = false } = {}) {
  if (loading.value) return
  const key = contextKey()
  if (!key) {
    photos.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const offset = reset ? 0 : photos.value.length
    const { items, total: count } = await listPhotos({
      familyId: store.membership.family_id,
      babyId: store.baby.id,
      limit: PAGE_SIZE,
      offset,
    })
    photos.value = reset ? items : photos.value.concat(items)
    total.value = count
    hasLoaded.value = true
    loadedKey.value = key
    loadedAt.value = Date.now()
    if (reset) store.clearTimelineDirty()
    console.log('[Timeline] 已加载照片', photos.value.length, '/', total.value)
  } catch (err) {
    console.error('[Timeline] 加载照片失败', err)
    uni.showToast({ title: err.message || '加载失败，请重试', icon: 'none' })
  } finally {
    loading.value = false
  }
}

/**
 * 是否需要重新拉取。
 * 数据没变就复用上次结果，避免「去别的页面再回来」也重新请求；家人新增的照片靠下拉刷新看到。
 */
function shouldReload() {
  if (!hasLoaded.value) return true
  if (contextKey() !== loadedKey.value) return true
  if (store.timelineDirty) return true
  return Date.now() - loadedAt.value > CACHE_TTL
}

/* ---------- 悬浮「+」：可拖动 ---------- */

const FAB_SIZE = 112
/** 贴边时离屏幕边缘的距离（rpx） */
const FAB_EDGE = 48
/** 「+」下面要留出的空隙（rpx），叠在底栏之上，别贴着底栏 */
const FAB_BOTTOM_GAP = 40
/** 手指位移超过这个值（px）才算拖动，否则当作点击 */
const FAB_DRAG_THRESHOLD = 6
const FAB_STORAGE_KEY = 'home_fab_pos'

/** 页面可视区（rpx）：750rpx 恒等于屏幕宽度，据此做 px → rpx 的换算 */
const FAB_SYSTEM = uni.getSystemInfoSync()
const FAB_RPX_PER_PX = 750 / FAB_SYSTEM.windowWidth
const FAB_VIEW = {
  width: FAB_SYSTEM.windowWidth * FAB_RPX_PER_PX,
  height: FAB_SYSTEM.windowHeight * FAB_RPX_PER_PX,
}
/** 底部安全区（rpx）：有 home indicator 的机型，底栏实际比横条高这么多 */
const FAB_SAFE_BOTTOM = FAB_SYSTEM.safeArea
  ? Math.max((FAB_SYSTEM.windowHeight - FAB_SYSTEM.safeArea.bottom) * FAB_RPX_PER_PX, 0)
  : 0
/** 「+」的底边最多能压到哪：底栏 + 安全区 + 空隙，再往下就会被底栏挡住 */
const FAB_BOTTOM_LIMIT = TAB_BAR_HEIGHT + FAB_SAFE_BOTTOM + FAB_BOTTOM_GAP

/** 把位置收进可视区：左右不越界，底部不侵入底栏 */
function clampFabPos(pos) {
  const maxLeft = Math.max(FAB_VIEW.width - FAB_SIZE - FAB_EDGE, FAB_EDGE)
  const maxTop = Math.max(FAB_VIEW.height - FAB_SIZE - FAB_BOTTOM_LIMIT, 0)
  return {
    left: Math.min(Math.max(pos.left, FAB_EDGE), maxLeft),
    top: Math.min(Math.max(pos.top, 0), maxTop),
  }
}

/** 默认停在右下角、底栏之上（顶到 FAB_BOTTOM_LIMIT + 边距） */
function defaultFabPos() {
  return clampFabPos({
    left: FAB_VIEW.width - FAB_SIZE - FAB_EDGE,
    top: FAB_VIEW.height - FAB_SIZE - FAB_BOTTOM_LIMIT,
  })
}

/** 上次拖到哪儿了；没存过或读失败就用默认位置 */
function readSavedFabPos() {
  try {
    const saved = uni.getStorageSync(FAB_STORAGE_KEY)
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') return clampFabPos(saved)
  } catch (err) {
    console.error('[Timeline] 读取悬浮按钮位置失败', err)
  }
  return null
}

const fabPos = ref(readSavedFabPos() || defaultFabPos())
/** 拖动中：关掉过渡动画，否则按钮会「追」着手指走 */
const fabDragging = ref(false)
const fabStyle = computed(() => ({ left: `${fabPos.value.left}rpx`, top: `${fabPos.value.top}rpx` }))

/** 一次触摸的过程：记下手指起点和按钮起点，顺便判断这次是拖还是点 */
let fabDrag = null

function onFabTouchStart(e) {
  const touch = e.touches && e.touches[0]
  if (!touch) return
  fabDrag = { x: touch.clientX, y: touch.clientY, left: fabPos.value.left, top: fabPos.value.top, moved: false }
}

function onFabTouchMove(e) {
  const touch = e.touches && e.touches[0]
  if (!fabDrag || !touch) return
  const dx = touch.clientX - fabDrag.x
  const dy = touch.clientY - fabDrag.y
  // 越过阈值才跟着走：手指按下去时的轻微抖动不该让按钮跳一下
  if (!fabDrag.moved && Math.abs(dx) < FAB_DRAG_THRESHOLD && Math.abs(dy) < FAB_DRAG_THRESHOLD) return
  fabDrag.moved = true
  fabDragging.value = true
  fabPos.value = clampFabPos({
    left: fabDrag.left + dx * FAB_RPX_PER_PX,
    top: fabDrag.top + dy * FAB_RPX_PER_PX,
  })
}

function onFabTouchEnd() {
  if (!fabDrag) return
  const moved = fabDrag.moved
  fabDrag = null
  fabDragging.value = false
  // 没越过阈值就是一次普通点击，照旧弹拍照选项
  if (!moved) {
    onCapture()
    return
  }
  // 松手后吸到最近的一条竖边，并把位置存下来，下次进来还在这儿
  const snapped = clampFabPos({
    left: fabPos.value.left + FAB_SIZE / 2 < FAB_VIEW.width / 2 ? FAB_EDGE : FAB_VIEW.width - FAB_SIZE - FAB_EDGE,
    top: fabPos.value.top,
  })
  fabPos.value = snapped
  try {
    uni.setStorageSync(FAB_STORAGE_KEY, snapped)
  } catch (err) {
    console.error('[Timeline] 保存悬浮按钮位置失败', err)
  }
}

/** 「+」号先弹选项：照片可多选，视频一次一段（需要单独压缩与时长校验） */
function onCapture() {
  if (!store.baby) {
    uni.showToast({ title: '请先创建宝宝档案', icon: 'none' })
    return
  }
  uni.showActionSheet({
    itemList: ['照片（可多选）', '视频'],
    success: (res) => {
      if (!composer.value) return
      if (res.tapIndex === 0) composer.value.open()
      else if (res.tapIndex === 1) composer.value.openVideo()
    },
    fail: (err) => {
      // 用户点空白处取消不算异常
      if (!/cancel/i.test((err && err.errMsg) || '')) console.error('[Timeline] 选项菜单异常', err)
    },
  })
}

function onPhotoSaved() {
  loadPage({ reset: true })
}

/** 家人环绕动画：成员取自 store（bootstrap 时已缓存），此处不发请求 */
function openOrbit() {
  if (!store.baby) {
    uni.showToast({ title: '请先创建宝宝档案', icon: 'none' })
    return
  }
  if (orbit.value) orbit.value.open()
}

function openPhoto(photo) {
  uni.navigateTo({ url: `/pages/photo-detail/photo-detail?id=${photo.id}` })
}

function onImageError(photo) {
  console.error('[Timeline] 图片加载失败', photo.id, photo.storage_path)
}

/* ---------- AI 观察 ---------- */

/** AI 助手只有云开发后端才有；没有时不显示「去聊聊」那个入口 */
const aiReady = isAiChatAvailable()
const insight = ref(null)
let insightKey = ''
let insightAt = 0

/**
 * 查一次「AI 观察」，显示在首页顶上。
 *
 * 规则都在 services/ai-insight.js 里 —— 刻意用规则而不是模型：观察要的是准，
 * 规则算错了能查，而且不花 AI 额度、打开就有。这里只负责按 TTL 复用，
 * 别每次切回首页都查一遍。
 */
async function loadInsight() {
  const familyId = store.membership ? store.membership.family_id : ''
  const babyId = store.baby ? store.baby.id : ''
  if (!familyId || !babyId) {
    insight.value = null
    return
  }
  const key = contextKey()
  if (insightKey === key && Date.now() - insightAt < CACHE_TTL) return
  insightKey = key
  insightAt = Date.now()
  insight.value = await buildInsight({ familyId, babyId })
}

/** 点卡片去 AI 助手追问：把观察对应的问题带上，进去就已填好，不用自己重打一遍 */
function goAiChat() {
  const question = insight.value && insight.value.question ? insight.value.question : ''
  const url = question
    ? `/pages/ai-chat/ai-chat?q=${encodeURIComponent(question)}`
    : '/pages/ai-chat/ai-chat'
  uni.navigateTo({
    url,
    fail: (err) => console.error('[Timeline] 打开 AI 助手失败', err),
  })
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  // 同步自定义底栏的高亮（底栏组件见 components/AppTabBar）
  syncActiveTabFromRoute()
  // 冷启动时 onShow 会早于 bootstrap 完成，这里确保家庭/宝宝上下文已就绪
  await store.bootstrap()
  // 数据没变就复用上次结果，避免「去别的页面再回来」也重新请求；
  // 自己改过照片、切换了家庭/宝宝、缓存超过 CACHE_TTL 时会自动重新拉取，家人新增的照片靠下拉刷新
  if (!contextKey()) return
  if (shouldReload()) await loadPage({ reset: true })
  // AI 观察：跟照片用同一套 TTL 复用
  await loadInsight()
})

// 离开本页时关掉环绕动画，避免动画在后台空转
onHide(() => {
  if (orbit.value) orbit.value.close()
})

onPullDownRefresh(async () => {
  await loadPage({ reset: true })
  uni.stopPullDownRefresh()
})

onReachBottom(() => {
  if (hasMore.value) loadPage()
})

// 补丁 Step 4：统一分享卡片（标题与落地页见 @/utils/share）
onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  position: relative;
  min-height: 100vh;
  padding: var(--space-lg);
  /* 给底部的自定义 tabBar 让位（横条 + 安全区 + 一点呼吸），否则滑到底最后一张卡被压住 */
  padding-bottom: calc(var(--tabbar-height) + constant(safe-area-inset-bottom) + var(--space-lg));
  padding-bottom: calc(var(--tabbar-height) + env(safe-area-inset-bottom) + var(--space-lg));
  box-sizing: border-box;
}

.hero {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-lg);
  margin-bottom: var(--space-lg);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.hero-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 108rpx;
  height: 108rpx;
  overflow: hidden;
  background-color: var(--color-primary-soft);
  border-radius: 50%;
}

.hero-avatar-img {
  width: 108rpx;
  height: 108rpx;
}

.hero-avatar-text {
  font-size: 44rpx;
  color: var(--color-primary);
}

.hero-info {
  display: flex;
  flex-direction: column;
  margin-left: var(--space-md);
}

.hero-name {
  font-size: 36rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.hero-sub {
  margin-top: var(--space-xs);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

/* AI 观察卡：平时素净，有值得留意的事时换成暖色描边 */
.insight {
  padding: var(--space-md);
  margin-bottom: var(--space-lg);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.insight--warn {
  background-color: #fff6f3;
  border: 1rpx solid rgba(244, 112, 63, 0.25);
  box-shadow: none;
}

.insight-head {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.insight-glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44rpx;
  height: 44rpx;
  margin-right: var(--space-xs);
  font-size: 20rpx;
  font-weight: 600;
  color: #ffffff;
  background-image: linear-gradient(135deg, #b9a6ff 0%, #8b6df0 55%, #7a5af8 100%);
  border-radius: var(--radius-sm);
}

.insight-title {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.insight-text {
  display: block;
  margin-top: var(--space-sm);
  font-size: 27rpx;
  line-height: 1.7;
  color: var(--color-text-main);
}

.insight-more {
  display: block;
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.slides {
  height: 420rpx;
  margin-bottom: var(--space-lg);
  overflow: hidden;
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
}

.slide {
  position: relative;
  width: 100%;
  height: 420rpx;
  overflow: hidden;
}

.slide-img {
  width: 100%;
  height: 420rpx;
}

.slide-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 420rpx;
  background-color: var(--color-bg-card);
}

.slide-badge {
  position: absolute;
  top: var(--space-sm);
  right: var(--space-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  background-color: rgba(0, 0, 0, 0.45);
  border-radius: 50%;
}

.slide-badge-text {
  font-size: 26rpx;
  color: #ffffff;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 140rpx var(--space-lg);
}

.empty-icon {
  width: 140rpx;
  height: 140rpx;
  margin-bottom: var(--space-lg);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-lg);
}

.empty-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.empty-desc {
  margin-top: var(--space-sm);
  font-size: 26rpx;
  color: var(--color-text-muted);
  text-align: center;
}

.group {
  margin-bottom: var(--space-lg);
}

.group-title {
  display: block;
  margin-bottom: var(--space-md);
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.modes {
  display: flex;
  flex-direction: row;
  width: 300rpx;
  padding: 6rpx;
  margin: 0 0 var(--space-md) auto;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.mode {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  height: 60rpx;
  border-radius: var(--radius-pill);
}

.mode--active {
  background-color: var(--color-primary-soft);
}

.mode-text {
  font-size: 25rpx;
  color: var(--color-text-sub);
}

.mode-text--active {
  font-weight: 600;
  color: var(--color-primary-deep);
}

.grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.waterfall {
  display: flex;
  flex-direction: row;
}

.waterfall-col {
  flex: 1;
  margin-right: 2%;
}

.waterfall-col:last-child {
  margin-right: 0;
}

/* 单元格通用外观，具体尺寸交给 grid-cell / waterfall-cell */
.cell {
  position: relative;
  overflow: hidden;
  background-color: var(--color-bg-card);
  border-radius: var(--radius-md);
}

/* 按月模式：三列方格，缩略图统一裁成正方形 */
.grid-cell {
  width: 32%;
  height: 220rpx;
  margin-right: 2%;
  margin-bottom: 2%;
}

.grid-cell:nth-child(3n) {
  margin-right: 0;
}

/*
 * 全部模式：高度为 0，靠行内 padding-top（列宽 × 高宽比）撑开，
 * 图片绝对定位铺满，超过上限的长图被 overflow 裁掉。
 */
.waterfall-cell {
  width: 100%;
  height: 0;
  margin-bottom: var(--space-sm);
}

.cell-img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.cell-fallback {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: var(--color-bg-page);
}

.cell-fallback-text {
  font-size: 22rpx;
  color: var(--color-text-muted);
}

.cell-badge {
  position: absolute;
  top: var(--space-xs);
  right: var(--space-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44rpx;
  height: 44rpx;
  background-color: rgba(0, 0, 0, 0.45);
  border-radius: 50%;
}

.cell-badge-text {
  font-size: 20rpx;
  color: #ffffff;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg) 0 160rpx;
}

.footer-text {
  font-size: 24rpx;
  color: var(--color-text-muted);
}

/* 位置由 fabStyle 的 left / top 决定（见脚本里的 clampFabPos），所以这里不写 right / bottom */
.fab {
  position: fixed;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 112rpx;
  height: 112rpx;
  background-color: var(--color-primary);
  border-radius: 50%;
  box-shadow: 0 12rpx 32rpx rgba(255, 143, 107, 0.4);
  /* 吸边和回到上次位置时平滑落位；拖动中由 .fab--dragging 关掉 */
  transition: left 0.22s ease, top 0.22s ease;
}

.fab--dragging {
  transition: none;
}

.fab-plus {
  margin-top: -6rpx;
  font-size: 64rpx;
  line-height: 1;
  color: #ffffff;
}
</style>
