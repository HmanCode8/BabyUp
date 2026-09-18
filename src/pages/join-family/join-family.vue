<template>
  <view class="page">
    <view class="header">
      <text class="title">输入邀请码</text>
      <text class="subtitle">邀请码由家里的创建者在「我的 → 家庭 → 邀请成员」里生成，共 6 位</text>
    </view>

    <view class="app-card">
      <view class="code-box">
        <input
          class="code-input"
          maxlength="6"
          :value="code"
          placeholder="例如 86Z74W"
          placeholder-class="code-placeholder"
          @input="onCodeInput"
        />
      </view>

      <view class="primary" :class="{ 'primary--disabled': submitting }" @click="onJoin">
        <text class="primary-text">{{ submitting ? '请稍候…' : '加入家庭' }}</text>
      </view>

      <text v-if="errorText" class="error">{{ errorText }}</text>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { joinFamilyByInvite } from '@/services/family'
import { defaultShare, normalizeInviteCode } from '@/utils/share'
import { ensurePageAccess, redirectTo } from '@/utils/routeGuard'

const PAGE_PATH = 'pages/join-family/join-family'

const store = useAuthStore()

const code = ref('')
const submitting = ref(false)
const errorText = ref('')

/**
 * 解析分享卡片带进来的邀请码（补丁 Step 4，文档 5.1：接收页 onLoad 解析 options.code）。
 * 解析不出 6 位码时不做任何事，用户仍可手动输入（文档 9.6 的回退要求）。
 *
 * 注意：这里**不**再把邀请码写回本地暂存（未登录时会由 App.onLaunch 负责暂存）。
 * 否则登录页刚消费清掉，这里又写回去，30 分钟内下次登录会被重复弹到本页。
 */
onLoad((options) => {
  const value = normalizeInviteCode(options && options.code)
  if (value.length !== 6) return
  code.value = value
  console.log('[JoinFamily] 已从分享链接带出邀请码')
})

/** 邀请码统一大写并过滤非法字符，避免用户手输小写被判无效 */
function onCodeInput(event) {
  code.value = normalizeInviteCode(event.detail.value)
}

async function onJoin() {
  if (submitting.value) return
  errorText.value = ''
  if (code.value.length !== 6) {
    errorText.value = '邀请码为 6 位字母或数字'
    return
  }
  submitting.value = true
  try {
    const result = await joinFamilyByInvite(code.value)
    console.log('[JoinFamily] 加入成功', result && result.family_id, '角色', result && result.role)
    await store.refreshContext()
    // 一个用户可属于多个家庭：加入后直接切到刚加入的这个家庭
    if (result && result.family_id) await store.switchFamily(result.family_id)
    uni.showToast({ title: '已加入家庭', icon: 'success' })
    redirectTo('/pages/index/index')
  } catch (err) {
    console.error('[JoinFamily] 加入失败', err)
    errorText.value = err.message || '加入失败，请重试'
  } finally {
    submitting.value = false
  }
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

.code-box {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-md) 0;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.code-input {
  width: 100%;
  height: 96rpx;
  font-size: 52rpx;
  font-weight: 600;
  letter-spacing: 12rpx;
  color: var(--color-text-main);
  text-align: center;
}

.code-placeholder {
  font-size: 34rpx;
  font-weight: 400;
  letter-spacing: 2rpx;
  color: #c2c7ce;
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

.error {
  display: block;
  margin-top: var(--space-sm);
  font-size: 26rpx;
  color: var(--color-danger);
}
</style>
