<template>
  <view class="page">
    <!-- 今日小结（二期）：实时聚合，不落库；空项不显示 -->
    <view class="app-card summary">
      <view class="summary-head" @click="toggleDetail">
        <text class="summary-title">今日小结</text>
        <text class="summary-date">{{ todayLabel }}</text>
        <!-- 加 .stop 阻止冒泡，否则点「历史」会同时把当日明细展开/收起 -->
        <text class="summary-history" @click.stop="goDaily">历史 ›</text>
        <text v-if="summary.hasAny" class="summary-toggle">{{ detailOpen ? '收起明细' : '明细 ›' }}</text>
      </view>

      <!-- 喂奶提醒（三期 P1-8）：开启后，距上次喂养超过月龄上限时置顶提示 -->
      <view v-if="feedingReminderText" class="summary-alert">
        <text class="summary-alert-text">{{ feedingReminderText }}</text>
      </view>

      <view v-if="!summary.hasAny" class="summary-empty">
        <text class="summary-empty-text">
          {{ summaryEmptyText }}
        </text>
      </view>

      <!-- 「距上次喂养」可能来自昨天，所以不放进「今日数据」里，单独抬高一块 -->
      <view v-if="lastFeedingText" class="summary-hero">
        <text class="summary-hero-label">距上次喂养</text>
        <text class="summary-hero-value">{{ lastFeedingText }}</text>
      </view>

      <!-- 展开的当日明细：时间在左、类型点在轨上、内容在右，从上往下就是一天的时间轴 -->
      <view v-if="detailOpen && summary.hasAny" class="detail">
        <view v-if="summary.feeding.items.length" class="detail-block">
          <text class="detail-title">喂养时间线</text>
          <view class="line-list">
            <view class="line-rail" />
            <view v-for="item in summary.feeding.items" :key="item.id" class="line-item">
              <text class="line-time">{{ formatTime(item.record_time) }}</text>
              <view class="line-dot line-dot--feeding" />
              <text class="line-text">
                {{ formatFeeding(item) }}{{ item.note ? ` · ${item.note}` : '' }}
              </text>
            </view>
          </view>
        </view>

        <view v-if="summary.sleep.items.length" class="detail-block">
          <text class="detail-title">睡眠时段</text>
          <view class="line-list">
            <view class="line-rail" />
            <view v-for="item in summary.sleep.items" :key="item.id" class="line-item">
              <text class="line-time">{{ formatTime(item.started_at) }}</text>
              <view class="line-dot line-dot--sleep" />
              <text class="line-text">{{ sleepDetailText(item) }}</text>
            </view>
          </view>
        </view>

        <view v-if="summary.diaper.items.length" class="detail-block">
          <text class="detail-title">便便记录</text>
          <view class="line-list">
            <view class="line-rail" />
            <view v-for="item in summary.diaper.items" :key="item.id" class="line-item">
              <text class="line-time">{{ formatTime(item.record_time) }}</text>
              <view class="line-dot line-dot--diaper" />
              <text class="line-text">
                {{ formatDiaper(item) }}{{ item.note ? ` · ${item.note}` : '' }}
              </text>
            </view>
          </view>
        </view>

        <view v-if="summary.photo.items.length" class="detail-block">
          <text class="detail-title">当日照片</text>
          <view class="detail-photos">
            <image
              v-for="item in summary.photo.items"
              :key="item.id"
              class="detail-photo"
              :src="item.cover_url || item.url"
              mode="aspectFill"
            />
          </view>
        </view>
      </view>

      <!-- 日报分享卡（三期 P1-7）：把今日小结一键变成图，方便发给家人 -->
      <view
        v-if="summary.hasAny"
        class="summary-share"
        :class="{ 'summary-share--disabled': generating }"
        @click="onGenerateCard"
      >
        <text class="summary-share-text">{{ generating ? '生成中…' : '生成分享图' }}</text>
      </view>

      <!-- AI 每日小结：让 AI 主动说一句「今天怎么样」，可复制发家庭群；同一天只生成一次 -->
      <view v-if="aiReady && summary.hasAny" class="ai-summary">
        <view class="ai-summary-head">
          <text class="ai-summary-title">AI 小结</text>
          <view class="ai-summary-links">
            <text v-if="dailySummary" class="ai-summary-link" @click="onCopySummary">复制</text>
            <text v-if="dailySummary" class="ai-summary-link" @click="onDailySummary(true)">
              {{ dailySummarizing ? '生成中…' : '重新生成' }}
            </text>
          </view>
        </view>
        <text v-if="dailySummary" class="ai-summary-text">{{ dailySummary }}</text>
        <view v-else class="ai-summary-btn" @click="onDailySummary(false)">
          <text class="ai-summary-btn-text">
            {{ dailySummarizing ? 'AI 正在看今天的记录…' : '让 AI 说一句今天怎么样' }}
          </text>
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

    <!-- AI 一句话记一笔：像跟家人说话那样描述，AI 解析成记录并让人确认（仅云开发后端可用） -->
    <view v-if="canWrite && aiReady" class="quick-ai" @click="goQuickRecord">
      <text class="quick-ai-glyph">AI</text>
      <view class="quick-ai-main">
        <text class="quick-ai-title">一句话记一笔</text>
        <text class="quick-ai-desc">说「刚喂了 120 毫升配方奶，有点吐奶」，AI 帮你填好</text>
      </view>
      <text class="arrow">›</text>
    </view>

    <!-- viewer 只读：隐藏全部写入口，只留小结与列表查看（真正拦截靠 RLS） -->
    <view v-if="!canWrite" class="app-card readonly">
      <text class="readonly-text">你是这个家庭的只读成员，可以查看记录，但不能新增或修改</text>
    </view>

    <template v-else>
      <view v-if="visibleEntries.length" class="grid">
        <view v-for="entry in visibleEntries" :key="entry.key" class="grid-item" @click="onEntry(entry)">
          <view class="grid-icon" :style="{ backgroundColor: entry.bg }">
            <text class="grid-icon-text" :style="{ color: entry.color }">{{ entry.glyph }}</text>
          </view>
          <text class="grid-title">{{ entry.title }}</text>
          <text class="grid-desc">{{ entry.desc }}</text>
        </view>
      </view>

      <!-- 全关掉时的兜底：不然页面会变成一片空白，看不出工具栏在哪 -->
      <view v-else class="grid-empty">
        <text class="grid-empty-text">记录项都收起来了，点右侧「记录项」再放出来</text>
      </view>
    </template>

    <PhotoComposer ref="composer" @saved="onPhotoSaved" />

    <!-- 分享卡画布：移出屏幕外，只用于导出图片（预览里显示的是导出的文件） -->
    <canvas
      v-if="cardVisible"
      id="dailyCardCanvas"
      canvas-id="dailyCardCanvas"
      class="card-canvas"
      :style="{ width: CARD_WIDTH + 'px', height: CARD_HEIGHT + 'px' }"
    />

    <!-- 分享图预览：生成后可保存到相册，或直接转发给家人 -->
    <view v-if="cardPath" class="card-mask" @click="closeCard">
      <view class="card-box" @click.stop>
        <image class="card-image" :src="cardPath" mode="widthFix" />
        <view class="card-actions">
          <view
            class="card-btn"
            :class="{ 'card-btn--disabled': savingCard }"
            @click="onSaveCard"
          >
            <text class="card-btn-text">{{ savingCard ? '保存中…' : '保存到相册' }}</text>
          </view>
          <!-- #ifdef MP-WEIXIN -->
          <button class="card-btn card-btn--ghost" open-type="share">
            <text class="card-btn-text card-btn-text--ghost">转发给家人</text>
          </button>
          <!-- #endif -->
        </view>
        <text class="card-close" @click="closeCard">关闭</text>
      </view>
    </view>

    <!-- 右侧悬浮工具栏：逐项开关控制宫格里显示哪些记录项，选择存本机；点名字仍可直接去记一笔 -->
    <view v-if="canWrite" class="toolbar">
      <view v-if="toolbarOpen" class="toolbar-mask" @click="toggleToolbar" />
      <view v-if="toolbarOpen" class="toolbar-panel">
        <text class="toolbar-title">显示哪些记录项</text>
        <view v-for="entry in entries" :key="entry.key" class="toolbar-row">
          <text class="toolbar-name" @click="onEntry(entry)">{{ entry.title }}</text>
          <switch
            class="toolbar-switch"
            :checked="!hiddenEntries.includes(entry.key)"
            color="#ff8f6b"
            @change="onToggleEntry(entry, $event)"
          />
        </view>
      </view>
      <view class="toolbar-handle" @click="toggleToolbar">
        <text class="toolbar-handle-text">{{ toolbarOpen ? '›' : '‹' }}</text>
        <text class="toolbar-handle-label">记录项</text>
      </view>
    </view>

    <AppTabBar />
  </view>
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { buildDailySummary } from '@/services/summary'
import { formatFeeding, fetchLatestFeeding, feedOverdueState, formatFeedInterval } from '@/services/feeding'
import { formatDiaper, diaperLabelParts } from '@/services/diaper'
import { todayString, formatTime, formatDate, formatMinutes } from '@/utils/date'
import { formatAge } from '@/utils/age'
import { loadImage, saveImageToAlbum } from '@/utils/media'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'
import { track } from '@/utils/tracker'
import PhotoComposer from '@/components/PhotoComposer/index.vue'
import AppTabBar from '@/components/AppTabBar/index.vue'
import { syncActiveTabFromRoute } from '@/utils/tabbar'
import { APP_BRAND } from '@/config'
import { isAiChatAvailable, summarizeDay, loadDailySummary, saveDailySummary } from '@/services/ai'
import { ensurePrivacyAuthorized } from '@/utils/privacy'

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
/** AI 只有云开发后端才有（Supabase / H5 下没有），不可用时整块入口不渲染 */
const aiReady = isAiChatAvailable()

/** AI 小结文案：缓存在本机，按「账号 + 宝宝 + 日期」存，同一天不重复花模型额度 */
const dailySummary = ref('')
const dailySummarizing = ref(false)

/** 读本机缓存的今日小结（换宝宝、换天都会取到对应那份） */
function loadDailySummaryFromCache() {
  dailySummary.value = loadDailySummary(store.userId, store.currentBabyId, todayString())
}

/** 今天已经自动尝试过的标记（同一次运行内不重复尝试，免得每次切回来都白跑一次） */
let dailySummaryTriedTag = ''

/**
 * 进页面时自动补一次小结：当天有记录、又还没生成过，就静默生成。
 *
 * 生成成功会写进本机缓存，所以一天只会成功一次；失败就退回按钮让用户手动点，
 * 不会因为反复进页面而反复请求。
 */
async function ensureDailySummary() {
  if (!aiReady || !summary.value.hasAny || dailySummary.value) return
  const tag = `${store.currentBabyId}:${todayString()}`
  if (dailySummaryTriedTag === tag) return
  dailySummaryTriedTag = tag
  await onDailySummary(false)
}

/**
 * 让 AI 写今天的小结。
 * @param {boolean} force 重新生成：跳过缓存、再花一次模型额度
 */
async function onDailySummary(force) {
  if (dailySummarizing.value) return
  const date = todayString()

  if (!force) {
    const cached = loadDailySummary(store.userId, store.currentBabyId, date)
    if (cached) {
      dailySummary.value = cached
      return
    }
  }

  if (!store.membership || !store.baby) {
    uni.showToast({ title: '还没有宝宝档案', icon: 'none' })
    return
  }

  dailySummarizing.value = true
  try {
    const text = await summarizeDay({
      familyId: store.membership.family_id,
      babyId: store.baby.id,
      baby: store.baby,
    })
    dailySummary.value = text
    saveDailySummary(store.userId, store.currentBabyId, date, text)
  } catch (err) {
    console.error('[Record] AI 小结生成失败', err)
    uni.showToast({ title: err.message || 'AI 暂时不可用，请稍后重试', icon: 'none' })
  } finally {
    dailySummarizing.value = false
  }
}

/** 复制小结，方便直接发到家庭群（写剪切板属隐私接口，先过隐私授权） */
async function onCopySummary() {
  if (!dailySummary.value) return
  const allowed = await ensurePrivacyAuthorized()
  if (!allowed) {
    uni.showToast({ title: '需要同意隐私政策后才能复制', icon: 'none' })
    return
  }
  uni.setClipboardData({
    data: dailySummary.value,
    success: () => uni.showToast({ title: '已复制', icon: 'none' }),
    fail: (err) => {
      console.error('[Record] 复制小结失败', err)
      uni.showToast({ title: '复制失败', icon: 'none' })
    },
  })
}

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

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 头部日期：显示成「9月22日 周一」，比原始的 2026-09-22 好读 */
const todayLabel = computed(() => {
  const date = new Date(`${today}T00:00:00`)
  if (Number.isNaN(date.getTime())) return today
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`
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

/**
 * 喂奶提醒文案（三期 P1-8）。
 * 三个条件都满足才提示：该宝宝开启了提醒、有喂养记录作为起点、已超过间隔上限。
 * 页面上只做展示，真正推给家人的订阅消息由云函数 feeding-reminder 定时发送。
 */
const feedingReminderText = computed(() => {
  const baby = store.baby
  const record = lastFeeding.value
  if (!baby || !baby.feed_remind_enabled || !record) return ''
  const state = feedOverdueState(baby, record.record_time, nowTs.value)
  if (!state.overdue) return ''
  return `已超过 ${formatFeedInterval(state.limit)} 没有记录喂奶，该喂奶啦`
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

/** 睡眠时段右侧内容：结束时间 + 时长；跨天时段标一下，免得「23:00 → 07:00」看着像倒着走 */
function sleepDetailText(item) {
  const parts = [item.ended_at ? `→ ${formatTime(item.ended_at)}` : '→ 正在睡']
  const duration = item.sleeping ? `已 ${formatMinutes(item.minutes)}` : formatMinutes(item.minutes)
  if (duration) parts.push(duration)
  if (formatDate(item.started_at) !== today) parts.push('跨夜')
  return parts.join(' · ')
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

/* ---------- 日报分享卡（三期 P1-7） ---------- */

/** 分享卡逻辑尺寸：竖版小卡片，导出时按 2 倍放大保证文字清晰 */
const CARD_CANVAS_ID = 'dailyCardCanvas'
const CARD_WIDTH = 375
const CARD_HEIGHT = 600
const CARD_EXPORT_SCALE = 2
const CARD_HEADER_HEIGHT = 150
const CARD_PAD = 24
const CARD_AVATAR = 68
const CARD_X = 24
const CARD_Y = 170
const CARD_W = 327
const CARD_ROW_START_Y = CARD_Y + 84
const CARD_ROW_STEP = 34
const CARD_BRAND_Y = 540
const CARD_TAGLINE_Y = 562

const instance = getCurrentInstance()

const cardVisible = ref(false)
const cardPath = ref('')
const generating = ref(false)
const savingCard = ref(false)

const babyName = computed(() => (store.baby ? store.baby.name : '宝宝'))
const babyAge = computed(() => (store.baby ? formatAge(store.baby.birthday, today) : ''))
/** 头像旁的副标题：日期 + 月龄（生日缺失时只留日期） */
const cardSubTitle = computed(() => (babyAge.value ? `${today} · ${babyAge.value}` : today))

/** 分享卡上的数据行：口径与「今日小结」卡片完全一致，空项不列 */
function cardRows(current) {
  const rows = []
  if (lastFeedingText.value) rows.push({ label: '距上次喂养', value: lastFeedingText.value })
  if (current.feeding.total) {
    rows.push({ label: `喂养 ${current.feeding.total} 次`, value: feedingText.value })
  }
  if (current.sleep.totalMinutes) {
    rows.push({ label: '睡眠', value: formatMinutes(current.sleep.totalMinutes) })
  }
  if (current.diaper.total) {
    rows.push({ label: `便便 ${current.diaper.total} 次`, value: diaperText.value })
  }
  if (current.photo.count) rows.push({ label: '照片', value: `${current.photo.count} 张` })
  if (current.growth.items.length) rows.push({ label: '生长', value: growthText.value })
  if (current.vaccine.overdue || current.vaccine.soon) {
    rows.push({
      label: '疫苗',
      value: `已逾期 ${current.vaccine.overdue} · 近 7 天 ${current.vaccine.soon}`,
    })
  }
  return rows
}

/** 数据行的值可能很长（如喂养明细），超宽就截断，避免压出卡片外 */
function truncate(text, max) {
  const value = String(text || '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** 圆角矩形路径（legacy canvas 没有 roundRect，手写四段弧） */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

async function drawCard() {
  const current = summary.value
  const rows = cardRows(current)
  const ctx = uni.createCanvasContext(CARD_CANVAS_ID, instance)
  // 卡片高度随行数变化；品牌落款固定在底部，行数少时留白而不是把落款顶上去
  const cardHeight = CARD_ROW_START_Y - CARD_Y + rows.length * CARD_ROW_STEP

  ctx.setFillStyle('#FFF6F1')
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
  ctx.setFillStyle('#FFE9E1')
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEADER_HEIGHT)

  // 头像：圆形裁切，取不到图时退回「名字首字」
  const avatarPath = store.babyAvatarUrl ? await loadImage(store.babyAvatarUrl) : ''
  const radius = CARD_AVATAR / 2
  const centerX = CARD_PAD + radius
  const centerY = CARD_HEADER_HEIGHT / 2
  if (avatarPath) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    ctx.drawImage(avatarPath, centerX - radius, centerY - radius, CARD_AVATAR, CARD_AVATAR)
    ctx.restore()
  } else {
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
    ctx.closePath()
    ctx.setFillStyle('#FFFFFF')
    ctx.fill()
    ctx.setTextAlign('center')
    ctx.setFillStyle('#FF8F6B')
    ctx.setFontSize(24)
    ctx.fillText(truncate(babyName.value, 1), centerX, centerY + 8)
  }

  ctx.setTextAlign('left')
  ctx.setFillStyle('#1F2329')
  ctx.setFontSize(20)
  ctx.fillText(truncate(babyName.value, 8), centerX + radius + 12, centerY - 2)
  ctx.setFillStyle('#8A9099')
  ctx.setFontSize(12)
  ctx.fillText(cardSubTitle.value, centerX + radius + 12, centerY + 20)

  // 数据卡
  ctx.setFillStyle('#FFFFFF')
  roundRect(ctx, CARD_X, CARD_Y, CARD_W, cardHeight, 14)
  ctx.fill()

  ctx.setTextAlign('left')
  ctx.setFillStyle('#1F2329')
  ctx.setFontSize(16)
  ctx.fillText('今日小结', CARD_X + 20, CARD_Y + 36)
  ctx.setFillStyle('#EEF0F3')
  ctx.fillRect(CARD_X + 20, CARD_Y + 52, CARD_W - 40, 1)

  rows.forEach((row, index) => {
    const y = CARD_ROW_START_Y + index * CARD_ROW_STEP
    ctx.setTextAlign('left')
    ctx.setFillStyle('#5C6370')
    ctx.setFontSize(13)
    ctx.fillText(row.label, CARD_X + 20, y)
    ctx.setTextAlign('right')
    ctx.setFillStyle('#1F2329')
    ctx.fillText(truncate(row.value, 16), CARD_X + CARD_W - 20, y)
  })

  // 品牌落款
  ctx.setTextAlign('center')
  ctx.setFillStyle('#FF8F6B')
  ctx.setFontSize(15)
  ctx.fillText(APP_BRAND, CARD_WIDTH / 2, CARD_BRAND_Y)
  ctx.setFillStyle('#8A9099')
  ctx.setFontSize(11)
  ctx.fillText('记录宝宝的每一个第一次', CARD_WIDTH / 2, CARD_TAGLINE_Y)

  await new Promise((resolve) => {
    ctx.draw(false, () => resolve())
  })
}

/** canvas 导出成临时图片文件（预览与保存相册都用它） */
function canvasToFile() {
  return new Promise((resolve, reject) => {
    uni.canvasToTempFilePath(
      {
        canvasId: CARD_CANVAS_ID,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        destWidth: CARD_WIDTH * CARD_EXPORT_SCALE,
        destHeight: CARD_HEIGHT * CARD_EXPORT_SCALE,
        success: (res) => resolve(res.tempFilePath),
        fail: (err) => {
          console.error('[Record] 导出分享图失败', err)
          reject(new Error('图片生成失败，请重试'))
        },
      },
      instance,
    )
  })
}

async function onGenerateCard() {
  if (generating.value) return
  if (!summary.value.hasAny) {
    uni.showToast({ title: '今天还没有记录哦', icon: 'none' })
    return
  }
  generating.value = true
  try {
    cardPath.value = ''
    cardVisible.value = true
    // 画布是 v-if 挂载的，要等它进 DOM 之后才能创建 context
    await nextTick()
    await drawCard()
    cardPath.value = await canvasToFile()
    console.log('[Record] 日报分享卡已生成', { rows: cardRows(summary.value).length })
    track('action', 'daily_card_generate', { rows: cardRows(summary.value).length })
  } catch (err) {
    console.error('[Record] 生成分享图失败', err)
    cardVisible.value = false
    uni.showToast({ title: err.message || '生成失败，请重试', icon: 'none' })
  } finally {
    generating.value = false
  }
}

async function onSaveCard() {
  if (savingCard.value || !cardPath.value) return
  savingCard.value = true
  try {
    await saveImageToAlbum(cardPath.value)
    uni.showToast({ title: '已保存到相册', icon: 'success' })
  } catch (err) {
    // 权限问题 saveImageToAlbum 里已经弹窗引导过，这里只提示其它失败
    if (err && err.message && err.message !== '未获得相册权限') {
      uni.showToast({ title: err.message, icon: 'none' })
    }
  } finally {
    savingCard.value = false
  }
}

function closeCard() {
  cardPath.value = ''
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
  {
    key: 'illness',
    glyph: '病',
    title: '生病',
    desc: '症状、体温、用药',
    bg: '#FFECEC',
    color: '#E8503A',
  },
  {
    key: 'checkup',
    glyph: '检',
    title: '儿保体检',
    desc: '身高体重、发育评估',
    bg: '#E3F4F6',
    color: '#2C8C99',
  },
]

/**
 * 「宫格里显示哪些记录项」在本设备的标记位（存本机，家人各自设备互不影响）。
 * 存的是「被关掉的项目」，这样以后新增记录项默认是显示状态，不用迁移旧数据。
 */
const RECORD_ENTRY_STORAGE_KEY = 'babyup.recordEntryHidden'

function loadHiddenEntries() {
  try {
    const raw = uni.getStorageSync(RECORD_ENTRY_STORAGE_KEY)
    if (Array.isArray(raw)) return raw
    const parsed = typeof raw === 'string' && raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.error('[Record] 读取记录项显隐失败', err)
    // 读失败按「全显示」处理，宁可多显示也不要让宫格空着
    return []
  }
}

const hiddenEntries = ref(loadHiddenEntries())
const toolbarOpen = ref(false)

/** 宫格实际渲染的记录项：过滤掉被关掉的 */
const visibleEntries = computed(() => entries.filter((entry) => !hiddenEntries.value.includes(entry.key)))

function saveHiddenEntries() {
  try {
    uni.setStorageSync(RECORD_ENTRY_STORAGE_KEY, hiddenEntries.value)
  } catch (err) {
    console.error('[Record] 保存记录项显隐失败', err)
  }
}

/** 开关回调：关掉就记进隐藏清单，打开就从清单里摘掉 */
function onToggleEntry(entry, event) {
  const checked = event.detail.value
  const rest = hiddenEntries.value.filter((key) => key !== entry.key)
  hiddenEntries.value = checked ? rest : [...rest, entry.key]
  saveHiddenEntries()
}

function toggleToolbar() {
  toolbarOpen.value = !toolbarOpen.value
}

/** 「历史 ›」：进每日小结页，看每天一张卡的纵向对比 */
function goDaily() {
  uni.navigateTo({ url: '/pages/daily/daily' })
}

/** 「一句话记一笔」：AI 把一句话解析成记录，确认后才写库（见 pages/ai-quick-record） */
function goQuickRecord() {
  uni.navigateTo({
    url: '/pages/ai-quick-record/ai-quick-record',
    fail: (err) => console.error('[Record] 打开一句话记一笔失败', err),
  })
}

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
  if (entry.key === 'illness') {
    // 先进列表看历史，再点右上「记录」
    uni.navigateTo({ url: '/pages/illness/illness' })
    return
  }
  if (entry.key === 'checkup') {
    // 先进列表看历史，再点右上「记录」
    uni.navigateTo({ url: '/pages/checkup/checkup' })
    return
  }
  uni.showToast({ title: `${entry.title}将在后续步骤实现`, icon: 'none' })
}

/** 从记录页拍完就切到时光页，让用户直接看到刚记下的这条 */
function onPhotoSaved() {
  // 时光页会复用上次结果，这里置脏让它切过去时重新拉取
  store.markTimelineDirty()
  uni.switchTab({ url: '/pages/index/index' })
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  // 同步自定义底栏的高亮（底栏组件见 components/AppTabBar）
  syncActiveTabFromRoute()
  await store.bootstrap()
  await loadSummary()
  // AI 小结：先读本机缓存，没有就自动补一次（一天只补一次，见 ensureDailySummary）
  loadDailySummaryFromCache()
  ensureDailySummary()
  // 补丁 Step 5：首次进入记录页给一次轻引导（内部会判断写权限与「是否已看过」）
  showGuideOnce()
})

// 补丁 Step 4：统一分享卡片（标题与落地页见 @/utils/share）
// 补丁 Step 7：分享图已生成时用它当卡片图（本地临时文件，微信支持），否则沿用统一文案卡片
onShareAppMessage(() => {
  const base = defaultShare()
  if (cardPath.value) return { ...base, imageUrl: cardPath.value }
  return base
})
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: var(--space-lg);
  /* 给底部的自定义 tabBar 让位（横条 + 安全区 + 一点呼吸），否则滑到底最后一张卡被压住 */
  padding-bottom: calc(var(--tabbar-height) + constant(safe-area-inset-bottom) + var(--space-lg));
  padding-bottom: calc(var(--tabbar-height) + env(safe-area-inset-bottom) + var(--space-lg));
  box-sizing: border-box;
}

.hint {
  display: block;
  margin-bottom: var(--space-lg);
  font-size: 26rpx;
  color: var(--color-text-muted);
}

/*
 * 「一句话记一笔」入口：AI 是加速记录的手段，所以紧跟在「三步内记完一件事」后面、
 * 宫格之前。紫色沿用工具页 AI 卡片的色板，两个入口看起来是同一个能力。
 */
.quick-ai {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-md);
  margin-bottom: var(--space-lg);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.quick-ai-glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 76rpx;
  height: 76rpx;
  margin-right: var(--space-md);
  font-size: 28rpx;
  font-weight: 600;
  color: #ffffff;
  background-image: linear-gradient(135deg, #b9a6ff 0%, #8b6df0 55%, #7a5af8 100%);
  border-radius: var(--radius-md);
}

.quick-ai-main {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.quick-ai-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.quick-ai-desc {
  margin-top: 4rpx;
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.arrow {
  margin-left: var(--space-xs);
  font-size: 36rpx;
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
  align-items: center;
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

/* 「历史 ›」：纯文字，弱于右侧的「明细 ›」按钮，避免两个入口抢视线 */
.summary-history {
  margin-right: var(--space-sm);
  font-size: 24rpx;
  color: var(--color-text-sub);
}

.summary-toggle {
  padding: 4rpx var(--space-sm);
  font-size: 24rpx;
  color: var(--color-primary-deep);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

/* 喂奶提醒：左侧色条 + 深色字，像一条提醒但不至于像报错 */
.summary-alert {
  margin-top: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background-color: var(--color-bg-card);
  border-left: 6rpx solid var(--color-warning);
  border-radius: var(--radius-sm);
}

.summary-alert-text {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.summary-empty {
  padding: var(--space-md) 0 var(--space-xs);
}

.summary-empty-text {
  font-size: 26rpx;
  color: var(--color-text-muted);
}

/* 距上次喂养：小结里最该先看到的一个数，单独用主色浅底抬高 */
.summary-hero {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  margin-top: var(--space-sm);
  padding: var(--space-md);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-md);
}

.summary-hero-label {
  font-size: 26rpx;
  color: var(--color-primary-deep);
}

.summary-hero-value {
  font-size: 40rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

/* 生成分享图（三期 P1-7）：整条按钮，低干扰配色，不抢上面数据行的注意力 */
.summary-share {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 76rpx;
  margin-top: var(--space-md);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.summary-share--disabled {
  opacity: 0.6;
}

/* AI 小结：贴在今日小结卡里，用一条分隔线把它和上面的数据区分开 */
.ai-summary {
  padding-top: var(--space-md);
  margin-top: var(--space-md);
  border-top: 1rpx solid var(--color-border);
}

.ai-summary-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.ai-summary-title {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.ai-summary-links {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.ai-summary-link {
  margin-left: var(--space-md);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.ai-summary-text {
  display: block;
  margin-top: var(--space-sm);
  font-size: 27rpx;
  line-height: 1.7;
  color: var(--color-text-main);
}

.ai-summary-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 76rpx;
  margin-top: var(--space-sm);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.ai-summary-btn-text {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.summary-share-text {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
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
  font-weight: 600;
  color: var(--color-text-sub);
}

/* 时间轴：一条竖轨铺满整块，圆点压在轨上；轨两端各留出半个圆点，不会长出多余的头尾 */
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

.grid-empty {
  padding: var(--space-xl) var(--space-md);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.grid-empty-text {
  display: block;
  font-size: 26rpx;
  color: var(--color-text-muted);
  text-align: center;
}

/* 右侧悬浮工具栏：收起时只剩一条贴着右缘的把手，展开后是记录项开关清单 */
.toolbar {
  position: fixed;
  top: 24%;
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
}

/* 展开时铺一层透明遮罩，点空白处收回清单 */
.toolbar-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: -1;
}

.toolbar-handle {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 58rpx;
  padding: var(--space-sm) 0;
  background-color: var(--color-primary);
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  box-shadow: var(--shadow-card);
}

.toolbar-handle-text {
  font-size: 26rpx;
  font-weight: 600;
  color: #ffffff;
}

/* 竖排的「记录项」：窄列里中文自然逐字换行 */
.toolbar-handle-label {
  width: 30rpx;
  margin-top: var(--space-xs);
  font-size: 22rpx;
  line-height: 1.25;
  color: #ffffff;
  text-align: center;
}

.toolbar-panel {
  width: 340rpx;
  padding: var(--space-md);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  box-shadow: var(--shadow-card);
}

.toolbar-title {
  display: block;
  margin-bottom: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.toolbar-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 6rpx 0;
}

.toolbar-name {
  flex: 1;
  font-size: 27rpx;
  color: var(--color-text-main);
}

/* switch 原生尺寸偏大，缩一下并用负外边距收掉多出来的占位高度 */
.toolbar-switch {
  flex: none;
  margin: -14rpx 0;
  transform: scale(0.6);
  transform-origin: right center;
}

/* 分享卡画布：只用于导出图片，移到屏幕外不占版面（display:none 的平台画不出来） */
.card-canvas {
  position: fixed;
  top: 0;
  left: -9999px;
}

/* 分享图预览弹层 */
.card-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.6);
}

.card-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 84%;
  max-width: 640rpx;
  padding: var(--space-lg);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-sizing: border-box;
}

.card-image {
  width: 100%;
  border-radius: var(--radius-md);
}

.card-actions {
  display: flex;
  flex-direction: column;
  width: 100%;
  margin-top: var(--space-lg);
}

.card-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  margin: 0;
  padding: 0;
  line-height: normal;
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

/* 小程序 button 自带一层边框伪元素，这里统一去掉 */
.card-btn::after {
  border: none;
}

.card-btn--ghost {
  margin-top: var(--space-sm);
  background-color: transparent;
  border: 2rpx solid var(--color-primary);
}

.card-btn--disabled {
  opacity: 0.6;
}

.card-btn-text {
  font-size: 30rpx;
  font-weight: 600;
  color: #ffffff;
}

.card-btn-text--ghost {
  color: var(--color-primary);
}

.card-close {
  margin-top: var(--space-md);
  font-size: 26rpx;
  color: var(--color-text-muted);
}
</style>
