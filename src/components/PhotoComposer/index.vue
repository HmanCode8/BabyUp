<template>
  <view v-if="visible" class="mask" @click="onCancel">
    <view class="sheet" @click.stop>
      <text class="sheet-title">记录这一刻</text>

      <view class="preview">
        <image v-if="filePath" class="preview-img" :src="filePath" mode="aspectFit" />
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
          <text class="btn-text">{{ saving ? '保存中…' : '保存' }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { chooseImage, compressImage } from '@/utils/media'
import { uploadPhotoFile, createPhoto, discardUploadedFile } from '@/services/photo'

const emit = defineEmits(['saved'])

const store = useAuthStore()

const visible = ref(false)
const filePath = ref('')
const note = ref('')
const saving = ref(false)

/** 由页面按钮调用：先唤起相机/相册，选到图后再弹备注面板（记录路径 ≤ 2 步） */
async function open() {
  if (saving.value) return
  if (!store.baby) {
    uni.showToast({ title: '请先创建宝宝档案', icon: 'none' })
    return
  }
  let picked = ''
  try {
    picked = await chooseImage()
  } catch (err) {
    uni.showToast({ title: err.message, icon: 'none' })
    return
  }
  if (!picked) return
  filePath.value = await compressImage(picked)
  note.value = ''
  visible.value = true
}

function onCancel() {
  if (!saving.value) visible.value = false
}

async function onSave() {
  if (saving.value) return
  saving.value = true
  let storagePath = ''
  try {
    const { family_id: familyId } = store.membership
    const babyId = store.baby.id
    storagePath = await uploadPhotoFile(familyId, babyId, filePath.value)
    await createPhoto({ familyId, babyId, storagePath, note: note.value })
    visible.value = false
    console.log('[PhotoComposer] 照片已保存')
    emit('saved')
  } catch (err) {
    console.error('[PhotoComposer] 保存失败', err)
    // 文件已传成功但记录没写进去，清掉避免留下孤儿文件
    if (storagePath) await discardUploadedFile(storagePath)
    uni.showToast({ title: err.message || '保存失败，请重试', icon: 'none' })
  } finally {
    saving.value = false
  }
}

defineExpose({ open })
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
  display: flex;
  align-items: center;
  justify-content: center;
  height: 420rpx;
  margin-top: var(--space-md);
  overflow: hidden;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.preview-img {
  width: 100%;
  height: 420rpx;
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
