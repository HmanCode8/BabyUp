<template>
  <view class="page">
    <!-- 正在睡提示 -->
    <view v-if="activeSleep" class="app-card banner">
      <view class="banner-main">
        <text class="banner-title">宝宝正在睡</text>
        <text class="banner-sub">开始于 {{ rangeText(activeSleep) }} · 已 {{ activeElapsed }}</text>
      </view>
      <text class="banner-action" @click="openEnd(activeSleep)">结束睡眠</text>
    </view>

    <!-- 记录表单 -->
    <view class="app-card">
      <text class="card-label">入睡时间</text>
      <view class="field">
        <picker mode="date" :value="form.startDate" :end="today" @change="form.startDate = $event.detail.value">
          <text class="field-value">{{ form.startDate }}</text>
        </picker>
        <picker mode="time" :value="form.startTime" @change="form.startTime = $event.detail.value">
          <text class="field-value field-value--time">{{ form.startTime }}</text>
        </picker>
        <text class="arrow">›</text>
      </view>

      <text class="card-label">醒来时间</text>
      <view class="field">
        <template v-if="form.hasEnded">
          <picker mode="date" :value="form.endDate" :end="today" @change="form.endDate = $event.detail.value">
            <text class="field-value">{{ form.endDate }}</text>
          </picker>
          <picker mode="time" :value="form.endTime" @change="form.endTime = $event.detail.value">
            <text class="field-value field-value--time">{{ form.endTime }}</text>
          </picker>
          <text class="field-clear" @click="clearEnd">改回「正在睡」</text>
        </template>
        <template v-else>
          <text class="field-value field-value--empty">还没醒，保存后显示「正在睡」</text>
          <text class="field-clear" @click="fillEndNow">补醒来时间</text>
        </template>
      </view>

      <view class="field field--last">
        <text class="field-label">备注</text>
        <input
          class="field-input"
          maxlength="30"
          :value="form.note"
          placeholder="可留空"
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

    <!-- 最近记录 -->
    <view class="app-card">
      <text class="card-title">最近记录</text>
      <view v-if="!records.length" class="empty-inline">
        <text class="empty-inline-text">{{ loading ? '加载中…' : '还没有睡眠记录' }}</text>
      </view>
      <view v-for="item in records" :key="item.id" class="row">
        <view class="row-main">
          <text class="row-title" :class="{ 'row-title--active': isSleeping(item) }">
            {{ formatSleep(item) }}
          </text>
          <text class="row-sub">
            {{ rangeText(item) }}{{ item.note ? ` · ${item.note}` : '' }}
          </text>
        </view>
        <text v-if="isSleeping(item)" class="row-action" @click="openEnd(item)">结束睡眠</text>
        <text class="row-action" @click="startEdit(item)">编辑</text>
        <text class="row-action row-action--danger" @click="onDelete(item)">删除</text>
      </view>
    </view>

    <!-- 结束睡眠 -->
    <view v-if="ending" class="mask" @click="closeEnd">
      <view class="sheet" @click.stop>
        <text class="sheet-title">结束睡眠</text>
        <text class="sheet-sub">开始于 {{ rangeText(ending) }}</text>

        <text class="card-label">醒来时间</text>
        <view class="field">
          <picker mode="date" :value="endForm.date" :end="today" @change="endForm.date = $event.detail.value">
            <text class="field-value">{{ endForm.date }}</text>
          </picker>
          <picker mode="time" :value="endForm.time" @change="endForm.time = $event.detail.value">
            <text class="field-value field-value--time">{{ endForm.time }}</text>
          </picker>
          <text class="arrow">›</text>
        </view>
        <text v-if="endError" class="error">{{ endError }}</text>

        <view class="actions">
          <view class="btn btn--ghost" @click="closeEnd">
            <text class="btn-text btn-text--ghost">取消</text>
          </view>
          <view class="btn btn--primary" :class="{ 'btn--disabled': ending2 }" @click="confirmEnd">
            <text class="btn-text">{{ ending2 ? '保存中…' : '确认' }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import {
  listSleeps,
  createSleep,
  updateSleep,
  endSleep,
  removeSleep,
  formatSleep,
  formatDuration,
  isSleeping,
  findActiveSleep,
} from '@/services/sleep'
import {
  todayString,
  nowTimeString,
  toIsoFromLocal,
  formatDate,
  formatTime,
  formatDateTime,
} from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/sleep-edit/sleep-edit'

const store = useAuthStore()

const records = ref([])
const loading = ref(false)
const saving = ref(false)
const errorText = ref('')
/** 非空表示正在编辑这条记录，否则是新增 */
const editing = ref(null)

/** 结束睡眠弹层 */
const ending = ref(null)
const ending2 = ref(false)
const endError = ref('')
const endForm = reactive({ date: todayString(), time: nowTimeString() })

const today = todayString()

const form = reactive({
  startDate: today,
  startTime: nowTimeString(),
  hasEnded: false,
  endDate: today,
  endTime: nowTimeString(),
  note: '',
})

const activeSleep = computed(() => findActiveSleep(records.value))
const activeElapsed = computed(() =>
  activeSleep.value ? formatDuration(activeSleep.value.started_at, new Date().toISOString()) : '',
)

/** '09-17 21:00 → 06:30'，跨天时结束时间带上日期 */
function rangeText(item) {
  if (!item) return ''
  const start = formatDateTime(item.started_at).slice(5)
  if (!item.ended_at) return start
  const sameDay = formatDate(item.ended_at) === formatDate(item.started_at)
  const end = sameDay ? formatTime(item.ended_at) : formatDateTime(item.ended_at).slice(5)
  return `${start} → ${end}`
}

function resetForm() {
  form.startDate = today
  form.startTime = nowTimeString()
  form.hasEnded = false
  form.endDate = today
  form.endTime = nowTimeString()
  form.note = ''
  errorText.value = ''
}

function fillEndNow() {
  const now = new Date()
  form.hasEnded = true
  form.endDate = formatDate(now.toISOString())
  form.endTime = formatTime(now.toISOString())
  errorText.value = ''
}

function clearEnd() {
  form.hasEnded = false
  errorText.value = ''
}

async function load() {
  if (!store.membership || !store.baby) {
    records.value = []
    return
  }
  loading.value = true
  try {
    records.value = await listSleeps(store.membership.family_id, store.baby.id, { limit: 20 })
    console.log('[Sleep] 已加载', records.value.length, '条，正在睡:', Boolean(activeSleep.value))
  } catch (err) {
    console.error('[Sleep] 加载失败', err)
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

  const startedAt = toIsoFromLocal(form.startDate, form.startTime)
  let endedAt = null
  if (form.hasEnded) {
    endedAt = toIsoFromLocal(form.endDate, form.endTime)
    if (new Date(endedAt).getTime() <= new Date(startedAt).getTime()) {
      errorText.value = '醒来时间要晚于入睡时间'
      return
    }
  }

  saving.value = true
  try {
    const target = editing.value
    if (target) {
      await updateSleep(target, {
        started_at: startedAt,
        ended_at: endedAt,
        note: form.note ? String(form.note).trim() : null,
      })
      console.log('[Sleep] 修改成功', target.id)
      uni.showToast({ title: '已保存修改', icon: 'success' })
    } else {
      await createSleep({
        familyId: store.membership.family_id,
        babyId: store.baby.id,
        startedAt,
        endedAt,
        note: form.note,
      })
      console.log('[Sleep] 保存成功')
      uni.showToast({ title: '已保存', icon: 'success' })
    }
    editing.value = null
    resetForm()
    await load()
  } catch (err) {
    console.error('[Sleep] 保存失败', err)
    errorText.value = err.message || '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

function startEdit(item) {
  editing.value = item
  form.startDate = formatDate(item.started_at)
  form.startTime = formatTime(item.started_at)
  if (item.ended_at) {
    form.hasEnded = true
    form.endDate = formatDate(item.ended_at)
    form.endTime = formatTime(item.ended_at)
  } else {
    form.hasEnded = false
  }
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
    content: `删除「${rangeText(item)}」这条睡眠记录？`,
    confirmText: '删除',
    confirmColor: '#F04438',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await removeSleep(item.id)
        console.log('[Sleep] 已删除', item.id)
        if (editing.value && editing.value.id === item.id) cancelEdit()
        uni.showToast({ title: '已删除', icon: 'success' })
        await load()
      } catch (err) {
        console.error('[Sleep] 删除失败', err)
        uni.showToast({ title: err.message || '删除失败，请重试', icon: 'none' })
      }
    },
  })
}

/** 打开「结束睡眠」弹层：醒来时间默认现在 */
function openEnd(item) {
  ending.value = item
  endError.value = ''
  const now = new Date().toISOString()
  endForm.date = formatDate(now)
  endForm.time = formatTime(now)
}

function closeEnd() {
  if (ending2.value) return
  ending.value = null
}

async function confirmEnd() {
  if (!ending.value || ending2.value) return
  endError.value = ''
  const endedAt = toIsoFromLocal(endForm.date, endForm.time)
  if (new Date(endedAt).getTime() <= new Date(ending.value.started_at).getTime()) {
    endError.value = '醒来时间要晚于入睡时间'
    return
  }
  ending2.value = true
  try {
    await endSleep(ending.value, endedAt)
    console.log('[Sleep] 已结束睡眠', ending.value.id, endedAt)
    uni.showToast({ title: '已记录醒来时间', icon: 'success' })
    ending.value = null
    await load()
  } catch (err) {
    console.error('[Sleep] 结束睡眠失败', err)
    uni.showToast({ title: err.message || '保存失败，请重试', icon: 'none' })
  } finally {
    ending2.value = false
  }
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

.banner {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: #e8f1ff;
}

.banner-main {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.banner-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #3b7dd8;
}

.banner-sub {
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: #6b8fc4;
}

.banner-action {
  padding: 10rpx 26rpx;
  font-size: 26rpx;
  color: #ffffff;
  background-color: #3b7dd8;
  border-radius: var(--radius-pill);
}

.card-label {
  display: block;
  margin-top: var(--space-sm);
  margin-bottom: var(--space-xs);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.field {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 100rpx;
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

.field-value--empty {
  color: #c2c7ce;
  font-size: 27rpx;
}

.field-clear {
  padding-left: var(--space-sm);
  font-size: 25rpx;
  color: var(--color-primary);
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

.row-title--active {
  color: #3b7dd8;
  font-weight: 600;
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

.mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background-color: rgba(0, 0, 0, 0.45);
}

.sheet {
  display: flex;
  flex-direction: column;
  padding: var(--space-lg);
  padding-bottom: calc(var(--space-lg) + env(safe-area-inset-bottom));
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.sheet-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.sheet-sub {
  margin-top: var(--space-xs);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.actions {
  display: flex;
  flex-direction: row;
  margin-top: var(--space-lg);
}

.btn {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  border-radius: var(--radius-pill);
}

.btn--ghost {
  margin-right: var(--space-md);
  background-color: var(--color-bg-page);
}

.btn--primary {
  background-color: var(--color-primary);
}

.btn--disabled {
  opacity: 0.6;
}

.btn-text {
  font-size: 30rpx;
  font-weight: 600;
  color: #ffffff;
}

.btn-text--ghost {
  color: var(--color-text-sub);
}
</style>
