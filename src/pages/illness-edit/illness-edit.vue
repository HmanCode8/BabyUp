<template>
  <view class="page">
    <!-- 发病时间 / 症状 / 体温 -->
    <view class="app-card">
      <text class="card-label card-label--first">发病时间</text>
      <view class="field">
        <picker mode="date" :value="form.date" :end="today" @change="form.date = $event.detail.value">
          <text class="field-value">{{ form.date }}</text>
        </picker>
        <picker mode="time" :value="form.time" @change="form.time = $event.detail.value">
          <text class="field-value field-value--time">{{ form.time }}</text>
        </picker>
        <text class="arrow">›</text>
      </view>

      <text class="card-label">症状（可多选，至少一项）</text>
      <view class="pills">
        <view
          v-for="item in ILLNESS_SYMPTOMS"
          :key="item.key"
          class="pill"
          :class="{ 'pill--active': form.symptoms.indexOf(item.key) >= 0 }"
          @click="toggleSymptom(item.key)"
        >
          <text
            class="pill-text"
            :class="{ 'pill-text--active': form.symptoms.indexOf(item.key) >= 0 }"
          >
            {{ item.label }}
          </text>
        </view>
      </view>

      <text class="card-label">体温</text>
      <view class="field field--last">
        <input
          class="field-input"
          type="digit"
          maxlength="4"
          :value="form.temperature"
          placeholder="选填，如 38.5"
          placeholder-class="field-placeholder"
          @input="form.temperature = $event.detail.value"
        />
        <text class="field-unit">℃</text>
      </view>
    </view>

    <!-- 用药 -->
    <view class="app-card">
      <view class="card-head">
        <text class="card-title">用药（选填）</text>
        <text
          v-if="medicines.length < ILLNESS_LIMITS.medicineMax"
          class="card-action"
          @click="addMedicine"
        >
          ＋ 添加用药
        </text>
      </view>
      <text v-if="!medicines.length" class="tip">
        吃了什么药、吃多少、吃几天，记下来复诊时好回忆
      </text>
      <view v-for="(med, index) in medicines" :key="med.key" class="med">
        <view class="med-head">
          <text class="med-index">药 {{ index + 1 }}</text>
          <text class="med-remove" @click="removeMedicine(index)">删除</text>
        </view>
        <view class="med-row">
          <text class="med-label">药品名</text>
          <input
            class="med-input"
            maxlength="50"
            :value="med.name"
            placeholder="必填，如 布洛芬混悬液"
            placeholder-class="field-placeholder"
            @input="med.name = $event.detail.value"
          />
        </view>
        <view class="med-row">
          <text class="med-label">剂量</text>
          <input
            class="med-input med-input--dose"
            maxlength="20"
            :value="med.dose"
            placeholder="如 5"
            placeholder-class="field-placeholder"
            @input="med.dose = $event.detail.value"
          />
          <input
            class="med-input med-input--unit"
            maxlength="10"
            :value="med.unit"
            placeholder="ml"
            placeholder-class="field-placeholder"
            @input="med.unit = $event.detail.value"
          />
        </view>
        <view class="med-row">
          <text class="med-label">频次</text>
          <input
            class="med-input"
            maxlength="30"
            :value="med.frequency"
            placeholder="如 每 6 小时一次"
            placeholder-class="field-placeholder"
            @input="med.frequency = $event.detail.value"
          />
        </view>
        <view class="med-row">
          <text class="med-label">天数</text>
          <input
            class="med-input med-input--dose"
            type="number"
            maxlength="3"
            :value="med.days"
            placeholder="如 3"
            placeholder-class="field-placeholder"
            @input="med.days = $event.detail.value"
          />
          <text class="med-unit">天</text>
        </view>
        <view class="med-row med-row--last">
          <text class="med-label">备注</text>
          <input
            class="med-input"
            maxlength="50"
            :value="med.note"
            placeholder="选填，如 饭后吃"
            placeholder-class="field-placeholder"
            @input="med.note = $event.detail.value"
          />
        </view>
      </view>
    </view>

    <!-- 就诊 / 照片 / 备注 -->
    <view class="app-card">
      <text class="card-label card-label--first">就诊（选填）</text>
      <view class="field">
        <text class="field-label">医院</text>
        <input
          class="field-input"
          maxlength="50"
          :value="form.hospital"
          placeholder="如 市妇幼保健院"
          placeholder-class="field-placeholder"
          @input="form.hospital = $event.detail.value"
        />
      </view>
      <view class="field field--last">
        <text class="field-label">医生</text>
        <input
          class="field-input"
          maxlength="30"
          :value="form.doctor"
          placeholder="选填"
          placeholder-class="field-placeholder"
          @input="form.doctor = $event.detail.value"
        />
      </view>

      <text class="card-label">诊断</text>
      <textarea
        class="textarea"
        maxlength="200"
        :value="form.diagnosis"
        placeholder="选填，如 上呼吸道感染"
        placeholder-class="field-placeholder"
        @input="form.diagnosis = $event.detail.value"
      />

      <text class="card-label">过敏 / 不良反应</text>
      <textarea
        class="textarea"
        maxlength="200"
        :value="form.allergyNote"
        placeholder="选填，如 服用后起皮疹"
        placeholder-class="field-placeholder"
        @input="form.allergyNote = $event.detail.value"
      />

      <text class="card-label">照片（选填，最多 {{ ILLNESS_LIMITS.photoMax }} 张）</text>
      <view class="shots">
        <view v-for="(shot, index) in photos" :key="shot.key" class="shot">
          <image
            class="shot-img"
            :src="shot.filePath || shot.url"
            mode="aspectFill"
            @click="previewPhoto(index)"
          />
          <text class="shot-remove" @click="removePhoto(index)">×</text>
        </view>
        <view v-if="photos.length < ILLNESS_LIMITS.photoMax" class="shot shot--add" @click="onPickPhotos">
          <text class="shot-add-glyph">＋</text>
        </view>
      </view>

      <text class="card-label">备注</text>
      <textarea
        class="textarea"
        maxlength="200"
        :value="form.note"
        placeholder="选填，如 夜里烧到 39 度，物理降温后退下来"
        placeholder-class="field-placeholder"
        @input="form.note = $event.detail.value"
      />

      <text v-if="errorText" class="error">{{ errorText }}</text>

      <view class="primary" :class="{ 'primary--disabled': saving }" @click="onSave">
        <text class="primary-text">{{ saving ? '保存中…' : editing ? '保存修改' : '保存' }}</text>
      </view>
      <view v-if="editing" class="ghost" @click="goBack">
        <text class="ghost-text">取消编辑</text>
      </view>

      <!-- 医疗免责：合规表达，不是功能 -->
      <text class="disclaimer">本记录仅用于家庭内部留存，不构成医疗建议，请遵医嘱</text>
    </view>
  </view>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import {
  ILLNESS_SYMPTOMS,
  ILLNESS_LIMITS,
  fetchIllnessRecord,
  createIllnessRecord,
  updateIllnessRecord,
  uploadIllnessPhoto,
  discardIllnessPhoto,
} from '@/services/illness'
import { chooseImages, compressImage } from '@/utils/media'
import { todayString, nowTimeString, toIsoFromLocal, formatDate, formatTime } from '@/utils/date'
import { ensurePageAccess, redirectTo } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/illness-edit/illness-edit'

const store = useAuthStore()

const today = todayString()
const saving = ref(false)
const errorText = ref('')
/** 非空表示正在编辑这条记录，否则是新增 */
const editing = ref(null)

const form = reactive({
  date: today,
  time: nowTimeString(),
  symptoms: [],
  temperature: '',
  hospital: '',
  doctor: '',
  diagnosis: '',
  allergyNote: '',
  note: '',
})

/** 用药多行，空行（没填药名）保存时会被丢掉 */
const medicines = ref([])
let medSeq = 0

/**
 * 照片统一放在一个数组里：
 * - 已入库的带 path（+url 签名地址）
 * - 新选的带本地 filePath，保存时才上传
 */
const photos = ref([])

function toggleSymptom(key) {
  const list = form.symptoms
  const at = list.indexOf(key)
  if (at >= 0) list.splice(at, 1)
  else list.push(key)
  errorText.value = ''
}

function addMedicine() {
  if (medicines.value.length >= ILLNESS_LIMITS.medicineMax) return
  medSeq += 1
  medicines.value.push({
    key: `med-${medSeq}`,
    name: '',
    dose: '',
    unit: '',
    frequency: '',
    days: '',
    note: '',
  })
}

function removeMedicine(index) {
  medicines.value.splice(index, 1)
}

async function onPickPhotos() {
  const remain = ILLNESS_LIMITS.photoMax - photos.value.length
  if (remain <= 0) return
  try {
    const picked = await chooseImages(remain)
    if (!picked.length) return
    for (const item of picked.slice(0, remain)) {
      photos.value.push({ key: `new-${item}`, filePath: await compressImage(item) })
    }
    errorText.value = ''
  } catch (err) {
    console.error('[Illness] 选择图片失败', err)
    uni.showToast({ title: err.message || '选择图片失败', icon: 'none' })
  }
}

function removePhoto(index) {
  photos.value.splice(index, 1)
}

function previewPhoto(index) {
  const urls = photos.value.map((item) => item.filePath || item.url).filter(Boolean)
  if (!urls.length) return
  const current = photos.value[index].filePath || photos.value[index].url
  uni.previewImage({ urls, current })
}

/** 体温：空返回 null，非法返回错误文案 */
function parseTemperature() {
  const raw = String(form.temperature == null ? '' : form.temperature).trim()
  if (!raw) return { value: null }
  const value = Number(raw)
  if (!Number.isFinite(value) ||
      value < ILLNESS_LIMITS.temperatureMin || value > ILLNESS_LIMITS.temperatureMax) {
    return {
      error: `体温应在 ${ILLNESS_LIMITS.temperatureMin}~${ILLNESS_LIMITS.temperatureMax} ℃ 之间`,
    }
  }
  return { value: Math.round(value * 10) / 10 }
}

/** 只保留填了药名的行，天数转成整数（与云函数 normalizeIllnessDoc 同一套规则） */
function buildMedicines() {
  return medicines.value
    .map((med) => {
      const name = String(med.name || '').trim()
      if (!name) return null
      const days = Number(med.days)
      return {
        name,
        dose: String(med.dose || '').trim() || null,
        unit: String(med.unit || '').trim() || null,
        frequency: String(med.frequency || '').trim() || null,
        days: Number.isFinite(days) && days > 0 ? Math.round(days) : null,
        note: String(med.note || '').trim() || null,
      }
    })
    .filter(Boolean)
}

async function onSave() {
  if (saving.value) return
  errorText.value = ''
  if (!store.membership || !store.baby) {
    errorText.value = '还没有家庭或宝宝档案'
    return
  }
  if (!form.symptoms.length) {
    errorText.value = '请至少选择一项症状'
    return
  }
  const temperature = parseTemperature()
  if (temperature.error) {
    errorText.value = temperature.error
    return
  }

  const familyId = store.membership.family_id
  const babyId = store.baby.id
  const target = editing.value
  const keptPaths = photos.value.filter((item) => item.path).map((item) => item.path)
  const newFiles = photos.value.filter((item) => item.filePath)
  /** 编辑时被移除的旧图，保存成功后清掉 */
  const removedPaths = target
    ? (target.photos || []).filter((path) => keptPaths.indexOf(path) < 0)
    : []

  const fields = {
    occurred_at: toIsoFromLocal(form.date, form.time),
    symptoms: form.symptoms.slice(),
    temperature: temperature.value,
    medicines: buildMedicines(),
    hospital: form.hospital,
    doctor: form.doctor,
    diagnosis: form.diagnosis,
    allergy_note: form.allergyNote,
    note: form.note,
  }

  saving.value = true
  const uploaded = []
  try {
    // 先把文件传到 Storage，成功后再写库
    for (const item of newFiles) {
      uploaded.push(await uploadIllnessPhoto(familyId, babyId, item.filePath))
    }
    const finalPhotos = keptPaths.concat(uploaded)

    if (target) {
      await updateIllnessRecord({ ...target, ...fields, photos: finalPhotos })
      console.log('[Illness] 修改成功', target.id)
      uni.showToast({ title: '已保存修改', icon: 'success' })
    } else {
      await createIllnessRecord({
        familyId,
        babyId,
        occurredAt: fields.occurred_at,
        symptoms: fields.symptoms,
        temperature: fields.temperature,
        medicines: fields.medicines,
        hospital: fields.hospital,
        doctor: fields.doctor,
        diagnosis: fields.diagnosis,
        allergyNote: fields.allergy_note,
        photos: finalPhotos,
        note: fields.note,
      })
      console.log('[Illness] 保存成功', fields.symptoms.join(','))
      uni.showToast({ title: '已保存', icon: 'success' })
    }
    if (removedPaths.length) await discardIllnessPhoto(removedPaths)
    setTimeout(goBack, 600)
  } catch (err) {
    console.error('[Illness] 保存失败', err)
    // 记录没写进去，把刚传的图片清掉，避免留下孤儿文件
    if (uploaded.length) await discardIllnessPhoto(uploaded)
    errorText.value = err.message || '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

function goBack() {
  if (getCurrentPages().length > 1) {
    uni.navigateBack()
  } else {
    redirectTo('/pages/illness/illness')
  }
}

onLoad((query) => {
  const id = query && query.id
  if (!id) return
  uni.setNavigationBarTitle({ title: '编辑生病记录' })
  ;(async () => {
    try {
      await store.bootstrap()
      const record = await fetchIllnessRecord(id)
      if (!record) {
        errorText.value = '这条记录不存在或已被删除'
        return
      }
      editing.value = record
      form.date = formatDate(record.occurred_at)
      form.time = formatTime(record.occurred_at)
      form.symptoms = Array.isArray(record.symptoms) ? record.symptoms.slice() : []
      form.temperature = record.temperature == null ? '' : String(record.temperature)
      form.hospital = record.hospital || ''
      form.doctor = record.doctor || ''
      form.diagnosis = record.diagnosis || ''
      form.allergyNote = record.allergy_note || ''
      form.note = record.note || ''
      medicines.value = (record.medicines || []).map((med) => {
        medSeq += 1
        return {
          key: `med-${medSeq}`,
          name: med.name || '',
          dose: med.dose == null ? '' : String(med.dose),
          unit: med.unit || '',
          frequency: med.frequency || '',
          days: med.days == null ? '' : String(med.days),
          note: med.note || '',
        }
      })
      // photoUrls 与 photos 索引一一对应，签名失败的位置是空串，这里直接丢弃
      photos.value = (record.photos || []).map((path, index) => ({
        key: path,
        path,
        url: (record.photoUrls || [])[index] || '',
      }))
      console.log('[Illness] 编辑回填', record.id, medicines.value.length, '条用药')
    } catch (err) {
      console.error('[Illness] 回填失败', err)
      errorText.value = err.message || '加载记录失败，请重试'
    }
  })()
})

onShow(() => {
  ensurePageAccess(PAGE_PATH)
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

.card-label--first {
  margin-top: 0;
}

.card-head {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.card-title {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.card-action {
  font-size: 26rpx;
  color: var(--color-primary);
}

.tip {
  display: block;
  padding: var(--space-sm) 0;
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
}

/* 症状多选 */
.pills {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.pill {
  padding: 12rpx 28rpx;
  margin-right: var(--space-sm);
  margin-bottom: var(--space-sm);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.pill--active {
  background-color: var(--color-primary-soft);
}

.pill-text {
  font-size: 26rpx;
  color: var(--color-text-sub);
}

.pill-text--active {
  color: var(--color-primary-deep);
  font-weight: 600;
}

/* 表单行 */
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

.field-unit {
  padding-left: var(--space-xs);
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.arrow {
  padding-left: var(--space-xs);
  font-size: 36rpx;
  color: var(--color-text-muted);
}

/* 用药 */
.med {
  margin-top: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.med-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 56rpx;
}

.med-index {
  flex: 1;
  font-size: 25rpx;
  font-weight: 600;
  color: var(--color-text-sub);
}

.med-remove {
  font-size: 25rpx;
  color: var(--color-danger);
}

.med-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 84rpx;
  border-bottom: 1rpx solid var(--color-border);
}

.med-row--last {
  border-bottom: none;
}

.med-label {
  width: 110rpx;
  font-size: 27rpx;
  color: var(--color-text-sub);
}

.med-input {
  flex: 1;
  height: 84rpx;
  font-size: 28rpx;
  color: var(--color-text-main);
}

.med-input--dose {
  flex: none;
  width: 180rpx;
}

.med-input--unit {
  flex: 1;
  padding-left: var(--space-md);
}

.med-unit {
  padding-left: var(--space-xs);
  font-size: 26rpx;
  color: var(--color-text-muted);
}

/* 照片 */
.shots {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.shot {
  position: relative;
  width: 176rpx;
  height: 176rpx;
  margin-right: var(--space-sm);
  margin-bottom: var(--space-sm);
}

.shot-img {
  width: 176rpx;
  height: 176rpx;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.shot-remove {
  position: absolute;
  top: -12rpx;
  right: -12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40rpx;
  height: 40rpx;
  font-size: 28rpx;
  color: #ffffff;
  background-color: rgba(31, 35, 41, 0.6);
  border-radius: 50%;
}

.shot--add {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.shot-add-glyph {
  font-size: 52rpx;
  color: var(--color-text-muted);
}

/* 多行文本 */
.textarea {
  width: 100%;
  height: 160rpx;
  padding: var(--space-md);
  font-size: 29rpx;
  line-height: 1.6;
  color: var(--color-text-main);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
  box-sizing: border-box;
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

.disclaimer {
  display: block;
  margin-top: var(--space-md);
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
  text-align: center;
}
</style>
