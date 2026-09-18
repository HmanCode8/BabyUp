<template>
  <view class="page">
    <!-- 今日小结（二期）：实时聚合，不落库；空项不显示 -->
    <view class="app-card summary">
      <view class="summary-head" @click="toggleDetail">
        <text class="summary-title">今日小结</text>
        <text class="summary-date">{{ today }}</text>
        <text v-if="summary.hasAny" class="summary-toggle">{{ detailOpen ? '收起明细' : '明细 ›' }}</text>
      </view>

      <view v-if="!summary.hasAny" class="summary-empty">
        <text class="summary-empty-text">
          {{ summaryEmptyText }}
        </text>
      </view>

      <!-- 「距上次喂养」可能来自昨天，所以不放在「今日有记录」分支里；没有喂养记录时整项不渲染 -->
      <view v-if="lastFeedingText || summary.hasAny" class="summary-rows">
        <view v-if="lastFeedingText" class="summary-row">
          <text class="summary-label">距上次喂养</text>
          <text class="summary-value">{{ lastFeedingText }}</text>
        </view>
        <view v-if="summary.feeding.total" class="summary-row">
          <text class="summary-label">喂养 {{ summary.feeding.total }} 次</text>
          <text class="summary-value">{{ feedingText }}</text>
        </view>
        <view v-if="summary.sleep.totalMinutes" class="summary-row">
          <text class="summary-label">睡眠</text>
          <text class="summary-value">{{ formatMinutes(summary.sleep.totalMinutes) }}</text>
        </view>
        <view v-if="summary.diaper.total" class="summary-row">
          <text class="summary-label">便便 {{ summary.diaper.total }} 次</text>
          <text class="summary-value">{{ diaperText }}</text>
        </view>
        <view v-if="summary.photo.count" class="summary-row">
          <text class="summary-label">照片</text>
          <text class="summary-value">{{ summary.photo.count }} 张</text>
        </view>
        <view v-if="summary.growth.items.length" class="summary-row">
          <text class="summary-label">生长</text>
          <text class="summary-value">{{ growthText }}</text>
        </view>
        <view v-if="summary.vaccine.overdue || summary.vaccine.soon" class="summary-row">
          <text class="summary-label">疫苗</text>
          <text class="summary-value">
            已逾期 {{ summary.vaccine.overdue }} · 近 7 天 {{ summary.vaccine.soon }}
          </text>
        </view>
      </view>

      <!-- 展开的当日明细 -->
      <view v-if="detailOpen && summary.hasAny" class="detail">
        <view v-if="summary.feeding.items.length" class="detail-block">
          <text class="detail-title">喂养时间线</text>
          <text v-for="item in summary.feeding.items" :key="item.id" class="detail-line">
            {{ formatTime(item.record_time) }} · {{ formatFeeding(item) }}{{ item.note ? ` · ${item.note}` : '' }}
          </text>
        </view>

        <view v-if="summary.sleep.items.length" class="detail-block">
          <text class="detail-title">睡眠时段</text>
          <text v-for="item in summary.sleep.items" :key="item.id" class="detail-line">
            {{ sleepRangeText(item) }} · {{ item.sleeping ? `已 ${formatMinutes(item.minutes)}` : formatMinutes(item.minutes) }}
          </text>
        </view>

        <view v-if="summary.diaper.items.length" class="detail-block">
          <text class="detail-title">便便记录</text>
          <text v-for="item in summary.diaper.items" :key="item.id" class="detail-line">
            {{ formatTime(item.record_time) }} · {{ formatDiaper(item) }}{{ item.note ? ` · ${item.note}` : '' }}
          </text>
        </view>

        <view v-if="summary.photo.items.length" class="detail-block">
          <text class="detail-title">当日照片</text>
          <view class="detail-photos">
            <image
              v-for="item in summary.photo.items"
              :key="item.id"
              class="detail-photo"
              :src="item.url"
              mode="aspectFill"
            />
          </view>
        </view>
      </view>
    </view>

    <!-- 首次进入的轻引导：只显示一次，可关闭，不拦截下面宫格的点击（viewer 不显示） -->
    <view v-if="guideVisible" class="guide">
      <text class="guide-text">
        点下面的「喂奶 / 睡觉 / 便便」就能随手记一笔，宝宝的一天才不会漏。
      </text>
      <text class="guide-close" @click="closeGuide">知道了</text>
    </view>

    <text v-if="canWrite" class="hint">三步内记完一件事，随手就能补上。</text>

    <!-- viewer 只读：隐藏全部写入口，只留小结与列表查看（真正拦截靠 RLS） -->
    <view v-if="!canWrite" class="app-card readonly">
      <text class="readonly-text">你是这个家庭的只读成员，可以查看记录，但不能新增或修改</text>
    </view>

    <view v-else class="grid">
      <view v-for="entry in entries" :key="entry.key" class="grid-item" @click="onEntry(entry)">
        <view class="grid-icon" :style="{ backgroundColor: entry.bg }">
          <text class="grid-icon-text" :style="{ color: entry.color }">{{ entry.glyph }}</text>
        </view>
        <text class="grid-title">{{ entry.title }}</text>
        <text class="grid-desc">{{ entry.desc }}</text>
      </view>
    </view>

    <PhotoComposer ref="composer" @saved="onPhotoSaved" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { buildDailySummary } from '@/services/summary'
import { formatFeeding, fetchLatestFeeding } from '@/services/feeding'
import { formatDiaper, diaperLabelParts } from '@/services/diaper'
import { todayString, formatTime, formatDate, formatDateTime, formatMinutes } from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'
import PhotoComposer from '@/components/PhotoComposer/index.vue'

const PAGE_PATH = 'pages/record/record'

/**
 * 「首次进入记录页的轻引导」在本设备的标记位。
 * 不分账号：与 utils/legal.js 的合规确认同一思路，同一台设备看过一次就不再打扰。
 */
const RECORD_GUIDE_STORAGE_KEY = 'babyup.recordGuideSeen'

const store = useAuthStore()

const composer = ref(null)

/** viewer 只读：隐藏功能宫格等写入口 */
const canWrite = computed(() => store.canWrite)

/** 今日小结：进页面就重新聚合一次（从各记录页返回也能看到最新数字） */
const today = todayString()
const summaryLoading = ref(false)
const detailOpen = ref(false)

function emptySummary() {
  return {
    date: today,
    hasAny: false,
    feeding: { total: 0, breastMinutes: 0, formulaMl: 0, waterMl: 0, solidCount: 0, items: [] },
    sleep: { totalMinutes: 0, items: [] },
    diaper: { total: 0, last: null, lastPoop: null, items: [] },
    photo: { count: 0, items: [] },
    growth: { items: [] },
    vaccine: { overdue: 0, soon: 0, pending: 0, vaccinated: 0, todo: 0 },
  }
}

const summary = ref(emptySummary())

const feedingText = computed(() => {
  const item = summary.value.feeding
  const parts = []
  if (item.breastMinutes) parts.push(`母乳 ${item.breastMinutes} 分钟`)
  if (item.formulaMl) parts.push(`配方奶 ${item.formulaMl} ml`)
  if (item.waterMl) parts.push(`水 ${item.waterMl} ml`)
  if (item.solidCount) parts.push(`辅食 ${item.solidCount} 次`)
  return parts.join(' · ')
})

const diaperText = computed(() => {
  // 优先展示最近一条「有性状/颜色」的记录（纯尿没有性状颜色可展示）
  const d = summary.value.diaper
  const source = d.lastPoop || d.last
  if (!source) return ''
  const parts = diaperLabelParts({
    diaper_type: source.type,
    poop_character: source.character,
    poop_color: source.color,
  })
  return `最近 ${parts.join(' · ')}`
})

const growthText = computed(() => {
  const parts = []
  summary.value.growth.items.forEach((row) => {
    if (row.weight_kg != null) parts.push(`体重 ${row.weight_kg} kg`)
    if (row.height_cm != null) parts.push(`身高 ${row.height_cm} cm`)
    if (row.head_cm != null) parts.push(`头围 ${row.head_cm} cm`)
  })
  return parts.join(' · ')
})

const summaryEmptyText = computed(() => {
  if (summaryLoading.value) return '加载中…'
  return canWrite.value ? '今天还没有记录，从下面随手记一笔吧' : '今天还没有记录，家人记下后会显示在这里'
})

/** 最近一次喂养（可能发生在昨天）；没有喂养记录时为 null */
const lastFeeding = ref(null)
/** 算时间差用的「此刻」：进页面时刷新，从喂养页回来数字才会变 */
const nowTs = ref(Date.now())

const lastFeedingText = computed(() => {
  const record = lastFeeding.value
  if (!record || !record.record_time) return ''
  // 本地时间戳相减，跨天（昨天 23:00 → 今天 01:00）自然算对
  const minutes = Math.floor((nowTs.value - new Date(record.record_time).getTime()) / 60000)
  if (!Number.isFinite(minutes) || minutes < 0) return ''
  if (minutes < 1) return '刚刚'
  return formatMinutes(minutes)
})

/** 首次进入引导：展示后立刻写标记，保证「只显示一次」 */
const guideVisible = ref(false)

function guideSeen() {
  try {
    return uni.getStorageSync(RECORD_GUIDE_STORAGE_KEY) === '1'
  } catch (err) {
    console.error('[Record] 读取新手引导标记失败', err)
    // 读取失败按「已看过」处理，避免每次进页面都弹
    return true
  }
}

function showGuideOnce() {
  if (!canWrite.value || guideSeen()) return
  guideVisible.value = true
  try {
    uni.setStorageSync(RECORD_GUIDE_STORAGE_KEY, '1')
  } catch (err) {
    console.error('[Record] 保存新手引导标记失败', err)
  }
}

function closeGuide() {
  guideVisible.value = false
}

function toggleDetail() {
  if (!summary.value.hasAny) return
  detailOpen.value = !detailOpen.value
}

/** 睡眠时段：跨天时起点带上日期，避免看起来像今天开始的 */
function sleepRangeText(item) {
  const startDate = formatDate(item.started_at)
  const start = startDate === today ? formatTime(item.started_at) : formatDateTime(item.started_at).slice(5)
  if (!item.ended_at) return `${start} → 正在睡`
  return `${start} → ${formatTime(item.ended_at)}`
}

async function loadSummary() {
  if (!store.membership || !store.baby) {
    summary.value = emptySummary()
    lastFeeding.value = null
    return
  }
  summaryLoading.value = true
  nowTs.value = Date.now()
  try {
    const familyId = store.membership.family_id
    const babyId = store.baby.id
    // 小结 + 最近一次喂养一起查：后者只取 1 条，不拉全表
    const [daily, latest] = await Promise.all([
      buildDailySummary({ familyId, babyId, date: today }),
      fetchLatestFeeding(familyId, babyId),
    ])
    summary.value = daily
    lastFeeding.value = latest
    console.log('[Record] 今日小结已聚合', {
      feeding: summary.value.feeding.total,
      sleepMinutes: summary.value.sleep.totalMinutes,
      diaper: summary.value.diaper.total,
      photos: summary.value.photo.count,
      lastFeedingAt: latest ? latest.record_time : null,
    })
  } catch (err) {
    console.error('[Record] 聚合今日小结失败', err)
    summary.value = emptySummary()
    lastFeeding.value = null
  } finally {
    summaryLoading.value = false
  }
}

const entries = [
  {
    key: 'photo',
    glyph: '照',
    title: '拍照片',
    desc: '拍照或选图，写一句话',
    bg: 'var(--color-primary-soft)',
    color: 'var(--color-primary-deep)',
  },
  {
    key: 'growth',
    glyph: '量',
    title: '量一量',
    desc: '身高体重头围，看曲线',
    bg: '#E8F1FF',
    color: '#3B7DD8',
  },
  {
    key: 'vaccine',
    glyph: '苗',
    title: '打疫苗',
    desc: '接种记录与到期提醒',
    bg: '#E6F7EE',
    color: '#12B76A',
  },
  {
    key: 'feeding',
    glyph: '奶',
    title: '喂奶',
    desc: '母乳 / 配方奶 / 辅食 / 水',
    bg: '#FFF1E8',
    color: '#E86A33',
  },
  {
    key: 'sleep',
    glyph: '睡',
    title: '睡觉',
    desc: '入睡醒来，自动算时长',
    bg: '#EDF0FF',
    color: '#5B6BE8',
  },
  {
    key: 'diaper',
    glyph: '便',
    title: '便便',
    desc: '尿 / 便 / 混合，看性状颜色',
    bg: '#FFF7E0',
    color: '#C08A00',
  },
  {
    key: 'milestone',
    glyph: '碑',
    title: '里程碑',
    desc: '第一次翻身、第一颗牙',
    bg: '#F1EBFF',
    color: '#7A5AF8',
  },
]

function onEntry(entry) {
  if (entry.key === 'photo') {
    if (composer.value) composer.value.open()
    return
  }
  if (entry.key === 'growth') {
    uni.navigateTo({ url: '/pages/growth/growth?mode=entry' })
    return
  }
  if (entry.key === 'vaccine') {
    uni.navigateTo({ url: '/pages/vaccine/vaccine?mode=entry' })
    return
  }
  if (entry.key === 'feeding') {
    // 表单页默认展开，从记录页到保存只要两步
    uni.navigateTo({ url: '/pages/feeding-edit/feeding-edit' })
    return
  }
  if (entry.key === 'sleep') {
    // 默认入睡=现在、醒来留空，一键记录「开始睡眠」
    uni.navigateTo({ url: '/pages/sleep-edit/sleep-edit' })
    return
  }
  if (entry.key === 'diaper') {
    uni.navigateTo({ url: '/pages/diaper-edit/diaper-edit' })
    return
  }
  if (entry.key === 'milestone') {
    // 先进时间线看历史，再点右上「打卡」
    uni.navigateTo({ url: '/pages/milestone/milestone' })
    return
  }
  uni.showToast({ title: `${entry.title}将在后续步骤实现`, icon: 'none' })
}

/** 从记录页拍完就切到时光页，让用户直接看到刚记下的这条 */
function onPhotoSaved() {
  uni.switchTab({ url: '/pages/index/index' })
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  await store.bootstrap()
  await loadSummary()
  // 补丁 Step 5：首次进入记录页给一次轻引导（内部会判断写权限与「是否已看过」）
  showGuideOnce()
})

// 补丁 Step 4：统一分享卡片（标题与落地页见 @/utils/share）
onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: var(--space-lg);
  box-sizing: border-box;
}

.hint {
  display: block;
  margin-bottom: var(--space-lg);
  font-size: 26rpx;
  color: var(--color-text-muted);
}

/* 首次进入的轻引导条 */
.guide {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-md);
  margin-bottom: var(--space-md);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-md);
}

.guide-text {
  flex: 1;
  font-size: 25rpx;
  color: var(--color-primary-deep);
}

.guide-close {
  padding-left: var(--space-md);
  font-size: 25rpx;
  font-weight: 600;
  color: var(--color-primary);
}

/* 今日小结 */
.summary {
  padding: var(--space-lg);
  margin-bottom: var(--space-md);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.summary-head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
}

.summary-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.summary-date {
  flex: 1;
  margin-left: var(--space-sm);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.summary-toggle {
  font-size: 25rpx;
  color: var(--color-primary);
}

.summary-empty {
  padding: var(--space-md) 0 var(--space-xs);
}

.summary-empty-text {
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.summary-rows {
  margin-top: var(--space-sm);
}

.summary-row {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  padding: 8rpx 0;
}

.summary-label {
  width: 240rpx;
  font-size: 28rpx;
  color: var(--color-text-sub);
}

.summary-value {
  flex: 1;
  font-size: 28rpx;
  color: var(--color-text-main);
}

.detail {
  margin-top: var(--space-md);
  padding-top: var(--space-sm);
  border-top: 1rpx solid var(--color-border);
}

.detail-block {
  margin-bottom: var(--space-md);
}

.detail-title {
  display: block;
  margin-bottom: var(--space-xs);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.detail-line {
  display: block;
  padding: 4rpx 0;
  font-size: 27rpx;
  color: var(--color-text-main);
}

.detail-photos {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: var(--space-xs);
}

.detail-photo {
  width: 150rpx;
  height: 150rpx;
  margin: 0 var(--space-sm) var(--space-sm) 0;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-sm);
}

.grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
}

.readonly {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160rpx;
}

.readonly-text {
  font-size: 26rpx;
  color: var(--color-text-muted);
  text-align: center;
}

.grid-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 48%;
  padding: var(--space-xl) var(--space-md);
  margin-bottom: var(--space-md);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.grid-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 104rpx;
  height: 104rpx;
  border-radius: 50%;
}

.grid-icon-text {
  font-size: 40rpx;
  font-weight: 600;
}

.grid-title {
  margin-top: var(--space-md);
  font-size: 32rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.grid-desc {
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
  text-align: center;
}
</style>
