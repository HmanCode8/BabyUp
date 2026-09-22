<template>
  <view class="page">
    <!-- 体检日期 / 月龄 -->
    <view class="app-card">
      <text class="card-label card-label--first">体检日期</text>
      <view class="field">
        <picker mode="date" :value="form.date" :end="today" @change="form.date = $event.detail.value">
          <text class="field-value">{{ form.date }}</text>
        </picker>
        <text class="arrow">›</text>
      </view>
      <view class="field field--last">
        <text class="field-label">月龄</text>
        <text class="field-value">{{ ageText }}</text>
      </view>
      <text class="tip">月龄按宝宝生日自动算，不用填</text>
    </view>

    <!-- 体格测量 -->
    <view class="app-card">
      <text class="card-title">体格测量（选填）</text>
      <text class="tip">填了身高或体重，会自动往生长记录里同步一条同日期、同数值的数据</text>

      <view class="field">
        <text class="field-label">身高</text>
        <input
          class="field-input"
          type="digit"
          maxlength="5"
          :value="form.heightCm"
          placeholder="如 75.5"
          placeholder-class="field-placeholder"
          @input="form.heightCm = $event.detail.value"
        />
        <text class="field-unit">cm</text>
      </view>

      <view class="field">
        <text class="field-label">体重</text>
        <input
          class="field-input"
          type="digit"
          maxlength="5"
          :value="form.weightKg"
          placeholder="如 9.6"
          placeholder-class="field-placeholder"
          @input="form.weightKg = $event.detail.value"
        />
        <text class="field-unit">kg</text>
      </view>

      <view class="field">
        <text class="field-label">头围</text>
        <input
          class="field-input"
          type="digit"
          maxlength="5"
          :value="form.headCm"
          placeholder="选填，如 45"
          placeholder-class="field-placeholder"
          @input="form.headCm = $event.detail.value"
        />
        <text class="field-unit">cm</text>
      </view>

      <view class="field field--last">
        <text class="field-label">血红蛋白</text>
        <input
          class="field-input"
          type="digit"
          maxlength="6"
          :value="form.hemoglobin"
          placeholder="选填，按化验单数值"
          placeholder-class="field-placeholder"
          @input="form.hemoglobin = $event.detail.value"
        />
      </view>
    </view>

    <!-- 体检机构 / 发育评估 / 医生建议 / 下次体检 / 照片 -->
    <view class="app-card">
      <text class="card-label card-label--first">体检机构</text>
      <view class="field field--last">
        <input
          class="field-input"
          maxlength="50"
          :value="form.hospital"
          placeholder="选填，如 市妇幼保健院"
          placeholder-class="field-placeholder"
          @input="form.hospital = $event.detail.value"
        />
      </view>

      <text class="card-label">发育评估</text>
      <textarea
        class="textarea"
        maxlength="500"
        :value="form.development"
        placeholder="选填，如 大运动、语言发育正常"
        placeholder-class="field-placeholder"
        @input="form.development = $event.detail.value"
      />

      <text class="card-label">医生建议</text>
      <textarea
        class="textarea"
        maxlength="500"
        :value="form.doctorAdvice"
        placeholder="选填，如 多晒太阳，4 个月后复查血常规"
        placeholder-class="field-placeholder"
        @input="form.doctorAdvice = $event.detail.value"
      />

      <text class="card-label">建议下次体检日期</text>
      <view class="field field--last">
        <picker mode="date" :value="form.nextDate" @change="form.nextDate = $event.detail.value">
          <text class="field-value" :class="{ 'field-value--empty': !form.nextDate }">
            {{ form.nextDate || '选填，用于提醒' }}
          </text>
        </picker>
        <text v-if="form.nextDate" class="field-clear" @click="form.nextDate = ''">清空</text>
        <text v-else class="arrow">›</text>
      </view>

      <text class="card-label">体检本照片（选填，最多 {{ CHECKUP_LIMITS.photoMax }} 张）</text>
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
        <view v-if="photos.length < CHECKUP_LIMITS.photoMax" class="shot shot--add" @click="onPickPhotos">
          <text class="shot-add-glyph">＋</text>
        </view>
      </view>

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
import { computed, reactive, ref } from 'vue'
import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import {
  CHECKUP_LIMITS,
  fetchCheckupRecord,
  createCheckupRecord,
  updateCheckupRecord,
  uploadCheckupPhoto,
  discardCheckupPhoto,
} from '@/services/checkup'
import { ageParts, formatAge } from '@/utils/age'
import { chooseImages, compressImage } from '@/utils/media'
import { todayString } from '@/utils/date'
import { ensurePageAccess, redirectTo } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/checkup-edit/checkup-edit'

const store = useAuthStore()

const today = todayString()
const saving = ref(false)
const errorText = ref('')
/** 非空表示正在编辑这条记录，否则是新增 */
const editing = ref(null)

const form = reactive({
  date: today,
  hospital: '',
  heightCm: '',
  weightKg: '',
  headCm: '',
  hemoglobin: '',
  development: '',
  doctorAdvice: '',
  nextDate: '',
})

/** 月龄只读展示：按「宝宝生日 → 体检日期」算 */
const ageText = computed(() => {
  const birthday = store.baby && store.baby.birthday
  if (!birthday) return '未填宝宝生日'
  const text = formatAge(birthday, form.date)
  return text || '——'
})

/**
 * 照片统一放在一个数组里：
 * - 已入库的带 path（+url 签名地址）
 * - 新选的带本地 filePath，保存时才上传
 */
const photos = ref([])

async function onPickPhotos() {
  const remain = CHECKUP_LIMITS.photoMax - photos.value.length
  if (remain <= 0) return
  try {
    const picked = await chooseImages(remain)
    if (!picked.length) return
    for (const item of picked.slice(0, remain)) {
      photos.value.push({ key: `new-${item}`, filePath: await compressImage(item) })
    }
    errorText.value = ''
  } catch (err) {
    console.error('[Checkup] 选择图片失败', err)
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

/** 数值输入：空返回 null，非法/超范围返回错误文案（与云函数 normalizeCheckupDoc 同一套规则） */
function parseNumber(raw, label, min, max) {
  const text = String(raw == null ? '' : raw).trim()
  if (!text) return { value: null }
  const value = Number(text)
  if (!Number.isFinite(value) || value < min || value > max) {
    return { error: `${label}应在 ${min}~${max} 之间` }
  }
  return { value }
}

async function onSave() {
  if (saving.value) return
  errorText.value = ''
  if (!store.membership || !store.baby) {
    errorText.value = '还没有家庭或宝宝档案'
    return
  }
  if (!form.date) {
    errorText.value = '请选择体检日期'
    return
  }

  const height = parseNumber(form.heightCm, '身高', CHECKUP_LIMITS.heightMin, CHECKUP_LIMITS.heightMax)
  const weight = parseNumber(form.weightKg, '体重', CHECKUP_LIMITS.weightMin, CHECKUP_LIMITS.weightMax)
  const head = parseNumber(form.headCm, '头围', CHECKUP_LIMITS.headMin, CHECKUP_LIMITS.headMax)
  const hemoglobin = parseNumber(
    form.hemoglobin,
    '血红蛋白',
    CHECKUP_LIMITS.hemoglobinMin,
    CHECKUP_LIMITS.hemoglobinMax,
  )
  const invalid = [height, weight, head, hemoglobin].find((item) => item.error)
  if (invalid) {
    errorText.value = invalid.error
    return
  }

  const parts = ageParts(store.baby.birthday, form.date)
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
    checkup_date: form.date,
    month_age: parts ? parts.totalMonths : null,
    hospital: form.hospital,
    height_cm: height.value,
    weight_kg: weight.value,
    head_cm: head.value,
    hemoglobin: hemoglobin.value,
    development: form.development,
    doctor_advice: form.doctorAdvice,
    next_date: form.nextDate,
  }

  saving.value = true
  const uploaded = []
  try {
    // 先把文件传到 Storage，成功后再写库
    for (const item of newFiles) {
      uploaded.push(await uploadCheckupPhoto(familyId, babyId, item.filePath))
    }
    const finalPhotos = keptPaths.concat(uploaded)

    if (target) {
      await updateCheckupRecord({ ...target, ...fields, photos: finalPhotos })
      console.log('[Checkup] 修改成功', target.id)
      uni.showToast({ title: '已保存修改', icon: 'success' })
    } else {
      await createCheckupRecord({
        familyId,
        babyId,
        checkupDate: fields.checkup_date,
        monthAge: fields.month_age,
        hospital: fields.hospital,
        heightCm: fields.height_cm,
        weightKg: fields.weight_kg,
        headCm: fields.head_cm,
        hemoglobin: fields.hemoglobin,
        development: fields.development,
        doctorAdvice: fields.doctor_advice,
        nextDate: fields.next_date,
        photos: finalPhotos,
      })
      console.log('[Checkup] 保存成功', fields.checkup_date)
      uni.showToast({ title: '已保存', icon: 'success' })
    }
    if (removedPaths.length) await discardCheckupPhoto(removedPaths)
    setTimeout(goBack, 600)
  } catch (err) {
    console.error('[Checkup] 保存失败', err)
    // 记录没写进去，把刚传的图片清掉，避免留下孤儿文件
    if (uploaded.length) await discardCheckupPhoto(uploaded)
    errorText.value = err.message || '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

function goBack() {
  if (getCurrentPages().length > 1) {
    uni.navigateBack()
  } else {
    redirectTo('/pages/checkup/checkup')
  }
}

onLoad((query) => {
  const id = query && query.id
  if (!id) return
  uni.setNavigationBarTitle({ title: '编辑体检记录' })
  ;(async () => {
    try {
      await store.bootstrap()
      const record = await fetchCheckupRecord(id)
      if (!record) {
        errorText.value = '这条记录不存在或已被删除'
        return
      }
      editing.value = record
      form.date = record.checkup_date || today
      form.hospital = record.hospital || ''
      form.heightCm = record.height_cm == null ? '' : String(record.height_cm)
      form.weightKg = record.weight_kg == null ? '' : String(record.weight_kg)
      form.headCm = record.head_cm == null ? '' : String(record.head_cm)
      form.hemoglobin = record.hemoglobin == null ? '' : String(record.hemoglobin)
      form.development = record.development || ''
      form.doctorAdvice = record.doctor_advice || ''
      form.nextDate = record.next_date || ''
      // photoUrls 与 photos 索引一一对应，签名失败的位置是空串，这里直接丢弃
      photos.value = (record.photos || []).map((path, index) => ({
        key: path,
        path,
        url: (record.photoUrls || [])[index] || '',
      }))
      console.log('[Checkup] 编辑回填', record.id)
    } catch (err) {
      console.error('[Checkup] 回填失败', err)
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

.card-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.tip {
  display: block;
  padding: var(--space-sm) 0;
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
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
  width: 150rpx;
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
  font-size: 28rpx;
  color: #c2c7ce;
}

.field-unit {
  padding-left: var(--space-xs);
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.field-clear {
  padding-left: var(--space-md);
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.arrow {
  padding-left: var(--space-xs);
  font-size: 36rpx;
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
