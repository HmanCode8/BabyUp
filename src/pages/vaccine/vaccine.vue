<template>
  <view class="page">
    <!--
      提醒授权入口（三期 P1-6）：微信订阅消息是一次性的，只能靠用户点一次攒一条额度，
      不做记录的家庭成员（如爷爷奶奶）没有「保存疫苗」这个动作，所以这里给一个主动授权的按钮。
    -->
    <view class="remind">
      <view class="remind-main">
        <text class="remind-title">接种日微信提醒</text>
        <text class="remind-sub">
          微信提醒次数有限，站内「待办」始终可见；每位家人都点一次，到期当天才能各自收到
        </text>
      </view>
      <view class="remind-btn" @click="onEnableRemind">
        <text class="remind-btn-text">开启提醒</text>
      </view>
    </view>

    <!-- 待办：未接种的全部（逾期 / 即将接种 / 待接种），按紧急度排序 -->
    <view class="section-head">
      <view class="section-bar section-bar--todo" />
      <text class="section-title">待办</text>
      <text v-if="todoList.length" class="section-meta">{{ todoList.length }} 针待接种</text>
      <text v-if="summary.overdue" class="section-meta section-meta--danger">
        逾期 {{ summary.overdue }} 项
      </text>
    </view>

    <view class="app-card">
      <view v-if="!todoList.length" class="empty-inline">
        <text class="empty-inline-title">{{ loading ? '加载中…' : '没有待接种的疫苗' }}</text>
        <text v-if="!loading" class="empty-inline-sub">接种记录都归档在下面的「已接种」里</text>
      </view>
      <VaccineItem
        v-for="item in todoList"
        :key="item.id"
        :record="item"
        :readonly="!canWrite"
        @mark="openMark"
        @edit="startEdit"
        @delete="onDelete"
      />
    </view>

    <!-- 添加：viewer 只读时不显示。虚线边框 = 「动作区」，与上下两个列表卡片区分开 -->
    <view v-if="canWrite" class="section-head">
      <view class="section-bar section-bar--add" />
      <text class="section-title">{{ editing ? '编辑疫苗' : '添加疫苗' }}</text>
      <text class="section-action" @click="onToggleForm">{{ toggleActionText }}</text>
    </view>

    <view v-if="canWrite" id="vaccineEntry" class="app-card app-card--action">
      <!-- 疫苗名字典入口：按宝宝月龄推荐（viewer 整张卡片都不渲染） -->
      <view class="lib-entry" @click="openLibrary">
        <view class="lib-entry-main">
          <text class="lib-entry-title">从推荐库添加</text>
          <text class="lib-entry-sub">按宝宝月龄推荐常见疫苗，日期可改</text>
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

    <!-- 已接种：从「待办」归档过来的历史记录，按实际接种日期倒序 -->
    <view class="section-head">
      <view class="section-bar section-bar--done" />
      <text class="section-title">已接种</text>
      <text v-if="doneList.length" class="section-meta">共 {{ doneList.length }} 针</text>
    </view>

    <view class="app-card">
      <view v-if="!doneList.length" class="empty-inline">
        <text class="empty-inline-title">还没有已接种的记录</text>
        <text v-if="!loading" class="empty-inline-sub">在「待办」里标记接种后，会自动归档到这里</text>
      </view>
      <VaccineItem
        v-for="item in doneList"
        :key="item.id"
        :record="item"
        :readonly="!canWrite"
        @mark="openMark"
        @edit="startEdit"
        @delete="onDelete"
      />
    </view>

    <!-- 合规：字典仅作名称录入参考，接种程序以当地门诊为准（风险说明第 2 条） -->
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

    <!-- 疫苗名字典列表：类别 tab + 名称/剂次 + 月龄匹配 -->
    <view v-if="showLibrary" class="mask" @click="closeLibrary">
      <view class="sheet sheet--library" @click.stop>
        <view class="sheet-head">
          <text class="sheet-title">疫苗推荐库</text>
          <text class="sheet-close" @click="closeLibrary">关闭</text>
        </view>
        <text class="sheet-sub">
          {{ librarySubText }}
        </text>

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
              :class="{ 'lib-item--matched': isMatched(item) }"
            >
              <view class="lib-item-main">
                <view class="lib-item-head">
                  <text class="lib-item-name">{{ libTitle(item) }}</text>
                  <text v-if="isMatched(item)" class="lib-item-badge">适龄</text>
                </view>
                <text v-if="libHint(item)" class="lib-item-hint">{{ libHint(item) }}</text>
              </view>
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

    <!-- 选中字典某条后的表单：计划日期按推荐月龄预填，接种日期留空 = 未接种 -->
    <view v-if="picked" class="mask" @click="closePick">
      <view class="sheet" @click.stop>
        <text class="sheet-title">{{ libTitle(picked) }}</text>
        <text class="sheet-sub">计划日期已按推荐月龄预填，请按当地接种门诊的安排核对修改</text>

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
  removeVaccination,
  withStatus,
  summarizeVaccinations,
} from '@/services/vaccine'
import {
  listVaccineLibrary,
  isAgeMatched,
  ageRangeText,
  VACCINE_CATEGORY_LABEL,
  VACCINE_CATEGORY_TAG,
} from '@/services/vaccine-library'
import { ageParts, dateAtMonths } from '@/utils/age'
import { todayString } from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'
import VaccineItem from '@/components/VaccineItem/index.vue'

const PAGE_PATH = 'pages/vaccine/vaccine'

/**
 * 订阅消息模板 ID（小程序后台 → 功能 → 订阅消息 → 我的模板）。
 * 必须与云函数 src/cloudfunctions/reminder/index.js 里的 TEMPLATE_ID 一致。
 */
const VACCINE_TEMPLATE_ID = '9-P4ftotXMMapWSvVhH578lFR0LV4qvLewPMYyA0dns'

/** 待办区排序权重：逾期最急，其次即将接种，最后待接种 */
const URGENCY = { overdue: 0, soon: 1, pending: 2, vaccinated: 3 }

/** 字典类别 tab（与 vaccine_library.category 的 check 约束一致） */
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

/** 疫苗名字典列表 */
const showLibrary = ref(false)
const libraryCategory = ref('free')
const libraryItems = ref([])
const libraryLoading = ref(false)
const libraryError = ref('')

/** 选中字典某条后的表单（null = 未弹出） */
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
/** 已接种归档：列表接口按计划日期排序，历史记录这里要按实际接种日期倒序 */
const doneList = computed(() =>
  allList.value
    .filter((item) => item.status === 'vaccinated')
    .sort((a, b) => String(b.vaccinated_date || '').localeCompare(String(a.vaccinated_date || ''))),
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

/** 当前宝宝月龄；生日缺失时为 null，此时不做月龄匹配 */
const babyMonths = computed(() => {
  const birthday = store.baby && store.baby.birthday
  if (!birthday) return null
  const parts = ageParts(birthday)
  return parts ? parts.totalMonths : null
})

/** 当前 tab 的条目：服务层已按 sort_order 升序，这里按类别过滤后把适龄的提前 */
const libraryRows = computed(() => {
  const rows = libraryItems.value.filter((item) => item.category === libraryCategory.value)
  if (babyMonths.value === null) return rows
  // 适龄的排到前面（组内仍是 sort_order 顺序），进弹层就能直接点「添加」
  const matched = rows.filter((item) => isAgeMatched(item, babyMonths.value))
  return matched.concat(rows.filter((item) => !isAgeMatched(item, babyMonths.value)))
})

/** 弹层副标题：能算出月龄时提示已按该月龄推荐，否则只提示以门诊为准 */
const librarySubText = computed(() => {
  if (babyMonths.value === null) return '接种时间请按当地接种门诊的安排填写'
  return `已按 ${babyMonths.value} 月龄标记「适龄」并排在前面，接种时间以当地接种门诊为准`
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

/** 删除一条疫苗记录；删的正好是正在编辑的那条时顺手退出编辑态 */
function onDelete(item) {
  const label = item.dose ? `${item.name} · ${item.dose}` : item.name
  uni.showModal({
    title: '删除疫苗记录',
    content: `删除「${label}」这条记录？删掉后不会再提醒接种。`,
    confirmText: '删除',
    confirmColor: '#F04438',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await removeVaccination(item.id)
        console.log('[Vaccine] 已删除', item.id)
        if (editing.value && editing.value.id === item.id) cancelEdit()
        uni.showToast({ title: '已删除', icon: 'success' })
        await load()
      } catch (err) {
        console.error('[Vaccine] 删除失败', err)
        uni.showToast({ title: err.message || '删除失败，请重试', icon: 'none' })
      }
    },
  })
}

/**
 * 要一次订阅消息授权。
 *
 * 一次性订阅授权一次只能发一条，额度只能在用户操作时攒，等提醒那天再要根本来不及
 * （那时用户不在小程序里）。所以两处入手：
 *   1. 保存「有计划日期且未接种」的疫苗时顺手要一次（notify=false，静默）；
 *   2. 页面顶部「开启提醒」按钮（notify=true）——给不做记录的家人一个主动授权入口。
 *
 * 必须在点击回调里同步调用：微信要求 requestSubscribeMessage 由用户点击手势直接触发，
 * 放在 await 之后会以「can only be invoked by user TAP gesture」失败。
 * 授权被拒/失败一律静默，绝不能因为提醒没授权就让疫苗记录存不进去。
 */
function requestVaccineSubscribe(notify) {
  // #ifdef MP-WEIXIN
  console.log('[Vaccine] 准备请求订阅消息授权', VACCINE_TEMPLATE_ID)
  if (typeof uni.requestSubscribeMessage !== 'function') return
  uni.requestSubscribeMessage({
    tmplIds: [VACCINE_TEMPLATE_ID],
    success: (res) => {
      const result = res[VACCINE_TEMPLATE_ID]
      console.log('[Vaccine] 订阅消息授权结果', result)
      // 保存记录时顺手要的授权不打扰用户；主动点按钮时才告诉结果
      if (!notify) return
      uni.showToast(
        result === 'accept'
          ? { title: '已开启提醒', icon: 'success' }
          : { title: '未开启，可稍后再试', icon: 'none' },
      )
    },
    fail: (err) => {
      const errCode = err && err.errCode
      console.error('[Vaccine] 订阅消息授权失败', errCode, (err && err.errMsg) || err)
      // 20004：用户关掉了订阅消息总开关，只能在设置里重新打开
      if (errCode === 20004) {
        uni.showModal({
          title: '提醒未开启',
          content: '你在设置里关闭了订阅消息，打开后才能在接种日收到提醒',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm && typeof uni.openSetting === 'function') uni.openSetting()
          },
        })
      } else if (notify) {
        uni.showToast({ title: '开启失败，请重试', icon: 'none' })
      }
    },
  })
  // #endif
  // #ifndef MP-WEIXIN
  if (notify) uni.showToast({ title: '请在微信小程序里开启', icon: 'none' })
  // #endif
}

/** 顶部「开启提醒」按钮：直接转发给 requestVaccineSubscribe，保证同步处于点击手势中 */
function onEnableRemind() {
  requestVaccineSubscribe(true)
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

  // 新增「有计划接种日期」的疫苗时顺手要授权（必须同步调用，见函数注释）
  if (!editing.value && form.scheduledDate) requestVaccineSubscribe()

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

/** 行内月龄提示：优先用字典维护的 note（如「与上一剂间隔约 1 个月」），没有则按月龄区间拼 */
function libHint(item) {
  if (!item) return ''
  return item.note || ageRangeText(item)
}

/** 是否与当前宝宝月龄匹配（月龄未知时一律不匹配） */
function isMatched(item) {
  if (babyMonths.value === null) return false
  return isAgeMatched(item, babyMonths.value)
}

async function openLibrary() {
  showLibrary.value = true
  // 数据量很小且不常变，加载成功后就复用；失败（libraryItems 仍为空）则允许再次点击重试
  if (libraryItems.value.length || libraryLoading.value) return
  libraryLoading.value = true
  libraryError.value = ''
  try {
    libraryItems.value = await listVaccineLibrary()
    console.log('[Vaccine] 疫苗名字典已加载', libraryItems.value.length, '条')
  } catch (err) {
    console.error('[Vaccine] 疫苗名字典加载失败', err)
    libraryError.value = err.message || '疫苗名字典加载失败，请稍后重试'
  } finally {
    libraryLoading.value = false
  }
}

function closeLibrary() {
  showLibrary.value = false
}

/**
 * 计划日期预填：生日 + 推荐起始月龄（如 6 月龄疫苗 -> 满 6 个月那天）。
 * 算出来的日期已经过去（含月龄 0 的出生时疫苗）就回落到今天，避免一进来就是「逾期」。
 */
function recommendedDate(item) {
  const birthday = store.baby && store.baby.birthday
  const raw = item && item.min_age_month
  if (!birthday || raw === null || raw === undefined || raw === '') return ''
  const min = Number(raw)
  if (!Number.isFinite(min)) return ''
  const date = dateAtMonths(birthday, min)
  if (!date) return ''
  return date > today ? date : today
}

/** 点「添加」：把名称/剂次带进表单，计划日期按推荐月龄预填（可改），接种日期留空 */
function pickLibraryItem(item) {
  picked.value = item
  pickError.value = ''
  pickForm.scheduledDate = recommendedDate(item)
  pickForm.vaccinatedDate = ''
}

function closePick() {
  if (pickSaving.value) return
  picked.value = null
}

/** 保存：复制字典里的名称/剂次进 vaccinations，日期用用户在表单里确认过的值 */
async function savePick() {
  if (!picked.value || pickSaving.value) return
  pickError.value = ''
  if (!store.membership || !store.baby) {
    pickError.value = '还没有家庭或宝宝档案'
    return
  }

  // 排了计划日期且还没接种时顺手要授权（必须同步调用，见函数注释）
  if (pickForm.scheduledDate && !pickForm.vaccinatedDate) requestVaccineSubscribe()

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
    console.log('[Vaccine] 从字典添加成功', picked.value.id)
    uni.showToast({ title: '已添加', icon: 'success' })
    // 只关表单、保留字典：常有多剂次要连着加（如脊灰第2剂 + 百白破第1剂）
    picked.value = null
    await load()
  } catch (err) {
    console.error('[Vaccine] 从字典添加失败', err)
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

/* 提醒授权：整页最上面的一条，不抢待办列表的注意力，所以用浅底 + 描边按钮 */
.remind {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-sm) var(--space-md);
  margin-bottom: var(--space-lg);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-md);
}

.remind-main {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.remind-title {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.remind-sub {
  margin-top: 4rpx;
  font-size: 22rpx;
  line-height: 1.5;
  color: var(--color-text-sub);
}

.remind-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 152rpx;
  height: 60rpx;
  margin-left: var(--space-sm);
  background-color: var(--color-bg-card);
  border: 2rpx solid var(--color-primary);
  border-radius: var(--radius-pill);
}

.remind-btn-text {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

/* 区块之间留大间距、卡片内部紧凑：一眼能看出这是三块，而不是一个长列表 */
.app-card {
  margin-bottom: var(--space-xl);
}

/* 「添加疫苗」是动作区：虚线边框 + 去掉投影，与上下两个列表卡片区分开 */
.app-card--action {
  border: 2rpx dashed rgba(255, 143, 107, 0.55);
  box-shadow: none;
}

/* 区块标题放在卡片外面，配一根主色竖条，区块边界靠它来分 */
.section-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: var(--space-sm);
}

.section-bar {
  width: 8rpx;
  height: 30rpx;
  margin-right: var(--space-sm);
  border-radius: var(--radius-pill);
}

/* 橙 = 还需要关注的（待接种 / 要操作），绿 = 已完成的 */
.section-bar--todo,
.section-bar--add {
  background-color: var(--color-primary);
}

.section-bar--done {
  background-color: var(--color-success);
}

.section-title {
  flex: 1;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.section-meta {
  margin-left: var(--space-sm);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.section-meta--danger {
  color: var(--color-danger);
}

.section-action {
  font-size: 26rpx;
  color: var(--color-primary);
}

.empty-inline {
  padding: var(--space-md) 0;
}

.empty-inline-title {
  display: block;
  font-size: 27rpx;
  color: var(--color-text-sub);
}

.empty-inline-sub {
  display: block;
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.empty-inline-text {
  font-size: 26rpx;
  color: var(--color-text-muted);
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

/* ===== 疫苗名字典 ===== */

.lib-entry {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
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

/* 与当前宝宝月龄匹配：左侧竖条 + 浅底，一眼能看出推荐哪几条 */
.lib-item--matched {
  background-color: var(--color-bg-page);
  border-left: 6rpx solid var(--color-primary);
}

.lib-item-main {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.lib-item-head {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.lib-item-name {
  font-size: 28rpx;
  color: var(--color-text-main);
}

.lib-item-badge {
  margin-left: var(--space-xs);
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  color: #ffffff;
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.lib-item-hint {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--color-text-sub);
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
