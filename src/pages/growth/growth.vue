<template>
  <view class="page">
    <!-- 生长曲线 -->
    <view class="app-card">
      <view class="tabs">
        <view
          v-for="metric in METRICS"
          :key="metric.key"
          class="tab"
          :class="{ 'tab--active': metric.key === activeMetric }"
          @click="switchMetric(metric.key)"
        >
          <text class="tab-text" :class="{ 'tab-text--active': metric.key === activeMetric }">
            {{ metric.label }}
          </text>
        </view>
      </view>

      <view class="chart-wrap" :style="{ height: chartHeight + 'px' }">
        <canvas
          v-if="points.length"
          id="growthChart"
          canvas-id="growthChart"
          class="chart"
          :style="{ width: chartWidth + 'px', height: chartHeight + 'px' }"
          @touchstart="onTouchChart"
        />
        <view v-else class="chart-empty">
          <text class="chart-empty-text">
            {{ loading ? '加载中…' : '至少录入一条记录后就能看到曲线' }}
          </text>
        </view>
      </view>

      <text v-if="points.length" class="chart-hint">
        共 {{ points.length }} 个{{ activeMetricLabel }}测量点，点一下曲线可看数值
      </text>
    </view>

    <!-- 录入：viewer 只读时不显示 -->
    <view v-if="canWrite" id="growthEntry" class="app-card">
      <view class="toggle" @click="onToggleForm">
        <text class="toggle-title">{{ editing ? '编辑记录' : '记一笔' }}</text>
        <text class="toggle-action">{{ toggleActionText }}</text>
      </view>

      <view v-if="showForm" class="form">
        <picker mode="date" :value="form.recordDate" :end="today" @change="form.recordDate = $event.detail.value">
          <view class="field">
            <text class="field-label">日期</text>
            <text class="field-value">{{ form.recordDate }}</text>
            <text class="arrow">›</text>
          </view>
        </picker>

        <view class="field">
          <text class="field-label">身高</text>
          <input
            class="field-input"
            type="digit"
            maxlength="6"
            :value="form.heightCm"
            placeholder="cm，可留空"
            placeholder-class="field-placeholder"
            @input="form.heightCm = $event.detail.value"
          />
        </view>

        <view class="field">
          <text class="field-label">体重</text>
          <input
            class="field-input"
            type="digit"
            maxlength="6"
            :value="form.weightKg"
            placeholder="kg，可留空"
            placeholder-class="field-placeholder"
            @input="form.weightKg = $event.detail.value"
          />
        </view>

        <view class="field">
          <text class="field-label">头围</text>
          <input
            class="field-input"
            type="digit"
            maxlength="6"
            :value="form.headCm"
            placeholder="cm，可留空"
            placeholder-class="field-placeholder"
            @input="form.headCm = $event.detail.value"
          />
        </view>

        <view class="field field--last">
          <text class="field-label">备注</text>
          <input
            class="field-input"
            maxlength="20"
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
      </view>
    </view>

    <!-- 历史列表 -->
    <view class="app-card">
      <text class="card-title">历史记录</text>
      <view v-if="!records.length" class="empty-inline">
        <text class="empty-inline-text">{{ historyEmptyText }}</text>
      </view>
      <view v-for="item in historyList" :key="item.id" class="history-row">
        <text class="history-date">{{ item.record_date }}</text>
        <view class="history-values">
          <text v-if="item.weight_kg != null" class="history-value">体重 {{ item.weight_kg }} kg</text>
          <text v-if="item.height_cm != null" class="history-value">身高 {{ item.height_cm }} cm</text>
          <text v-if="item.head_cm != null" class="history-value">头围 {{ item.head_cm }} cm</text>
        </view>
        <text v-if="canWrite" class="history-edit" @click="startEdit(item)">编辑</text>
        <text v-if="canWrite" class="history-edit history-edit--danger" @click="onDelete(item)">删除</text>
        <text v-if="item.note" class="history-note">{{ item.note }}</text>
        <text v-if="recorderName(item)" class="history-recorder">由 {{ recorderName(item) }} 记录</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, reactive, ref } from 'vue'
import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app'
import uCharts from '@qiun/ucharts'
import { useAuthStore } from '@/stores/auth'
import {
  listGrowthRecords,
  createGrowthRecord,
  updateGrowthRecord,
  removeGrowthRecord,
  GROWTH_RANGES,
} from '@/services/growth'
import { todayString } from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/growth/growth'

const METRICS = [
  { key: 'weight', field: 'weight_kg', label: '体重', unit: 'kg' },
  { key: 'height', field: 'height_cm', label: '身高', unit: 'cm' },
  { key: 'head', field: 'head_cm', label: '头围', unit: 'cm' },
]

const instance = getCurrentInstance()
const store = useAuthStore()

const records = ref([])
const loading = ref(false)
const saving = ref(false)
const errorText = ref('')
const showForm = ref(false)
/** 非空表示正在编辑这条历史记录，否则是新增 */
const editing = ref(null)
const activeMetric = ref('weight')

const form = reactive({
  recordDate: todayString(),
  heightCm: '',
  weightKg: '',
  headCm: '',
  note: '',
})

const today = todayString()

let chart = null

// 画布尺寸：页面左右各 32rpx + 卡片左右各 32rpx 的内边距要扣掉
const chartSize = (() => {
  const info = uni.getSystemInfoSync()
  const rpx = info.windowWidth / 750
  return {
    width: Math.floor(info.windowWidth - 128 * rpx),
    height: Math.floor(420 * rpx),
  }
})()
const chartWidth = chartSize.width
const chartHeight = chartSize.height

const metricConfig = computed(
  () => METRICS.find((item) => item.key === activeMetric.value) || METRICS[0],
)
const activeMetricLabel = computed(() => metricConfig.value.label)

/** 只取当前指标有值的记录，避免空值把折线打断 */
const points = computed(() =>
  records.value
    .filter((item) => item[metricConfig.value.field] != null)
    .map((item) => ({
      label: shortDate(item.record_date),
      value: Number(item[metricConfig.value.field]),
    })),
)

/** 历史列表按日期倒序展示 */
const historyList = computed(() => records.value.slice().reverse())

/** viewer 只读：隐藏录入表单与编辑入口 */
const canWrite = computed(() => store.canWrite)

/** 记录人显示名；单人家庭返回空串，历史列表据此不渲染这一行 */
function recorderName(item) {
  return store.memberLabel(item && item.created_by)
}

const toggleActionText = computed(() => {
  if (!showForm.value) return '展开'
  return editing.value ? '取消编辑' : '收起'
})

/** 曲线空态：viewer 没有录入入口，文案要说清记录来自家人 */
const chartEmptyText = computed(() => {
  if (loading.value) return '加载中…'
  return canWrite.value ? '至少录入一条记录后就能看到曲线' : '家人录入记录后就能看到曲线'
})

/** 历史列表空态：给写权限的人一个明确的下一步 */
const historyEmptyText = computed(() =>
  canWrite.value ? '还没有记录，点上方「记一笔」记下第一次测量' : '家人记录后，这里会显示测量历史',
)

/** '2026-09-17' -> '9/17' */
function shortDate(value) {
  const parts = String(value || '').split('-')
  if (parts.length < 3) return String(value || '')
  return `${Number(parts[1])}/${Number(parts[2])}`
}

async function load() {
  if (!store.membership || !store.baby) {
    records.value = []
    return
  }
  loading.value = true
  try {
    records.value = await listGrowthRecords(store.membership.family_id, store.baby.id)
    console.log('[Growth] 已加载记录', records.value.length, '条')
  } catch (err) {
    console.error('[Growth] 加载失败', err)
    uni.showToast({ title: err.message || '加载失败，请重试', icon: 'none' })
  } finally {
    loading.value = false
    drawChart()
  }
}

function drawChart() {
  const list = points.value
  if (!list.length) {
    chart = null
    return
  }
  nextTick(() => {
    try {
      chart = new uCharts({
        type: 'line',
        context: uni.createCanvasContext('growthChart', instance),
        width: chartSize.width,
        height: chartSize.height,
        // 固定 1：uni-app 的 canvas 已按设备像素比缩放并改写了绘图坐标，
        // 这里再传 devicePixelRatio 会被缩放两次，导致字体与线条在高 DPI 屏上被放大甚至溢出
        pixelRatio: 1,
        categories: list.map((item) => item.label),
        series: [{ name: metricConfig.value.label, data: list.map((item) => item.value) }],
        animation: true,
        background: '#FFFFFF',
        color: ['#FF8F6B'],
        padding: [16, 16, 8, 8],
        dataLabel: false,
        dataPointShape: true,
        enableScroll: false,
        legend: { show: false },
        xAxis: {
          disableGrid: true,
          itemCount: 6,
          fontColor: '#8A9099',
          fontSize: 11,
        },
        yAxis: {
          gridType: 'dash',
          dashLength: 2,
          gridColor: '#EEF0F3',
          fontColor: '#8A9099',
          fontSize: 11,
        },
        extra: {
          line: { type: 'curve', width: 2, activeType: 'hollow' },
        },
      })
    } catch (err) {
      console.error('[Growth] 绘制曲线失败', err)
    }
  })
}

function switchMetric(key) {
  if (key === activeMetric.value) return
  activeMetric.value = key
  drawChart()
}

function onTouchChart(event) {
  if (!chart || !points.value.length) return
  try {
    chart.showToolTip(event, {
      format: (item) => `${item.name}: ${item.data}`,
    })
  } catch (err) {
    console.error('[Growth] 显示数值失败', err)
  }
}

function parseMetric(input, rule) {
  const raw = String(input == null ? '' : input).trim()
  if (!raw) return { value: '' }
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return { error: `${rule.label}请填写大于 0 的数字` }
  if (value < rule.min || value > rule.max) {
    return { error: `${rule.label}应在 ${rule.min}~${rule.max} 之间` }
  }
  return { value }
}

function resetForm() {
  form.heightCm = ''
  form.weightKg = ''
  form.headCm = ''
  form.note = ''
  errorText.value = ''
}

function onToggleForm() {
  if (editing.value) {
    cancelEdit()
    return
  }
  showForm.value = !showForm.value
}

/** 从历史记录进入编辑：回填表单，并滚到表单处，避免列表很长时以为点击没反应 */
function startEdit(item) {
  editing.value = item
  form.recordDate = item.record_date
  form.heightCm = item.height_cm == null ? '' : String(item.height_cm)
  form.weightKg = item.weight_kg == null ? '' : String(item.weight_kg)
  form.headCm = item.head_cm == null ? '' : String(item.head_cm)
  form.note = item.note || ''
  errorText.value = ''
  showForm.value = true
  nextTick(() => {
    uni.pageScrollTo({ selector: '#growthEntry', duration: 200 })
  })
}

function cancelEdit() {
  editing.value = null
  resetForm()
}

/** 删除一条历史记录；删的正好是正在编辑的那条时顺手退出编辑态 */
function onDelete(item) {
  uni.showModal({
    title: '删除记录',
    content: `删除「${item.record_date}」这条测量记录？`,
    confirmText: '删除',
    confirmColor: '#F04438',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await removeGrowthRecord(item.id)
        console.log('[Growth] 已删除', item.id)
        if (editing.value && editing.value.id === item.id) cancelEdit()
        uni.showToast({ title: '已删除', icon: 'success' })
        await load()
      } catch (err) {
        console.error('[Growth] 删除失败', err)
        uni.showToast({ title: err.message || '删除失败，请重试', icon: 'none' })
      }
    },
  })
}

async function onSave() {
  if (saving.value) return
  errorText.value = ''
  if (!store.membership || !store.baby) {
    errorText.value = '还没有家庭或宝宝档案'
    return
  }

  const height = parseMetric(form.heightCm, GROWTH_RANGES.heightCm)
  const weight = parseMetric(form.weightKg, GROWTH_RANGES.weightKg)
  const head = parseMetric(form.headCm, GROWTH_RANGES.headCm)
  const firstError = height.error || weight.error || head.error
  if (firstError) {
    errorText.value = firstError
    return
  }
  if (height.value === '' && weight.value === '' && head.value === '') {
    errorText.value = '身高、体重、头围至少填一项'
    return
  }

  saving.value = true
  try {
    const values = {
      record_date: form.recordDate,
      height_cm: height.value === '' ? null : height.value,
      weight_kg: weight.value === '' ? null : weight.value,
      head_cm: head.value === '' ? null : head.value,
      note: form.note ? String(form.note).trim() : null,
    }
    const target = editing.value
    if (target) {
      await updateGrowthRecord({ ...target, ...values })
      console.log('[Growth] 修改成功', target.id)
      uni.showToast({ title: '已保存修改', icon: 'success' })
    } else {
      await createGrowthRecord({
        familyId: store.membership.family_id,
        babyId: store.baby.id,
        recordDate: form.recordDate,
        heightCm: height.value,
        weightKg: weight.value,
        headCm: head.value,
        note: form.note,
      })
      console.log('[Growth] 保存成功')
      uni.showToast({ title: '已保存', icon: 'success' })
    }
    editing.value = null
    resetForm()
    showForm.value = false
    await load()
  } catch (err) {
    console.error('[Growth] 保存失败', err)
    errorText.value = err.message || '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

onLoad((query) => {
  // 从「记录 → 量一量」进来时直接展开表单，省一步点击（viewer 没有表单可展开）
  if (query && query.mode === 'entry' && store.canWrite) showForm.value = true
})

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

.tabs {
  display: flex;
  flex-direction: row;
  padding: 6rpx;
  margin-bottom: var(--space-md);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.tab {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  height: 68rpx;
  border-radius: var(--radius-pill);
}

.tab--active {
  background-color: var(--color-primary-soft);
}

.tab-text {
  font-size: 28rpx;
  color: var(--color-text-sub);
}

.tab-text--active {
  color: var(--color-primary-deep);
  font-weight: 600;
}

.chart-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  overflow: hidden;
}

.chart {
  display: block;
}

.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.chart-empty-text {
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.chart-hint {
  display: block;
  margin-top: var(--space-sm);
  font-size: 23rpx;
  color: var(--color-text-muted);
  text-align: center;
}

.toggle {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.toggle-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.toggle-action {
  font-size: 26rpx;
  color: var(--color-primary);
}

.form {
  margin-top: var(--space-sm);
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

.arrow {
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

.history-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  padding: var(--space-md) 0;
  border-bottom: 1rpx solid var(--color-border);
}

.history-date {
  width: 200rpx;
  font-size: 27rpx;
  color: var(--color-text-main);
}

.history-values {
  display: flex;
  flex: 1;
  flex-direction: row;
  flex-wrap: wrap;
}

.history-value {
  margin-right: var(--space-md);
  font-size: 25rpx;
  color: var(--color-text-sub);
}

.history-edit {
  padding-left: var(--space-sm);
  font-size: 26rpx;
  color: var(--color-primary);
}

.history-edit--danger {
  color: var(--color-danger);
}

.history-note {
  width: 100%;
  margin-top: var(--space-xs);
  font-size: 23rpx;
  color: var(--color-text-muted);
}

/* 记录人：单人家庭 store.memberLabel 返回空串，整行不渲染 */
.history-recorder {
  width: 100%;
  margin-top: var(--space-xs);
  font-size: 23rpx;
  color: var(--color-text-muted);
}
</style>
