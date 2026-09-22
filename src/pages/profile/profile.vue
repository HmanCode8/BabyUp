<template>
  <view class="page">
    <!-- 当前宝宝 + 当前家庭（支持一个家庭多个宝宝、一个用户多个家庭） -->
    <view class="card switch-card">
      <view class="switch-baby" @click="openBabyPicker">
        <view class="profile-avatar">
          <image v-if="babyAvatar" class="profile-avatar-img" :src="babyAvatar" mode="aspectFill" />
          <text v-else-if="babyInitial" class="profile-avatar-text">{{ babyInitial }}</text>
          <text v-else class="profile-avatar-text">＋</text>
        </view>
        <view class="profile-info">
          <text class="profile-name">{{ babyName }}</text>
          <text class="profile-sub">{{ babySub }}</text>
        </view>
        <text class="switch-action">切换宝宝 ›</text>
      </view>

      <view class="switch-family" @click="openFamilyPicker">
        <text class="switch-label">当前家庭</text>
        <text class="switch-value">{{ familyName }}</text>
        <text class="switch-action">切换 ›</text>
      </view>
    </view>

    <!-- 宝宝档案：viewer 只读时不给编辑入口 -->
    <view v-if="canWrite" class="card">
      <view class="row" @click="goBabyEdit">
        <text class="row-label">编辑宝宝档案</text>
        <text class="arrow">›</text>
      </view>
      <view class="row" @click="goAddBaby">
        <text class="row-label">添加宝宝</text>
        <text class="row-value">一个家庭可以有多个宝宝</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <!-- 疫苗提醒 -->
    <view class="card">
      <text class="card-title">疫苗提醒</text>
      <view class="row" @click="goVaccine">
        <text class="row-label">待办疫苗</text>
        <view v-if="vaccineSummary.overdue" class="dot" />
        <text class="row-value">
          待接种 {{ vaccineSummary.todo }} · 已逾期 {{ vaccineSummary.overdue }}
        </text>
        <text class="arrow">›</text>
      </view>
    </view>

    <!-- 喂奶提醒（三期 P1-8）：按月龄定间隔上限，超时提醒 -->
    <view class="card">
      <text class="card-title">喂奶提醒</text>
      <view class="row" @click="goFeedingReminder">
        <text class="row-label">喂养间隔</text>
        <text class="row-value">{{ feedingReminderValue }}</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <!-- AI 照护助手（只有云开发后端提供，Supabase / H5 下自动隐藏） -->
    <view v-if="aiAvailable" class="card">
      <view class="row" @click="goAiChat">
        <text class="row-label">AI 照护助手</text>
        <text class="row-value">结合宝宝记录问答</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <!-- 成长报告 -->
    <view class="card">
      <view class="row" @click="goReport">
        <text class="row-label">成长报告</text>
        <text class="row-value">按月生成分享图</text>
        <text class="arrow">›</text>
      </view>
    </view>
    <!-- 家庭成员 -->
    <view class="card">
      <text class="card-title">家庭</text>
      <view class="row" @click="goFamily">
        <text class="row-label">{{ familyName }}</text>
        <text class="row-value">{{ roleText }}</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <!-- 补丁 Step 2：账号安全与合规入口 -->
    <view class="card">
      <text class="card-title">账号</text>
      <view class="row" @click="goAccount">
        <text class="row-label">账号与安全</text>
        <text class="row-value" :class="{ 'row-value--warn': accountValueWarn }">
          {{ accountValue }}
        </text>
        <text class="arrow">›</text>
      </view>
      <view class="row" @click="goAccount">
        <text class="row-label">数据与备份</text>
        <text class="row-value">导出全部数据</text>
        <text class="arrow">›</text>
      </view>
      <view class="row" @click="goFeedback">
        <text class="row-label">意见反馈</text>
        <text class="row-value">问题与建议</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <view class="card">
      <text class="card-title">关于与法律</text>
      <view class="row" @click="goPrivacy">
        <text class="row-label">隐私政策</text>
        <text class="arrow">›</text>
      </view>
      <view class="row" @click="goTerms">
        <text class="row-label">用户协议</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <view class="card">
      <view class="row" @click="onSignOut">
        <text class="row-label row-label--danger">退出登录</text>
        <text class="arrow">›</text>
      </view>
    </view>

    <!-- 选择宝宝 -->
    <view v-if="babyPicker" class="mask" @click="babyPicker = false">
      <view class="sheet" @click.stop>
        <text class="sheet-title">选择宝宝</text>
        <view v-for="item in store.babies" :key="item.id" class="pick-row" @click="onPickBaby(item)">
          <view class="pick-main">
            <text class="pick-name">{{ item.name }}</text>
            <text class="pick-sub">{{ item.birthday ? `生日 ${item.birthday}` : '未填写生日' }}</text>
          </view>
          <text v-if="item.id === store.currentBabyId" class="pick-check">当前</text>
        </view>
        <view v-if="canWrite" class="sheet-actions">
          <view class="btn btn--primary" @click="goAddBaby">
            <text class="btn-text">＋ 添加宝宝</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 选择家庭 -->
    <view v-if="familyPicker" class="mask" @click="familyPicker = false">
      <view class="sheet" @click.stop>
        <text class="sheet-title">选择家庭</text>
        <view
          v-for="item in store.memberships"
          :key="item.id"
          class="pick-row"
          @click="onPickFamily(item)"
        >
          <view class="pick-main">
            <text class="pick-name">{{ familyNameOf(item.family_id) }}</text>
            <text class="pick-sub">{{ roleLabel(item.role) }}</text>
          </view>
          <text v-if="item.family_id === store.currentFamilyId" class="pick-check">当前</text>
        </view>
        <view class="sheet-actions">
          <view class="btn btn--ghost" @click="goCreateFamily">
            <text class="btn-text btn-text--ghost">＋ 创建新家庭</text>
          </view>
          <view class="btn btn--ghost" @click="goJoinFamily">
            <text class="btn-text btn-text--ghost">＋ 加入已有家庭</text>
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
import { listVaccinations, summarizeVaccinations } from '@/services/vaccine'
import { formatFeedInterval, resolveFeedInterval } from '@/services/feeding'
import { roleLabel } from '@/services/family'
import { capabilities, isRecoveryEmailBound } from '@/services/api'
import { isAiChatAvailable } from '@/services/ai'
import { formatAge } from '@/utils/age'
import { ensurePageAccess, redirectTo } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/profile/profile'

const store = useAuthStore()

const vaccineSummary = ref({ overdue: 0, soon: 0, pending: 0, vaccinated: 0, todo: 0 })
const babyPicker = ref(false)
const familyPicker = ref(false)
const signingOut = ref(false)

const babyName = computed(() => (store.baby ? store.baby.name : '还没有宝宝档案'))
const babyAvatar = computed(() => store.babyAvatarUrl)
const babyInitial = computed(() =>
  store.baby && store.baby.name ? store.baby.name.slice(0, 1) : '',
)
const babySub = computed(() => {
  if (!store.baby) return '点击添加宝宝档案'
  // 补丁 Step 5：档案卡展示月龄
  const age = formatAge(store.baby.birthday)
  if (!store.baby.birthday) return '未填写生日'
  return age ? `${age} · 生日 ${store.baby.birthday}` : `生日 ${store.baby.birthday}`
})
const familyName = computed(() => (store.family ? store.family.name : '未加入家庭'))
/** viewer 只读：隐藏宝宝档案的编辑/添加入口 */
const canWrite = computed(() => store.canWrite)

const roleText = computed(() => roleLabel(store.myRole))
/** AI 助手入口：只有云开发后端 + 微信小程序端才有 */
const aiAvailable = computed(() => isAiChatAvailable())
/** 是否已绑定真实邮箱（决定能否自助找回密码） */
const emailBound = computed(() => isRecoveryEmailBound(store.user && store.user.email))
/**
 * 账号卡片的右侧文案。
 * 后端不提供邮箱体系（云开发）时没有「绑定邮箱」一说，直接显示账号类型。
 */
const accountValue = computed(() => {
  if (!capabilities.emailBinding) return '微信账号'
  return emailBound.value ? '已绑定邮箱' : '未绑定邮箱'
})
/** 只有需要提醒的「未绑定邮箱」才标红 */
const accountValueWarn = computed(() => capabilities.emailBinding && !emailBound.value)

/** 喂奶提醒摘要：未开启时直接说明，开启时展示当前生效的间隔上限 */
const feedingReminderValue = computed(() => {
  if (!store.baby) return '未设置'
  if (!store.baby.feed_remind_enabled) return '未开启'
  return `每 ${formatFeedInterval(resolveFeedInterval(store.baby))}`
})

function familyNameOf(familyId) {
  const found = store.families.find((item) => item.id === familyId)
  return found ? found.name : '未命名家庭'
}

function goBabyEdit() {
  uni.navigateTo({ url: '/pages/baby-edit/baby-edit' })
}

function goAddBaby() {
  babyPicker.value = false
  // mode=create 让 baby-edit 走「新增宝宝」而不是「编辑当前宝宝」
  uni.navigateTo({ url: '/pages/baby-edit/baby-edit?mode=create' })
}

function goVaccine() {
  uni.navigateTo({ url: '/pages/vaccine/vaccine' })
}

function goFamily() {
  uni.navigateTo({ url: '/pages/family/family' })
}

function goReport() {
  uni.navigateTo({ url: '/pages/report/report' })
}

function goFeedingReminder() {
  uni.navigateTo({ url: '/pages/feeding-reminder/feeding-reminder' })
}

function goAiChat() {
  uni.navigateTo({ url: '/pages/ai-chat/ai-chat' })
}

function goAccount() {
  uni.navigateTo({ url: '/pages/account/account' })
}

function goFeedback() {
  uni.navigateTo({ url: '/pages/feedback/feedback' })
}

function goPrivacy() {
  uni.navigateTo({ url: '/pages/privacy/privacy' })
}

function goTerms() {
  uni.navigateTo({ url: '/pages/terms/terms' })
}

function goCreateFamily() {
  familyPicker.value = false
  uni.navigateTo({ url: '/pages/setup/setup' })
}

function goJoinFamily() {
  familyPicker.value = false
  uni.navigateTo({ url: '/pages/join-family/join-family' })
}

function openBabyPicker() {
  babyPicker.value = true
}

function openFamilyPicker() {
  familyPicker.value = true
}

/** 切宝宝后疫苗提醒要跟着换（它是按当前宝宝统计的） */
async function onPickBaby(item) {
  babyPicker.value = false
  await store.switchBaby(item.id)
  await loadVaccineSummary()
}

/** 切家庭后宝宝列表、头像、疫苗提醒全部跟着换 */
async function onPickFamily(item) {
  familyPicker.value = false
  await store.switchFamily(item.family_id)
  await loadVaccineSummary()
}

/** 「我的」页只展示待办数量，不加载完整列表逻辑 */
async function loadVaccineSummary() {
  if (!store.membership || !store.baby) {
    vaccineSummary.value = { overdue: 0, soon: 0, pending: 0, vaccinated: 0, todo: 0 }
    return
  }
  try {
    const list = await listVaccinations(store.membership.family_id, store.baby.id)
    vaccineSummary.value = summarizeVaccinations(list)
  } catch (err) {
    console.error('[Profile] 加载疫苗提醒失败', err)
  }
}

function onSignOut() {
  if (signingOut.value) return
  uni.showModal({
    title: '退出登录',
    // 云开发后端没有手机号密码，只能重新微信授权登录
    content: capabilities.phoneLogin
      ? '退出后需要重新输入手机号和密码，家庭里的记录不会丢失。'
      : '退出后需要重新微信授权登录，家庭里的记录不会丢失。',
    confirmText: '退出',
    success: async (res) => {
      if (!res.confirm) return
      signingOut.value = true
      try {
        await store.signOut()
        redirectTo('/pages/login/login')
      } catch (err) {
        console.error('[Profile] 退出登录失败', err)
        uni.showToast({ title: '退出失败，请重试', icon: 'none' })
      } finally {
        signingOut.value = false
      }
    },
  })
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  await store.bootstrap()
  await loadVaccineSummary()
})

// 补丁 Step 4：统一分享卡片（标题与落地页见 @/utils/share）
onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  padding: var(--space-lg);
  box-sizing: border-box;
}

.dot {
  width: 16rpx;
  height: 16rpx;
  margin-right: var(--space-xs);
  background-color: var(--color-danger);
  border-radius: 50%;
}

.card {
  padding: var(--space-lg);
  margin-bottom: var(--space-md);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.card-title {
  display: block;
  margin-bottom: var(--space-sm);
  font-size: 26rpx;
  color: var(--color-text-muted);
}

/* 当前宝宝 / 当前家庭 */
.switch-card {
  padding: var(--space-md) var(--space-lg);
}

.switch-baby {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding-bottom: var(--space-md);
  border-bottom: 1rpx solid var(--color-border);
}

.switch-family {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding-top: var(--space-md);
}

.switch-label {
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.switch-value {
  flex: 1;
  margin-left: var(--space-sm);
  font-size: 28rpx;
  color: var(--color-text-main);
}

.switch-action {
  font-size: 25rpx;
  color: var(--color-primary);
}

.profile-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 108rpx;
  height: 108rpx;
  overflow: hidden;
  background-color: var(--color-primary-soft);
  border-radius: 50%;
}

.profile-avatar-img {
  width: 108rpx;
  height: 108rpx;
}

.profile-avatar-text {
  font-size: 44rpx;
  color: var(--color-primary);
}

.profile-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  margin-left: var(--space-md);
}

.profile-name {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.profile-sub {
  margin-top: var(--space-xs);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.row {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 88rpx;
}

.row-label {
  flex: 1;
  font-size: 30rpx;
  color: var(--color-text-main);
}

.row-label--danger {
  color: var(--color-danger);
}

.row-value {
  margin-right: var(--space-xs);
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.row-value--warn {
  color: var(--color-warning);
}

.arrow {
  font-size: 36rpx;
  color: var(--color-text-muted);
}

/* 选择家庭 / 宝宝的底部弹层 */
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
  margin-bottom: var(--space-sm);
  font-size: 32rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.pick-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-md) 0;
  border-bottom: 1rpx solid var(--color-border);
}

.pick-main {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.pick-name {
  font-size: 30rpx;
  color: var(--color-text-main);
}

.pick-sub {
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.pick-check {
  padding: 6rpx 20rpx;
  font-size: 24rpx;
  color: var(--color-primary-deep);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.sheet-actions {
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

.btn--primary {
  background-color: var(--color-primary);
}

.btn--ghost {
  margin-right: var(--space-md);
  background-color: var(--color-bg-page);
}

.btn--ghost:last-child {
  margin-right: 0;
}

.btn-text {
  font-size: 29rpx;
  font-weight: 600;
  color: #ffffff;
}

.btn-text--ghost {
  color: var(--color-text-sub);
}
</style>
