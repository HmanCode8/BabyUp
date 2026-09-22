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

      <!-- 订阅消息：模板 ID 还没申请下来，授权入口由 SUBSCRIBE_TEMPLATE_ID 挡住（见脚本注释） -->
      <view v-if="SUBSCRIBE_TEMPLATE_ID" class="app-card">
        <view class="row row--last row--tap" @click="requestSubscribe(true)">
          <text class="row-label">微信推送提醒</text>
          <text class="row-value">点击开启</text>
          <text class="arrow">›</text>
        </view>
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
import { ensurePageAccess, redirectTo } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/feeding-reminder/feeding-reminder'

/**
 * 喂奶提醒的订阅消息模板 ID（小程序后台 → 功能 → 订阅消息 → 我的模板）。
 *
 * ⚠️ 必须与云函数 src/cloudfunctions/feeding-reminder/index.js 的 TEMPLATE_ID 完全一致：
 *    这里负责让用户授权攒额度，云函数负责消费额度发消息，对不上等于白授权。
 *    关键词占位符在云函数的 KEY 里配。
 */
const SUBSCRIBE_TEMPLATE_ID = 'NCXAOkXSusWa7FN3hLwRRbAgUF4fNTjM_gNU7HUhUfQ'

const store = useAuthStore()

const stepMinutes = FEED_INTERVAL_RANGE.step

const enabled = ref(false)
const interval = ref(FEED_INTERVAL_RANGE.min)
const submitting = ref(false)
const errorText = ref('')

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
}

/** 加减一档，撞到边界就停在边界（按钮同时置灰，不再只是点了没反应） */
function stepInterval(direction) {
  const next = interval.value + direction * stepMinutes
  interval.value = Math.min(FEED_INTERVAL_RANGE.max, Math.max(FEED_INTERVAL_RANGE.min, next))
}

function useRecommended() {
  interval.value = recommended.value
}

/**
 * 订阅消息授权：微信要求 requestSubscribeMessage 必须由用户点击手势直接触发，
 * 放到 await 之后会以「can only be invoked by user TAP gesture」失败，
 * 所以这里同步调用、前面不做任何异步操作（与疫苗页同一套路）。
 * 授权被拒一律静默，绝不能因为提醒没授权就影响设置保存。
 */
function requestSubscribe(notify) {
  // #ifdef MP-WEIXIN
  if (!SUBSCRIBE_TEMPLATE_ID) return
  if (typeof uni.requestSubscribeMessage !== 'function') return
  uni.requestSubscribeMessage({
    tmplIds: [SUBSCRIBE_TEMPLATE_ID],
    success: (res) => {
      const result = res[SUBSCRIBE_TEMPLATE_ID]
      console.log('[FeedingReminder] 订阅消息授权结果', result)
      if (!notify) return
      uni.showToast(
        result === 'accept' ? { title: '已开启', icon: 'success' } : { title: '未开启', icon: 'none' },
      )
    },
    fail: (err) => console.error('[FeedingReminder] 订阅消息授权失败', err),
  })
  // #endif
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
