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

    <!-- 顶部幻灯片：进入本页自动轮播最近的照片（视频显示封面） -->
    <view v-if="slides.length" class="slides-wrap">
      <swiper
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
            lazy-load
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

      <!-- 全屏放映入口：叠在轮播右上角，不多占一行版面 -->
      <view class="slides-play" @click.stop="openSlideshow">
        <text class="slides-play-text">▶ 放映</text>
      </view>
    </view>

    <!-- 空态（文件夹视图有自己的空态，见上面） -->
    <view v-if="viewMode !== 'album' && !groups.length && !loading" class="empty">
      <view class="empty-icon" />
      <text class="empty-title">还没有记录</text>
      <text class="empty-desc">
        {{ canWrite ? '点右下角按钮，拍下宝宝的第一张照片' : '家人记录的照片会出现在这里' }}
      </text>
    </view>

    <!-- 视图切换：全部 / 按月分组 / 文件管理 -->
    <view v-if="baby" class="modes">
      <view
        v-for="item in VIEW_MODES"
        :key="item.key"
        class="mode"
        :class="{ 'mode--active': viewMode === item.key }"
        @click="switchView(item.key)"
      >
        <text class="mode-text" :class="{ 'mode-text--active': viewMode === item.key }">
          {{ item.label }}
        </text>
      </view>
    </view>

    <!-- ---------- 文件夹视图：两层，先列表后内容 ---------- -->
    <template v-if="viewMode === 'album'">
      <!-- 第一层：文件夹列表。长按某一行可拖动排序，右侧「⋯」重命名 / 删除 -->
      <template v-if="!currentAlbumId">
        <view v-if="sortMode" class="sort-hint">
          <text class="sort-hint-text">长按拖动调整顺序</text>
          <text class="sort-hint-done" @click="quitSort">完成</text>
        </view>

        <view class="album-list">
          <!-- 「未分类」是固定入口，不是真实相册：没归过类的照片（含加本功能之前的老照片）都在这儿 -->
          <view class="album-row" @click="enterUnclassified">
            <view class="album-thumb">
              <image
                v-if="coverSrc(albumSummary.unclassified.cover)"
                class="album-thumb-img"
                :src="coverSrc(albumSummary.unclassified.cover)"
                mode="aspectFill"
                lazy-load
              />
              <text v-else class="album-thumb-glyph">未</text>
            </view>
            <view class="album-info">
              <text class="album-name">未分类</text>
              <text class="album-count">{{ albumSummary.unclassified.count }} 张</text>
            </view>
            <text class="album-arrow">›</text>
          </view>

          <view
            v-for="(album, index) in albums"
            :key="album.id"
            class="album-row"
            :class="{ 'album-row--dragging': sortMode && dragIndex === index }"
            @click="onAlbumRowTap(album)"
            @longpress="startSort(index, $event)"
            @touchmove="onSortMove"
            @touchend="endSort"
            @touchcancel="endSort"
          >
            <view class="album-thumb">
              <image
                v-if="coverSrc(albumCoverOf(album))"
                class="album-thumb-img"
                :src="coverSrc(albumCoverOf(album))"
                mode="aspectFill"
                lazy-load
              />
              <text v-else class="album-thumb-glyph">{{ album.name.slice(0, 1) }}</text>
            </view>
            <view class="album-info">
              <text class="album-name">{{ album.name }}</text>
              <text class="album-count">{{ albumCountOf(album) }} 张</text>
            </view>
            <text v-if="canWrite && !sortMode" class="album-more" @click.stop="openAlbumMenu(album)">⋯</text>
            <text v-else class="album-arrow">›</text>
          </view>
        </view>

        <view v-if="albumLoading" class="footer">
          <text class="footer-text">加载中…</text>
        </view>
        <view v-else-if="canWrite" class="album-new" @click="promptCreateAlbum()">
          <text class="album-new-text">+ 新建文件夹</text>
        </view>
        <view v-if="!albumLoading && !albums.length" class="album-tip">
          <text class="album-tip-text">
            还没有文件夹。建成「一岁」「二岁」这样，照片就能分开放了。
          </text>
        </view>
      </template>

      <!-- 第二层：某个文件夹（或「未分类」）里的照片 -->
      <template v-else>
        <view class="album-bar">
          <text class="album-bar-back" @click="exitAlbum">‹ 文件管理</text>
          <text class="album-bar-name">{{ currentAlbumName }}</text>
          <text v-if="canWrite && photos.length" class="album-bar-select" @click="toggleSelectMode">
            {{ selectMode ? '取消' : '多选' }}
          </text>
          <text v-else class="album-bar-holder" />
        </view>

        <view v-if="!photos.length && !loading" class="empty">
          <view class="empty-icon" />
          <text class="empty-title">这里还是空的</text>
          <text class="empty-desc">
            {{ canWrite ? '拍照时选这个文件夹，或长按别处的照片「移动到」这里' : '家人放进来的照片会出现在这里' }}
          </text>
        </view>

        <view v-else class="grid">
          <view
            v-for="photo in photos"
            :key="photo.id"
            class="cell grid-cell"
            @click="onCellTap(photo)"
            @longpress="onCellLongPress(photo)"
          >
            <image
              v-if="photo.cover_url || photo.url"
              class="cell-img"
              :src="photo.cover_url || photo.url"
              mode="aspectFill"
              lazy-load
              @error="onImageError(photo)"
            />
            <view v-else class="cell-fallback">
              <text class="cell-fallback-text">{{ photo.media_type === 'video' ? '视频' : '图片加载失败' }}</text>
            </view>
            <view v-if="photo.media_type === 'video'" class="cell-badge">
              <text class="cell-badge-text">▶</text>
            </view>
            <view v-if="selectMode" class="cell-check" :class="{ 'cell-check--on': isSelected(photo.id) }">
              <text class="cell-check-text">{{ isSelected(photo.id) ? '✓' : '' }}</text>
            </view>
          </view>
        </view>
      </template>
    </template>

    <!-- 按月分组：三列方格，缩略图统一裁成正方形 -->
    <template v-else-if="viewMode === 'month'">
      <view v-for="group in groups" :key="group.key" class="group">
        <text class="group-title">{{ group.label }}</text>
        <view class="grid">
          <view
            v-for="photo in group.items"
            :key="photo.id"
            class="cell grid-cell"
            @click="onCellTap(photo)"
            @longpress="onCellLongPress(photo)"
          >
            <image
              v-if="photo.cover_url || photo.url"
              class="cell-img"
              :src="photo.cover_url || photo.url"
              mode="aspectFill"
              lazy-load
              @error="onImageError(photo)"
            />
            <view v-else class="cell-fallback">
              <text class="cell-fallback-text">{{ photo.media_type === 'video' ? '视频' : '图片加载失败' }}</text>
            </view>
            <view v-if="photo.media_type === 'video'" class="cell-badge">
              <text class="cell-badge-text">▶</text>
            </view>
            <view v-if="selectMode" class="cell-check" :class="{ 'cell-check--on': isSelected(photo.id) }">
              <text class="cell-check-text">{{ isSelected(photo.id) ? '✓' : '' }}</text>
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
          @click="onCellTap(photo)"
          @longpress="onCellLongPress(photo)"
        >
          <image
            v-if="photo.cover_url || photo.url"
            class="cell-img"
            :src="photo.cover_url || photo.url"
            mode="aspectFill"
            lazy-load
            @load="onImageLoad(photo, $event)"
            @error="onImageError(photo)"
          />
          <view v-else class="cell-fallback">
            <text class="cell-fallback-text">{{ photo.media_type === 'video' ? '视频' : '图片加载失败' }}</text>
          </view>
          <view v-if="photo.media_type === 'video'" class="cell-badge">
            <text class="cell-badge-text">▶</text>
          </view>
          <view v-if="selectMode" class="cell-check" :class="{ 'cell-check--on': isSelected(photo.id) }">
            <text class="cell-check-text">{{ isSelected(photo.id) ? '✓' : '' }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="showingPhotos && loading" class="footer">
      <text class="footer-text">加载中…</text>
    </view>
    <view v-else-if="showingPhotos && photos.length && !hasMore" class="footer">
      <text class="footer-text">没有更多了</text>
    </view>

    <!-- 多选时的底部操作条：固定在底栏之上 -->
    <view v-if="selectMode" class="select-bar">
      <text class="select-bar-count">已选 {{ selectedIds.length }} 张</text>
      <view v-if="inAlbum" class="select-bar-btn" @click="moveTargetsTo(null)">
        <text class="select-bar-btn-text">移出文件夹</text>
      </view>
      <view
        class="select-bar-btn select-bar-btn--primary"
        :class="{ 'select-bar-btn--off': !selectedIds.length }"
        @click="openMoveSheet"
      >
        <text class="select-bar-btn-text select-bar-btn-text--primary">移动到…</text>
      </view>
    </view>

    <!--
      「移动到」弹层：刻意不用 uni.showActionSheet —— 它的 itemList 最多 6 项，
      而文件夹数量上限是 50，装不下。
    -->
    <view v-if="moveSheet" class="sheet-mask" @click="closeMoveSheet">
      <view class="sheet" @click.stop>
        <text class="sheet-title">移动到</text>
        <scroll-view class="sheet-list" scroll-y>
          <view class="sheet-item" @click="moveTargetsTo(null)">
            <text class="sheet-item-text">未分类</text>
          </view>
          <view
            v-for="album in albums"
            :key="album.id"
            class="sheet-item"
            @click="moveTargetsTo(album.id)"
          >
            <text class="sheet-item-text">{{ album.name }}</text>
          </view>
        </scroll-view>
        <view v-if="canWrite" class="sheet-item sheet-item--new" @click="onCreateFromSheet">
          <text class="sheet-item-text sheet-item-text--new">+ 新建文件夹</text>
        </view>
        <view class="sheet-cancel" @click="closeMoveSheet">
          <text class="sheet-cancel-text">取消</text>
        </view>
      </view>
    </view>

    <PhotoComposer v-if="canWrite" ref="composer" :albums="albums" @saved="onPhotoSaved" />

    <FamilyOrbit ref="orbit" />

    <!-- 悬浮「+」：可以拖着换位置，见 onFabTouchStart 那一组；轻点仍然是拍照。
         多选时收起，否则会和底部操作条叠在一起。 -->
    <view
      v-if="canWrite && !selectMode"
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
import { computed, ref, watch } from 'vue'
import { onShow, onHide, onPullDownRefresh, onReachBottom, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import {
  listPhotos,
  listAlbums,
  createAlbum,
  renameAlbum,
  reorderAlbums,
  deleteAlbum,
  movePhotos,
  summarizeAlbums,
  ALBUM_NAME_MAX,
  ALBUM_MAX_PER_BABY,
  ALBUM_NONE,
} from '@/services/photo'
import { formatAge } from '@/utils/age'
import { localMonth } from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'
import PhotoComposer from '@/components/PhotoComposer/index.vue'
import FamilyOrbit from '@/components/FamilyOrbit/index.vue'
import AppTabBar from '@/components/AppTabBar/index.vue'
import { syncActiveTabFromRoute, TAB_BAR_HEIGHT } from '@/utils/tabbar'

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

/* ---------------------------------------------------------------------------
 * 照片文件夹（相册）
 *
 * 数据层见 services/photo.js 的「照片文件夹」一节，表结构见 docx/guide/data-model.md。
 * 三条约定：只做一层；挂在「家庭 + 宝宝」下；**删文件夹不删照片**（回到「未分类」）。
 * ------------------------------------------------------------------------- */

const albums = ref([])
/** 每个文件夹有几张、封面是哪张；「未分类」单独一项。由 summarizeAlbums 一次算出来 */
const albumSummary = ref({ byAlbum: {}, unclassified: { count: 0, cover: null }, total: 0 })
/**
 * 走进的是哪个文件夹：
 *   ''          —— 还在文件夹列表这一层，不展示照片
 *   ALBUM_NONE  —— 「未分类」
 *   其它         —— 相册 id
 */
const currentAlbumId = ref('')
const albumLoading = ref(false)
const albumLoadedKey = ref('')

/** 多选模式与已勾选的照片 id */
const selectMode = ref(false)
const selectedIds = ref([])

/** 「移动到」弹层开着没有；moveTargets 是这一次要移动的那批照片 */
const moveSheet = ref(false)
const moveTargets = ref([])
const moving = ref(false)

/** 拖动排序：sortMode 开着才能拖，dragIndex 是正在拖的那一行 */
const sortMode = ref(false)
const dragIndex = ref(-1)
/** 拖动起点：手指按下时的行号与纵坐标，目标位置 = 起点行号 + 位移 ÷ 行高 */
const sortStartIndex = ref(-1)
const dragStartY = ref(null)
/** 这一次拖动是否真的动过：只长按没拖的话不必写库 */
const sortMoved = ref(false)

/** 当前视图是不是「在展示照片」——文件夹视图的第一层只列文件夹 */
const showingPhotos = computed(() => viewMode.value !== 'album' || !!currentAlbumId.value)
/** 是否已经走进某个文件夹（含「未分类」） */
const inAlbum = computed(() => viewMode.value === 'album' && !!currentAlbumId.value)
const currentAlbumName = computed(() => {
  if (currentAlbumId.value === ALBUM_NONE) return '未分类'
  const hit = albums.value.find((item) => item.id === currentAlbumId.value)
  return hit ? hit.name : '文件夹'
})

/**
 * 顶部幻灯片只取最近若干条。
 * 这里是「一进页面就全部下载」的地方，条数要克制：每条都是相机原图，
 * 之前写 20，弱网下首屏要等一串大图下完。6 张足够轮播起来不重复。
 */
const SLIDE_COUNT = 6
const slides = computed(() => photos.value.slice(0, SLIDE_COUNT))

/** viewer 只读：不渲染拍照入口 */
const canWrite = computed(() => store.canWrite)

/** 视图模式：全部（瀑布流）/ 按月分组（原三列方格）/ 文件管理（相册文件夹） */
const VIEW_MODES = [
  { key: 'all', label: '全部' },
  { key: 'month', label: '按月' },
  { key: 'album', label: '文件管理' },
]

/**
 * 记住上次选的视图。
 * 默认仍是「按月」—— 不改变现有家人的使用习惯；谁切到「文件夹」，下次进来就还在文件夹。
 */
const VIEW_STORAGE_KEY = 'babyup.timelineView'

function loadSavedView() {
  try {
    const saved = uni.getStorageSync(VIEW_STORAGE_KEY)
    return VIEW_MODES.some((item) => item.key === saved) ? saved : 'month'
  } catch (err) {
    console.error('[Timeline] 读取视图模式失败', err)
    return 'month'
  }
}

const viewMode = ref(loadSavedView())

/** 照片墙列数：3 列 */
const COLUMN_COUNT = 3
/** 瀑布流单元格默认高宽比：图片真实比例要等 @load 才知道，先用正方形占位，避免首屏高度为 0 */
const DEFAULT_ASPECT = 1
/** 高宽比上限：超过就按上限裁切（超长图在列表里只露一段，点开详情看全图） */
const MAX_ASPECT = 3

/** 图片真实高宽比缓存（photo.id → height / width） */
const imageRatios = ref({})

/**
 * 待写入的高宽比暂存在普通对象里，攒一小会儿再一次性同步进响应式。
 *
 * 为什么不能直接写 imageRatios：@load 是逐张触发的，而 cellStyle 读的是整个
 * imageRatios —— 每张图加载完都写一次响应式，等于整个照片墙重渲一次；
 * 一屏 40 张图就是 40 次重排，这正是滚动前那阵卡顿的来源。
 * 攒成一批再写，重渲次数从「每张图一次」降到「每 200ms 一次」。
 */
const pendingRatios = {}
let ratioFlushTimer = 0

function flushRatios() {
  ratioFlushTimer = 0
  const keys = Object.keys(pendingRatios)
  if (!keys.length) return
  const next = { ...imageRatios.value }
  keys.forEach((key) => {
    next[key] = pendingRatios[key]
    delete pendingRatios[key]
  })
  imageRatios.value = next
}

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

/** 图片加载完成后记录真实比例，驱动 cellStyle 重算高度（攒批写，见 pendingRatios） */
function onImageLoad(photo, e) {
  const width = e && e.detail && e.detail.width
  const height = e && e.detail && e.detail.height
  if (!width || !height) return
  const ratio = height / width
  if (imageRatios.value[photo.id] === ratio || pendingRatios[photo.id] === ratio) return
  pendingRatios[photo.id] = ratio
  if (ratioFlushTimer) return
  ratioFlushTimer = setTimeout(flushRatios, 200)
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

/**
 * 上下文里「数据属于谁」的那一半：家庭 + 宝宝。
 *
 * 文件夹清单只跟这两个有关 —— 与当前在哪个视图、进没进文件夹都无关，
 * 所以判断「要不要重拉文件夹」用它，而不是用下面那个带视图的 key。
 */
function baseKey() {
  if (!store.membership || !store.baby) return ''
  return `${store.membership.family_id}:${store.baby.id}`
}

/**
 * 当前视图的「上下文标记」：家庭 + 宝宝 + 视图 + 文件夹。
 *
 * 把视图与文件夹也算进来，是为了让 shouldReload 能识别「切了视图 / 换了文件夹」——
 * 否则从 A 文件夹切到 B 文件夹时会被当成「数据没变」而沿用上一个文件夹的照片。
 */
function contextKey() {
  const base = baseKey()
  if (!base) return ''
  const album = viewMode.value === 'album' ? currentAlbumId.value || '-' : ''
  return `${base}:${viewMode.value}:${album}`
}

/**
 * 换了家庭 / 宝宝：正待着的那个文件夹已经不属于这个宝宝了，必须退回文件夹列表层。
 * 否则会停在一个「别人的文件夹」里 —— 标题还是旧宝宝的文件夹名，照片一张都没有。
 *
 * 用 watch 而不是在 onShow 里比对：本页是 tab 页、切走时不销毁，
 * 这样在「我的」页一改宝宝，这边立刻归位，不必等用户切回来。
 */
watch(baseKey, (next) => {
  if (!next) return
  currentAlbumId.value = ''
  photos.value = []
  total.value = 0
  quitSort()
  exitSelectMode()
})

/**
 * 当前视图该按哪个文件夹筛（三态，与 listPhotos 的 albumId 参数一致）：
 *   undefined —— 不筛（「按月 / 全部」视图）
 *   null      —— 只看「未分类」
 *   字符串     —— 只看这个文件夹
 */
function currentAlbumFilter() {
  if (viewMode.value !== 'album' || !currentAlbumId.value) return undefined
  return currentAlbumId.value === ALBUM_NONE ? null : currentAlbumId.value
}

async function loadPage({ reset = false } = {}) {
  if (loading.value) return
  const key = contextKey()
  if (!key) {
    photos.value = []
    total.value = 0
    return
  }
  // 文件夹列表这一层不展示照片，没什么可拉的
  if (viewMode.value === 'album' && !currentAlbumId.value) return
  loading.value = true
  try {
    const offset = reset ? 0 : photos.value.length
    const { items, total: count } = await listPhotos({
      familyId: store.membership.family_id,
      babyId: store.baby.id,
      limit: PAGE_SIZE,
      offset,
      albumId: currentAlbumFilter(),
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
  store.markTimelineDirty()
  // 在文件夹列表层时刷的是清单（封面与张数都会变），进了文件夹或别的视图才刷照片
  if (viewMode.value === 'album' && !currentAlbumId.value) {
    loadAlbums()
    return
  }
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
  uni.navigateTo({ url: `/pkg/photo-detail/photo-detail?id=${photo.id}` })
}

/**
 * 进全屏放映页（把当前宝宝的照片自动播一遍）。
 *
 * 只把「叫什么」带过去，播放页自己去拉照片：这样它不依赖本页已加载的那一页数据
 * （本页是分页加载的，直接复用会只播前面 20 张）。
 */
function openSlideshow() {
  const name = babyName.value || '宝宝时光'
  uni.navigateTo({
    url: `/pkg/slideshow/slideshow?title=${encodeURIComponent(name)}`,
    fail: (err) => console.error('[Timeline] 打开放映失败', err),
  })
}

function onImageError(photo) {
  console.error('[Timeline] 图片加载失败', photo.id, photo.storage_path)
}

/* ---------- 文件夹：加载与切换 ---------- */

/** 文件夹列表要不要重新拉：换了家庭/宝宝，或刚从别的页面动过照片 */
function shouldReloadAlbums() {
  if (!albumLoadedKey.value) return true
  if (albumLoadedKey.value !== baseKey()) return true
  return store.timelineDirty
}

async function loadAlbums() {
  /**
   * ⚠️ key 必须在**发请求之前**取好，回来时也只认这个 key。
   *
   * 曾经的写法是等接口回来再算一次 `contextKey()` 存进去 —— 只要请求跑着的时候
   * 用户切了宝宝，存下的就是**新宝宝的 key**、而 `albums` 里装的是**旧宝宝的数据**。
   * 之后 `shouldReloadAlbums()` 一看 key 一样，就认为「已经是最新的」，
   * 界面上的文件夹会一直停在旧宝宝那一批，直到小程序重启（踩过）。
   */
  const key = baseKey()
  if (!key) {
    albums.value = []
    albumSummary.value = { byAlbum: {}, unclassified: { count: 0, cover: null }, total: 0 }
    albumLoadedKey.value = ''
    return
  }
  albumLoading.value = true
  try {
    const familyId = store.membership.family_id
    const babyId = store.baby.id
    // 两件事并行：文件夹清单 + 每个文件夹几张/封面
    const [list, summary] = await Promise.all([
      listAlbums({ familyId, babyId }),
      summarizeAlbums({ familyId, babyId }),
    ])
    // 请求期间换了家庭/宝宝：这份结果已经不是当前宝宝的了，直接丢弃
    // （不写 albumLoadedKey，下次进来会按新的 key 重拉）
    if (baseKey() !== key) return
    albums.value = list
    albumSummary.value = summary
    albumLoadedKey.value = key
    store.clearTimelineDirty()
  } catch (err) {
    console.error('[Timeline] 加载文件夹失败', err)
    uni.showToast({ title: err.message || '加载文件夹失败，请重试', icon: 'none' })
  } finally {
    albumLoading.value = false
  }
}

async function switchView(key) {
  if (viewMode.value === key) return
  viewMode.value = key
  try {
    uni.setStorageSync(VIEW_STORAGE_KEY, key)
  } catch (err) {
    console.error('[Timeline] 保存视图模式失败', err)
  }
  quitSort()
  exitSelectMode()
  currentAlbumId.value = ''
  photos.value = []
  total.value = 0
  if (key === 'album') {
    await loadAlbums()
    return
  }
  await loadPage({ reset: true })
}

async function enterAlbum(id) {
  currentAlbumId.value = id
  exitSelectMode()
  photos.value = []
  total.value = 0
  await loadPage({ reset: true })
}

async function exitAlbum() {
  currentAlbumId.value = ''
  exitSelectMode()
  photos.value = []
  total.value = 0
  // 回来时重新算一遍张数与封面（刚可能移出去过照片）
  await loadAlbums()
}

/** 排序模式下点一行不该进文件夹，否则一松手就跳走了 */
function onAlbumRowTap(album) {
  if (sortMode.value) return
  enterAlbum(album.id)
}

/**
 * 「未分类」入口。
 * 单独包一个无参方法，是为了让模板里不必引用 ALBUM_NONE 这个从 services 导入的常量。
 */
function enterUnclassified() {
  enterAlbum(ALBUM_NONE)
}

/* ---------- 文件夹：封面与张数 ---------- */

function coverSrc(photo) {
  if (!photo) return ''
  return photo.cover_url || photo.url || ''
}

function albumCoverOf(album) {
  const bucket = albumSummary.value.byAlbum[album.id]
  return bucket ? bucket.cover : null
}

function albumCountOf(album) {
  const bucket = albumSummary.value.byAlbum[album.id]
  return bucket ? bucket.count : 0
}

/* ---------- 文件夹：新建 / 重命名 / 删除 ---------- */

/**
 * 弹出输入框新建文件夹。
 * 用 showModal 的 editable（基础库 2.17.1+）而不是自建弹层：少一层 UI，键盘处理也现成。
 * @param {(album: object) => void} [afterCreate] 建完之后的回调（「移动到」弹层里用它直接移进去）
 */
function promptCreateAlbum(afterCreate) {
  if (!canWrite.value) return
  if (albums.value.length >= ALBUM_MAX_PER_BABY) {
    uni.showToast({ title: `最多建 ${ALBUM_MAX_PER_BABY} 个文件夹`, icon: 'none' })
    return
  }
  uni.showModal({
    title: '新建文件夹',
    editable: true,
    placeholderText: `比如「一岁」，最多 ${ALBUM_NAME_MAX} 个字`,
    success: async (res) => {
      if (!res.confirm) return
      const name = String(res.content || '').trim()
      if (!name) {
        uni.showToast({ title: '请输入文件夹名称', icon: 'none' })
        return
      }
      if (name.length > ALBUM_NAME_MAX) {
        uni.showToast({ title: `最多 ${ALBUM_NAME_MAX} 个字`, icon: 'none' })
        return
      }
      try {
        const created = await createAlbum({
          familyId: store.membership.family_id,
          babyId: store.baby.id,
          name,
        })
        await loadAlbums()
        if (created && afterCreate) afterCreate(created)
        else uni.showToast({ title: '已创建', icon: 'none' })
      } catch (err) {
        console.error('[Timeline] 新建文件夹失败', err)
        uni.showToast({ title: err.message || '新建失败，请重试', icon: 'none' })
      }
    },
  })
}

function promptRenameAlbum(album) {
  uni.showModal({
    title: '重命名文件夹',
    editable: true,
    content: album.name,
    placeholderText: `最多 ${ALBUM_NAME_MAX} 个字`,
    success: async (res) => {
      if (!res.confirm) return
      const name = String(res.content || '').trim()
      if (!name || name === album.name) return
      if (name.length > ALBUM_NAME_MAX) {
        uni.showToast({ title: `最多 ${ALBUM_NAME_MAX} 个字`, icon: 'none' })
        return
      }
      try {
        await renameAlbum(album, name)
        await loadAlbums()
        uni.showToast({ title: '已重命名', icon: 'none' })
      } catch (err) {
        console.error('[Timeline] 重命名文件夹失败', err)
        uni.showToast({ title: err.message || '重命名失败，请重试', icon: 'none' })
      }
    },
  })
}

function confirmDeleteAlbum(album) {
  const count = albumCountOf(album)
  uni.showModal({
    title: '删除文件夹',
    // 说清「照片不会没」：这是整个功能里最容易被误解的一步
    content: count
      ? `「${album.name}」里的 ${count} 张照片不会被删除，会回到「未分类」。`
      : `确定删除「${album.name}」吗？`,
    confirmText: '删除',
    confirmColor: '#f04438',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await deleteAlbum(album)
        store.markTimelineDirty()
        await loadAlbums()
        uni.showToast({ title: count ? '已删除，照片回到未分类' : '已删除', icon: 'none' })
      } catch (err) {
        console.error('[Timeline] 删除文件夹失败', err)
        uni.showToast({ title: err.message || '删除失败，请重试', icon: 'none' })
      }
    },
  })
}

function openAlbumMenu(album) {
  if (!canWrite.value) return
  uni.showActionSheet({
    itemList: ['重命名', '删除文件夹'],
    success: (res) => {
      if (res.tapIndex === 0) promptRenameAlbum(album)
      else if (res.tapIndex === 1) confirmDeleteAlbum(album)
    },
    fail: (err) => {
      // 点空白处取消不算异常
      if (!/cancel/i.test((err && err.errMsg) || '')) console.error('[Timeline] 文件夹菜单异常', err)
    },
  })
}

/* ---------- 文件夹：拖动排序 ---------- */

/** 行高（rpx）。必须与样式里 .album-row 的 height 一致 —— CSS 读不到 JS 常量 */
const ALBUM_ROW_RPX = 150

function rpxToPx(rpx) {
  const info = uni.getSystemInfoSync()
  const width = (info && info.windowWidth) || 375
  return (Number(rpx) * width) / 750
}

/** 从触摸事件里取纵坐标；longpress 的 touches 可能为空，退化用 detail.y */
function touchYOf(e) {
  const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0])
  if (touch) {
    if (typeof touch.pageY === 'number') return touch.pageY
    if (typeof touch.clientY === 'number') return touch.clientY
  }
  if (e.detail && typeof e.detail.y === 'number') return e.detail.y
  return null
}

function startSort(index, e) {
  // 只有一个文件夹时没什么可排的，别进排序模式
  if (!canWrite.value || albums.value.length < 2) return
  sortMode.value = true
  dragIndex.value = index
  sortStartIndex.value = index
  dragStartY.value = touchYOf(e)
  sortMoved.value = false
  uni.vibrateShort({ fail: () => {} })
}

/**
 * 拖动中：用「手指相对起点的位移 ÷ 行高」算目标位置。
 *
 * 刻意不量列表的位置——只要知道位移了几行就够了，而拖动时会把数组实时重排，
 * 看着就是被拖的那行浮起来、其它行让位。
 */
function onSortMove(e) {
  if (!sortMode.value || dragIndex.value < 0) return
  const y = touchYOf(e)
  if (y === null) return
  if (dragStartY.value === null) {
    dragStartY.value = y
    return
  }
  const rowHeight = rpxToPx(ALBUM_ROW_RPX)
  if (!rowHeight) return
  const steps = Math.round((y - dragStartY.value) / rowHeight)
  let target = sortStartIndex.value + steps
  const list = albums.value
  if (target < 0) target = 0
  if (target > list.length - 1) target = list.length - 1
  if (target === dragIndex.value) return
  const next = list.slice()
  const moved = next.splice(dragIndex.value, 1)[0]
  next.splice(target, 0, moved)
  albums.value = next
  dragIndex.value = target
  sortMoved.value = true
}

/** 松手：拖过才写库（只长按没拖动的话别白写一次） */
async function endSort() {
  if (!sortMode.value || dragIndex.value < 0) return
  const moved = sortMoved.value
  dragIndex.value = -1
  dragStartY.value = null
  sortMoved.value = false
  if (!moved) return
  try {
    await reorderAlbums(albums.value)
    console.log('[Timeline] 文件夹顺序已保存')
  } catch (err) {
    console.error('[Timeline] 保存文件夹顺序失败', err)
    uni.showToast({ title: '保存顺序失败，请重试', icon: 'none' })
    await loadAlbums()
  }
}

function quitSort() {
  sortMode.value = false
  dragIndex.value = -1
  dragStartY.value = null
  sortMoved.value = false
}

/* ---------- 多选与「移动到」 ---------- */

function isSelected(photoId) {
  return selectedIds.value.indexOf(photoId) >= 0
}

function toggleSelectMode() {
  if (selectMode.value) {
    exitSelectMode()
    return
  }
  selectMode.value = true
  selectedIds.value = []
}

function exitSelectMode() {
  selectMode.value = false
  selectedIds.value = []
  moveTargets.value = []
}

/** 多选态下点一下是勾选，否则才是打开详情 */
function onCellTap(photo) {
  if (!selectMode.value) {
    openPhoto(photo)
    return
  }
  const next = selectedIds.value.slice()
  const at = next.indexOf(photo.id)
  if (at >= 0) next.splice(at, 1)
  else next.push(photo.id)
  selectedIds.value = next
}

/** 长按一张照片 = 直接「移动到…」，不必先进多选 */
function onCellLongPress(photo) {
  if (!canWrite.value || moving.value) return
  moveTargets.value = [photo]
  moveSheet.value = true
}

function openMoveSheet() {
  if (!selectedIds.value.length) {
    uni.showToast({ title: '先选几张照片', icon: 'none' })
    return
  }
  moveTargets.value = photos.value.filter((photo) => selectedIds.value.indexOf(photo.id) >= 0)
  moveSheet.value = true
}

function closeMoveSheet() {
  moveSheet.value = false
  moveTargets.value = []
}

/** 「移动到」弹层里点「新建文件夹」：建完直接把这批照片移进去 */
function onCreateFromSheet() {
  moveSheet.value = false
  promptCreateAlbum((album) => moveTargetsTo(album.id))
}

/**
 * 把 moveTargets 里的照片移到 albumId（null = 移回「未分类」）。
 * 逐张写，所以要给进度提示——多选十几张时能看出在动，不会以为卡住了。
 */
async function moveTargetsTo(albumId) {
  const list = moveTargets.value.slice()
  moveSheet.value = false
  moveTargets.value = []
  if (!list.length || moving.value) return
  const target = albumId || null
  // 目标就是它现在待的地方：不必发请求
  if (list.every((photo) => (photo.album_id || null) === target)) {
    exitSelectMode()
    return
  }
  moving.value = true
  uni.showLoading({ title: `移动中 0/${list.length}`, mask: true })
  try {
    await movePhotos(list, target, (done, total) => {
      uni.showLoading({ title: `移动中 ${done}/${total}`, mask: true })
    })
    uni.hideLoading()
    store.markTimelineDirty()
    exitSelectMode()
    // 文件夹视图下内容变了要重拉；「按月 / 全部」里照片还在，只是归属变了，列表不用动
    if (viewMode.value === 'album') {
      if (currentAlbumId.value) await loadPage({ reset: true })
      else await loadAlbums()
    }
    uni.showToast({ title: '已移动', icon: 'none' })
  } catch (err) {
    uni.hideLoading()
    console.error('[Timeline] 移动照片失败', err)
    uni.showToast({ title: err.message || '移动失败，请重试', icon: 'none' })
  } finally {
    moving.value = false
  }
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  // 同步自定义底栏的高亮（底栏组件见 components/AppTabBar）
  syncActiveTabFromRoute()
  // 冷启动时 onShow 会早于 bootstrap 完成，这里确保家庭/宝宝上下文已就绪
  await store.bootstrap()
  if (!contextKey()) return
  // 文件夹视图的第一层只列文件夹；进了具体文件夹才拉照片
  if (viewMode.value === 'album' && !currentAlbumId.value) {
    if (shouldReloadAlbums()) await loadAlbums()
    return
  }
  // 数据没变就复用上次结果，避免「去别的页面再回来」也重新请求；
  // 自己改过照片、切换了家庭/宝宝、缓存超过 CACHE_TTL 时会自动重新拉取，家人新增的照片靠下拉刷新
  if (shouldReload()) await loadPage({ reset: true })
})

// 离开本页时关掉环绕动画，避免动画在后台空转
onHide(() => {
  if (orbit.value) orbit.value.close()
})

onPullDownRefresh(async () => {
  if (viewMode.value === 'album' && !currentAlbumId.value) await loadAlbums()
  else await loadPage({ reset: true })
  uni.stopPullDownRefresh()
})

onReachBottom(() => {
  if (showingPhotos.value && hasMore.value) loadPage()
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

/* 轮播外再包一层，是给右上角那个「放映」入口做定位基准 */
.slides-wrap {
  position: relative;
  margin-bottom: var(--space-lg);
}

.slides {
  height: 420rpx;
  overflow: hidden;
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
}

/* 半透明黑底 + 白字：叠在照片上，深色浅色照片都看得清 */
.slides-play {
  position: absolute;
  top: 16rpx;
  right: 16rpx;
  padding: 8rpx 22rpx;
  background-color: rgba(0, 0, 0, 0.42);
  border-radius: var(--radius-pill);
}

.slides-play-text {
  font-size: 23rpx;
  color: #ffffff;
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
  /* 三个视图（文件夹 / 按月 / 全部）比原来的两个宽一档 */
  width: 440rpx;
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

/* ---------- 文件夹视图 ---------- */

.album-list {
  display: flex;
  flex-direction: column;
}

/* 行高必须与脚本里的 ALBUM_ROW_RPX 一致 —— 拖动排序按它算目标位置 */
.album-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 150rpx;
  padding: 0 var(--space-md);
  margin-bottom: var(--space-sm);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

/* 拖动中的那一行：浮起来、描个边，让手指底下有反馈 */
.album-row--dragging {
  background-color: var(--color-primary-soft);
  box-shadow: 0 12rpx 28rpx rgba(255, 143, 107, 0.28);
}

.album-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 108rpx;
  height: 108rpx;
  margin-right: var(--space-md);
  overflow: hidden;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.album-thumb-img {
  width: 100%;
  height: 100%;
}

.album-thumb-glyph {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.album-info {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.album-name {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.album-count {
  margin-top: 6rpx;
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.album-arrow {
  font-size: 34rpx;
  color: var(--color-text-muted);
}

/* 「⋯」按钮：点击区域做大一点，不然很难点中 */
.album-more {
  padding: 0 var(--space-sm);
  font-size: 34rpx;
  color: var(--color-text-muted);
}

.album-new {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.album-new-text {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.album-tip {
  padding: var(--space-md) var(--space-xs);
}

.album-tip-text {
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
}

.sort-hint {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-sm) var(--space-md);
  margin-bottom: var(--space-sm);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.sort-hint-text {
  font-size: 24rpx;
  color: var(--color-primary-deep);
}

.sort-hint-done {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

/* 进了某个文件夹后的标题条：左返回、中名称、右多选 */
.album-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: var(--space-md);
}

.album-bar-back {
  font-size: 26rpx;
  color: var(--color-text-sub);
}

.album-bar-name {
  flex: 1;
  margin: 0 var(--space-sm);
  overflow: hidden;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--color-text-main);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.album-bar-select,
.album-bar-holder {
  width: 96rpx;
  font-size: 26rpx;
  color: var(--color-primary-deep);
  text-align: right;
}

/* 多选勾：右上角一个圆点，选中变实心 */
.cell-check {
  position: absolute;
  top: 8rpx;
  right: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40rpx;
  height: 40rpx;
  background-color: rgba(255, 255, 255, 0.85);
  border: 2rpx solid var(--color-border);
  border-radius: 50%;
}

.cell-check--on {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

.cell-check-text {
  font-size: 24rpx;
  font-weight: 600;
  color: #ffffff;
}

/* 多选操作条：浮在自定义底栏之上 */
.select-bar {
  position: fixed;
  right: var(--space-lg);
  bottom: calc(var(--tabbar-height) + env(safe-area-inset-bottom) + var(--space-md));
  left: var(--space-lg);
  z-index: 20;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-sm) var(--space-md);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-pill);
  box-shadow: 0 8rpx 32rpx rgba(31, 35, 41, 0.16);
}

.select-bar-count {
  flex: 1;
  font-size: 26rpx;
  color: var(--color-text-sub);
}

.select-bar-btn {
  padding: 14rpx var(--space-md);
  margin-left: var(--space-sm);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.select-bar-btn--primary {
  background-color: var(--color-primary);
}

.select-bar-btn--off {
  opacity: 0.5;
}

.select-bar-btn-text {
  font-size: 26rpx;
  color: var(--color-text-main);
}

.select-bar-btn-text--primary {
  font-weight: 600;
  color: #ffffff;
}

/* ---------- 「移动到」弹层 ---------- */

.sheet-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background-color: rgba(31, 35, 41, 0.45);
}

.sheet {
  padding: var(--space-lg);
  padding-bottom: calc(var(--space-lg) + env(safe-area-inset-bottom));
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.sheet-title {
  display: block;
  margin-bottom: var(--space-md);
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
  text-align: center;
}

/* 文件夹多时最多占屏幕一半高，剩下靠滚动 */
.sheet-list {
  max-height: 48vh;
}

.sheet-item {
  display: flex;
  align-items: center;
  height: 96rpx;
  border-bottom: 1rpx solid var(--color-border);
}

.sheet-item--new {
  border-bottom: none;
}

.sheet-item-text {
  font-size: 30rpx;
  color: var(--color-text-main);
}

.sheet-item-text--new {
  font-weight: 600;
  color: var(--color-primary-deep);
}

.sheet-cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  margin-top: var(--space-sm);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.sheet-cancel-text {
  font-size: 30rpx;
  color: var(--color-text-sub);
}
</style>
