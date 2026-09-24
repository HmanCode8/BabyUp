<template>
  <view class="page">
    <!-- 顶部说明：这份页面就是「今日小结」的历史版，口径与它完全一致 -->
    <view class="app-card head">
      <text class="head-title">{{ babyName }} · 每天的小结</text>
      <text class="head-tip">
        每天一张卡，数字右边是这一天与前一天相比的增减；前一天没有记录时不显示对比。点日期那一行可以展开当天明细。
      </text>
    </view>

    <view v-if="!store.baby" class="app-card empty">
      <text class="empty-text">还没有宝宝档案，先去建一个吧</text>
    </view>

    <template v-else>
      <view v-for="card in cards" :key="card.date" class="app-card day">
        <!-- 整行可点：展开/收起这一天的明细时间线 -->
        <view class="day-head" @click="toggleDay(card.date)">
          <text class="day-title">{{ card.title }}</text>
          <text class="day-sub">{{ card.sub }}</text>
          <text v-if="card.hasAny" class="day-toggle">
            {{ card.expanded ? '收起' : '明细' }}
          </text>
        </view>

        <text v-if="!card.hasAny" class="day-empty">这天没有喂养、睡眠或尿布记录</text>

        <view v-else class="rows">
          <view v-for="row in card.rows" :key="row.key" class="row-line">
            <text class="row-label">{{ row.label }}</text>
            <text class="row-value">{{ row.text }}</text>
            <text class="row-delta" :class="row.deltaClass">{{ row.deltaText }}</text>
          </view>
        </view>

        <!-- 展开的当日时间线：与记录页「今日小结 → 明细」同一套呈现，收起时完全不渲染 -->
        <view v-if="card.expanded && card.timeline.length" class="timeline">
          <text class="timeline-title">当日明细</text>
          <view class="line-list">
            <view class="line-rail" />
            <view v-for="entry in card.timeline" :key="entry.key" class="line-item">
              <text class="line-time">{{ formatTime(entry.time) }}</text>
              <view class="line-dot" :class="'line-dot--' + entry.kind" />
              <text class="line-text">{{ entry.text }}</text>
            </view>
          </view>
        </view>
      </view>

      <view v-if="loading" class="foot">
        <text class="foot-text">加载中…</text>
      </view>
      <view v-else-if="canLoadMore" class="more" @click="loadMore">
        <text class="more-text">查看更早的小结</text>
      </view>
      <view v-else-if="cards.length" class="foot">
        <text class="foot-text">最多回看最近 {{ MAX_DAYS }} 天</text>
      </view>

      <text v-if="errorText" class="error">{{ errorText }}</text>
    </template>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { buildDailySummaries } from '@/services/summary'
import { formatFeeding } from '@/services/feeding'
import { formatDiaper } from '@/services/diaper'
import { todayString, diffDays, formatDate, formatTime, formatMinutes } from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/daily/daily'

/** 首屏天数与「查看更早」每次增加的天数 */
const PAGE_DAYS = 7
/**
 * 最多回看多少天。
 * 上限来自查询额度：listFeedings / listDiapers 单次最多取 500 条，一天十来条喂养的话
 * 一个月就是三百多条，再往上就可能被截断导致早期天数统计偏少。
 */
const MAX_DAYS = 31

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * 卡片上要展示的指标。
 * always 的三行每天都摆（位置固定才好上下扫一眼对比），其余只在有数时出现。
 */
const METRICS = [
  { key: 'feedingCount', label: '喂养', always: true, get: (day) => day.feeding.total, fmt: (v) => `${v} 次` },
  { key: 'formulaMl', label: '配方奶', always: false, get: (day) => day.feeding.formulaMl, fmt: (v) => `${v} ml` },
  {
    key: 'breastMinutes',
    label: '母乳',
    always: false,
    get: (day) => day.feeding.breastMinutes,
    fmt: (v) => `${v} 分钟`,
  },
  {
    key: 'sleepMinutes',
    label: '睡眠',
    always: true,
    get: (day) => day.sleep.totalMinutes,
    fmt: (v) => formatMinutes(v) || '0 分钟',
  },
  { key: 'diaperCount', label: '尿布', always: true, get: (day) => day.diaper.total, fmt: (v) => `${v} 次` },
]

const store = useAuthStore()

const loading = ref(false)
const errorText = ref('')
const dayCount = ref(PAGE_DAYS)
const days = ref([])

const babyName = computed(() => (store.baby ? store.baby.name : '宝宝'))
const canLoadMore = computed(() => dayCount.value < MAX_DAYS && days.value.length > 0)

/** 「今天 / 昨天 / 前天」这类相对称呼；更早的直接写月日 */
function dayTitle(date) {
  const back = diffDays(date, todayString())
  if (back === 0) return '今天'
  if (back === 1) return '昨天'
  if (back === 2) return '前天'
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日`
}

/** 副标题：标题用了相对称呼时补上具体日期，否则只补星期 */
function daySub(date) {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return ''
  const week = WEEKDAYS[parsed.getDay()]
  const back = diffDays(date, todayString())
  const monthDay = `${parsed.getMonth() + 1}月${parsed.getDate()}日`
  return back >= 0 && back <= 2 ? `${monthDay} ${week}` : week
}

/** 一天的指标行：值 + 与前一天相比的增减 */
function buildRows(day) {
  const prev = day.prev
  // 前一天完全没记录时不给对比：否则「昨天忘了记」会被读成「今天暴增」
  const comparable = Boolean(prev) && day.prevHasAny
  return METRICS.filter((metric) => metric.always || metric.get(day) > 0 || (prev && metric.get(prev) > 0)).map(
    (metric) => {
      const value = metric.get(day)
      const delta = value - (prev ? metric.get(prev) : 0)
      let deltaText = ''
      let deltaClass = ''
      if (comparable && delta !== 0) {
        deltaText = `${delta > 0 ? '↑' : '↓'} ${metric.fmt(Math.abs(delta))}`
        deltaClass = delta > 0 ? 'row-delta--up' : 'row-delta--down'
      } else if (comparable) {
        deltaText = '持平'
        deltaClass = 'row-delta--same'
      }
      return { key: metric.key, label: metric.label, text: metric.fmt(value), deltaText, deltaClass }
    },
  )
}

/** 睡眠明细：醒来时间 + 这一天的时长，跨夜再补一个标记 */
function sleepTimeText(item) {
  const parts = [item.ended_at ? `→ ${formatTime(item.ended_at)}` : '→ 正在睡']
  const duration = formatMinutes(item.minutes)
  if (duration) parts.push(duration)
  // 入睡在昨天、今天还睡了一段：这一觉算在两天里，标出来才不会被当成两次入睡
  if (formatDate(item.started_at) !== item.dayDate) parts.push('跨夜')
  return parts.join(' · ')
}

/**
 * 一天的明细时间线：喂养 / 睡眠 / 便便合成一条，按时间正序。
 * 只在卡片展开时构造（见 cards），收起时一行都不算。
 */
function buildTimeline(day) {
  const entries = []
  day.feeding.items.forEach((item) => {
    entries.push({
      key: `feeding-${item.id}`,
      kind: 'feeding',
      time: item.record_time,
      text: `${formatFeeding(item)}${item.note ? ` · ${item.note}` : ''}`,
    })
  })
  day.sleep.items.forEach((item) => {
    entries.push({
      key: `sleep-${item.id}`,
      kind: 'sleep',
      time: item.started_at,
      text: sleepTimeText(item),
    })
  })
  day.diaper.items.forEach((item) => {
    entries.push({
      key: `diaper-${item.id}`,
      kind: 'diaper',
      time: item.record_time,
      text: `${formatDiaper(item)}${item.note ? ` · ${item.note}` : ''}`,
    })
  })
  return entries.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
}

/** 展开了哪些天（按日期存，重新加载后展开状态还在） */
const expanded = ref({})

function toggleDay(date) {
  expanded.value = { ...expanded.value, [date]: !expanded.value[date] }
}

/** 渲染用的卡片列表：最近的一天在最上面 */
const cards = computed(() =>
  [...days.value].reverse().map((day) => {
    const isOpen = Boolean(expanded.value[day.date])
    return {
      date: day.date,
      title: dayTitle(day.date),
      sub: daySub(day.date),
      hasAny: day.hasAny,
      rows: buildRows(day),
      expanded: isOpen,
      timeline: isOpen ? buildTimeline(day) : [],
    }
  }),
)

async function load(count) {
  if (!store.membership || !store.baby) {
    days.value = []
    return
  }
  loading.value = true
  errorText.value = ''
  try {
    days.value = await buildDailySummaries({
      familyId: store.membership.family_id,
      babyId: store.baby.id,
      days: count,
    })
    console.log('[Daily] 已聚合每日小结', days.value.length, '天')
  } catch (err) {
    console.error('[Daily] 聚合每日小结失败', err)
    days.value = []
    errorText.value = err.message || '加载失败，请重试'
  } finally {
    loading.value = false
  }
}

function loadMore() {
  if (loading.value || !canLoadMore.value) return
  dayCount.value = Math.min(dayCount.value + PAGE_DAYS, MAX_DAYS)
  load(dayCount.value)
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  await store.bootstrap()
  // 从记录页增删记录后返回也要看到最新数字，所以每次进页面重新拉
  dayCount.value = PAGE_DAYS
  await load(dayCount.value)
})

onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: var(--space-lg);
  box-sizing: border-box;
}

.head {
  margin-bottom: var(--space-md);
}

.head-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.head-tip {
  display: block;
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.empty {
  align-items: center;
}

.empty-text {
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.day {
  margin-bottom: var(--space-md);
}

.day-head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
}

.day-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.day-sub {
  flex: 1;
  margin-left: var(--space-sm);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.day-empty {
  display: block;
  padding-top: var(--space-sm);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

/* 「明细 / 收起」开关：跟日期行同一行，整行都是热区 */
.day-toggle {
  flex: none;
  margin-left: var(--space-sm);
  font-size: 24rpx;
  color: var(--color-primary-deep);
}

.timeline {
  margin-top: var(--space-md);
  padding-top: var(--space-sm);
  border-top: 1rpx solid var(--color-border);
}

.timeline-title {
  display: block;
  margin-bottom: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

/* 时间线：时间在左、色点在轨上、内容在右，与记录页的今日小结明细一致 */
.line-list {
  position: relative;
}

.line-rail {
  position: absolute;
  top: 28rpx;
  bottom: 28rpx;
  left: 117rpx;
  width: 2rpx;
  background-color: var(--color-border);
}

.line-item {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  padding: 8rpx 0;
}

.line-time {
  flex: none;
  width: 112rpx;
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.line-dot {
  flex: none;
  width: 12rpx;
  height: 12rpx;
  margin-top: 14rpx;
  margin-right: var(--space-sm);
  border-radius: 50%;
}

/* 三种点色与记录页宫格的图标同色，一眼能对上 */
.line-dot--feeding {
  background-color: #e86a33;
}

.line-dot--sleep {
  background-color: #5b6be8;
}

.line-dot--diaper {
  background-color: #c08a00;
}

.line-text {
  flex: 1;
  font-size: 27rpx;
  line-height: 1.5;
  color: var(--color-text-main);
}

.rows {
  padding-top: var(--space-xs);
}

/* 每行「指标名 — 数值 — 与前一天对比」，数值与对比固定宽度才好在纵向扫的时候对齐 */
.row-line {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-xs) 0;
}

.row-label {
  width: 120rpx;
  font-size: 26rpx;
  color: var(--color-text-sub);
}

.row-value {
  flex: 1;
  font-size: 28rpx;
  color: var(--color-text-main);
}

.row-delta {
  min-width: 150rpx;
  font-size: 24rpx;
  text-align: right;
}

/* 只表示「变多 / 变少」，不做好坏判断，所以不用红绿 */
.row-delta--up {
  color: var(--color-primary-deep);
}

.row-delta--down {
  color: var(--color-text-sub);
}

.row-delta--same {
  color: var(--color-text-muted);
}

.more {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 84rpx;
  margin-bottom: var(--space-md);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.more-text {
  font-size: 27rpx;
  color: var(--color-primary-deep);
}

.foot {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-md) 0;
}

.foot-text {
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.error {
  display: block;
  padding: var(--space-sm) 0;
  font-size: 25rpx;
  color: var(--color-danger);
}
</style>
