<template>
  <view v-if="visible" class="mask" @click="onCancel">
    <view class="sheet" @click.stop>
      <text class="sheet-title">记录这一刻</text>

      <view class="preview">
        <video
          v-if="isVideo"
          class="preview-video"
          :src="videoPath"
          :poster="videoPoster"
          :controls="true"
          :show-center-play-btn="true"
        />
        <view v-if="!isVideo" class="preview-grid">
          <view v-for="(item, index) in fileList" :key="index" class="preview-cell">
            <image class="preview-img" :src="item" mode="aspectFill" />
          </view>
        </view>
      </view>

      <input
        class="note-input"
        maxlength="40"
        :value="note"
        placeholder="写一句话（可跳过）"
        placeholder-class="note-placeholder"
        confirm-type="done"
        @input="note = $event.detail.value"
      />

      <view class="actions">
        <view class="btn btn--ghost" @click="onCancel">
          <text class="btn-text btn-text--ghost">取消</text>
        </view>
        <view class="btn btn--primary" :class="{ 'btn--disabled': saving }" @click="onSave">
          <text class="btn-text">{{ saveText }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { chooseImages, chooseVideo, compressImage, compressVideo } from '@/utils/media'
import { PHOTO_MAX_COUNT, VIDEO_MAX_DURATION_SEC } from '@/config'
import {
  uploadPhotoFile,
  uploadVideoFile,
  createPhoto,
  discardUploadedFile,
} from '@/services/photo'

const emit = defineEmits(['saved'])

const store = useAuthStore()

const visible = ref(false)
const mediaType = ref('image')
const fileList = ref([])
const videoPath = ref('')
const videoPoster = ref('')
const note = ref('')
const saving = ref(false)
const progress = ref(0)

const isVideo = computed(() => mediaType.value === 'video')

const saveText = computed(() => {
  if (!saving.value) return isVideo.value ? '保存视频' : `保存 ${fileList.value.length} 张`
  return isVideo.value ? '上传中…' : `上传中 ${progress.value}/${fileList.value.length}`
})

function reset() {
  mediaType.value = 'image'
  fileList.value = []
  videoPath.value = ''
  videoPoster.value = ''
  note.value = ''
  progress.value = 0
}

/** 由页面按钮调用：先唤起相册多选，选到图后再弹备注面板（记录路径 ≤ 2 步） */
async function open() {
  if (saving.value) return
  if (!store.baby) {
    uni.showToast({ title: '请先创建宝宝档案', icon: 'none' })
    return
  }
  let picked = []
  try {
    picked = await chooseImages(PHOTO_MAX_COUNT)
  } catch (err) {
    uni.showToast({ title: err.message, icon: 'none' })
    return
  }
  if (!picked.length) return
  // 逐张压缩：一次性并发压 9 张容易把内存顶满
  const list = []
  for (const path of picked) list.push(await compressImage(path))
  reset()
  fileList.value = list
  visible.value = true
}

/** 选择一段视频：先卡时长再压缩，超限直接打回不传 */
async function openVideo() {
  if (saving.value) return
  if (!store.baby) {
    uni.showToast({ title: '请先创建宝宝档案', icon: 'none' })
    return
  }
  let picked = null
  try {
    picked = await chooseVideo(VIDEO_MAX_DURATION_SEC)
  } catch (err) {
    uni.showToast({ title: err.message, icon: 'none' })
    return
  }
  if (!picked) return
  if (picked.duration > VIDEO_MAX_DURATION_SEC) {
    uni.showToast({
      title: `视频不能超过 ${VIDEO_MAX_DURATION_SEC} 秒，请先裁剪后再传`,
      icon: 'none',
    })
    return
  }
  uni.showLoading({ title: '压缩中…', mask: true })
  let compressed = picked.path
  try {
    compressed = await compressVideo(picked.path)
  } finally {
    uni.hideLoading()
  }
  reset()
  mediaType.value = 'video'
  videoPath.value = compressed
  videoPoster.value = picked.posterPath
  visible.value = true
}

function onCancel() {
  if (!saving.value) visible.value = false
}

async function onSave() {
  if (saving.value) return
  saving.value = true
  progress.value = 0
  const video = isVideo.value
  let failed = 0
  let storagePath = ''
  try {
    const { family_id: familyId } = store.membership
    const babyId = store.baby.id
    if (video) {
      storagePath = await uploadVideoFile(familyId, babyId, videoPath.value, videoPoster.value)
      await createPhoto({
        familyId,
        babyId,
        storagePath,
        note: note.value,
        mediaType: 'video',
      })
      progress.value = 1
    } else {
      // 必须逐张串行：云函数写入是「逐行 add + 回读」，一次塞 9 条容易撞超时
      for (const path of fileList.value) {
        let uploaded = ''
        try {
          uploaded = await uploadPhotoFile(familyId, babyId, path)
          await createPhoto({ familyId, babyId, storagePath: uploaded, note: note.value })
          progress.value += 1
        } catch (err) {
          console.error('[PhotoComposer] 单张保存失败', err)
          // 文件已传成功但记录没写进去，清掉避免留下孤儿文件
          if (uploaded) await discardUploadedFile(uploaded)
          failed += 1
        }
      }
    }
  } catch (err) {
    console.error('[PhotoComposer] 保存失败', err)
    // 文件已传成功但记录没写进去，清掉避免留下孤儿文件
    if (storagePath) await discardUploadedFile(storagePath)
    uni.showToast({ title: err.message || '保存失败，请重试', icon: 'none' })
    return
  } finally {
    saving.value = false
  }

  const count = video ? 1 : fileList.value.length
  const done = count - failed
  if (!done) {
    uni.showToast({ title: '保存失败，请重试', icon: 'none' })
    return
  }
  visible.value = false
  console.log('[PhotoComposer] 已保存', { done, failed })
  if (failed) uni.showToast({ title: `${done} 张已保存，${failed} 张失败`, icon: 'none' })
  emit('saved')
}

defineExpose({ open, openVideo })
</script>

<style scoped>
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

.preview {
  margin-top: var(--space-md);
}

.preview-video {
  width: 100%;
  height: 420rpx;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.preview-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.preview-cell {
  width: 200rpx;
  height: 200rpx;
  margin: 0 var(--space-xs) var(--space-xs) 0;
  overflow: hidden;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-sm);
}

.preview-img {
  width: 100%;
  height: 100%;
}

.note-input {
  height: 96rpx;
  margin-top: var(--space-md);
  padding: 0 var(--space-md);
  font-size: 30rpx;
  color: var(--color-text-main);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.note-placeholder {
  font-size: 28rpx;
  color: #c2c7ce;
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
