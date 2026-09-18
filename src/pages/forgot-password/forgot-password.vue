<template>
  <view class="page">
    <view class="brand">
      <text class="brand-title">找回密码</text>
      <text class="brand-sub">输入你绑定的邮箱，我们会发送重置链接</text>
    </view>

    <view class="app-card form">
      <view class="field">
        <text class="field-label">邮箱</text>
        <input
          class="field-input"
          :value="email"
          placeholder="请输入注册时绑定的邮箱"
          placeholder-class="field-placeholder"
          @input="email = $event.detail.value"
        />
      </view>
      <text v-if="errorText" class="error">{{ errorText }}</text>
      <view class="submit" :class="{ 'submit--disabled': submitting }" @click="onSubmit">
        <text class="submit-text">{{ submitting ? '发送中…' : '发送重置邮件' }}</text>
      </view>
    </view>

    <view class="tips">
      <text class="tip-title">没有绑定过邮箱？</text>
      <text class="tip-line">
        一期注册的账号默认用手机号登录，邮箱是系统生成的假地址，收不到重置邮件，
        因此需要先绑定一个真实邮箱：
      </text>
      <text class="tip-line">1. 返回登录页，用「手机号 + 密码」登录；</text>
      <text class="tip-line">2. 进入「我的 - 账号与安全 - 绑定真实邮箱」；</text>
      <text class="tip-line">3. 回到这里输入新绑定的邮箱即可。</text>
      <text class="tip-line tip-line--muted">
        用微信一键登录的账号同理：先在「我的 - 账号与安全」绑定邮箱。
      </text>
    </view>

    <view class="switch" @click="goLogin">
      <text class="switch-text">返回登录</text>
    </view>
  </view>
</template>

<script setup>
/**
 * 找回密码（补丁 Step 2）。
 *
 * 与文档 4.7 的差异（已向用户确认）：
 * 文档写的是「输入手机号 → 查 profiles.recovery_email → 发重置邮件」，
 * 但实测 GoTrue 只给「账号登录邮箱」发重置信，且未登录状态下按手机号查 profiles
 * 会被 RLS 拦住，所以本页改为直接输入邮箱，并对手机号输入给出绑定引导。
 * 未绑定邮箱的用户属于文档验收里的「未绑定用户」，提示引导即为验收项。
 */
import { ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/forgot-password/forgot-password'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^1[3-9]\d{9}$/

const store = useAuthStore()

const email = ref('')
const submitting = ref(false)
const errorText = ref('')

async function onSubmit() {
  if (submitting.value) return
  const value = email.value.trim()

  if (PHONE_PATTERN.test(value)) {
    errorText.value = '暂不支持用手机号重置密码，请先按下方说明绑定真实邮箱'
    return
  }
  if (!EMAIL_PATTERN.test(value)) {
    errorText.value = '请输入正确的邮箱地址'
    return
  }

  errorText.value = ''
  submitting.value = true
  try {
    await store.requestPasswordReset(value)
    console.log('[ForgotPassword] 重置邮件请求已提交')
    uni.showModal({
      title: '邮件已发送',
      content: `若 ${value} 已绑定到账号，重置链接会发送到该邮箱。\n\n没收到请检查垃圾邮件，或稍后重试（同一邮箱 60 秒内只能请求一次）。`,
      showCancel: false,
      confirmText: '知道了',
    })
  } catch (err) {
    console.error('[ForgotPassword] 发送重置邮件失败', err)
    errorText.value = err.message || '发送失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}

function goLogin() {
  uni.reLaunch({ url: '/pages/login/login' })
}

onShow(() => {
  ensurePageAccess(PAGE_PATH)
})

// 补丁 Step 4：统一分享卡片（标题与落地页见 @/utils/share）
onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  padding: var(--space-xl) var(--space-lg) var(--space-lg);
  box-sizing: border-box;
}

.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-xl) 0 var(--space-lg);
}

.brand-title {
  font-size: 42rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.brand-sub {
  margin-top: var(--space-xs);
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.form {
  padding: var(--space-lg);
}

.field {
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 108rpx;
  border-bottom: 1rpx solid var(--color-border);
}

.field-label {
  width: 110rpx;
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

.error {
  display: block;
  margin-top: var(--space-sm);
  font-size: 26rpx;
  color: var(--color-danger);
}

.submit {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  margin-top: var(--space-lg);
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.submit--disabled {
  opacity: 0.6;
}

.submit-text {
  font-size: 32rpx;
  font-weight: 600;
  color: #ffffff;
}

.tips {
  display: flex;
  flex-direction: column;
  margin-top: var(--space-xl);
  padding: var(--space-lg);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.tip-title {
  margin-bottom: var(--space-xs);
  font-size: 29rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.tip-line {
  margin-top: var(--space-xs);
  font-size: 25rpx;
  line-height: 1.7;
  color: var(--color-text-sub);
}

.tip-line--muted {
  color: var(--color-text-muted);
}

.switch {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  margin-top: var(--space-md);
}

.switch-text {
  font-size: 28rpx;
  color: var(--color-primary);
}
</style>
