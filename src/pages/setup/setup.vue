<template>
  <view class="page">
    <view class="header">
      <text class="title">{{ isFamilyStep ? '先建一个家' : '再认识一下宝宝' }}</text>
      <text class="subtitle">
        {{ isFamilyStep ? '所有记录都存在家庭空间里，只有家人能看到' : '填好昵称和生日，就能开始记录啦' }}
      </text>
    </view>

    <!-- 第一步：创建家庭 -->
    <view v-if="isFamilyStep" class="app-card">
      <view class="field">
        <text class="field-label">家庭名称</text>
        <input
          class="field-input"
          maxlength="12"
          :value="familyName"
          placeholder="我的家"
          placeholder-class="field-placeholder"
          @input="familyName = $event.detail.value"
        />
      </view>

      <view class="primary" :class="{ 'primary--disabled': submitting }" @click="onCreateFamily">
        <text class="primary-text">{{ submitting ? '请稍候…' : '创建我的家庭' }}</text>
      </view>

      <view class="secondary" @click="goJoinFamily">
        <text class="secondary-text">家人已建好家庭？输入邀请码加入</text>
      </view>

      <text v-if="errorText" class="error">{{ errorText }}</text>
    </view>

    <!-- 第二步：建宝宝档案 -->
    <view v-else class="app-card">
      <view class="field">
        <text class="field-label">宝宝昵称</text>
        <input
          class="field-input"
          maxlength="12"
          :value="babyName"
          placeholder="例如：小芽"
          placeholder-class="field-placeholder"
          @input="babyName = $event.detail.value"
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

      <view class="primary" :class="{ 'primary--disabled': submitting }" @click="onFinish">
        <text class="primary-text">{{ submitting ? '请稍候…' : '完成，开始记录' }}</text>
      </view>

      <view class="secondary" @click="goHome">
        <text class="secondary-text">先跳过，稍后再填</text>
      </view>

      <text v-if="errorText" class="error">{{ errorText }}</text>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { createFamily } from '@/services/family'
import { createBaby } from '@/services/baby'
import { todayString } from '@/utils/date'
import { ensurePageAccess, redirectTo } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'
import { track } from '@/utils/tracker'

const PAGE_PATH = 'pages/setup/setup'

const store = useAuthStore()

const step = ref('family') // family | baby
const familyName = ref('')
const babyName = ref('')
const birthday = ref('')
const gender = ref('')
const submitting = ref(false)
const errorText = ref('')
const today = todayString()

const genderOptions = [
  { value: 'male', label: '男宝' },
  { value: 'female', label: '女宝' },
]

const isFamilyStep = computed(() => step.value === 'family')

async function onCreateFamily() {
  if (submitting.value) return
  errorText.value = ''
  submitting.value = true
  try {
    const family = await createFamily(familyName.value.trim())
    console.log('[Setup] 家庭创建成功', family && family.id)
    await store.refreshContext()
    // 一个用户可拥有多个家庭：新建后直接切成当前家庭，下一步的宝宝才落在这个家里
    if (family) await store.switchFamily(family.id)
    if (family) track('action', 'family_created', {})
    step.value = 'baby'
  } catch (err) {
    console.error('[Setup] 创建家庭失败', err)
    errorText.value = err.message || '创建失败，请重试'
  } finally {
    submitting.value = false
  }
}

function goJoinFamily() {
  uni.navigateTo({ url: '/pages/join-family/join-family' })
}

async function onFinish() {
  if (submitting.value) return
  errorText.value = ''
  if (!babyName.value.trim()) {
    errorText.value = '请填写宝宝昵称'
    return
  }
  submitting.value = true
  try {
    await createBaby(store.membership.family_id, {
      name: babyName.value,
      gender: gender.value,
      birthday: birthday.value,
    })
    await store.refreshContext()
    goHome()
  } catch (err) {
    console.error('[Setup] 创建宝宝档案失败', err)
    errorText.value = err.message || '保存失败，请重试'
  } finally {
    submitting.value = false
  }
}

function goHome() {
  redirectTo('/pages/index/index')
}

onShow(() => {
  ensurePageAccess(PAGE_PATH)
})

// 补丁 Step 4：统一分享卡片（标题与落地页见 @/utils/share）
onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  padding: var(--space-xl) var(--space-lg) var(--space-lg);
  box-sizing: border-box;
}

.header {
  display: flex;
  flex-direction: column;
  margin-bottom: var(--space-lg);
}

.title {
  font-size: 44rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.subtitle {
  margin-top: var(--space-xs);
  font-size: 26rpx;
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
  width: 160rpx;
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

.secondary {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
}

.secondary-text {
  font-size: 28rpx;
  color: var(--color-primary);
}

.error {
  display: block;
  margin-top: var(--space-sm);
  font-size: 26rpx;
  color: var(--color-danger);
}
</style>
