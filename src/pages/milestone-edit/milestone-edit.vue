<template>
  <view class="page">
    <!-- 打卡表单 -->
    <view class="app-card">
      <text class="card-label">里程碑</text>
      <view class="presets">
        <view
          v-for="item in MILESTONE_PRESETS"
          :key="item.key"
          class="preset"
          :class="{ 'preset--active': item.key === form.key }"
          @click="switchKey(item.key)"
        >
          <text class="preset-glyph" :class="{ 'preset-glyph--active': item.key === form.key }">
            {{ item.glyph }}
          </text>
          <text class="preset-label" :class="{ 'preset-label--active': item.key === form.key }">
            {{ item.label }}
          </text>
        </view>
      </view>

      <input
        v-if="isCustom"
        class="custom-input"
        maxlength="12"
        :value="form.customName"
        placeholder="给这个里程碑起个名字，如：第一次游泳"
        placeholder-class="field-placeholder"
        @input="form.customName = $event.detail.value"
      />

      <view class="field">
        <text class="field-label">日期</text>
        <picker mode="date" :value="form.date" :end="today" @change="form.date = $event.detail.value">
          <text class="field-value">{{ form.date }}</text>
        </picker>
        <text class="arrow">›</text>
      </view>

      <text class="card-label">照片</text>
      <view class="photo-area">
        <image
          v-if="previewUrl"
          class="photo"
          :src="previewUrl"
          mode="aspectFill"
          @click="onPreviewPhoto"
        />
        <view v-else class="photo photo--empty" @click="onPickPhoto">
          <text class="photo-empty-glyph">＋</text>
          <text class="photo-empty-text">拍照 / 选图</text>
        </view>
        <view v-if="previewUrl" class="photo-actions">
          <text class="photo-action" @click="onPickPhoto">换一张</text>
          <text class="photo-action photo-action--danger" @click="onRemovePhoto">移除</text>
        </view>
      </view>

      <view class="field">
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
      <view v-if="editing" class="ghost" @click="goBack">
        <text class="ghost-text">取消编辑</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import {
  MILESTONE_PRESETS,
  CUSTOM_KEY,
  presetOf,
  fetchMilestone,
  createMilestone,
  updateMilestone,
  uploadMilestonePhoto,
  discardMilestonePhoto,
} from '@/services/milestone'
import { chooseImage, compressImage } from '@/utils/media'
import { todayString } from '@/utils/date'
import { ensurePageAccess, redirectTo } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/milestone-edit/milestone-edit'

const store = useAuthStore()

const today = todayString()
const saving = ref(false)
const errorText = ref('')
/** 非空表示正在编辑这条记录，否则是新增 */
const editing = ref(null)

const form = reactive({
  key: '',
  customName: '',
  date: today,
  note: '',
  /** 新选的本地图片路径 */
  filePath: '',
  /** 已入库的对象路径（编辑时回填，用于判断是否需要清理旧文件） */
  photoPath: '',
})

const isCustom = computed(() => form.key === CUSTOM_KEY)
/** 预览优先用新选的本地图，否则用已入库那张的签名地址 */
const previewUrl = computed(() => {
  if (form.filePath) return form.filePath
  if (form.photoPath && editing.value) return editing.value.photoUrl || ''
  return ''
})

function switchKey(key) {
  form.key = key
  errorText.value = ''
}

async function onPickPhoto() {
  try {
    const picked = await chooseImage()
    if (!picked) return
    form.filePath = await compressImage(picked)
  } catch (err) {
    uni.showToast({ title: err.message || '选择图片失败', icon: 'none' })
  }
}

function onPreviewPhoto() {
  if (!previewUrl.value) return
  uni.previewImage({ urls: [previewUrl.value] })
}

/** 移除：新选的与已入库的都清掉，保存时按「无照片」处理 */
function onRemovePhoto() {
  form.filePath = ''
  form.photoPath = ''
}

async function onSave() {
  if (saving.value) return
  errorText.value = ''
  if (!store.membership || !store.baby) {
    errorText.value = '还没有家庭或宝宝档案'
    return
  }
  if (!form.key) {
    errorText.value = '请选择里程碑'
    return
  }
  if (isCustom.value && !form.customName.trim()) {
    errorText.value = '请填写自定义里程碑名称'
    return
  }

  const name = isCustom.value ? form.customName.trim() : presetOf(form.key).label
  const familyId = store.membership.family_id
  const babyId = store.baby.id
  const target = editing.value

  saving.value = true
  let uploadedPath = ''
  try {
    // 先把文件传到 Storage，成功后再写库；写库失败则把刚传的对象删掉
    if (form.filePath) uploadedPath = await uploadMilestonePhoto(familyId, babyId, form.filePath)
    const photoPath = uploadedPath || form.photoPath || null

    if (target) {
      await updateMilestone({
        ...target,
        milestone_key: form.key,
        name,
        achieved_date: form.date,
        photo_url: photoPath,
        note: form.note ? String(form.note).trim() : null,
      })
      // 换图或移除后，旧对象不再被引用，顺手清掉
      if (target.photo_url && target.photo_url !== photoPath) {
        await discardMilestonePhoto(target.photo_url)
      }
      console.log('[Milestone] 修改成功', target.id)
      uni.showToast({ title: '已保存修改', icon: 'success' })
    } else {
      await createMilestone({
        familyId,
        babyId,
        milestoneKey: form.key,
        name,
        achievedDate: form.date,
        photoPath,
        note: form.note,
      })
      console.log('[Milestone] 打卡成功', form.key, form.date)
      uni.showToast({ title: '已保存', icon: 'success' })
    }
    setTimeout(goBack, 600)
  } catch (err) {
    console.error('[Milestone] 保存失败', err)
    // 文件已传成功但记录没写进去，清掉避免留下孤儿文件
    if (uploadedPath) await discardMilestonePhoto(uploadedPath)
    errorText.value = err.message || '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

function goBack() {
  if (getCurrentPages().length > 1) {
    uni.navigateBack()
  } else {
    redirectTo('/pages/milestone/milestone')
  }
}

onLoad((query) => {
  const id = query && query.id
  if (!id) return
  uni.setNavigationBarTitle({ title: '编辑里程碑' })
  ;(async () => {
    try {
      await store.bootstrap()
      const record = await fetchMilestone(id)
      if (!record) {
        errorText.value = '这条记录不存在或已被删除'
        return
      }
      editing.value = record
      form.key = record.milestone_key
      form.customName = record.milestone_key === CUSTOM_KEY ? record.name || '' : ''
      form.date = record.achieved_date
      form.note = record.note || ''
      form.photoPath = record.photo_url || ''
      console.log('[Milestone] 编辑回填', record.id)
    } catch (err) {
      console.error('[Milestone] 回填失败', err)
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

.card-label:first-child {
  margin-top: 0;
}

.presets {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
}

.preset {
  display: flex;
  flex-direction: row;
  align-items: center;
  width: 48%;
  padding: var(--space-sm) var(--space-md);
  margin-bottom: var(--space-sm);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.preset--active {
  background-color: var(--color-primary-soft);
}

.preset-glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48rpx;
  height: 48rpx;
  margin-right: var(--space-sm);
  font-size: 24rpx;
  font-weight: 600;
  color: var(--color-text-muted);
  background-color: var(--color-bg-card);
  border-radius: 50%;
}

.preset-glyph--active {
  color: var(--color-primary-deep);
}

.preset-label {
  flex: 1;
  font-size: 27rpx;
  color: var(--color-text-sub);
}

.preset-label--active {
  color: var(--color-primary-deep);
  font-weight: 600;
}

.custom-input {
  height: 92rpx;
  margin-top: var(--space-sm);
  padding: 0 var(--space-md);
  font-size: 30rpx;
  color: var(--color-text-main);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.field {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 100rpx;
  margin-top: var(--space-sm);
  border-bottom: 1rpx solid var(--color-border);
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
  padding-left: var(--space-xs);
  font-size: 36rpx;
  color: var(--color-text-muted);
}

.photo-area {
  display: flex;
  flex-direction: column;
}

.photo {
  width: 100%;
  height: 360rpx;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.photo--empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.photo-empty-glyph {
  font-size: 56rpx;
  color: var(--color-text-muted);
}

.photo-empty-text {
  margin-top: var(--space-xs);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.photo-actions {
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  margin-top: var(--space-sm);
}

.photo-action {
  padding-left: var(--space-md);
  font-size: 26rpx;
  color: var(--color-primary);
}

.photo-action--danger {
  color: var(--color-danger);
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
</style>
