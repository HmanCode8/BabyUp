<template>
  <view class="page">
    <!-- 大图 -->
    <view class="viewer" @click="previewImage">
      <image
        v-if="photoUrl"
        class="viewer-img"
        :src="photoUrl"
        mode="aspectFit"
        @error="onImageError"
      />
      <view v-else class="viewer-fallback">
        <text class="viewer-fallback-text">{{ loading ? '加载中…' : '图片加载失败' }}</text>
      </view>
    </view>

    <view class="app-card">
      <view class="card-head">
        <text class="card-label card-label--head">拍摄时间</text>
        <!-- viewer 只读：不显示编辑入口（真正拦截靠 RLS） -->
        <text v-if="canWrite && photo" class="card-action" @click="toggleTimeEditor">
          {{ editingTime ? '取消' : '编辑拍摄时间' }}
        </text>
      </view>
      <text class="card-value">{{ takenAtText }}</text>

      <!-- 补录老照片：改完日期与时间后，时光页会按新时间重新归月排序 -->
      <view v-if="editingTime" class="time-editor">
        <picker mode="date" :value="timeForm.date" :end="today" @change="onDateChange">
          <view class="field">
            <text class="field-label">日期</text>
            <text class="field-value">{{ timeForm.date }}</text>
            <text class="arrow">›</text>
          </view>
        </picker>
        <picker mode="time" :value="timeForm.time" @change="onTimeChange">
          <view class="field field--last">
            <text class="field-label">时间</text>
            <text class="field-value">{{ timeForm.time }}</text>
            <text class="arrow">›</text>
          </view>
        </picker>
        <view
          class="primary"
          :class="{ 'primary--disabled': savingTime }"
          @click="onSaveTime"
        >
          <text class="primary-text">{{ savingTime ? '保存中…' : '保存拍摄时间' }}</text>
        </view>
      </view>
    </view>

    <view class="app-card">
      <text class="card-label">备注</text>
      <input
        v-if="canWrite"
        class="note-input"
        maxlength="40"
        :value="note"
        placeholder="写一句话（可留空）"
        placeholder-class="note-placeholder"
        confirm-type="done"
        @input="note = $event.detail.value"
      />
      <text v-else class="card-value">{{ note || '没有备注' }}</text>
      <view
        v-if="canWrite"
        class="primary"
        :class="{ 'primary--disabled': saving }"
        @click="onSaveNote"
      >
        <text class="primary-text">{{ saving ? '保存中…' : '保存备注' }}</text>
      </view>
    </view>

    <view v-if="canWrite" class="danger" @click="onDelete">
      <text class="danger-text">删除这张照片</text>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { fetchPhoto, updatePhotoNote, updatePhotoTakenAt, deletePhoto } from '@/services/photo'
import {
  formatDateTime,
  formatDate,
  formatTime,
  nowTimeString,
  todayString,
  toIsoFromLocal,
} from '@/utils/date'
import { defaultShare } from '@/utils/share'

const store = useAuthStore()

const photoId = ref('')
const photo = ref(null)
const note = ref('')
const loading = ref(true)
const saving = ref(false)
const deleting = ref(false)

/** 拍摄时间编辑态：日期与时间分开选，保存时再合成绝对时刻 */
const editingTime = ref(false)
const savingTime = ref(false)
const today = todayString()
const timeForm = reactive({ date: today, time: nowTimeString() })

/** viewer 只读：隐藏备注编辑与删除 */
const canWrite = computed(() => store.canWrite)

const photoUrl = computed(() => (photo.value ? photo.value.url : ''))
const takenAtText = computed(() =>
  photo.value ? formatDateTime(photo.value.taken_at) : '',
)

async function load() {
  if (!photoId.value) {
    uni.showToast({ title: '照片不存在', icon: 'none' })
    return
  }
  loading.value = true
  try {
    const row = await fetchPhoto(photoId.value)
    if (!row) {
      uni.showToast({ title: '照片不存在或已被删除', icon: 'none' })
      return
    }
    photo.value = row
    note.value = row.note || ''
    console.log('[PhotoDetail] 已加载', row.id)
  } catch (err) {
    console.error('[PhotoDetail] 加载失败', err)
    uni.showToast({ title: err.message || '加载失败，请重试', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function previewImage() {
  if (!photoUrl.value) return
  uni.previewImage({ urls: [photoUrl.value] })
}

function onImageError() {
  console.error('[PhotoDetail] 图片加载失败', photoId.value)
}

async function onSaveNote() {
  if (!photo.value || saving.value) return
  saving.value = true
  try {
    const updated = await updatePhotoNote(photo.value, note.value)
    if (updated) photo.value = { ...photo.value, ...updated, url: photo.value.url }
    uni.showToast({ title: '备注已保存', icon: 'success' })
  } catch (err) {
    console.error('[PhotoDetail] 保存备注失败', err)
    uni.showToast({ title: err.message || '保存失败，请重试', icon: 'none' })
  } finally {
    saving.value = false
  }
}

/** 打开/收起编辑态：默认值取当前拍摄时间的本地日期与时间 */
function toggleTimeEditor() {
  if (!photo.value) return
  if (editingTime.value) {
    editingTime.value = false
    return
  }
  timeForm.date = formatDate(photo.value.taken_at) || today
  timeForm.time = formatTime(photo.value.taken_at) || nowTimeString()
  editingTime.value = true
}

function onDateChange(event) {
  timeForm.date = event.detail.value
}

function onTimeChange(event) {
  timeForm.time = event.detail.value
}

async function onSaveTime() {
  if (!photo.value || savingTime.value) return
  if (!timeForm.date) {
    uni.showToast({ title: '请先选择日期', icon: 'none' })
    return
  }
  savingTime.value = true
  try {
    // 本地日期 + 本地时间 -> 绝对时刻；不能手拼字符串交给数据库（会被按 UTC 解析，差 8 小时）
    const takenAt = toIsoFromLocal(timeForm.date, timeForm.time)
    const updated = await updatePhotoTakenAt(photo.value, takenAt)
    if (updated) photo.value = { ...photo.value, ...updated, url: photo.value.url }
    editingTime.value = false
    console.log('[PhotoDetail] 拍摄时间已更新', photoId.value, takenAt)
    uni.showToast({ title: '拍摄时间已更新', icon: 'success' })
  } catch (err) {
    console.error('[PhotoDetail] 更新拍摄时间失败', err)
    uni.showToast({ title: err.message || '保存失败，请重试', icon: 'none' })
  } finally {
    savingTime.value = false
  }
}

function onDelete() {
  if (!photo.value || deleting.value) return
  uni.showModal({
    title: '删除照片',
    content: '删除后无法恢复，照片会从家庭时间线里移除。',
    confirmText: '删除',
    confirmColor: '#F04438',
    success: async (res) => {
      if (!res.confirm) return
      deleting.value = true
      try {
        await deletePhoto(photo.value)
        console.log('[PhotoDetail] 已删除', photoId.value)
        uni.showToast({ title: '已删除', icon: 'success' })
        setTimeout(goBack, 600)
      } catch (err) {
        console.error('[PhotoDetail] 删除失败', err)
        uni.showToast({ title: err.message || '删除失败，请重试', icon: 'none' })
      } finally {
        deleting.value = false
      }
    },
  })
}

function goBack() {
  if (getCurrentPages().length > 1) {
    uni.navigateBack()
  } else {
    uni.switchTab({ url: '/pages/index/index' })
  }
}

onLoad((query) => {
  photoId.value = (query && query.id) || ''
  load()
})

// 补丁 Step 4：统一分享卡片（标题与落地页见 @/utils/share）
onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  padding: var(--space-lg);
  box-sizing: border-box;
}

.viewer {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 760rpx;
  margin-bottom: var(--space-lg);
  overflow: hidden;
  background-color: #ffffff;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.viewer-img {
  width: 100%;
  height: 760rpx;
}

.viewer-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 760rpx;
  background-color: var(--color-bg-page);
}

.viewer-fallback-text {
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.app-card {
  margin-bottom: var(--space-md);
}

.card-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-xs);
}

.card-label {
  display: block;
  margin-bottom: var(--space-xs);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

/* 放在标题行里的标签不需要再占一行间距 */
.card-label--head {
  margin-bottom: 0;
}

.card-action {
  font-size: 25rpx;
  color: var(--color-primary);
}

.card-value {
  font-size: 30rpx;
  color: var(--color-text-main);
}

.time-editor {
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

.field-value {
  flex: 1;
  font-size: 30rpx;
  color: var(--color-text-main);
}

.arrow {
  font-size: 36rpx;
  color: var(--color-text-muted);
}

.note-input {
  height: 96rpx;
  padding: 0 var(--space-md);
  margin-top: var(--space-sm);
  font-size: 30rpx;
  color: var(--color-text-main);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.note-placeholder {
  font-size: 28rpx;
  color: #c2c7ce;
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

.danger {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  margin-top: var(--space-md);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.danger-text {
  font-size: 30rpx;
  color: var(--color-danger);
}
</style>
