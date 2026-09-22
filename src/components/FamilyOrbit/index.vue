<template>
  <view v-if="visible" class="mask" @click="close">
    <view class="panel" @click.stop>
      <text class="panel-title">守护 {{ babyName }} 的家人</text>
      <text class="panel-sub">{{ subtitle }}</text>

      <view class="stage">
        <!-- 中心的宝宝：只留一个圆头像，寓意被家人环绕 -->
        <view class="baby-avatar">
          <image v-if="babyAvatar" class="baby-avatar-img" :src="babyAvatar" mode="aspectFill" />
          <text v-else class="baby-avatar-text">{{ babyInitial }}</text>
        </view>

        <!-- 环绕的家人：外层正转 + 气泡同周期反转，抵消后头像与名字始终正立 -->
        <view v-if="bubbles.length" class="orbit">
          <view v-for="item in bubbles" :key="item.key" class="bubble-wrap" :style="item.style">
            <view class="bubble">
              <image class="bubble-avatar" :src="item.avatar" mode="aspectFill" />
              <text class="bubble-name" :class="{ 'bubble-name--sm': item.small }">
                {{ item.label }}
              </text>
            </view>
          </view>
        </view>
      </view>

      <text v-if="!bubbles.length" class="hint">
        当前家庭还没有其他成员，去「我的」页邀请家人一起记录吧
      </text>

      <view class="close-btn" @click="close">
        <text class="close-text">知道了</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { FAMILY_ROLE_LABEL } from '@/services/family'

/** 舞台尺寸与布局参数：改这里就能调整环绕效果 */
const STAGE = 640
const RADIUS = 210
const BUBBLE_MAX = 120
const BUBBLE_MIN = 84

/** 成员默认头像：表里没有性别字段，只能按称谓关键字推断 */
const AVATAR_MALE = '/static/avatar/male.png'
const AVATAR_FEMALE = '/static/avatar/female.png'
const FEMALE_KEYWORDS = ['妈', '娘', '母', '奶', '婆', '姨', '姑', '姐', '妹', '女', '妻', '太']
const MALE_KEYWORDS = ['爸', '爹', '父', '爷', '公', '叔', '伯', '哥', '弟', '男', '夫', '儿']

const store = useAuthStore()

const visible = ref(false)

const babyName = computed(() => (store.baby ? store.baby.name : '宝宝'))
const babyAvatar = computed(() => store.babyAvatarUrl)
const babyInitial = computed(() => (store.baby && store.baby.name ? store.baby.name.slice(0, 1) : '宝'))

/** 昵称缺失时按家庭页既有规则回落：自己显示「我」，别人显示角色名 */
function memberLabel(member) {
  if (member.nickname) return member.nickname
  if (member.user_id === store.userId) return '我'
  return FAMILY_ROLE_LABEL[member.role] || '家庭成员'
}

/** 先判女性（「女儿」这类同时含男女关键字），命中不了则用女性头像兜底 */
function memberAvatar(member) {
  const text = `${member.nickname || ''}${memberLabel(member)}`
  if (FEMALE_KEYWORDS.some((k) => text.includes(k))) return AVATAR_FEMALE
  if (MALE_KEYWORDS.some((k) => text.includes(k))) return AVATAR_MALE
  return AVATAR_FEMALE
}

const bubbles = computed(() => {
  const list = store.members || []
  const count = list.length
  if (!count) return []
  // 人多时缩小气泡，避免绕圈时挤在一起；下限 84rpx 保证 2 个字还能读
  const size = Math.max(
    BUBBLE_MIN,
    Math.min(BUBBLE_MAX, (2 * Math.PI * RADIUS) / count - 16),
  )
  const center = STAGE / 2
  return list.map((member, index) => {
    // 从正上方开始均分一圈，按百分比定位，避免内联 rpx 的跨端换算问题
    const rad = ((-90 + (index * 360) / count) * Math.PI) / 180
    const left = center + RADIUS * Math.cos(rad) - size / 2
    const top = center + RADIUS * Math.sin(rad) - size / 2
    const label = memberLabel(member)
    return {
      key: member.id || member.user_id || index,
      label: label.length > 4 ? label.slice(0, 4) : label,
      avatar: memberAvatar(member),
      small: size < 104,
      style: `left:${(left / STAGE) * 100}%;top:${(top / STAGE) * 100}%;width:${(size / STAGE) * 100}%;height:${(size / STAGE) * 100}%;`,
    }
  })
})

const subtitle = computed(() =>
  bubbles.value.length
    ? `共 ${bubbles.value.length} 位家人陪宝宝长大`
    : '家人会一起陪宝宝长大',
)

function open() {
  visible.value = true
}

function close() {
  visible.value = false
}

defineExpose({ open, close })
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
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.75);
}

.panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: 0 var(--space-lg);
  box-sizing: border-box;
}

.panel-title {
  font-size: 34rpx;
  font-weight: 600;
  color: #ffffff;
}

.panel-sub {
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.65);
}

.stage {
  position: relative;
  width: 640rpx;
  height: 640rpx;
  margin-top: var(--space-md);
}

.baby-avatar {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 200rpx;
  height: 200rpx;
  overflow: hidden;
  box-sizing: border-box;
  background-color: var(--color-primary-soft);
  border: 6rpx solid #ffffff;
  border-radius: 50%;
  box-shadow: 0 10rpx 40rpx rgba(0, 0, 0, 0.35);
  transform: translate(-50%, -50%);
}

.baby-avatar-img {
  width: 100%;
  height: 100%;
}

.baby-avatar-text {
  font-size: 80rpx;
  color: var(--color-primary);
}

.orbit {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  animation: orbit-spin 20s linear infinite;
}

.bubble-wrap {
  position: absolute;
}

.bubble {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  background-color: var(--color-bg-card);
  border: 4rpx solid rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  box-shadow: 0 6rpx 20rpx rgba(0, 0, 0, 0.3);
  animation: orbit-spin-rev 20s linear infinite;
}

.bubble-avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
}

/* 名字挂在圆圈外侧下方，靠气泡的反向旋转保持正立 */
.bubble-name {
  position: absolute;
  top: 100%;
  left: 50%;
  max-width: 200rpx;
  margin-top: 6rpx;
  overflow: hidden;
  font-size: 22rpx;
  font-weight: 600;
  line-height: 1.3;
  color: #ffffff;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.65);
  transform: translateX(-50%);
}

.bubble-name--sm {
  font-size: 20rpx;
}

.hint {
  margin-top: var(--space-md);
  padding: 0 var(--space-lg);
  font-size: 24rpx;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.75);
  text-align: center;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 80rpx;
  padding: 0 var(--space-xl);
  margin-top: var(--space-lg);
  border: 2rpx solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-pill);
}

.close-text {
  font-size: 28rpx;
  color: #ffffff;
}

@keyframes orbit-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes orbit-spin-rev {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(-360deg);
  }
}
</style>
