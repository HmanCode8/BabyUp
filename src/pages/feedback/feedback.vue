<template>
  <view class="page">
    <!-- 提交表单 -->
    <view class="app-card">
      <text class="card-label">反馈类型</text>
      <view class="types">
        <view
          v-for="item in FEEDBACK_TYPES"
          :key="item.key"
          class="type"
          :class="{ 'type--active': item.key === form.type }"
          @click="form.type = item.key"
        >
          <text class="type-text" :class="{ 'type-text--active': item.key === form.type }">
            {{ item.label }}
          </text>
        </view>
      </view>

      <text class="card-label">问题描述</text>
      <textarea
        class="textarea"
        :maxlength="FEEDBACK_LIMITS.contentMax"
        :value="form.content"
        placeholder="说说遇到了什么问题，或你希望我们改进的地方"
        placeholder-class="field-placeholder"
        @input="form.content = $event.detail.value"
      />
      <text class="counter">{{ form.content.length }}/{{ FEEDBACK_LIMITS.contentMax }}</text>

      <text class="card-label">截图（选填，最多 {{ FEEDBACK_LIMITS.imageMax }} 张）</text>
      <view class="shots">
        <view v-for="(shot, index) in shots" :key="shot.filePath" class="shot">
          <image class="shot-img" :src="shot.filePath" mode="aspectFill" @click="previewShot(index)" />
          <text class="shot-remove" @click="removeShot(index)">×</text>
        </view>
        <view v-if="shots.length < FEEDBACK_LIMITS.imageMax" class="shot shot--add" @click="onPickShots">
          <text class="shot-add-glyph">＋</text>
        </view>
      </view>

      <view class="field">
        <text class="field-label">联系方式</text>
        <input
          class="field-input"
          :maxlength="FEEDBACK_LIMITS.contactMax"
          :value="form.contact"
          placeholder="选填，方便我们回复你"
          placeholder-class="field-placeholder"
          @input="form.contact = $event.detail.value"
        />
      </view>

      <text v-if="errorText" class="error">{{ errorText }}</text>

      <view class="primary" :class="{ 'primary--disabled': saving }" @click="onSubmit">
        <text class="primary-text">{{ saving ? '提交中…' : '提交反馈' }}</text>
      </view>
    </view>

    <!-- 我提交过的反馈：只有自己能看，状态由我们后台更新 -->
    <view class="app-card">
      <text class="card-label card-label--first">我的反馈</text>
      <text v-if="loading" class="tip">加载中…</text>
      <text v-else-if="!list.length" class="tip">还没有提交过反馈</text>
      <view v-for="item in list" :key="item.id" class="fb">
        <view class="fb-head">
          <text class="fb-type">{{ typeLabel(item.type) }}</text>
          <text class="fb-status" :class="{ 'fb-status--done': item.status === 'done' }">
            {{ statusLabel(item.status) }}
          </text>
        </view>
        <text class="fb-content">{{ item.content }}</text>
        <view v-if="item.thumbs.length" class="fb-shots">
          <image
            v-for="(thumb, index) in item.thumbs"
            :key="thumb.path"
            class="fb-shot"
            :src="thumb.url"
            mode="aspectFill"
            @click="previewFeedbackShot(item, index)"
          />
        </view>
        <text class="fb-time">{{ formatDateTime(item.created_at) }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import {
  FEEDBACK_TYPES,
  FEEDBACK_TYPE_LABEL,
  FEEDBACK_STATUS_LABEL,
  FEEDBACK_LIMITS,
  submitFeedback,
  listMyFeedback,
  createFeedbackImageUrls,
  uploadFeedbackImage,
  discardFeedbackImage,
} from '@/services/feedback'
import { chooseImages, compressImage } from '@/utils/media'
import { formatDateTime } from '@/utils/date'
import { ensurePageAccess, redirectTo } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/feedback/feedback'

const store = useAuthStore()

const form = reactive({ type: FEEDBACK_TYPES[0].key, content: '', contact: '' })
/** 待提交的截图：只存本地临时路径，点提交时才真正上传 */
const shots = ref([])
const saving = ref(false)
const errorText = ref('')
const list = ref([])
const loading = ref(true)

function typeLabel(type) {
  return FEEDBACK_TYPE_LABEL[type] || '其他'
}

function statusLabel(status) {
  return FEEDBACK_STATUS_LABEL[status] || FEEDBACK_STATUS_LABEL.pending
}

async function onPickShots() {
  const remain = FEEDBACK_LIMITS.imageMax - shots.value.length
  if (remain <= 0) return
  try {
    const picked = await chooseImages(remain)
    if (!picked.length) return
    const added = []
    for (const item of picked.slice(0, remain)) {
      added.push({ filePath: await compressImage(item) })
    }
    shots.value = shots.value.concat(added)
    errorText.value = ''
  } catch (err) {
    console.error('[Feedback] 选择截图失败', err)
    uni.showToast({ title: err.message || '选择图片失败', icon: 'none' })
  }
}

function removeShot(index) {
  shots.value = shots.value.filter((item, i) => i !== index)
}

function previewShot(index) {
  uni.previewImage({
    urls: shots.value.map((item) => item.filePath),
    current: shots.value[index].filePath,
  })
}

function previewFeedbackShot(item, index) {
  const urls = item.thumbs.map((thumb) => thumb.url).filter(Boolean)
  if (!urls.length) return
  uni.previewImage({ urls, current: urls[index] })
}

function resetForm() {
  form.type = FEEDBACK_TYPES[0].key
  form.content = ''
  form.contact = ''
  shots.value = []
  errorText.value = ''
}

async function onSubmit() {
  if (saving.value) return
  errorText.value = ''
  const content = form.content.trim()
  if (content.length < FEEDBACK_LIMITS.contentMin) {
    errorText.value = `问题描述至少 ${FEEDBACK_LIMITS.contentMin} 个字`
    return
  }
  // 截图要存在「当前家庭」的目录下才能被成员校验放行，没有家庭时只能提交纯文字
  if (shots.value.length && !store.membership) {
    errorText.value = '请先创建或加入家庭后再上传截图'
    return
  }

  saving.value = true
  const uploaded = []
  try {
    const familyId = store.membership ? store.membership.family_id : ''
    for (const shot of shots.value) {
      uploaded.push(await uploadFeedbackImage(familyId, shot.filePath))
    }
    await submitFeedback({ type: form.type, content, contact: form.contact, images: uploaded })
    console.log('[Feedback] 提交成功', form.type)
    uni.showToast({ title: '已收到，感谢反馈', icon: 'none' })
    resetForm()
    setTimeout(goBack, 800)
  } catch (err) {
    console.error('[Feedback] 提交失败', err)
    // 记录没写进去，把刚传的截图清掉，避免留下孤儿文件
    for (const path of uploaded) await discardFeedbackImage(path)
    errorText.value = err.message || '提交失败，请重试'
  } finally {
    saving.value = false
  }
}

async function loadList() {
  loading.value = true
  try {
    const rows = await listMyFeedback()
    list.value = await Promise.all(
      rows.map(async (row) => {
        const thumbs = await createFeedbackImageUrls(row.images)
        return { ...row, thumbs: thumbs.filter((item) => item.url) }
      }),
    )
  } catch (err) {
    console.error('[Feedback] 加载历史反馈失败', err)
    list.value = []
  } finally {
    loading.value = false
  }
}

function goBack() {
  if (getCurrentPages().length > 1) {
    uni.navigateBack()
  } else {
    redirectTo('/pages/profile/profile')
  }
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  await store.bootstrap()
  await loadList()
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

/* 反馈类型 */
.types {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.type {
  padding: 12rpx 28rpx;
  margin-right: var(--space-sm);
  margin-bottom: var(--space-sm);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.type--active {
  background-color: var(--color-primary-soft);
}

.type-text {
  font-size: 26rpx;
  color: var(--color-text-sub);
}

.type-text--active {
  color: var(--color-primary-deep);
  font-weight: 600;
}

/* 问题描述 */
.textarea {
  width: 100%;
  height: 220rpx;
  padding: var(--space-md);
  font-size: 29rpx;
  line-height: 1.6;
  color: var(--color-text-main);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
  box-sizing: border-box;
}

.field-placeholder {
  font-size: 27rpx;
  color: #c2c7ce;
}

.counter {
  display: block;
  margin-top: var(--space-xs);
  font-size: 23rpx;
  color: var(--color-text-muted);
  text-align: right;
}

/* 截图 */
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

/* 表单行 */
.field {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 100rpx;
  margin-top: var(--space-md);
  border-bottom: 1rpx solid var(--color-border);
}

.field-label {
  width: 140rpx;
  font-size: 30rpx;
  color: var(--color-text-sub);
}

.field-input {
  flex: 1;
  height: 100rpx;
  font-size: 30rpx;
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

/* 历史反馈 */
.tip {
  display: block;
  padding: var(--space-sm) 0;
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.fb {
  padding: var(--space-md) 0;
  border-bottom: 1rpx solid var(--color-border);
}

.fb:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.fb-head {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.fb-type {
  flex: 1;
  font-size: 27rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.fb-status {
  padding: 4rpx 18rpx;
  font-size: 23rpx;
  color: var(--color-warning);
  background-color: rgba(247, 144, 9, 0.12);
  border-radius: var(--radius-pill);
}

.fb-status--done {
  color: var(--color-success);
  background-color: rgba(18, 183, 106, 0.12);
}

.fb-content {
  display: block;
  margin-top: var(--space-xs);
  font-size: 27rpx;
  line-height: 1.7;
  color: var(--color-text-sub);
}

.fb-shots {
  display: flex;
  flex-direction: row;
  margin-top: var(--space-sm);
}

.fb-shot {
  width: 140rpx;
  height: 140rpx;
  margin-right: var(--space-sm);
  border-radius: var(--radius-md);
}

.fb-time {
  display: block;
  margin-top: var(--space-xs);
  font-size: 23rpx;
  color: var(--color-text-muted);
}
</style>
