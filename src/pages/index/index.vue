<template>
  <view class="page">
    <!-- 宝宝信息头 -->
    <view class="hero">
      <view class="hero-avatar">
        <image v-if="babyAvatar" class="hero-avatar-img" :src="babyAvatar" mode="aspectFill" />
        <text v-else-if="babyInitial" class="hero-avatar-text">{{ babyInitial }}</text>
      </view>
      <view class="hero-info">
        <text class="hero-name">{{ babyName }}</text>
        <text class="hero-sub">{{ babySub }}</text>
      </view>
    </view>

    <!-- 空态 -->
    <view v-if="!groups.length && !loading" class="empty">
      <view class="empty-icon" />
      <text class="empty-title">还没有记录</text>
      <text class="empty-desc">
        {{ canWrite ? '点右下角按钮，拍下宝宝的第一张照片' : '家人记录的照片会出现在这里' }}
      </text>
    </view>

    <!-- 按月分组的照片流 -->
    <view v-for="group in groups" :key="group.key" class="group">
      <text class="group-title">{{ group.label }}</text>
      <view class="grid">
        <view v-for="photo in group.items" :key="photo.id" class="cell" @click="openPhoto(photo)">
          <image
            v-if="photo.url"
            class="cell-img"
            :src="photo.url"
            mode="aspectFill"
            @error="onImageError(photo)"
          />
          <view v-else class="cell-fallback">
            <text class="cell-fallback-text">图片加载失败</text>
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

    <view v-if="canWrite" class="fab" @click="onCapture">
      <text class="fab-plus">+</text>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow, onPullDownRefresh, onReachBottom, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { listPhotos } from '@/services/photo'
import { formatAge } from '@/utils/age'
import { localMonth } from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'
import PhotoComposer from '@/components/PhotoComposer/index.vue'

const PAGE_PATH = 'pages/index/index'
const PAGE_SIZE = 20

const store = useAuthStore()

const photos = ref([])
const total = ref(0)
const loading = ref(false)

const composer = ref(null)

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

/** viewer 只读：不渲染拍照入口 */
const canWrite = computed(() => store.canWrite)

/** taken_at 倒序的结果按本地时区归月，跨月自动断组 */
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
    console.log('[Timeline] 已加载照片', photos.value.length, '/', total.value)
  } catch (err) {
    console.error('[Timeline] 加载照片失败', err)
    uni.showToast({ title: err.message || '加载失败，请重试', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function onCapture() {
  if (!store.baby) {
    uni.showToast({ title: '请先创建宝宝档案', icon: 'none' })
    return
  }
  if (composer.value) composer.value.open()
}

function onPhotoSaved() {
  loadPage({ reset: true })
}

function openPhoto(photo) {
  uni.navigateTo({ url: `/pages/photo-detail/photo-detail?id=${photo.id}` })
}

function onImageError(photo) {
  console.error('[Timeline] 图片加载失败', photo.id, photo.storage_path)
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  // 冷启动时 onShow 会早于 bootstrap 完成，这里确保家庭/宝宝上下文已就绪
  await store.bootstrap()
  // 每次回到本页都重新拉取，详情页删除、记录页新增都能及时反映
  if (contextKey()) await loadPage({ reset: true })
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

.grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.cell {
  width: 32%;
  height: 220rpx;
  margin-right: 2%;
  margin-bottom: 2%;
  overflow: hidden;
  background-color: var(--color-bg-card);
  border-radius: var(--radius-md);
}

.cell:nth-child(3n) {
  margin-right: 0;
}

.cell-img {
  width: 100%;
  height: 220rpx;
}

.cell-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 220rpx;
  background-color: var(--color-bg-page);
}

.cell-fallback-text {
  font-size: 22rpx;
  color: var(--color-text-muted);
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

.fab {
  position: fixed;
  right: 48rpx;
  bottom: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 112rpx;
  height: 112rpx;
  background-color: var(--color-primary);
  border-radius: 50%;
  box-shadow: 0 12rpx 32rpx rgba(255, 143, 107, 0.4);
}

.fab-plus {
  margin-top: -6rpx;
  font-size: 64rpx;
  line-height: 1;
  color: #ffffff;
}
</style>
