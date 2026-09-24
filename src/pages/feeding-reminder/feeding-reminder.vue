<template>
  <view class="page">
    <!-- 设置是按宝宝存的（不同月龄推荐间隔不同），所以先把「给谁设」说清楚 -->
    <view class="app-card baby-card">
      <view class="baby-main">
        <text class="baby-name">{{ babyName }}</text>
        <text class="baby-sub">{{ babySub }}</text>
      </view>
      <text v-if="tierLabel" class="baby-tier">{{ tierLabel }}</text>
    </view>

    <view v-if="!store.baby" class="tip">
      <text class="tip-text">还没有宝宝档案，请先到「我的」页添加宝宝</text>
    </view>

    <template v-else>
      <view class="app-card">
        <view class="row">
          <text class="row-label">开启喂奶提醒</text>
          <switch :checked="enabled" color="#ff8f6b" @change="onToggleEnabled" />
        </view>
        <text class="row-hint">
          开启后，距上次喂奶超过下面的间隔上限就提醒；关闭时不做任何判定。
        </text>
      </view>

      <view class="app-card">
        <view class="row row--last">
          <text class="row-label">间隔上限</text>
          <text class="row-value">{{ formatFeedInterval(interval) }}</text>
        </view>
        <text class="row-hint">
          超过这个时长还没有新的喂养记录就触发提醒。可按宝宝实际情况调整，每次 {{ stepMinutes }} 分钟。
        </text>

        <view class="stepper">
          <view class="step-btn" :class="{ 'step-btn--disabled': atMin }" @click="stepInterval(-1)">
            <text class="step-btn-text">－</text>
          </view>
          <text class="step-value">{{ formatFeedInterval(interval) }}</text>
          <view class="step-btn" :class="{ 'step-btn--disabled': atMax }" @click="stepInterval(1)">
            <text class="step-btn-text">＋</text>
          </view>
        </view>

        <view class="row row--last row--tap" @click="useRecommended">
          <text class="row-label row-label--link">
            恢复月龄推荐（{{ formatFeedInterval(recommended) }}）
          </text>
          <text class="arrow">›</text>
        </view>
      </view>

      <!-- 订阅消息：授权入口由 FEED_TEMPLATE_ID 挡住（见 utils/subscribe.js 注释） -->
      <view v-if="FEED_TEMPLATE_ID" class="app-card">
        <view class="row row--tap">
          <text class="row-label">微信推送提醒</text>
          <text class="row-value">{{ feedStatusText }}</text>
        </view>
        <text class="row-hint">
          一条提醒要用掉一条额度。勾了「总是保持以上选择」之后，每次记一笔都会自动攒一条（不会再弹窗）；
          没勾的话每天会请你确认一次。
        </text>

        <view class="quota" @click="openFeedSubscribe">
          <text class="quota-text">补充 1 条提醒额度</text>
        </view>

        <!-- 微信不提供「还剩几条」的查询接口，但云函数知道每次发送的结果，由它写回这里 -->
        <view class="row row--last">
          <text class="row-label">上次提醒</text>
          <text class="row-value" :class="{ 'row-value--warn': lastRemindWarn }">{{ lastRemindText }}</text>
        </view>
        <text v-if="lastRemindHint" class="row-hint">{{ lastRemindHint }}</text>
        <text v-else-if="todayCount" class="row-hint">今天已推送 {{ todayCount }} 条。</text>
      </view>

      <text v-if="errorText" class="error">{{ errorText }}</text>

      <view class="primary" :class="{ 'primary--disabled': submitting }" @click="onSave">
        <text class="primary-text">{{ submitting ? '保存中…' : '保存' }}</text>
      </view>

      <text class="footnote">
        判定以「最近一条喂养记录」为起点：从来没有记录过时不会提醒。
      </text>
    </template>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { saveBaby } from '@/services/baby'
import {
  FEED_INTERVAL_RANGE,
  feedIntervalTierLabel,
  formatFeedInterval,
  recommendedFeedInterval,
  resolveFeedInterval,
} from '@/services/feeding'
import { formatAge } from '@/utils/age'
import { todayString } from '@/utils/date'
import { ensurePageAccess, redirectTo } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'
import {
  FEED_TEMPLATE_ID,
  describeSubscribeStatus,
  loadSubscribeStatus,
  requestSubscribe,
} from '@/utils/subscribe'

const PAGE_PATH = 'pages/feeding-reminder/feeding-reminder'

const store = useAuthStore()

const stepMinutes = FEED_INTERVAL_RANGE.step

const enabled = ref(false)
const interval = ref(FEED_INTERVAL_RANGE.min)
const submitting = ref(false)
const errorText = ref('')
/** getSetting 的结果，null 表示还没查完 */
const subscribeStatus = ref(null)

const feedStatusText = computed(() => describeSubscribeStatus(subscribeStatus.value, FEED_TEMPLATE_ID))

/**
 * 云函数写回的最近一次推送结果（字段名见 cloudfunctions/feeding-reminder 的 RESULT）。
 * 微信查不到「还剩几条额度」，只能靠这个告诉家长上次到底发出去没有。
 */
const lastRemind = computed(() => {
  const baby = store.baby
  if (!baby || !baby.feed_remind_last_at) return null
  const at = new Date(baby.feed_remind_last_at)
  if (Number.isNaN(at.getTime())) return null
  const pad = (value) => String(value).padStart(2, '0')
  return {
    time: `${at.getMonth() + 1}月${at.getDate()}日 ${pad(at.getHours())}:${pad(at.getMinutes())}`,
    ok: Boolean(baby.feed_remind_last_ok),
    reason: baby.feed_remind_last_reason || '',
  }
})

const lastRemindText = computed(() => {
  if (!lastRemind.value) return '还没有推送过'
  return lastRemind.value.ok ? `${lastRemind.value.time} 已送达` : `${lastRemind.value.time} 未送达`
})

const lastRemindWarn = computed(() => Boolean(lastRemind.value && !lastRemind.value.ok))

/** 未送达时补一句原因，让人知道下一步该做什么 */
const lastRemindHint = computed(() => {
  if (!lastRemind.value || lastRemind.value.ok) return ''
  return lastRemind.value.reason === 'no_quota'
    ? '原因是提醒额度用完了：记一笔喂养，或点上面的按钮补一条，就又能收到了。'
    : '发送失败了，稍后会自动重试；若连续失败请查看云函数日志。'
})

/** 今天已推送的轮数（云函数记的，跨天自动归零） */
const todayCount = computed(() => {
  const baby = store.baby
  if (!baby || baby.feed_remind_day !== todayString()) return 0
  return Number(baby.feed_remind_day_count) || 0
})

const babyName = computed(() => (store.baby ? store.baby.name : '还没有宝宝档案'))
const babySub = computed(() => {
  if (!store.baby) return '请先添加宝宝档案'
  const age = formatAge(store.baby.birthday)
  return age ? `月龄 ${age}` : '未填写生日，按月龄兜底档推荐'
})
/** 当前月龄命中的推荐档位，例：'1~2 月' */
const tierLabel = computed(() => feedIntervalTierLabel(store.baby && store.baby.birthday))
/** 该宝宝的月龄推荐上限（分钟），「恢复月龄推荐」用它 */
const recommended = computed(() => recommendedFeedInterval(store.baby && store.baby.birthday))

const atMin = computed(() => interval.value <= FEED_INTERVAL_RANGE.min)
const atMax = computed(() => interval.value >= FEED_INTERVAL_RANGE.max)

function onToggleEnabled(event) {
  enabled.value = Boolean(event.detail.value)
  // 打开提醒的同时就把订阅授权攒上：授权只认「用户点击手势」，switch 的 change
  // 正好是手势事件，错过这里就只能靠下面那一行单独点了（很容易漏）。
  // 注意订阅消息是一次性额度，授权一次只能收到 1 条，之后再想收就得重新授权。
  if (enabled.value) openFeedSubscribe()
}

/** 主动授权入口（点击行 / 打开开关）。授权弹窗关掉后回查一次，让上面的状态文案跟上 */
function openFeedSubscribe() {
  requestSubscribe(FEED_TEMPLATE_ID, true, refreshSubscribeStatus)
}

/** 状态只在进页面时查一次就够，微信不提供变更通知。顺便刷新全局缓存（见 utils/subscribe.js） */
async function refreshSubscribeStatus() {
  subscribeStatus.value = await loadSubscribeStatus()
}

/** 加减一档，撞到边界就停在边界（按钮同时置灰，不再只是点了没反应） */
function stepInterval(direction) {
  const next = interval.value + direction * stepMinutes
  interval.value = Math.min(FEED_INTERVAL_RANGE.max, Math.max(FEED_INTERVAL_RANGE.min, next))
}

function useRecommended() {
  interval.value = recommended.value
}

/** 把当前宝宝档案上的设置读进表单；切宝宝后重进本页也走这里 */
function loadFromBaby() {
  const baby = store.baby
  if (!baby) return
  enabled.value = Boolean(baby.feed_remind_enabled)
  interval.value = resolveFeedInterval(baby)
}

async function onSave() {
  if (submitting.value) return
  errorText.value = ''
  const baby = store.baby
  if (!baby) {
    errorText.value = '还没有宝宝档案'
    return
  }
  if (!store.canWrite) {
    errorText.value = '你在这个家庭里是只读成员，不能修改提醒设置'
    return
  }

  submitting.value = true
  try {
    const saved = await saveBaby({
      ...baby,
      feed_remind_enabled: enabled.value,
      feed_interval_max_min: interval.value,
    })
    // store.babies 是内存快照，不更新的话退回「我的」页看到的还是旧摘要
    if (saved) {
      const index = store.babies.findIndex((item) => item.id === saved.id)
      if (index >= 0) store.babies.splice(index, 1, saved)
    }
    console.log('[FeedingReminder] 已保存', {
      enabled: enabled.value,
      interval: interval.value,
    })
    uni.showToast({ title: '已保存', icon: 'success' })
    setTimeout(goBack, 600)
  } catch (err) {
    console.error('[FeedingReminder] 保存失败', err)
    errorText.value = err.message || '保存失败，请重试'
  } finally {
    submitting.value = false
  }
}

function goBack() {
  if (getCurrentPages().length > 1) {
    uni.navigateBack()
  } else {
    redirectTo('/pages/index/index')
  }
}

onLoad(() => {
  loadFromBaby()
})

onShow(() => {
  ensurePageAccess(PAGE_PATH)
  // 在「我的」页切了宝宝再进来时，设置要跟着当前宝宝换
  loadFromBaby()
  refreshSubscribeStatus()
})

onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  padding: var(--space-lg);
  box-sizing: border-box;
}

.baby-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-md);
}

.baby-main {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.baby-name {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.baby-sub {
  margin-top: var(--space-xs);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.baby-tier {
  padding: 6rpx 20rpx;
  font-size: 24rpx;
  color: var(--color-primary-deep);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.tip {
  padding: var(--space-lg);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
}

.tip-text {
  font-size: 27rpx;
  color: var(--color-text-muted);
}

.app-card {
  margin-bottom: var(--space-md);
}

.row {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 88rpx;
  border-bottom: 1rpx solid var(--color-border);
}

.row--last {
  border-bottom: none;
}

.row--tap {
  min-height: 76rpx;
}

.row-label {
  flex: 1;
  font-size: 30rpx;
  color: var(--color-text-main);
}

.row-label--link {
  font-size: 27rpx;
  color: var(--color-primary-deep);
}

.row-value {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

/* 未送达用警示色，扫一眼就知道上次没收到 */
.row-value--warn {
  color: var(--color-warning);
}

/* 「补充额度」按钮：浅底风格，别和页面底部的「保存」抢注意力 */
.quota {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 76rpx;
  margin: var(--space-sm) 0 var(--space-md);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.quota-text {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.row-hint {
  display: block;
  padding: var(--space-sm) 0;
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
}

.arrow {
  margin-left: var(--space-xs);
  font-size: 36rpx;
  color: var(--color-text-muted);
}

.stepper {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding: var(--space-sm) 0;
}

.step-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 88rpx;
  height: 88rpx;
  background-color: var(--color-primary-soft);
  border-radius: 50%;
}

.step-btn--disabled {
  opacity: 0.35;
}

.step-btn-text {
  font-size: 40rpx;
  line-height: 1;
  color: var(--color-primary-deep);
}

.step-value {
  min-width: 320rpx;
  font-size: 40rpx;
  font-weight: 600;
  text-align: center;
  color: var(--color-text-main);
}

.error {
  display: block;
  margin-top: var(--space-sm);
  font-size: 26rpx;
  color: var(--color-danger);
}

.primary {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  margin-top: var(--space-md);
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.primary--disabled {
  opacity: 0.6;
}

.primary-text {
  font-size: 32rpx;
  font-weight: 600;
  color: #ffffff;
}

.footnote {
  display: block;
  margin-top: var(--space-md);
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
}
</style>
