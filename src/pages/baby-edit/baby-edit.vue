<template>
  <view class="page">
    <!-- 头像 -->
    <view class="avatar-area" @click="onChooseAvatar">
      <view class="avatar">
        <image v-if="avatarDisplay" class="avatar-img" :src="avatarDisplay" mode="aspectFill" />
        <text v-else-if="nameInitial" class="avatar-text">{{ nameInitial }}</text>
        <text v-else class="avatar-hint">＋</text>
      </view>
      <text class="avatar-action">{{ avatarDisplay ? '点击更换头像' : '点击添加头像' }}</text>
    </view>

    <view class="app-card">
      <view class="field">
        <text class="field-label">昵称</text>
        <input
          class="field-input"
          maxlength="12"
          :value="name"
          placeholder="例如：小芽"
          placeholder-class="field-placeholder"
          @input="name = $event.detail.value"
        />
      </view>

      <picker mode="date" :value="birthday" :end="today" @change="birthday = $event.detail.value">
        <view class="field">
          <text class="field-label">生日</text>
          <text class="field-value" :class="{ 'field-value--empty': !birthday }">
            {{ birthday || '请选择生日' }}
          </text>
          <text class="arrow">›</text>
        </view>
      </picker>

      <view class="field field--last">
        <text class="field-label">性别</text>
        <view class="chips">
          <view
            v-for="option in genderOptions"
            :key="option.value"
            class="chip"
            :class="{ 'chip--active': gender === option.value }"
            @click="gender = option.value"
          >
            <text class="chip-text" :class="{ 'chip-text--active': gender === option.value }">
              {{ option.label }}
            </text>
          </view>
        </view>
      </view>
    </view>

    <text v-if="errorText" class="error">{{ errorText }}</text>

    <view class="primary" :class="{ 'primary--disabled': submitting }" @click="onSave">
      <text class="primary-text">{{ submitting ? '保存中…' : '保存' }}</text>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { createBaby, saveBaby, uploadBabyAvatar } from '@/services/baby'
import { todayString } from '@/utils/date'
import { chooseImage } from '@/utils/media'
import { ensurePageAccess, redirectTo } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/baby-edit/baby-edit'

const store = useAuthStore()

const name = ref('')
const birthday = ref('')
const gender = ref('')
const pendingAvatarPath = ref('')
const submitting = ref(false)
const errorText = ref('')
/** true = 新增宝宝（一个家庭可有多个宝宝），false = 编辑当前宝宝 */
const isCreate = ref(false)
const today = todayString()

const genderOptions = [
  { value: 'male', label: '男宝' },
  { value: 'female', label: '女宝' },
]

const avatarDisplay = computed(() => pendingAvatarPath.value || store.babyAvatarUrl)
const nameInitial = computed(() => (name.value ? name.value.slice(0, 1) : ''))

async function onChooseAvatar() {
  try {
    const path = await chooseImage()
    if (path) pendingAvatarPath.value = path
  } catch (err) {
    console.error('[BabyEdit] 选择头像失败', err)
    uni.showToast({ title: err.message || '选择头像失败', icon: 'none' })
  }
}

async function onSave() {
  if (submitting.value) return
  errorText.value = ''
  if (!name.value.trim()) {
    errorText.value = '请填写宝宝昵称'
    return
  }
  if (!store.membership) {
    errorText.value = '还没有家庭，请先创建或加入家庭'
    return
  }

  submitting.value = true
  try {
    const familyId = store.membership.family_id
    const payload = {
      name: name.value.trim(),
      gender: gender.value || null,
      birthday: birthday.value || null,
    }
    // 新增模式一律新建；编辑模式改当前宝宝
    const base = isCreate.value ? null : store.baby
    let saved = base ? await saveBaby({ ...base, ...payload }) : await createBaby(familyId, payload)

    // 头像要等宝宝 id 存在后才能落到 {family_id}/{baby_id}/avatar.jpg
    if (pendingAvatarPath.value && saved) {
      const path = await uploadBabyAvatar(familyId, saved.id, pendingAvatarPath.value)
      saved = await saveBaby({ ...saved, avatar_url: path })
    }

    await store.refreshContext()
    // 新建的宝宝直接切成当前宝宝，否则用户会以为没建成功
    if (saved) await store.switchBaby(saved.id)
    console.log('[BabyEdit] 保存成功', saved && saved.id, '新增:', isCreate.value)
    uni.showToast({ title: '已保存', icon: 'success' })
    setTimeout(goBack, 600)
  } catch (err) {
    console.error('[BabyEdit] 保存失败', err)
    errorText.value = err.message || '保存失败，请重试'
  } finally {
    submitting.value = false
  }
}

function goBack() {
  if (getCurrentPages().length > 1) {
    uni.navigateBack()
  } else {
    redirectTo('/pages/index/index')
  }
}

onLoad((query) => {
  // mode=create 时是「添加宝宝」，不预填当前宝宝的信息
  isCreate.value = Boolean(query && query.mode === 'create') || !store.baby
  uni.setNavigationBarTitle({ title: isCreate.value ? '添加宝宝' : '宝宝档案' })
  const baby = isCreate.value ? null : store.baby
  if (!baby) return
  name.value = baby.name || ''
  birthday.value = baby.birthday || ''
  gender.value = baby.gender || ''
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

.avatar-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-lg) 0 var(--space-xl);
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 176rpx;
  height: 176rpx;
  overflow: hidden;
  background-color: var(--color-primary-soft);
  border-radius: 50%;
}

.avatar-img {
  width: 176rpx;
  height: 176rpx;
}

.avatar-text {
  font-size: 68rpx;
  font-weight: 600;
  color: var(--color-primary);
}

.avatar-hint {
  font-size: 56rpx;
  color: var(--color-primary);
}

.avatar-action {
  margin-top: var(--space-sm);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.field {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 108rpx;
  border-bottom: 1rpx solid var(--color-border);
}

.field--last {
  border-bottom: none;
}

.field-label {
  width: 140rpx;
  font-size: 30rpx;
  color: var(--color-text-sub);
}

.field-input {
  flex: 1;
  height: 108rpx;
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

.arrow {
  font-size: 36rpx;
  color: var(--color-text-muted);
}

.chips {
  display: flex;
  flex-direction: row;
  flex: 1;
}

.chip {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 68rpx;
  padding: 0 36rpx;
  margin-right: var(--space-sm);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.chip--active {
  background-color: var(--color-primary-soft);
}

.chip-text {
  font-size: 28rpx;
  color: var(--color-text-sub);
}

.chip-text--active {
  color: var(--color-primary-deep);
  font-weight: 600;
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
  height: 96rpx;
  margin-top: var(--space-lg);
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.primary--disabled {
  opacity: 0.6;
}

.primary-text {
  font-size: 32rpx;
  font-weight: 600;
  color: #ffffff;
}
</style>
