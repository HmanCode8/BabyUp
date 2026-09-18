<template>
  <view class="page">
    <!-- 记录表单 -->
    <view class="app-card">
      <text class="card-label">记录类型</text>
      <view class="types">
        <view
          v-for="item in FEED_TYPES"
          :key="item.key"
          class="type"
          :class="{ 'type--active': item.key === form.feedType }"
          @click="switchType(item.key)"
        >
          <text class="type-text" :class="{ 'type-text--active': item.key === form.feedType }">
            {{ item.label }}
          </text>
        </view>
      </view>

      <!-- 母乳按时长 -->
      <view v-if="form.feedType === 'breast'" class="field">
        <text class="field-label">时长</text>
        <input
          class="field-input"
          type="number"
          maxlength="3"
          :value="form.durationMin"
          placeholder="分钟，如 15"
          placeholder-class="field-placeholder"
          @input="form.durationMin = $event.detail.value"
        />
        <text class="field-unit">分钟</text>
        <text class="field-quick" @click="form.durationMin = '15'">15</text>
        <text class="field-quick" @click="form.durationMin = '20'">20</text>
      </view>

      <!-- 配方奶 / 水按毫升 -->
      <view v-else-if="form.feedType === 'formula' || form.feedType === 'water'" class="field">
        <text class="field-label">{{ form.feedType === 'water' ? '水量' : '奶量' }}</text>
        <input
          class="field-input"
          type="digit"
          maxlength="5"
          :value="form.amountMl"
          placeholder="ml，如 120"
          placeholder-class="field-placeholder"
          @input="form.amountMl = $event.detail.value"
        />
        <text class="field-unit">ml</text>
        <text class="field-quick" @click="form.amountMl = '90'">90</text>
        <text class="field-quick" @click="form.amountMl = '120'">120</text>
      </view>

      <!-- 辅食只记次数 -->
      <view v-else class="field">
        <text class="field-tip">辅食只记次数，不用填数量</text>
      </view>

      <view class="field">
        <text class="field-label">时间</text>
        <picker mode="date" :value="form.date" :end="today" @change="form.date = $event.detail.value">
          <text class="field-value">{{ form.date }}</text>
        </picker>
        <picker mode="time" :value="form.time" @change="form.time = $event.detail.value">
          <text class="field-value field-value--time">{{ form.time }}</text>
        </picker>
        <text class="arrow">›</text>
      </view>

      <view class="field field--last">
        <text class="field-label">备注</text>
        <input
          class="field-input"
          maxlength="30"
          :value="form.note"
          placeholder="可留空，如：左侧"
          placeholder-class="field-placeholder"
          @input="form.note = $event.detail.value"
        />
      </view>

      <text v-if="errorText" class="error">{{ errorText }}</text>

      <view class="primary" :class="{ 'primary--disabled': saving }" @click="onSave">
        <text class="primary-text">{{ saving ? '保存中…' : editing ? '保存修改' : '保存' }}</text>
      </view>
      <view v-if="editing" class="ghost" @click="cancelEdit">
        <text class="ghost-text">取消编辑</text>
      </view>
    </view>

    <!-- 今日记录 -->
    <view class="app-card">
      <text class="card-title">今日记录（{{ todayList.length }}）</text>
      <view v-if="!todayList.length" class="empty-inline">
        <text class="empty-inline-text">{{ loading ? '加载中…' : '今天还没有喂养记录' }}</text>
      </view>
      <view v-for="item in todayList" :key="item.id" class="row">
        <view class="row-main">
          <text class="row-title">{{ formatFeeding(item) }}</text>
          <text class="row-sub">
            {{ formatTime(item.record_time) }}{{ item.note ? ` · ${item.note}` : '' }}
          </text>
        </view>
        <text class="row-action" @click="startEdit(item)">编辑</text>
        <text class="row-action row-action--danger" @click="onDelete(item)">删除</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import {
  FEED_TYPES,
  FEED_LIMITS,
  listFeedings,
  createFeeding,
  updateFeeding,
  removeFeeding,
  formatFeeding,
} from '@/services/feeding'
import { todayString, nowTimeString, toIsoFromLocal, localDayStartIso, formatDate, formatTime } from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/feeding-edit/feeding-edit'

const store = useAuthStore()

const records = ref([])
const loading = ref(false)
const saving = ref(false)
const errorText = ref('')
/** 非空表示正在编辑这条记录，否则是新增 */
const editing = ref(null)

const today = todayString()

const form = reactive({
  feedType: 'breast',
  amountMl: '',
  durationMin: '',
  date: today,
  time: nowTimeString(),
  note: '',
})

const todayList = computed(() => records.value)

/** 切换类型时清掉另一个类型的数量，避免把母乳的分钟数当成奶量提交 */
function switchType(key) {
  if (key === form.feedType) return
  form.feedType = key
  errorText.value = ''
  if (key === 'breast') form.amountMl = ''
  else form.durationMin = ''
  if (key === 'solid') {
    form.amountMl = ''
    form.durationMin = ''
  }
}

/** 数量校验：空返回空串（由业务规则决定是否必填），非法返回错误文案 */
function parseNumber(input, rule) {
  const raw = String(input == null ? '' : input).trim()
  if (!raw) return { value: '' }
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return { error: `请填写大于 0 的${rule.label}` }
  if (value < rule.min || value > rule.max) {
    return { error: `${rule.label}应在 ${rule.min}~${rule.max} 之间` }
  }
  return { value }
}

function resetForm() {
  form.amountMl = ''
  form.durationMin = ''
  form.note = ''
  form.date = today
  form.time = nowTimeString()
  errorText.value = ''
}

async function load() {
  if (!store.membership || !store.baby) {
    records.value = []
    return
  }
  loading.value = true
  try {
    records.value = await listFeedings(store.membership.family_id, store.baby.id, {
      fromIso: localDayStartIso(today),
      limit: 50,
    })
    console.log('[Feeding] 今日已加载', records.value.length, '条')
  } catch (err) {
    console.error('[Feeding] 加载失败', err)
    uni.showToast({ title: err.message || '加载失败，请重试', icon: 'none' })
  } finally {
    loading.value = false
  }
}

async function onSave() {
  if (saving.value) return
  errorText.value = ''
  if (!store.membership || !store.baby) {
    errorText.value = '还没有家庭或宝宝档案'
    return
  }

  let amount = { value: '' }
  let duration = { value: '' }
  if (form.feedType === 'breast') {
    duration = parseNumber(form.durationMin, FEED_LIMITS.durationMin)
    if (duration.error) {
      errorText.value = duration.error
      return
    }
    if (duration.value === '') {
      errorText.value = '请填写母乳喂养时长'
      return
    }
  } else if (form.feedType === 'formula' || form.feedType === 'water') {
    amount = parseNumber(form.amountMl, FEED_LIMITS.amountMl)
    if (amount.error) {
      errorText.value = amount.error
      return
    }
    if (amount.value === '') {
      errorText.value = form.feedType === 'water' ? '请填写水量' : '请填写奶量'
      return
    }
  }

  const recordTime = toIsoFromLocal(form.date, form.time)
  saving.value = true
  try {
    const target = editing.value
    if (target) {
      await updateFeeding({
        ...target,
        feed_type: form.feedType,
        amount_ml: amount.value === '' ? null : amount.value,
        duration_min: duration.value === '' ? null : duration.value,
        record_time: recordTime,
        note: form.note ? String(form.note).trim() : null,
      })
      console.log('[Feeding] 修改成功', target.id)
      uni.showToast({ title: '已保存修改', icon: 'success' })
    } else {
      await createFeeding({
        familyId: store.membership.family_id,
        babyId: store.baby.id,
        feedType: form.feedType,
        amountMl: amount.value === '' ? null : amount.value,
        durationMin: duration.value === '' ? null : duration.value,
        recordTime,
        note: form.note,
      })
      console.log('[Feeding] 保存成功')
      uni.showToast({ title: '已保存', icon: 'success' })
    }
    editing.value = null
    resetForm()
    await load()
  } catch (err) {
    console.error('[Feeding] 保存失败', err)
    errorText.value = err.message || '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

/** 点列表里的编辑：回填表单并滚回顶部，避免列表长时以为点击没反应 */
function startEdit(item) {
  editing.value = item
  form.feedType = item.feed_type
  form.amountMl = item.amount_ml == null ? '' : String(item.amount_ml)
  form.durationMin = item.duration_min == null ? '' : String(item.duration_min)
  form.date = formatDate(item.record_time)
  form.time = formatTime(item.record_time)
  form.note = item.note || ''
  errorText.value = ''
  uni.pageScrollTo({ scrollTop: 0, duration: 200 })
}

function cancelEdit() {
  editing.value = null
  resetForm()
}

function onDelete(item) {
  uni.showModal({
    title: '删除记录',
    content: `删除「${formatFeeding(item)}」这条记录？`,
    confirmText: '删除',
    confirmColor: '#F04438',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await removeFeeding(item.id)
        console.log('[Feeding] 已删除', item.id)
        if (editing.value && editing.value.id === item.id) cancelEdit()
        uni.showToast({ title: '已删除', icon: 'success' })
        await load()
      } catch (err) {
        console.error('[Feeding] 删除失败', err)
        uni.showToast({ title: err.message || '删除失败，请重试', icon: 'none' })
      }
    },
  })
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  await store.bootstrap()
  await load()
})

// 补丁 Step 4：统一分享卡片（标题与落地页见 @/utils/share）
onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  padding: var(--space-lg);
  box-sizing: border-box;
}

.app-card {
  margin-bottom: var(--space-md);
}

.card-label {
  display: block;
  margin-bottom: var(--space-sm);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.types {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
}

.type {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  height: 76rpx;
  margin-right: var(--space-xs);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.type:last-child {
  margin-right: 0;
}

.type--active {
  background-color: var(--color-primary-soft);
}

.type-text {
  font-size: 27rpx;
  color: var(--color-text-sub);
}

.type-text--active {
  color: var(--color-primary-deep);
  font-weight: 600;
}

.field {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 100rpx;
  margin-top: var(--space-sm);
  border-bottom: 1rpx solid var(--color-border);
}

.field--last {
  border-bottom: none;
}

.field-label {
  width: 120rpx;
  font-size: 30rpx;
  color: var(--color-text-sub);
}

.field-input {
  flex: 1;
  height: 100rpx;
  font-size: 30rpx;
  color: var(--color-text-main);
}

.field-placeholder {
  font-size: 28rpx;
  color: #c2c7ce;
}

.field-unit {
  padding-left: var(--space-xs);
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.field-quick {
  margin-left: var(--space-sm);
  padding: 6rpx 20rpx;
  font-size: 25rpx;
  color: var(--color-primary-deep);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.field-value {
  flex: 1;
  font-size: 30rpx;
  color: var(--color-text-main);
}

.field-value--time {
  flex: none;
  padding-left: var(--space-md);
  text-align: right;
}

.field-tip {
  font-size: 27rpx;
  color: var(--color-text-muted);
}

.arrow {
  padding-left: var(--space-xs);
  font-size: 36rpx;
  color: var(--color-text-muted);
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
  height: 92rpx;
  margin-top: var(--space-md);
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.primary--disabled {
  opacity: 0.6;
}

.primary-text {
  font-size: 30rpx;
  font-weight: 600;
  color: #ffffff;
}

.ghost {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  margin-top: var(--space-sm);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.ghost-text {
  font-size: 28rpx;
  color: var(--color-text-sub);
}

.card-title {
  display: block;
  margin-bottom: var(--space-sm);
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.empty-inline {
  padding: var(--space-md) 0;
}

.empty-inline-text {
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-md) 0;
  border-bottom: 1rpx solid var(--color-border);
}

.row-main {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.row-title {
  font-size: 30rpx;
  color: var(--color-text-main);
}

.row-sub {
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.row-action {
  padding-left: var(--space-md);
  font-size: 26rpx;
  color: var(--color-primary);
}

.row-action--danger {
  color: var(--color-danger);
}
</style>
