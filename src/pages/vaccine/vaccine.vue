<template>
  <view class="page">
    <!-- 待办 -->
    <view class="app-card">
      <view class="card-head">
        <text class="card-title">待办</text>
        <text v-if="summary.overdue" class="card-warn">逾期 {{ summary.overdue }} 项</text>
      </view>

      <view v-if="!todoList.length" class="empty-inline">
        <text class="empty-inline-text">
          {{ loading ? '加载中…' : '暂时没有待接种的疫苗' }}
        </text>
      </view>
      <VaccineItem
        v-for="item in todoList"
        :key="item.id"
        :record="item"
        :readonly="!canWrite"
        @mark="openMark"
        @edit="startEdit"
      />
    </view>

    <!-- 添加：viewer 只读时不显示 -->
    <view v-if="canWrite" id="vaccineEntry" class="app-card">
      <view class="toggle" @click="onToggleForm">
        <text class="toggle-title">{{ editing ? '编辑疫苗' : '添加疫苗' }}</text>
        <text class="toggle-action">{{ toggleActionText }}</text>
      </view>

      <!-- 补丁 Step 6：从内置推荐库一键添加（viewer 整张卡片都不渲染） -->
      <view class="lib-entry" @click="openLibrary">
        <view class="lib-entry-main">
          <text class="lib-entry-title">从推荐库添加</text>
          <text class="lib-entry-sub">一类/二类常见疫苗，按宝宝月龄推荐</text>
        </view>
        <text class="arrow">›</text>
      </view>

      <view v-if="showForm" class="form">
        <view class="field">
          <text class="field-label">名称</text>
          <input
            class="field-input"
            maxlength="20"
            :value="form.name"
            placeholder="如：乙肝疫苗"
            placeholder-class="field-placeholder"
            @input="form.name = $event.detail.value"
          />
        </view>

        <view class="field">
          <text class="field-label">剂次</text>
          <input
            class="field-input"
            maxlength="10"
            :value="form.dose"
            placeholder="如：第1剂，可留空"
            placeholder-class="field-placeholder"
            @input="form.dose = $event.detail.value"
          />
        </view>

        <picker mode="date" :value="form.scheduledDate" @change="form.scheduledDate = $event.detail.value">
          <view class="field field--last">
            <text class="field-label">计划日期</text>
            <text class="field-value" :class="{ 'field-value--empty': !form.scheduledDate }">
              {{ form.scheduledDate || '可留空，稍后再排' }}
            </text>
            <text v-if="form.scheduledDate" class="field-clear" @click.stop="clearScheduled">清除</text>
            <text class="arrow">›</text>
          </view>
        </picker>

        <text v-if="errorText" class="error">{{ errorText }}</text>

        <view class="primary" :class="{ 'primary--disabled': saving }" @click="onSave">
          <text class="primary-text">{{ saving ? '保存中…' : editing ? '保存修改' : '保存' }}</text>
        </view>
      </view>
    </view>

    <!-- 全部记录 -->
    <view class="app-card">
      <text class="card-title">全部记录</text>
      <view v-if="!allList.length" class="empty-inline">
        <text class="empty-inline-text">还没有疫苗记录</text>
      </view>
      <VaccineItem
        v-for="item in allList"
        :key="item.id"
        :record="item"
        :readonly="!canWrite"
        @mark="openMark"
        @edit="startEdit"
      />
    </view>

    <!-- 合规：推荐库仅作录入参考，接种程序以当地门诊为准（风险说明第 2 条） -->
    <view class="disclaimer">
      <text class="disclaimer-text">接种程序以当地接种门诊及《预防接种证》为准</text>
    </view>

    <!-- 标记已接种 -->
    <view v-if="marking" class="mask" @click="closeMark">
      <view class="sheet" @click.stop>
        <text class="sheet-title">标记已接种</text>
        <text class="sheet-sub">{{ markingTitle }}</text>

        <picker mode="date" :value="vaccinatedDate" :end="today" @change="vaccinatedDate = $event.detail.value">
          <view class="sheet-field">
            <text class="sheet-field-label">实际接种日期</text>
            <text class="sheet-field-value">{{ vaccinatedDate }}</text>
            <text class="arrow">›</text>
          </view>
        </picker>

        <view class="actions">
          <view class="btn btn--ghost" @click="closeMark">
            <text class="btn-text btn-text--ghost">取消</text>
          </view>
          <view class="btn btn--primary" :class="{ 'btn--disabled': marking2 }" @click="confirmMark">
            <text class="btn-text">{{ marking2 ? '保存中…' : '确认接种' }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 推荐库列表（补丁 Step 6）：类别 tab + 月龄匹配高亮 -->
    <view v-if="showLibrary" class="mask" @click="closeLibrary">
      <view class="sheet sheet--library" @click.stop>
        <view class="sheet-head">
          <text class="sheet-title">推荐疫苗库</text>
          <text class="sheet-close" @click="closeLibrary">关闭</text>
        </view>
        <text class="sheet-sub">{{ babyAgeText }}</text>

        <view class="tabs">
          <view
            v-for="tab in CATEGORY_TABS"
            :key="tab.value"
            class="tab"
            :class="{ 'tab--active': libraryCategory === tab.value }"
            @click="libraryCategory = tab.value"
          >
            <text class="tab-text" :class="{ 'tab-text--active': libraryCategory === tab.value }">
              {{ tab.label }}
            </text>
          </view>
        </view>

        <scroll-view class="lib-list" scroll-y>
          <view v-if="libraryLoading" class="empty-inline">
            <text class="empty-inline-text">加载中…</text>
          </view>
          <view v-else-if="libraryError" class="empty-inline">
            <text class="empty-inline-text">{{ libraryError }}</text>
          </view>
          <view v-else-if="!libraryRows.length" class="empty-inline">
            <text class="empty-inline-text">
              {{ libraryCategory === 'paid' ? '暂无二类疫苗数据' : '暂无一类疫苗数据' }}
            </text>
          </view>
          <view v-else>
            <view
              v-for="item in libraryRows"
              :key="item.id"
              class="lib-item"
              :class="{ 'lib-item--matched': item.matched }"
            >
              <view class="lib-item-main">
                <text class="lib-item-name">{{ libTitle(item) }}</text>
                <text class="lib-item-sub">建议月龄 {{ formatMonthRange(item.min_age_month, item.max_age_month) }}</text>
              </view>
              <text v-if="item.matched" class="lib-item-tag">适龄</text>
              <text class="lib-category" :class="'lib-category--' + item.category">
                {{ VACCINE_CATEGORY_TAG[item.category] }}
              </text>
              <view v-if="canWrite" class="lib-item-add" @click="pickLibraryItem(item)">
                <text class="lib-item-add-text">添加</text>
              </view>
            </view>
          </view>
        </scroll-view>

        <!-- 合规：弹层内也要能看到免责声明（打开弹层时页脚那条被遮罩盖住了） -->
        <view class="lib-disclaimer">
          <text class="disclaimer-text">接种程序以当地接种门诊及《预防接种证》为准</text>
        </view>
      </view>
    </view>

    <!-- 选中推荐库某条后的预填表单：默认按推荐月龄给计划日期，接种日期留空 = 未接种 -->
    <view v-if="picked" class="mask" @click="closePick">
      <view class="sheet" @click.stop>
        <text class="sheet-title">{{ libTitle(picked) }}</text>
        <text class="sheet-sub">
          建议月龄 {{ formatMonthRange(picked.min_age_month, picked.max_age_month) }}，计划日期已按宝宝月龄预填
        </text>

        <picker
          mode="date"
          :value="pickForm.scheduledDate"
          @change="pickForm.scheduledDate = $event.detail.value"
        >
          <view class="sheet-field">
            <text class="sheet-field-label">计划日期</text>
            <text class="sheet-field-value" :class="{ 'field-value--empty': !pickForm.scheduledDate }">
              {{ pickForm.scheduledDate || '未排期' }}
            </text>
            <text v-if="pickForm.scheduledDate" class="field-clear" @click.stop="pickForm.scheduledDate = ''">
              清除
            </text>
            <text class="arrow">›</text>
          </view>
        </picker>

        <picker
          mode="date"
          :value="pickForm.vaccinatedDate"
          :end="today"
          @change="pickForm.vaccinatedDate = $event.detail.value"
        >
          <view class="sheet-field">
            <text class="sheet-field-label">接种日期</text>
            <text class="sheet-field-value" :class="{ 'field-value--empty': !pickForm.vaccinatedDate }">
              {{ pickForm.vaccinatedDate || '未接种，可稍后标记' }}
            </text>
            <text v-if="pickForm.vaccinatedDate" class="field-clear" @click.stop="pickForm.vaccinatedDate = ''">
              清除
            </text>
            <text class="arrow">›</text>
          </view>
        </picker>

        <text v-if="pickError" class="error">{{ pickError }}</text>

        <view class="actions">
          <view class="btn btn--ghost" @click="closePick">
            <text class="btn-text btn-text--ghost">取消</text>
          </view>
          <view class="btn btn--primary" :class="{ 'btn--disabled': pickSaving }" @click="savePick">
            <text class="btn-text">{{ pickSaving ? '保存中…' : '保存' }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, nextTick, reactive, ref } from 'vue'
import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import {
  listVaccinations,
  createVaccination,
  updateVaccination,
  markVaccinated,
  withStatus,
  summarizeVaccinations,
} from '@/services/vaccine'
import {
  listVaccineLibrary,
  isAgeMatched,
  formatMonthRange,
  suggestScheduledDate,
  VACCINE_CATEGORY_LABEL,
  VACCINE_CATEGORY_TAG,
} from '@/services/vaccine-library'
import { ageParts } from '@/utils/age'
import { todayString } from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'
import VaccineItem from '@/components/VaccineItem/index.vue'

const PAGE_PATH = 'pages/vaccine/vaccine'

/** 待办区排序权重：逾期最急，其次即将接种，最后待接种 */
const URGENCY = { overdue: 0, soon: 1, pending: 2, vaccinated: 3 }

/** 推荐库类别 tab（与 vaccine_library.category 的 check 约束一致） */
const CATEGORY_TABS = [
  { value: 'free', label: VACCINE_CATEGORY_LABEL.free },
  { value: 'paid', label: VACCINE_CATEGORY_LABEL.paid },
]

const store = useAuthStore()

const records = ref([])
const loading = ref(false)
const saving = ref(false)
const errorText = ref('')
const showForm = ref(false)
/** 非空表示正在编辑这条记录，否则是新增 */
const editing = ref(null)

const marking = ref(null)
const marking2 = ref(false)
const vaccinatedDate = ref(todayString())

const today = todayString()

const form = reactive({ name: '', dose: '', scheduledDate: '' })

/** 推荐库列表（补丁 Step 6） */
const showLibrary = ref(false)
const libraryCategory = ref('free')
const libraryItems = ref([])
const libraryLoading = ref(false)
const libraryError = ref('')

/** 选中推荐库某条后的预填表单（null = 未弹出） */
const picked = ref(null)
const pickForm = reactive({ scheduledDate: '', vaccinatedDate: '' })
const pickSaving = ref(false)
const pickError = ref('')

const allList = computed(() => records.value.map((item) => withStatus(item, today)))
const summary = computed(() => summarizeVaccinations(records.value, today))
const todoList = computed(() =>
  allList.value
    .filter((item) => item.status !== 'vaccinated')
    .sort((a, b) => URGENCY[a.status] - URGENCY[b.status]),
)
const markingTitle = computed(() =>
  marking.value
    ? marking.value.dose
      ? `${marking.value.name} · ${marking.value.dose}`
      : marking.value.name
    : '',
)

const toggleActionText = computed(() => {
  if (!showForm.value) return '展开'
  return editing.value ? '取消编辑' : '收起'
})

/** viewer 只读：隐藏添加表单与标记/编辑入口 */
const canWrite = computed(() => store.canWrite)

/** 宝宝当前月龄：统一取 utils/age.js 的 ageParts，避免页面自己算一套（生日缺失时为 null） */
const babyAge = computed(() =>
  store.baby && store.baby.birthday ? ageParts(store.baby.birthday) : null,
)

const babyAgeText = computed(() => {
  if (!babyAge.value) return '宝宝还没填生日，暂时无法按月龄推荐'
  return `宝宝当前 ${babyAge.value.totalMonths} 个月，与月龄匹配的条目已高亮`
})

/** 当前 tab 的条目：服务层已按 sort_order 升序，这里只按类别过滤并标出是否适龄 */
const libraryRows = computed(() => {
  const totalMonths = babyAge.value ? babyAge.value.totalMonths : null
  return libraryItems.value
    .filter((item) => item.category === libraryCategory.value)
    .map((item) => ({ ...item, matched: isAgeMatched(item, totalMonths) }))
})

async function load() {
  if (!store.membership || !store.baby) {
    records.value = []
    return
  }
  loading.value = true
  try {
    records.value = await listVaccinations(store.membership.family_id, store.baby.id)
    console.log('[Vaccine] 已加载记录', records.value.length, '条', summary.value)
  } catch (err) {
    console.error('[Vaccine] 加载失败', err)
    uni.showToast({ title: err.message || '加载失败，请重试', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function clearScheduled() {
  form.scheduledDate = ''
}

function resetForm() {
  form.name = ''
  form.dose = ''
  form.scheduledDate = ''
  errorText.value = ''
}

function onToggleForm() {
  if (editing.value) {
    cancelEdit()
    return
  }
  showForm.value = !showForm.value
}

/** 从记录进入编辑：回填表单，并滚到表单处，避免列表很长时以为点击没反应 */
function startEdit(record) {
  editing.value = record
  form.name = record.name || ''
  form.dose = record.dose || ''
  form.scheduledDate = record.scheduled_date || ''
  errorText.value = ''
  showForm.value = true
  nextTick(() => {
    uni.pageScrollTo({ selector: '#vaccineEntry', duration: 200 })
  })
}

function cancelEdit() {
  editing.value = null
  resetForm()
}

async function onSave() {
  if (saving.value) return
  errorText.value = ''
  if (!form.name.trim()) {
    errorText.value = '请填写疫苗名称'
    return
  }
  if (!store.membership || !store.baby) {
    errorText.value = '还没有家庭或宝宝档案'
    return
  }

  saving.value = true
  try {
    const target = editing.value
    if (target) {
      await updateVaccination({
        ...target,
        name: form.name.trim(),
        dose: form.dose ? String(form.dose).trim() : null,
        scheduled_date: form.scheduledDate || null,
      })
      console.log('[Vaccine] 修改成功', target.id)
      uni.showToast({ title: '已保存修改', icon: 'success' })
    } else {
      await createVaccination({
        familyId: store.membership.family_id,
        babyId: store.baby.id,
        name: form.name,
        dose: form.dose,
        scheduledDate: form.scheduledDate,
      })
      console.log('[Vaccine] 添加成功')
      uni.showToast({ title: '已添加', icon: 'success' })
    }
    editing.value = null
    resetForm()
    showForm.value = false
    await load()
  } catch (err) {
    console.error('[Vaccine] 保存失败', err)
    errorText.value = err.message || '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

function openMark(record) {
  marking.value = record
  vaccinatedDate.value = today
}

function closeMark() {
  if (marking2.value) return
  marking.value = null
}

async function confirmMark() {
  if (!marking.value || marking2.value) return
  marking2.value = true
  try {
    await markVaccinated(marking.value, vaccinatedDate.value)
    console.log('[Vaccine] 已标记接种', marking.value.id, vaccinatedDate.value)
    uni.showToast({ title: '已标记为接种', icon: 'success' })
    marking.value = null
    await load()
  } catch (err) {
    console.error('[Vaccine] 标记失败', err)
    uni.showToast({ title: err.message || '标记失败，请重试', icon: 'none' })
  } finally {
    marking2.value = false
  }
}

/** 疫苗标题：有剂次就带上，否则同一种疫苗的多剂次分不清 */
function libTitle(item) {
  if (!item) return ''
  return item.dose ? `${item.name} · ${item.dose}` : item.name
}

async function openLibrary() {
  showLibrary.value = true
  // 数据量很小且不常变，加载成功后就复用；失败（libraryItems 仍为空）则允许再次点击重试
  if (libraryItems.value.length || libraryLoading.value) return
  libraryLoading.value = true
  libraryError.value = ''
  try {
    libraryItems.value = await listVaccineLibrary()
    console.log('[Vaccine] 推荐库已加载', libraryItems.value.length, '条')
  } catch (err) {
    console.error('[Vaccine] 推荐库加载失败', err)
    libraryError.value = err.message || '推荐库加载失败，请稍后重试'
  } finally {
    libraryLoading.value = false
  }
}

function closeLibrary() {
  showLibrary.value = false
}

/** 点「添加」：计划日期按推荐月龄预填（算出来已过则今天），接种日期默认空 = 未接种 */
function pickLibraryItem(item) {
  picked.value = item
  pickError.value = ''
  pickForm.scheduledDate = suggestScheduledDate(
    store.baby && store.baby.birthday,
    item.min_age_month,
    today,
  )
  pickForm.vaccinatedDate = ''
}

function closePick() {
  if (pickSaving.value) return
  picked.value = null
}

/** 保存：复制库里名称/剂次进 vaccinations，日期用用户在表单里确认过的值 */
async function savePick() {
  if (!picked.value || pickSaving.value) return
  pickError.value = ''
  if (!store.membership || !store.baby) {
    pickError.value = '还没有家庭或宝宝档案'
    return
  }

  pickSaving.value = true
  try {
    await createVaccination({
      familyId: store.membership.family_id,
      babyId: store.baby.id,
      name: picked.value.name,
      dose: picked.value.dose,
      scheduledDate: pickForm.scheduledDate,
      vaccinatedDate: pickForm.vaccinatedDate,
    })
    console.log('[Vaccine] 从推荐库添加成功', picked.value.id)
    uni.showToast({ title: '已添加', icon: 'success' })
    // 只关预填表单、保留推荐库：同月龄常有多剂次要连着加（如 3 月龄的脊灰第2剂 + 百白破第1剂）
    picked.value = null
    await load()
  } catch (err) {
    console.error('[Vaccine] 从推荐库添加失败', err)
    pickError.value = err.message || '保存失败，请重试'
  } finally {
    pickSaving.value = false
  }
}

onLoad((query) => {
  // 从「记录 → 打疫苗」进来时直接展开添加表单，保证记录路径不超过 2 步（viewer 没有表单可展开）
  if (query && query.mode === 'entry' && canWrite.value) showForm.value = true
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

.card-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  display: block;
  margin-bottom: var(--space-sm);
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.card-head .card-title {
  margin-bottom: 0;
}

.card-warn {
  font-size: 24rpx;
  color: var(--color-danger);
}

.empty-inline {
  padding: var(--space-md) 0;
}

.empty-inline-text {
  font-size: 26rpx;
  color: var(--color-text-muted);
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
  width: 160rpx;
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

.field-value--empty {
  color: #c2c7ce;
}

.field-clear {
  padding-left: var(--space-sm);
  font-size: 25rpx;
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

.sheet-field {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 100rpx;
  margin-top: var(--space-sm);
  border-bottom: 1rpx solid var(--color-border);
}

.sheet-field-label {
  flex: 1;
  font-size: 30rpx;
  color: var(--color-text-sub);
}

.sheet-field-value {
  font-size: 30rpx;
  color: var(--color-text-main);
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

/* ===== 补丁 Step 6：推荐库 ===== */

.lib-entry {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-md);
}

.lib-entry-main {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.lib-entry-title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.lib-entry-sub {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--color-text-sub);
}

.disclaimer {
  padding: 0 var(--space-sm) var(--space-lg);
}

.disclaimer-text {
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
}

.sheet-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.sheet-close {
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.sheet--library {
  max-height: 84vh;
}

.tabs {
  display: flex;
  flex-direction: row;
  margin-top: var(--space-md);
  padding: 6rpx;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.tab {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  height: 64rpx;
  border-radius: var(--radius-pill);
}

.tab--active {
  background-color: var(--color-bg-card);
}

.tab-text {
  font-size: 26rpx;
  color: var(--color-text-sub);
}

.tab-text--active {
  font-weight: 600;
  color: var(--color-primary-deep);
}

.lib-list {
  height: 56vh;
  margin-top: var(--space-sm);
}

.lib-disclaimer {
  padding-top: var(--space-sm);
  text-align: center;
}

.lib-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-sm) var(--space-sm);
  border-bottom: 1rpx solid var(--color-border);
}

/* 与当前宝宝月龄匹配：整体浅色高亮 + 「适龄」标签 */
.lib-item--matched {
  background-color: var(--color-primary-soft);
  border-bottom-color: transparent;
  border-radius: var(--radius-md);
}

.lib-item-main {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.lib-item-name {
  font-size: 28rpx;
  color: var(--color-text-main);
}

.lib-item-sub {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--color-text-muted);
}

.lib-item-tag {
  margin-right: var(--space-xs);
  padding: 2rpx 12rpx;
  font-size: 20rpx;
  color: var(--color-primary-deep);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-pill);
}

.lib-category {
  padding: 2rpx 12rpx;
  font-size: 20rpx;
  border-radius: var(--radius-pill);
}

.lib-category--free {
  color: #12b76a;
  background-color: #e6f7ee;
}

.lib-category--paid {
  color: #f79009;
  background-color: #fff3e0;
}

.lib-item-add {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 96rpx;
  height: 56rpx;
  margin-left: var(--space-sm);
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.lib-item-add-text {
  font-size: 24rpx;
  color: #ffffff;
}
</style>
