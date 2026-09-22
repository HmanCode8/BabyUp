<template>
  <view class="page">
    <!-- 当前登录账号与邮箱绑定状态 -->
    <view class="card">
      <text class="card-title">登录账号</text>
      <view class="row">
        <text class="row-label">当前账号</text>
        <text class="row-value">{{ account.label }}</text>
      </view>
      <view v-if="capabilities.emailRecovery" class="row">
        <text class="row-label">找回密码邮箱</text>
        <text class="row-value" :class="{ 'row-value--warn': !bound }">
          {{ bound ? account.label : '未绑定' }}
        </text>
      </view>

      <view v-if="capabilities.emailRecovery && !bound" class="notice notice--warn">
        <text class="notice-text">
          当前账号邮箱是系统生成的地址，收不到邮件，因此暂时无法自助找回密码。
          绑定一个你能收信的邮箱后即可找回。
        </text>
      </view>

      <view v-if="capabilities.emailBinding && pendingEmail" class="notice notice--warn">
        <text class="notice-text">待确认邮箱：{{ pendingEmail }}</text>
        <text class="notice-text">
          我们已向该邮箱发送确认邮件，请点击邮件里的链接完成绑定，再点下面的按钮刷新状态。
        </text>
      </view>

      <view v-if="capabilities.emailBinding && pendingEmail" class="btn btn--ghost" @click="onRefresh">
        <text class="btn-text btn-text--ghost">{{ refreshing ? '查询中…' : '我已确认，刷新状态' }}</text>
      </view>
    </view>

    <!-- 绑定邮箱：后端不支持邮箱体系（云开发）时整块隐藏 -->
    <view v-if="capabilities.emailBinding" class="card">
      <text class="card-title">绑定真实邮箱</text>
      <text class="tip">绑定后可用于找回密码；请务必确认邮箱填写正确。</text>

      <view class="field">
        <input
          class="field-input"
          :value="email"
          placeholder="请输入常用邮箱"
          placeholder-class="field-placeholder"
          @input="email = $event.detail.value"
        />
      </view>

      <view class="notice notice--danger">
        <text class="notice-text">
          确认邮件会发送到你填写的邮箱，点击邮件里的链接后才会生效。
          绑定后手机号与邮箱都可以登录，该邮箱用于接收密码重置邮件 ——
          邮箱填错将收不到重置邮件，请仔细核对。
        </text>
      </view>

      <text v-if="errorText" class="error">{{ errorText }}</text>

      <view class="btn btn--primary" :class="{ 'btn--disabled': submitting }" @click="onBind">
        <text class="btn-text">{{ submitting ? '提交中…' : '发送确认邮件' }}</text>
      </view>
    </view>

    <!-- 数据与备份（补丁 Step 3：文档 2.1 第 12 项、5.1） -->
    <view class="card">
      <text class="card-title">数据与备份</text>
      <text class="tip">{{ backupTip }}</text>
      <view class="btn btn--primary" :class="{ 'btn--disabled': exporting }" @click="onExport">
        <text class="btn-text">{{ exporting ? '导出中…' : '导出全部数据' }}</text>
      </view>
      <text class="tip tip--muted">
        导出内容：家庭与成员、宝宝档案、照片清单、生长/疫苗/喂养/睡眠/便便/里程碑全部记录（不含照片原件）。
      </text>
    </view>

    <!-- 注销账号（破坏性操作，双确认） -->
    <view class="card">
      <text class="card-title">注销账号</text>
      <text class="tip">
        注销后账号与相关数据将被永久删除且不可恢复。若你是家庭创建者，注销会同时删除该家庭的全部数据。
      </text>
      <view class="btn btn--danger-ghost" @click="onStartDelete">
        <text class="btn-text btn-text--danger">注销账号</text>
      </view>
    </view>

    <!-- 注销第一道确认：说明后果 -->
    <view v-if="deleteStep === 1" class="mask" @click="cancelDelete">
      <view class="sheet" @click.stop>
        <text class="sheet-title">确认注销账号？</text>
        <text class="sheet-text">{{ deleteWarning }}</text>
        <view class="sheet-actions">
          <view class="btn btn--ghost" @click="cancelDelete">
            <text class="btn-text btn-text--ghost">取消</text>
          </view>
          <view class="btn btn--danger" @click="deleteStep = 2">
            <text class="btn-text">继续注销</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 注销第二道确认：输入「删除」二字 -->
    <view v-if="deleteStep === 2" class="mask" @click="cancelDelete">
      <view class="sheet" @click.stop>
        <text class="sheet-title">请输入「删除」二字确认</text>
        <text class="sheet-text">此操作不可恢复，请谨慎确认。</text>
        <input
          class="del-input"
          :value="deleteWord"
          placeholder="在此输入：删除"
          placeholder-class="field-placeholder"
          @input="deleteWord = $event.detail.value"
        />
        <view class="sheet-actions">
          <view class="btn btn--ghost" @click="cancelDelete">
            <text class="btn-text btn-text--ghost">取消</text>
          </view>
          <view
            class="btn btn--danger"
            :class="{ 'btn--disabled': !deleteReady || deleting }"
            @click="onConfirmDelete"
          >
            <text class="btn-text">{{ deleting ? '注销中…' : '确认注销' }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
/**
 * 账号与安全（补丁 Step 2；导出数据与注销在 Step 3 续接）。
 *
 * 绑定邮箱走 GoTrue 原生改邮箱流程（文档 4.7 的「路线 1：真实邮箱即账号邮箱」）：
 * 提交后邮箱处于「待确认」，用户点完邮件里的确认链接才真正生效，
 * 生效后 auth.users.email 变为真实邮箱 —— 这样 GoTrue 才肯把重置邮件发过去
 * （实测：非账号邮箱调 /recover 会静默成功但不发信）。
 */
import { computed, ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { backendName, capabilities, isRecoveryEmailBound } from '@/services/api'
import { deleteAccount, exportAllData } from '@/services/account'
import { PHONE_EMAIL_DOMAIN, WECHAT_EMAIL_DOMAIN } from '@/config'
import { ensurePageAccess, redirectTo } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/account/account'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** 注销第二道确认要输入的字 */
const DELETE_WORD = '删除'

const store = useAuthStore()

const email = ref('')
const submitting = ref(false)
const refreshing = ref(false)
const errorText = ref('')
/** 导出中 / 注销中 的按钮态 */
const exporting = ref(false)
const deleting = ref(false)
/** 注销双确认：0=未开始 1=说明后果 2=输入确认词 */
const deleteStep = ref(0)
const deleteWord = ref('')

/** 当前账号邮箱 */
const currentEmail = computed(() => (store.user && store.user.email) || '')
/** 是否已绑定真实邮箱（一期手机号账号与微信账号的邮箱都收不到信） */
const bound = computed(() => isRecoveryEmailBound(currentEmail.value))
/** 待确认邮箱（GoTrue 改邮箱后放在 new_email） */
const pendingEmail = computed(
  () => (store.user && (store.user.new_email || store.user.email_change)) || '',
)

/** 把账号邮箱翻译成用户能看懂的身份：手机号 / 微信 / 真实邮箱 */
const account = computed(() => {
  // 云开发后端没有账号邮箱这个概念，身份固定是微信
  if (!capabilities.emailBinding) return { kind: 'wechat', label: '微信账号' }
  const value = currentEmail.value.toLowerCase()
  if (!value) return { kind: 'none', label: '未知' }
  const phoneSuffix = `@${PHONE_EMAIL_DOMAIN}`
  if (value.endsWith(phoneSuffix)) {
    const phone = value.slice(0, -phoneSuffix.length)
    return { kind: 'phone', label: phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') }
  }
  if (value.endsWith(`@${WECHAT_EMAIL_DOMAIN}`)) return { kind: 'wechat', label: '微信账号' }
  return { kind: 'email', label: value }
})

/** 「数据与备份」的说明文案：两套后端的数据存放位置不同，提示也要跟着换 */
const backupTip = computed(() =>
  backendName === 'cloud'
    ? '你的记录都存在微信云开发环境中。建议定期导出备份到本地，避免数据丢失。'
    : '你的记录都存在云端。免费版 Supabase 项目若长期无访问可能被暂停，建议定期导出备份到本地。',
)

/** 我作为创建者的家庭数量（注销会连带删除这些家庭） */
const ownedFamilyCount = computed(
  () => store.memberships.filter((item) => item.role === 'owner' && item.status === 'active').length,
)

/** 注销第一道确认里的后果说明 */
const deleteWarning = computed(() => {
  if (ownedFamilyCount.value > 0) {
    return `账号与相关数据将被永久删除，不可恢复。\n\n你创建了 ${ownedFamilyCount.value} 个家庭，注销会一并删除这些家庭的全部数据（含其他成员上传的照片与记录），请先与家人确认。`
  }
  return '账号与相关数据将被永久删除，不可恢复。\n\n你在其他家庭中的成员身份会被移除，家庭数据本身不受影响。'
})

/** 第二道确认：必须一字不差地输入「删除」才允许提交 */
const deleteReady = computed(() => deleteWord.value.trim() === DELETE_WORD)

/** 打开页面时拉一次最新用户信息，避免拿本地旧缓存判断绑定状态 */
async function loadUser() {
  try {
    await store.refreshUser()
  } catch (err) {
    console.error('[Account] 拉取用户信息失败', err)
  }
}

/** 用户点完邮件确认后，手动刷新状态 */
async function onRefresh() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await loadUser()
    const stillPending = (store.user && (store.user.new_email || store.user.email_change)) || ''
    if (stillPending) {
      uni.showModal({
        title: '还未确认',
        content: '服务端仍显示邮箱待确认。请确认你已点击邮件里的确认链接（确认后立即生效）。',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    uni.showToast({ title: '邮箱已生效', icon: 'success' })
    email.value = ''
  } catch (err) {
    console.error('[Account] 刷新绑定状态失败', err)
    errorText.value = err.message || '刷新失败，请重试'
  } finally {
    refreshing.value = false
  }
}

function onBind() {
  if (submitting.value) return
  const value = email.value.trim().toLowerCase()
  if (!EMAIL_PATTERN.test(value)) {
    errorText.value = '请输入正确的邮箱地址'
    return
  }
  if (value === currentEmail.value.toLowerCase()) {
    errorText.value = '该邮箱已是你当前的登录邮箱'
    return
  }
  errorText.value = ''
  uni.showModal({
    title: '确认绑定',
    content: `将向 ${value} 发送确认邮件，点击邮件里的链接后才会生效。\n\n绑定后手机号与邮箱都可以登录，该邮箱用于接收密码重置邮件。确定继续吗？`,
    confirmText: '确定绑定',
    success: (res) => {
      if (res.confirm) submit(value)
    },
  })
}

async function submit(value) {
  submitting.value = true
  try {
    const { pendingEmail: pending } = await store.bindEmail(value)
    console.log('[Account] 绑定邮箱申请已提交', Boolean(pending))
    uni.showModal({
      title: '确认邮件已发送',
      content: `请到 ${pending || value} 查收邮件并点击确认链接。\n\n确认前手机号仍可正常登录；确认后手机号与邮箱都可以登录。`,
      showCancel: false,
      confirmText: '知道了',
    })
    email.value = ''
  } catch (err) {
    console.error('[Account] 绑定邮箱失败', err)
    errorText.value = err.message || '绑定失败，请重试'
  } finally {
    submitting.value = false
  }
}

/**
 * 导出全部数据（补丁 Step 3 / 流程 2）。
 * 失败兜底：toast「请稍后重试」。
 */
async function onExport() {
  if (exporting.value) return
  exporting.value = true
  try {
    const text = await exportAllData()
    console.log('[Account] 导出成功，JSON 长度', text.length)
    saveExportFile(text)
  } catch (err) {
    console.error('[Account] 导出失败', err)
    uni.showToast({ title: err.message || '导出失败，请稍后重试', icon: 'none' })
  } finally {
    exporting.value = false
  }
}

/**
 * 把导出的 JSON 落到本地文件。
 *
 * 小程序端：写入沙箱文件后调起「转发文件」，让用户发到文件传输助手留存
 *   （文档 4.7 写的是 wx.openDocument，但该接口不支持 json，故改用转发；
 *     转发调不起来时把文件路径明确告诉用户）。
 * H5 端：用 Blob 触发浏览器下载，便于在电脑上直接查看。
 */
function saveExportFile(text) {
  // #ifdef MP-WEIXIN
  const fileName = `baby-export-${Date.now()}.json`
  const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`
  wx.getFileSystemManager().writeFile({
    filePath,
    data: text,
    encoding: 'utf8',
    success: () => {
      console.log('[Account] 导出文件已写入', filePath)
      wx.shareFileMessage({
        filePath,
        fileName,
        success: () => console.log('[Account] 已调起文件转发'),
        fail: (err) => {
          console.error('[Account] 文件转发未成功', err)
          uni.showModal({
            title: '导出完成',
            content: `文件已保存到小程序本地：\n${filePath}\n\n可稍后重试转发，或用文件管理工具导出。`,
            showCancel: false,
            confirmText: '知道了',
          })
        },
      })
    },
    fail: (err) => {
      console.error('[Account] 写导出文件失败', err)
      uni.showToast({ title: '导出失败：无法写入本地文件', icon: 'none' })
    },
  })
  // #endif

  // #ifndef MP-WEIXIN
  try {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `baby-export-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)
    uni.showToast({ title: '导出文件已下载', icon: 'none' })
  } catch (err) {
    console.error('[Account] 浏览器下载导出文件失败', err)
    uni.showToast({ title: '导出失败：浏览器不支持下载', icon: 'none' })
  }
  // #endif
}

/** 注销第一步：展示后果（第一道确认） */
function onStartDelete() {
  deleteWord.value = ''
  deleteStep.value = 1
}

function cancelDelete() {
  deleteStep.value = 0
  deleteWord.value = ''
}

/** 注销第二步：调 Edge Function，成功后清本地登录态并回登录页 */
async function onConfirmDelete() {
  if (deleting.value || !deleteReady.value) return
  deleting.value = true
  try {
    const res = await deleteAccount(DELETE_WORD)
    console.log('[Account] 注销完成', res)
    deleteStep.value = 0
    // 账号已不存在，服务端登出会失败，但本地登录态会被清掉（signOut 内部已兜底）
    await store.signOut()
    uni.showToast({ title: '账号已注销', icon: 'success' })
    setTimeout(() => redirectTo('/pages/login/login'), 800)
  } catch (err) {
    console.error('[Account] 注销失败', err)
    errorText.value = err.message || '注销失败，请稍后重试'
    uni.showToast({ title: errorText.value, icon: 'none' })
  } finally {
    deleting.value = false
  }
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  await store.bootstrap()
  await loadUser()
})

// 补丁 Step 4：统一分享卡片（标题与落地页见 @/utils/share）
onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  padding: var(--space-lg);
  box-sizing: border-box;
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
  margin-bottom: var(--space-xs);
  font-size: 26rpx;
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

.row-value {
  font-size: 28rpx;
  color: var(--color-text-sub);
}

.row-value--warn {
  color: var(--color-warning);
}

.tip {
  display: block;
  margin-bottom: var(--space-md);
  font-size: 25rpx;
  line-height: 1.7;
  color: var(--color-text-muted);
}

.field {
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 108rpx;
  padding: 0 var(--space-md);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
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

.notice {
  margin-top: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-md);
}

.notice--warn {
  background-color: #fff7e6;
}

.notice--danger {
  background-color: #ffeceb;
}

.notice-text {
  display: block;
  font-size: 25rpx;
  line-height: 1.7;
  color: var(--color-text-sub);
}

.error {
  display: block;
  margin-top: var(--space-sm);
  font-size: 26rpx;
  color: var(--color-danger);
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 84rpx;
  margin-top: var(--space-md);
  padding: 0 var(--space-lg);
  border-radius: var(--radius-pill);
}

/* 用的是加深后的主色：浅色 --color-primary 上放白字对比度太低，看起来像置灰的禁用态 */
.btn--primary {
  background-color: var(--color-primary-deep);
}

.btn--ghost {
  background-color: var(--color-primary-soft);
}

/* 确认弹层里的破坏性操作：保持实心红，让用户看清楚按的是哪个 */
.btn--danger {
  background-color: var(--color-danger);
}

/* 卡片里的注销入口：破坏性操作弱化处理（浅底红字 + 描边），不和主按钮抢眼 */
.btn--danger-ghost {
  background-color: #fff2f1;
  border: 2rpx solid var(--color-danger);
}

.btn--disabled {
  opacity: 0.6;
}

.btn-text {
  font-size: 28rpx;
  font-weight: 600;
  color: #ffffff;
}

.btn-text--ghost {
  color: var(--color-primary-deep);
}

.btn-text--danger {
  color: var(--color-danger);
}

.tip--muted {
  margin-top: var(--space-sm);
  margin-bottom: 0;
  color: var(--color-text-muted);
}

/* 注销双确认弹层 */
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

.sheet-text {
  margin-top: var(--space-sm);
  font-size: 27rpx;
  line-height: 1.7;
  color: var(--color-text-sub);
}

.del-input {
  height: 96rpx;
  margin-top: var(--space-md);
  padding: 0 var(--space-md);
  font-size: 30rpx;
  color: var(--color-text-main);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.sheet-actions {
  display: flex;
  flex-direction: row;
  margin-top: var(--space-lg);
}

/* 弹层底部两个按钮等宽平分，不然会各按文字宽度挤成两个小胶囊 */
.sheet-actions .btn {
  flex: 1;
  margin-top: 0;
  margin-right: var(--space-md);
}

.sheet-actions .btn:last-child {
  margin-right: 0;
}
</style>
