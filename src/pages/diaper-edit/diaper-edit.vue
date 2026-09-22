<template>
  <view class="page">
    <!-- 记录表单 -->
    <view class="app-card">
      <text class="card-label">类型</text>
      <view class="types">
        <view
          v-for="item in DIAPER_TYPES"
          :key="item.key"
          class="type"
          :class="{ 'type--active': item.key === form.diaperType }"
          @click="switchType(item.key)"
        >
          <text class="type-text" :class="{ 'type-text--active': item.key === form.diaperType }">
            {{ item.label }}
          </text>
        </view>
      </view>

      <!-- 含「便」才需要性状与颜色，纯尿不显示 -->
      <template v-if="showPoop">
        <text class="card-label">性状</text>
        <view class="chips">
          <view
            v-for="item in POOP_CHARACTERS"
            :key="item.key"
            class="chip"
            :class="{ 'chip--active': item.key === form.character }"
            @click="form.character = item.key"
          >
            <text class="chip-text" :class="{ 'chip-text--active': item.key === form.character }">
              {{ item.label }}
            </text>
          </view>
        </view>

        <text class="card-label">颜色</text>
        <view class="chips">
          <view
            v-for="item in POOP_COLORS"
            :key="item.key"
            class="chip"
            :class="{ 'chip--active': item.key === form.color }"
            @click="form.color = item.key"
          >
            <text class="chip-text" :class="{ 'chip-text--active': item.key === form.color }">
              {{ item.label }}
            </text>
          </view>
        </view>
        <text v-if="alertColor" class="alert-tip">该颜色建议咨询医生；仍可保存这条记录</text>
      </template>

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

    <!-- 今日记录 -->
    <view class="app-card">
      <text class="card-title">今日记录（{{ todayList.length }}）</text>
      <view v-if="!todayList.length" class="empty-inline">
        <text class="empty-inline-text">{{ loading ? '加载中…' : '今天还没有便便记录' }}</text>
      </view>
      <view v-for="item in todayList" :key="item.id" class="row">
        <view class="row-main">
          <text class="row-title" :class="{ 'row-title--alert': isAlertColor(item.poop_color) }">
            {{ formatDiaper(item) }}
          </text>
          <text class="row-sub">
            {{ formatTime(item.record_time) }}{{ item.note ? ` · ${item.note}` : '' }}{{ store.recorderSuffix(item) }}
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
  DIAPER_TYPES,
  POOP_CHARACTERS,
  POOP_COLORS,
  hasPoop,
  isAlertColor,
  listDiapers,
  createDiaper,
  updateDiaper,
  removeDiaper,
  formatDiaper,
} from '@/services/diaper'
import {
  todayString,
  nowTimeString,
  toIsoFromLocal,
  localDayStartIso,
  formatDate,
  formatTime,
} from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/diaper-edit/diaper-edit'

const store = useAuthStore()

const records = ref([])
const loading = ref(false)
const saving = ref(false)
const errorText = ref('')
/** 非空表示正在编辑这条记录，否则是新增 */
const editing = ref(null)

const today = todayString()

const form = reactive({
  diaperType: 'pee',
  character: '',
  color: '',
  date: today,
  time: nowTimeString(),
  note: '',
})

const todayList = computed(() => records.value)
const showPoop = computed(() => hasPoop(form.diaperType))
/** 选了红/黑：表单内先提示一次，保存后再轻提示一次（都不阻断保存） */
const alertColor = computed(() => isAlertColor(form.color))

/** 切类型时，纯尿要把性状与颜色清掉，避免带出上一次的选择 */
function switchType(key) {
  if (key === form.diaperType) return
  form.diaperType = key
  errorText.value = ''
  if (!hasPoop(key)) {
    form.character = ''
    form.color = ''
  }
}

function resetForm() {
  form.character = ''
  form.color = ''
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
    records.value = await listDiapers(store.membership.family_id, store.baby.id, {
      fromIso: localDayStartIso(today),
      limit: 50,
    })
    console.log('[Diaper] 今日已加载', records.value.length, '条')
  } catch (err) {
    console.error('[Diaper] 加载失败', err)
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
  if (showPoop.value && !form.character) {
    errorText.value = '请选择性状'
    return
  }
  if (showPoop.value && !form.color) {
    errorText.value = '请选择颜色'
    return
  }

  const recordTime = toIsoFromLocal(form.date, form.time)
  const needAlert = showPoop.value && isAlertColor(form.color)
  saving.value = true
  try {
    const target = editing.value
    if (target) {
      await updateDiaper({
        ...target,
        diaper_type: form.diaperType,
        poop_character: form.character || null,
        poop_color: form.color || null,
        record_time: recordTime,
        note: form.note ? String(form.note).trim() : null,
      })
      console.log('[Diaper] 修改成功', target.id)
      uni.showToast({ title: '已保存修改', icon: 'success' })
    } else {
      await createDiaper({
        familyId: store.membership.family_id,
        babyId: store.baby.id,
        diaperType: form.diaperType,
        character: form.character,
        color: form.color,
        recordTime,
        note: form.note,
      })
      console.log('[Diaper] 保存成功')
      uni.showToast({ title: '已保存', icon: 'success' })
    }
    editing.value = null
    resetForm()
    await load()
    // 红/黑便：保存成功后再补一句轻提示，不阻断也不回滚
    if (needAlert) {
      setTimeout(() => {
        uni.showToast({ title: '颜色异常，建议咨询医生', icon: 'none', duration: 3000 })
      }, 700)
    }
  } catch (err) {
    console.error('[Diaper] 保存失败', err)
    errorText.value = err.message || '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

/** 点列表里的编辑：回填表单并滚回顶部 */
function startEdit(item) {
  editing.value = item
  form.diaperType = item.diaper_type
  form.character = item.poop_character || ''
  form.color = item.poop_color || ''
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
    content: `删除「${formatDiaper(item)}」这条记录？`,
    confirmText: '删除',
    confirmColor: '#F04438',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await removeDiaper(item.id)
        console.log('[Diaper] 已删除', item.id)
        if (editing.value && editing.value.id === item.id) cancelEdit()
        uni.showToast({ title: '已删除', icon: 'success' })
        await load()
      } catch (err) {
        console.error('[Diaper] 删除失败', err)
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
  margin-top: var(--space-md);
  margin-bottom: var(--space-sm);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.card-label:first-child {
  margin-top: 0;
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
  margin-right: var(--space-sm);
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
  font-size: 28rpx;
  color: var(--color-text-sub);
}

.type-text--active {
  color: var(--color-primary-deep);
  font-weight: 600;
}

.chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.chip {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64rpx;
  padding: 0 28rpx;
  margin: 0 var(--space-sm) var(--space-sm) 0;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.chip--active {
  background-color: var(--color-primary-soft);
}

.chip-text {
  font-size: 27rpx;
  color: var(--color-text-sub);
}

.chip-text--active {
  color: var(--color-primary-deep);
  font-weight: 600;
}

.alert-tip {
  display: block;
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: #f79009;
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

.row-title--alert {
  color: var(--color-danger);
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
