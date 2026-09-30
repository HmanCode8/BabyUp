<template>
  <view class="page">
    <!-- 当前状态：会员制没上线时这里也是唯一的内容 -->
    <view class="app-card status">
      <text class="status-title">{{ statusTitle }}</text>
      <text class="status-desc">{{ statusDesc }}</text>
    </view>

    <template v-if="state.enabled">
      <!-- 权益对照：数字全部来自服务端（cloudfunctions/data 的 MEMBERSHIP_PLANS），前端不写死 -->
      <view class="app-card">
        <view class="row row--head">
          <text class="row-label">功能</text>
          <text class="row-value">免费</text>
          <text class="row-value">会员</text>
        </view>
        <view v-for="item in compareRows" :key="item.key" class="row">
          <text class="row-label">{{ item.label }}</text>
          <text class="row-value">{{ item.free }}</text>
          <text class="row-value row-value--member">{{ item.member }}</text>
        </view>
        <text class="hint">
          只有 AI 问答按会员分级 —— 它是唯一实打实消耗模型额度的功能。
          记录、时光、工具、疫苗、辅食、报告、每日小结、一句话记一笔、首页观察都不限次数。
        </text>
      </view>

      <!-- 开通：会员按家庭计，一个人开通全家共享 -->
      <view v-if="isPermanent" class="app-card">
        <text class="section-title">开通会员</text>
        <text class="hint">
          这个家庭已经是永久会员，不需要再兑换开通码。
          （永久的到期时间是空的，服务端没法在此基础上顺延，所以会直接拦住兑换 —— 免得把永久换成有期限的。）
        </text>
      </view>

      <view v-else class="app-card">
        <text class="section-title">开通会员</text>
        <text class="hint">
          会员按「家庭」开通，开通后家里所有人都按会员权益使用。输入开通码即可：
          会是当前到期时间往后顺延，不会把剩余天数吃掉。
        </text>

        <input
          class="code-input"
          :value="code"
          maxlength="32"
          :disabled="submitting"
          placeholder="输入开通码"
          placeholder-class="code-placeholder"
          confirm-type="done"
          @input="code = $event.detail.value"
        />

        <view
          class="app-button submit"
          :class="{ 'app-button--disabled': submitting }"
          @click="onRedeem"
        >
          <text class="submit-text">{{ submitting ? '开通中…' : '开通' }}</text>
        </view>

        <text v-if="!store.isOwner" class="hint">你在这个家庭里不是创建者，兑换需要由创建者操作。</text>
        <text v-if="errorText" class="error">{{ errorText }}</text>
      </view>
    </template>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import {
  chatPerDay,
  ensureMembership,
  isMember,
  membershipState,
  redeemMembership,
  untilText,
} from '@/services/membership'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pkg/membership/membership'

const store = useAuthStore()

/** 权益快照是响应式的，直接读它（模板里会自动解包） */
const state = membershipState

const code = ref('')
const submitting = ref(false)
const errorText = ref('')

const statusTitle = computed(() => {
  if (!state.value.enabled) return '会员制还没上线'
  return isMember() ? '当前是会员' : `当前是免费版（AI 问答 ${chatPerDay('free')} 次/天）`
})

const statusDesc = computed(() => {
  if (!state.value.enabled) {
    return '现在所有功能都能正常使用：AI 问答、记录、时光、工具、报告都不区分会员。'
  }
  if (isMember()) return `家里所有人共享这份权益。${untilText()}`
  return '免费版只限制 AI 问答次数，其他功能一样能用；开通后全家共享。'
})

/** 永久会员：`until` 为空就是永久。这类家庭不能再兑（服务端也会拦） */
const isPermanent = computed(() => state.value.tier === 'member' && !state.value.until)

/** 对照表：只列出有区分度的项，其余一行说清「都不限」 */
const compareRows = computed(() => {
  const plans = state.value.plans || {}
  const free = plans.free || {}
  const member = plans.member || {}
  return [
    {
      key: 'chat',
      label: 'AI 问答次数',
      free: `${free.chatPerDay || 0} 次/天`,
      member: `${member.chatPerDay || 0} 次/天`,
    },
    {
      key: 'context',
      label: 'AI 能看多久的记录',
      free: `近 ${free.contextDays || 0} 天`,
      member: `近 ${member.contextDays || 0} 天`,
    },
    { key: 'record', label: '记录 / 时光 / 工具 / 报告', free: '不限', member: '不限' },
    { key: 'quick', label: '每日小结 / 一句话记一笔', free: '不限', member: '不限' },
  ]
})

async function onRedeem() {
  if (submitting.value) return
  errorText.value = ''
  const value = code.value.trim()
  if (!value) {
    errorText.value = '请输入开通码'
    return
  }
  if (!store.isOwner) {
    errorText.value = '会员按家庭开通，请让家庭创建者来兑换'
    return
  }

  submitting.value = true
  try {
    await redeemMembership({ familyId: store.currentFamilyId, code: value })
    code.value = ''
    uni.showToast({ title: '已开通', icon: 'success' })
  } catch (err) {
    console.error('[Membership] 兑换失败', err)
    errorText.value = err.message || '兑换失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}

onShow(() => {
  ensurePageAccess(PAGE_PATH)
  // 强制刷新：可能刚在别处（或后台）改了权益，进来就得看到最新的
  ensureMembership({ familyId: store.currentFamilyId, force: true })
})

onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  padding: var(--space-lg);
  box-sizing: border-box;
}

/* 全局的 .app-card 只有内边距、没有外边距，这里几张卡是直接叠着的，
   不给个下间距「权益对照」和「开通会员」就会贴在一起（间距与 profile / photo-detail 保持一致） */
.app-card {
  margin-bottom: var(--space-md);
}

.status {
  display: flex;
  flex-direction: column;
}

.status-title {
  font-size: 36rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.status-desc {
  margin-top: var(--space-sm);
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--color-text-sub);
}

.section-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.row {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 80rpx;
  border-bottom: 1rpx solid var(--color-border);
}

.row--head {
  border-bottom: 1rpx solid var(--color-border);
}

.row-label {
  flex: 1;
  font-size: 27rpx;
  color: var(--color-text-main);
}

.row-value {
  width: 180rpx;
  font-size: 26rpx;
  text-align: right;
  color: var(--color-text-sub);
}

.row-value--member {
  color: var(--color-primary-deep);
  font-weight: 600;
}

.hint {
  display: block;
  padding-top: var(--space-sm);
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
}

.code-input {
  height: 96rpx;
  margin-top: var(--space-md);
  padding: 0 var(--space-md);
  font-size: 30rpx;
  color: var(--color-text-main);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.code-placeholder {
  font-size: 28rpx;
  color: #c2c7ce;
}

.submit {
  margin-top: var(--space-md);
}

.submit-text {
  font-size: 32rpx;
  font-weight: 600;
  color: #ffffff;
}

.error {
  display: block;
  padding-top: var(--space-sm);
  font-size: 26rpx;
  color: var(--color-danger);
}
</style>
