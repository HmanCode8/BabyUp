<template>
  <view class="page">
    <view class="brand">
      <view class="brand-logo">
        <text class="brand-logo-text">芽</text>
      </view>
      <text class="brand-title">初芽</text>
      <text class="brand-sub">记录宝宝的每一个第一次</text>
    </view>

    <!-- #ifdef MP-WEIXIN -->
    <!-- 二期新增：微信一键登录为主入口；H5/开发环境不渲染，走下方手机号登录 -->
    <view class="app-card wechat-card">
      <view
        class="wechat-btn"
        :class="{ 'wechat-btn--disabled': wxSubmitting }"
        @click="onWechatLogin"
      >
        <text class="wechat-btn-text">{{ wxSubmitting ? '登录中…' : '微信一键登录' }}</text>
      </view>
      <text class="wechat-hint">微信授权后自动注册，无需填写手机号</text>
      <text v-if="wxError" class="error">{{ wxError }}</text>
    </view>

    <view v-if="capabilities.phoneLogin" class="divider">
      <text class="divider-text">或使用手机号登录</text>
    </view>
    <!-- #endif -->

    <!-- 手机号账号密码登录：仅当后端提供该能力时渲染（云开发版只保留微信一键登录） -->
    <view v-if="capabilities.phoneLogin" class="app-card form">
      <view class="field">
        <text class="field-label">{{ isSignUp ? '手机号' : '账号' }}</text>
        <input
          class="field-input"
          :type="isSignUp ? 'number' : 'text'"
          :maxlength="isSignUp ? 11 : 50"
          :value="account"
          :placeholder="isSignUp ? '请输入 11 位手机号' : '手机号或邮箱'"
          placeholder-class="field-placeholder"
          @input="account = $event.detail.value"
        />
      </view>

      <view class="field">
        <text class="field-label">密码</text>
        <input
          class="field-input"
          :password="!showPassword"
          maxlength="32"
          :value="password"
          placeholder="至少 6 位"
          placeholder-class="field-placeholder"
          @input="password = $event.detail.value"
        />
        <text class="field-action" @click="showPassword = !showPassword">
          {{ showPassword ? '隐藏' : '显示' }}
        </text>
      </view>

      <view v-if="isSignUp" class="field">
        <text class="field-label">确认密码</text>
        <input
          class="field-input"
          :password="!showPassword"
          maxlength="32"
          :value="confirmPassword"
          placeholder="再输入一次密码"
          placeholder-class="field-placeholder"
          @input="confirmPassword = $event.detail.value"
        />
      </view>

      <!-- 补丁 Step 2：忘记密码入口 -->
      <view v-if="!isSignUp" class="form-links">
        <text class="form-link" @click="goForgotPassword">忘记密码？</text>
      </view>

      <text v-if="errorText" class="error">{{ errorText }}</text>

      <view class="submit" :class="{ 'submit--disabled': submitting }" @click="onSubmit">
        <text class="submit-text">{{ submitting ? '请稍候…' : submitLabel }}</text>
      </view>
    </view>

    <view v-if="capabilities.phoneLogin" class="switch" @click="toggleMode">
      <text class="switch-text">{{ isSignUp ? '已有账号？去登录' : '还没有账号？立即注册' }}</text>
    </view>

    <text v-if="capabilities.phoneLogin" class="footnote">一个手机号只能注册一个账号</text>

    <!-- 补丁 Step 2：合规入口（未登录状态也要能查看） -->
    <view class="legal">
      <text class="legal-link" @click="goLegal('/pages/privacy/privacy')">《隐私政策》</text>
      <text class="legal-text">与</text>
      <text class="legal-link" @click="goLegal('/pages/terms/terms')">《用户协议》</text>
    </view>

    <!-- 补丁 Step 2：首次登录合规确认 -->
    <view v-if="showConsent" class="mask">
      <view class="consent">
        <text class="consent-title">隐私政策与用户协议</text>
        <text class="consent-text">
          为向你提供育儿记录与家庭共享服务，我们需要收集并使用必要的账号信息与宝宝记录信息。
          请阅读并同意以下条款后继续使用：
        </text>
        <view class="consent-links">
          <text class="consent-link" @click="goLegal('/pages/privacy/privacy')">《隐私政策》</text>
          <text class="consent-link" @click="goLegal('/pages/terms/terms')">《用户协议》</text>
        </view>
        <view class="consent-actions">
          <view class="consent-btn consent-btn--ghost" @click="onRefuseConsent">
            <text class="consent-btn-text consent-btn-text--ghost">不同意</text>
          </view>
          <view class="consent-btn consent-btn--primary" @click="onAgreeConsent">
            <text class="consent-btn-text">同意并继续</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { capabilities } from '@/services/api'
import { hasAgreedLegal, markLegalAgreed } from '@/utils/legal'
import { ensurePageAccess, redirectTo } from '@/utils/routeGuard'
import { defaultShare, takeInviteCode } from '@/utils/share'
import { track } from '@/utils/tracker'

const PAGE_PATH = 'pages/login/login'
const PHONE_PATTERN = /^1[3-9]\d{9}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const store = useAuthStore()

const mode = ref('signin') // signin | signup
/** 登录账号：手机号或真实邮箱（补丁 Step 2 起，绑定邮箱的账号改用邮箱登录） */
const account = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const errorText = ref('')
const wxSubmitting = ref(false)
const wxError = ref('')
/** 首次登录合规确认弹层 */
const showConsent = ref(false)
/** 同意协议后要接着执行的登录动作 */
let pendingAction = null

const isSignUp = computed(() => mode.value === 'signup')
const submitLabel = computed(() => (isSignUp.value ? '注册并登录' : '登录'))

function toggleMode() {
  if (submitting.value) return
  mode.value = isSignUp.value ? 'signin' : 'signup'
  errorText.value = ''
  confirmPassword.value = ''
}

function validate() {
  const value = account.value.trim()
  if (isSignUp.value) {
    // 注册仍只支持手机号：一期规则是「一个手机号一个账号」
    if (!PHONE_PATTERN.test(value)) return '请输入正确的 11 位手机号'
  } else if (!PHONE_PATTERN.test(value) && !EMAIL_PATTERN.test(value)) {
    return '请输入正确的手机号或邮箱'
  }
  if (password.value.length < 6) return '密码至少 6 位'
  if (isSignUp.value && password.value !== confirmPassword.value) return '两次输入的密码不一致'
  return ''
}

/**
 * 首次登录合规确认（补丁 Step 2）。
 * 未同意过《隐私政策》《用户协议》时先弹确认层，同意后才继续真正的登录动作。
 */
function requireConsent(action) {
  if (hasAgreedLegal()) {
    action()
    return
  }
  pendingAction = action
  showConsent.value = true
}

function onAgreeConsent() {
  markLegalAgreed()
  showConsent.value = false
  const action = pendingAction
  pendingAction = null
  if (action) action()
}

function onRefuseConsent() {
  pendingAction = null
  showConsent.value = false
  console.log('[Login] 用户未同意协议，拒绝继续')
}

function goForgotPassword() {
  uni.navigateTo({ url: '/pages/forgot-password/forgot-password' })
}

/**
 * 登录成功后的落地页（补丁 Step 4）。
 *
 * 优先回到「分享带来的加入家庭」：从邀请卡片点进来的用户，登录前路由守卫
 * 会先把人送到登录页，邀请码只能暂存在本地，这里把它取出来带回接收页，
 * 否则邀请码就丢了（文档 9.6 要求至少能回退到手动输入）。
 */
function goAfterLogin() {
  const pendingInvite = takeInviteCode()
  if (pendingInvite) {
    console.log('[Login] 检测到分享带来的邀请码，将前往加入家庭')
    redirectTo(`/pages/join-family/join-family?code=${pendingInvite}`)
    return
  }
  // 有家庭进时光页；没有家庭进首次引导
  redirectTo(store.hasFamily ? '/pages/index/index' : '/pages/setup/setup')
}

function goLegal(path) {
  uni.navigateTo({ url: path })
}

function onSubmit() {
  if (submitting.value) return
  errorText.value = validate()
  if (errorText.value) return
  requireConsent(doSubmit)
}

async function doSubmit() {
  submitting.value = true
  try {
    const value = account.value.trim()
    if (isSignUp.value) {
      await store.signUpWithPhone(value, password.value)
      // 注册成功且 session 已写入后再上报（tracker 未登录会跳过）
      track('action', 'signup_success', {})
    } else {
      await store.signInWithAccount(value, password.value)
    }
    console.log('[Login] 登录成功，是否已有家庭:', store.hasFamily)
    goAfterLogin()
  } catch (err) {
    console.error('[Login] 提交失败', err)
    errorText.value = err.message || '操作失败，请重试'
    // 手机号已注册时，直接切到登录态，省得用户再点一次
    if (isSignUp.value && /已注册/.test(errorText.value)) {
      mode.value = 'signin'
      confirmPassword.value = ''
    }
  } finally {
    submitting.value = false
  }
}

/**
 * 微信一键登录（需求文档 3.2 / 流程 1）。
 *
 * Supabase 后端：uni.login 拿 code -> Edge Function 换 openid 并签发 Session。
 * 云开发后端：openid 由微信侧注入 login 云函数，前端不用 code，直接调用即可。
 * 失败时若后端有手机号登录能力则引导用户改用它，否则提示重试。
 */
function onWechatLogin() {
  if (wxSubmitting.value) return
  wxError.value = ''
  errorText.value = ''
  requireConsent(doWechatLogin)
}

async function doWechatLogin() {
  wxSubmitting.value = true
  try {
    let code = ''
    if (capabilities.wechatLoginCode) {
      code = await new Promise((resolve, reject) => {
        uni.login({
          provider: 'weixin',
          success: (res) => {
            if (res && res.code) resolve(res.code)
            else reject(new Error('未获取到微信登录凭证，请重试'))
          },
          fail: (err) => {
            console.error('[Login] uni.login 失败', err)
            reject(new Error(wechatFailHint()))
          },
        })
      })
      console.log('[Login] 已获取微信 code，提交后端换取登录态')
    } else {
      console.log('[Login] 当前后端无需微信 code，直接调用登录云函数')
    }
    await store.signInWithWechat(code)
    console.log('[Login] 微信登录成功，是否已有家庭:', store.hasFamily)
    // 落地页与手机号登录一致（含「分享带来的邀请码」优先分流）
    goAfterLogin()
  } catch (err) {
    console.error('[Login] 微信登录失败', err)
    wxError.value = err.message || wechatFailHint()
  } finally {
    wxSubmitting.value = false
  }
}

/** 微信登录失败的兜底文案：有手机号登录能力时才引导用户改用它 */
function wechatFailHint() {
  return capabilities.phoneLogin ? '微信登录失败，请重试或使用手机号登录' : '微信登录失败，请重试'
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
  padding: 80rpx 0 var(--space-xl);
}

.brand-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 140rpx;
  height: 140rpx;
  background-color: var(--color-primary);
  border-radius: 44rpx;
  box-shadow: 0 16rpx 36rpx rgba(255, 143, 107, 0.35);
}

.brand-logo-text {
  font-size: 64rpx;
  font-weight: 600;
  color: #ffffff;
}

.brand-title {
  margin-top: var(--space-md);
  font-size: 44rpx;
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

.field:last-of-type {
  border-bottom: none;
}

.field-label {
  width: 150rpx;
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

.field-action {
  padding-left: var(--space-sm);
  font-size: 26rpx;
  color: var(--color-primary);
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

.switch {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
}

.switch-text {
  font-size: 28rpx;
  color: var(--color-primary);
}

.footnote {
  margin-top: var(--space-xl);
  font-size: 23rpx;
  color: var(--color-text-muted);
  text-align: center;
}

/* 二期新增：微信一键登录 */
.wechat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-lg);
}

.wechat-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 96rpx;
  /* 微信品牌绿，与下方手机号登录按钮区分主次 */
  background-color: #07c160;
  border-radius: var(--radius-pill);
}

.wechat-btn--disabled {
  opacity: 0.6;
}

.wechat-btn-text {
  font-size: 32rpx;
  font-weight: 600;
  color: #ffffff;
}

.wechat-hint {
  margin-top: var(--space-sm);
  font-size: 23rpx;
  color: var(--color-text-muted);
  text-align: center;
}

.divider {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-xs) 0 var(--space-md);
}

.divider-text {
  font-size: 24rpx;
  color: var(--color-text-muted);
}

/* 补丁 Step 2：忘记密码入口 */
.form-links {
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  padding-top: var(--space-sm);
}

.form-link {
  font-size: 26rpx;
  color: var(--color-primary);
}

/* 补丁 Step 2：合规入口 */
.legal {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding-bottom: var(--space-lg);
}

.legal-link {
  font-size: 24rpx;
  color: var(--color-primary);
}

.legal-text {
  margin: 0 6rpx;
  font-size: 24rpx;
  color: var(--color-text-muted);
}

/* 补丁 Step 2：首次登录合规确认弹层 */
.mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-lg);
  background-color: rgba(0, 0, 0, 0.45);
}

.consent {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: var(--space-lg);
  box-sizing: border-box;
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
}

.consent-title {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.consent-text {
  margin-top: var(--space-sm);
  font-size: 27rpx;
  line-height: 1.7;
  color: var(--color-text-sub);
}

.consent-links {
  display: flex;
  flex-direction: row;
  margin-top: var(--space-md);
}

.consent-link {
  margin-right: var(--space-md);
  font-size: 27rpx;
  color: var(--color-primary);
}

.consent-actions {
  display: flex;
  flex-direction: row;
  margin-top: var(--space-lg);
}

.consent-btn {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  border-radius: var(--radius-pill);
}

.consent-btn--ghost {
  margin-right: var(--space-md);
  background-color: var(--color-bg-page);
}

.consent-btn--primary {
  background-color: var(--color-primary);
}

.consent-btn-text {
  font-size: 29rpx;
  font-weight: 600;
  color: #ffffff;
}

.consent-btn-text--ghost {
  color: var(--color-text-sub);
}
</style>
