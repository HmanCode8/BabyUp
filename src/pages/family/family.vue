<template>
  <view class="page">
    <!-- 家庭名称 -->
    <view class="app-card">
      <text class="card-label">家庭名称</text>
      <view v-if="isOwner" class="field field--name">
        <input
          class="field-input field-input--name"
          maxlength="12"
          :value="familyNameInput"
          placeholder="如：我们的家"
          placeholder-class="field-placeholder"
          @input="familyNameInput = $event.detail.value"
        />
        <text class="field-action" @click="onSaveFamilyName">保存</text>
      </view>
      <template v-else>
        <text class="family-name">{{ familyName }}</text>
        <text class="field-tip">家庭名称只有创建者可以修改</text>
      </template>
    </view>

    <!-- 邀请成员：仅创建者能生成（RLS 与数据库函数都会再校验一次） -->
    <view v-if="isOwner" class="app-card">
      <text class="card-title">邀请成员</text>

      <text class="card-label">角色</text>
      <view class="chips">
        <view
          v-for="item in INVITE_ROLES"
          :key="item.key"
          class="chip"
          :class="{ 'chip--active': item.key === form.role }"
          @click="form.role = item.key"
        >
          <text class="chip-text" :class="{ 'chip-text--active': item.key === form.role }">
            {{ item.label }}
          </text>
        </view>
      </view>
      <text class="field-tip">{{ roleDesc }}</text>

      <text class="card-label">有效期</text>
      <view class="chips">
        <view
          v-for="item in INVITE_EXPIRES"
          :key="item.key"
          class="chip"
          :class="{ 'chip--active': item.key === form.expires }"
          @click="form.expires = item.key"
        >
          <text class="chip-text" :class="{ 'chip-text--active': item.key === form.expires }">
            {{ item.label }}
          </text>
        </view>
      </view>

      <view class="primary" :class="{ 'primary--disabled': generating }" @click="onGenerate">
        <text class="primary-text">{{ generating ? '生成中…' : '生成邀请码' }}</text>
      </view>

      <!-- 刚生成的邀请码：大字 + 复制 / 分享 -->
      <view v-if="latest" class="code-box">
        <text class="invite-code">{{ latest.invite_code }}</text>
        <text class="invite-hint">
          {{ roleLabel(latest.role) }}邀请码 · {{ expiresText(latest) }}
        </text>
        <view class="code-actions">
          <view class="copy" @click="copyCode(latest.invite_code)">
            <text class="copy-text">复制邀请码</text>
          </view>
          <!-- #ifdef MP-WEIXIN -->
          <!-- 微信没有「用 JS 拉起转发面板」的接口，只能用 open-type="share" 的按钮 -->
          <button class="share-button" open-type="share">
            <text class="share-button-text">分享给家人</text>
          </button>
          <!-- #endif -->
        </view>
      </view>
      <text v-else class="field-tip">把邀请码发给家人，他们在「加入已有家庭」里输入即可</text>
    </view>

    <!-- 我的昵称 -->
    <view class="app-card">
      <view class="field">
        <text class="field-label">我的昵称</text>
        <input
          class="field-input"
          maxlength="12"
          :value="myNickname"
          placeholder="如：妈妈 / 奶奶"
          placeholder-class="field-placeholder"
          @input="myNickname = $event.detail.value"
        />
        <text class="field-action" @click="onSaveNickname">保存</text>
      </view>
      <text class="field-tip">昵称会显示给家人，方便互相认出是谁在记录</text>
    </view>

    <!-- 成员列表 -->
    <view class="app-card">
      <text class="card-title">家庭成员（{{ members.length }}）</text>

      <view v-if="!members.length" class="empty-inline">
        <text class="empty-inline-text">{{ loading ? '加载中…' : '还没有成员' }}</text>
      </view>

      <view v-for="member in members" :key="member.id" class="member-row">
        <view class="member-main">
          <text class="member-name">{{ memberLabel(member) }}</text>
          <text class="member-sub">{{ roleLabel(member.role) }}</text>
        </view>
        <text v-if="canManage(member)" class="member-action" @click="openRolePicker(member)">
          改角色
        </text>
        <text v-if="canManage(member)" class="member-remove" @click="onRemove(member)">移除</text>
      </view>
    </view>

    <!-- 邀请码记录：仅创建者能看与撤销 -->
    <view v-if="isOwner" class="app-card">
      <text class="card-title">邀请码记录</text>
      <view v-if="!invites.length" class="empty-inline">
        <text class="empty-inline-text">还没有生成过邀请码</text>
      </view>
      <view v-for="invite in invites" :key="invite.id" class="invite-row">
        <view class="invite-main">
          <text class="invite-code-small">{{ invite.invite_code }}</text>
          <text class="invite-sub">
            {{ roleLabel(invite.role) }} · {{ statusLabel(invite) }} · {{ createdText(invite) }}
          </text>
        </view>
        <text
          v-if="inviteStatus(invite) === 'active'"
          class="member-remove"
          @click="onRevoke(invite)"
        >
          撤销
        </text>
      </view>
    </view>

    <!-- 退出家庭 -->
    <view v-if="!isOwner" class="danger" @click="onLeave">
      <text class="danger-text">退出家庭</text>
    </view>
    <text v-else class="owner-hint">你是家庭创建者，暂时不能退出家庭</text>

    <!-- 改角色 -->
    <view v-if="roleTarget" class="mask" @click="roleTarget = null">
      <view class="sheet" @click.stop>
        <text class="sheet-title">修改角色</text>
        <text class="sheet-sub">{{ memberLabel(roleTarget) }}</text>
        <view
          v-for="item in INVITE_ROLES"
          :key="item.key"
          class="sheet-row"
          :class="{ 'sheet-row--active': item.key === roleTarget.role }"
          @click="onPickRole(item.key)"
        >
          <view class="sheet-row-main">
            <text class="sheet-row-label">{{ item.label }}</text>
            <text class="sheet-row-desc">{{ item.desc }}</text>
          </view>
          <text v-if="item.key === roleTarget.role" class="sheet-row-check">当前</text>
        </view>
        <view class="sheet-cancel" @click="roleTarget = null">
          <text class="sheet-cancel-text">取消</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import {
  INVITE_ROLES,
  INVITE_EXPIRES,
  INVITE_STATUS_LABEL,
  inviteStatus,
  roleLabel,
  listMembers,
  listInvitations,
  createInvitation,
  revokeInvitation,
  setMemberRole,
  updateMyNickname,
  updateFamily,
  removeMember,
  leaveFamily,
} from '@/services/family'
import { formatDate } from '@/utils/date'
import { ensurePrivacyAuthorized } from '@/utils/privacy'
import { inviteShare } from '@/utils/share'
import { ensurePageAccess, redirectTo } from '@/utils/routeGuard'

const PAGE_PATH = 'pages/family/family'

const store = useAuthStore()

const members = ref([])
const invites = ref([])
const loading = ref(false)
const savingNickname = ref(false)
const myNickname = ref('')
const familyNameInput = ref('')
const savingName = ref(false)
const generating = ref(false)
/** 刚生成的邀请码（大字展示用） */
const latest = ref(null)
/** 非空表示正在给这个成员改角色 */
const roleTarget = ref(null)

const form = reactive({ role: 'member', expires: '7' })

const familyName = computed(() => (store.family ? store.family.name : '未加入家庭'))
const isOwner = computed(() => store.isOwner)
const myUserId = computed(() => store.userId)
const roleDesc = computed(() => {
  const found = INVITE_ROLES.find((item) => item.key === form.role)
  return found ? found.desc : ''
})

/**
 * 分享给家人时带上的邀请码（补丁 Step 4，文档 3.3 / 流程 4）。
 * 优先用刚生成的那个，其次用列表里最新的一条有效邀请码；
 * 都没有时 inviteShare 会退化成普通分享，用户仍可复制邀请码手动发送。
 */
const shareCode = computed(() => {
  if (latest.value && latest.value.invite_code) return latest.value.invite_code
  const active = invites.value.find((item) => inviteStatus(item) === 'active')
  return active ? active.invite_code : ''
})

function memberLabel(member) {
  if (member.nickname) return member.nickname
  if (member.user_id === myUserId.value) return '我'
  return '家庭成员'
}

function statusLabel(invite) {
  return INVITE_STATUS_LABEL[inviteStatus(invite)] || '未使用'
}

function expiresText(invite) {
  if (!invite) return ''
  if (!invite.expires_at) return '永久有效'
  return `${formatDate(invite.expires_at)} 前有效`
}

function createdText(invite) {
  return invite && invite.created_at ? formatDate(invite.created_at) : ''
}

/** 只有创建者能管理别人，且不能动自己和其它创建者 */
function canManage(member) {
  return isOwner.value && member.role !== 'owner' && member.user_id !== myUserId.value
}

async function load() {
  if (!store.membership) {
    members.value = []
    invites.value = []
    return
  }
  loading.value = true
  try {
    const familyId = store.membership.family_id
    members.value = await listMembers(familyId)
    const mine = members.value.find((item) => item.user_id === myUserId.value)
    myNickname.value = mine && mine.nickname ? mine.nickname : ''
    familyNameInput.value = store.family ? store.family.name : ''
    // 邀请码列表只有创建者能管，成员不必拉
    invites.value = isOwner.value ? await listInvitations(familyId) : []
    console.log('[Family] 已加载成员', members.value.length, '人；邀请码', invites.value.length, '条')
  } catch (err) {
    console.error('[Family] 加载成员失败', err)
    uni.showToast({ title: err.message || '加载失败，请重试', icon: 'none' })
  } finally {
    loading.value = false
  }
}

async function onGenerate() {
  if (generating.value || !store.membership) return
  const option = INVITE_EXPIRES.find((item) => item.key === form.expires)
  generating.value = true
  try {
    const invite = await createInvitation(
      store.membership.family_id,
      form.role,
      option ? option.days : 7,
    )
    latest.value = invite
    console.log('[Family] 已生成邀请码', invite && invite.invite_code, form.role)
    await load()
  } catch (err) {
    console.error('[Family] 生成邀请码失败', err)
    uni.showToast({ title: err.message || '生成失败，请重试', icon: 'none' })
  } finally {
    generating.value = false
  }
}

async function copyCode(code) {
  if (!code) return
  // 写入剪切板属于隐私接口，需先确认用户已同意隐私协议
  const allowed = await ensurePrivacyAuthorized()
  if (!allowed) {
    uni.showToast({ title: '需要同意隐私政策后才能复制', icon: 'none' })
    return
  }
  uni.setClipboardData({
    data: code,
    success: () => uni.showToast({ title: '邀请码已复制', icon: 'none' }),
    fail: (err) => {
      console.error('[Family] 复制失败', err)
      uni.showToast({ title: '复制失败，请手动记录邀请码', icon: 'none' })
    },
  })
}

function onRevoke(invite) {
  uni.showModal({
    title: '撤销邀请码',
    content: `撤销后「${invite.invite_code}」将无法再用于加入家庭。`,
    confirmText: '撤销',
    confirmColor: '#F04438',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await revokeInvitation(invite)
        console.log('[Family] 已撤销邀请码', invite.id)
        if (latest.value && latest.value.id === invite.id) latest.value = null
        uni.showToast({ title: '已撤销', icon: 'success' })
        await load()
      } catch (err) {
        console.error('[Family] 撤销邀请码失败', err)
        uni.showToast({ title: err.message || '撤销失败，请重试', icon: 'none' })
      }
    },
  })
}

function openRolePicker(member) {
  roleTarget.value = member
}

async function onPickRole(role) {
  const member = roleTarget.value
  if (!member || member.role === role) {
    roleTarget.value = null
    return
  }
  try {
    await setMemberRole(member.id, role)
    console.log('[Family] 已修改角色', member.id, '->', role)
    roleTarget.value = null
    uni.showToast({ title: '角色已修改', icon: 'success' })
    await load()
  } catch (err) {
    console.error('[Family] 修改角色失败', err)
    uni.showToast({ title: err.message || '修改失败，请重试', icon: 'none' })
  }
}

async function onSaveNickname() {
  if (savingNickname.value) return
  savingNickname.value = true
  try {
    await updateMyNickname(myNickname.value.trim())
    console.log('[Family] 昵称已更新')
    uni.showToast({ title: '昵称已保存', icon: 'success' })
    await load()
  } catch (err) {
    console.error('[Family] 保存昵称失败', err)
    uni.showToast({ title: err.message || '保存失败，请重试', icon: 'none' })
  } finally {
    savingNickname.value = false
  }
}

/** 家庭名称只有创建者能改（families_update 策略限定 owner），保存后同步到全局上下文 */
async function onSaveFamilyName() {
  if (savingName.value || !store.family) return
  const name = familyNameInput.value.trim()
  if (!name) {
    uni.showToast({ title: '请填写家庭名称', icon: 'none' })
    return
  }
  if (name === store.family.name) {
    uni.showToast({ title: '名称没有变化', icon: 'none' })
    return
  }
  savingName.value = true
  try {
    const updated = await updateFamily(store.family, name)
    // family 是 store 的 getter（只读），改名后同步底层数组即可
    store.patchFamily(updated || { ...store.family, name })
    console.log('[Family] 家庭名称已更新为', name)
    uni.showToast({ title: '名称已保存', icon: 'success' })
  } catch (err) {
    console.error('[Family] 保存家庭名称失败', err)
    familyNameInput.value = store.family.name
    uni.showToast({ title: err.message || '保存失败，请重试', icon: 'none' })
  } finally {
    savingName.value = false
  }
}

function onRemove(member) {
  uni.showModal({
    title: '移除成员',
    content: `移除后「${memberLabel(member)}」将看不到家庭里的记录，家庭数据不受影响。`,
    confirmText: '移除',
    confirmColor: '#F04438',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await removeMember(member.id)
        console.log('[Family] 已移除成员', member.id)
        uni.showToast({ title: '已移除', icon: 'success' })
        await load()
      } catch (err) {
        console.error('[Family] 移除成员失败', err)
        uni.showToast({ title: err.message || '移除失败，请重试', icon: 'none' })
      }
    },
  })
}

function onLeave() {
  if (!store.membership) return
  uni.showModal({
    title: '退出家庭',
    content: '退出后你将看不到这个家庭的记录；数据仍保留在家庭里，日后可用邀请码重新加入。',
    confirmText: '退出',
    confirmColor: '#F04438',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await leaveFamily(store.membership.id)
        console.log('[Family] 已退出家庭')
        await store.refreshContext()
        // 还可能属于别的家庭：有就回时光页，一个都没有才回首次引导
        redirectTo(store.hasFamily ? '/pages/index/index' : '/pages/setup/setup')
      } catch (err) {
        console.error('[Family] 退出家庭失败', err)
        uni.showToast({ title: err.message || '退出失败，请重试', icon: 'none' })
      }
    },
  })
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  await store.bootstrap()
  await load()
})

/**
 * 补丁 Step 4：家庭页覆盖默认分享，带上邀请码（文档 3.3 / 流程 4）。
 * 顶部「...」菜单与「分享给家人」按钮共用这个返回值。
 */
onShareAppMessage(() => inviteShare(shareCode.value))
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
  margin-bottom: var(--space-xs);
  margin-top: var(--space-md);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.family-name {
  font-size: 36rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-bottom: var(--space-xs);
}

.chip {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64rpx;
  padding: 0 32rpx;
  margin: 0 var(--space-sm) var(--space-sm) 0;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.chip--active {
  background-color: var(--color-primary-soft);
}

.chip-text {
  font-size: 27rpx;
  color: var(--color-text-sub);
}

.chip-text--active {
  color: var(--color-primary-deep);
  font-weight: 600;
}

.code-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: var(--space-md);
  padding: var(--space-md) 0;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.invite-code {
  font-size: 72rpx;
  font-weight: 600;
  letter-spacing: 14rpx;
  color: var(--color-primary-deep);
}

.invite-hint {
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
  text-align: center;
}

.code-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-top: var(--space-sm);
}

.copy {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64rpx;
  padding: 0 40rpx;
  background-color: var(--color-bg-card);
  border-radius: var(--radius-pill);
}

.copy-text {
  font-size: 26rpx;
  color: var(--color-primary);
}

/* 微信端拉起转发面板只能用 open-type="share" 的按钮，这里清掉 button 的默认样式 */
.share-button {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  height: 64rpx;
  margin: 0 0 0 var(--space-sm);
  padding: 0 40rpx;
  font-size: 26rpx;
  line-height: 1;
  color: #ffffff;
  background-color: var(--color-primary);
  border: none;
  border-radius: var(--radius-pill);
}

.share-button::after {
  border: none;
}

.share-button-text {
  font-size: 26rpx;
  color: #ffffff;
}

.primary {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 92rpx;
  margin-top: var(--space-sm);
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.primary--disabled {
  opacity: 0.5;
}

.primary-text {
  font-size: 30rpx;
  font-weight: 600;
  color: #ffffff;
}

.field {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 96rpx;
}

.field-label {
  width: 150rpx;
  font-size: 30rpx;
  color: var(--color-text-sub);
}

.field-input {
  flex: 1;
  height: 96rpx;
  font-size: 30rpx;
  color: var(--color-text-main);
}

.field-input--name {
  height: 110rpx;
  font-size: 34rpx;
  font-weight: 600;
}

.field-placeholder {
  font-size: 28rpx;
  color: #c2c7ce;
}

.field-action {
  padding-left: var(--space-sm);
  font-size: 27rpx;
  color: var(--color-primary);
}

.field-tip {
  display: block;
  font-size: 23rpx;
  color: var(--color-text-muted);
}

.card-title {
  display: block;
  margin-bottom: var(--space-sm);
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.empty-inline {
  padding: var(--space-md) 0;
}

.empty-inline-text {
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.member-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md) 0;
  border-bottom: 1rpx solid var(--color-border);
}

.member-main {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.member-name {
  font-size: 30rpx;
  color: var(--color-text-main);
}

.member-sub {
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.member-action {
  margin-right: var(--space-sm);
  padding: 8rpx 24rpx;
  font-size: 26rpx;
  color: var(--color-primary);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.member-remove {
  padding: 8rpx 24rpx;
  font-size: 26rpx;
  color: var(--color-danger);
  background-color: #ffe6e4;
  border-radius: var(--radius-pill);
}

.invite-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md) 0;
  border-bottom: 1rpx solid var(--color-border);
}

.invite-main {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.invite-code-small {
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 4rpx;
  color: var(--color-text-main);
}

.invite-sub {
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.danger {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  margin-top: var(--space-md);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.danger-text {
  font-size: 30rpx;
  color: var(--color-danger);
}

.owner-hint {
  display: block;
  margin-top: var(--space-md);
  font-size: 24rpx;
  color: var(--color-text-muted);
  text-align: center;
}

/* 改角色弹层 */
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

.sheet-sub {
  margin-top: var(--space-xs);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.sheet-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-md) 0;
  border-bottom: 1rpx solid var(--color-border);
}

.sheet-row-main {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.sheet-row-label {
  font-size: 30rpx;
  color: var(--color-text-main);
}

.sheet-row--active .sheet-row-label {
  color: var(--color-primary-deep);
  font-weight: 600;
}

.sheet-row-desc {
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.sheet-row-check {
  font-size: 24rpx;
  color: var(--color-primary);
}

.sheet-cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  margin-top: var(--space-md);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.sheet-cancel-text {
  font-size: 28rpx;
  color: var(--color-text-sub);
}
</style>
