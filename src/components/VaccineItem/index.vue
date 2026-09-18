<template>
  <view class="item">
    <view class="item-head">
      <text class="item-name">{{ title }}</text>
      <text v-if="!readonly" class="item-edit" @click="emit('edit', record)">编辑</text>
      <view class="badge" :class="'badge--' + record.status">
        <text class="badge-text">{{ statusLabel }}</text>
      </view>
    </view>

    <text class="item-sub">{{ subText }}</text>

    <view v-if="canMark && !readonly" class="item-action" @click="emit('mark', record)">
      <text class="item-action-text">标记已接种</text>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { VACCINE_STATUS_LABEL } from '@/services/vaccine'

const props = defineProps({
  record: { type: Object, required: true },
  /** viewer 只读：隐藏编辑与标记接种 */
  readonly: { type: Boolean, default: false },
})

const emit = defineEmits(['mark', 'edit'])

const title = computed(() =>
  props.record.dose ? `${props.record.name} · ${props.record.dose}` : props.record.name,
)
const statusLabel = computed(() => VACCINE_STATUS_LABEL[props.record.status] || '待接种')
const canMark = computed(() => props.record.status !== 'vaccinated')
const subText = computed(() => {
  const { vaccinated_date: vaccinated, scheduled_date: scheduled, note } = props.record
  if (vaccinated) return `已于 ${vaccinated} 接种${note ? ` · ${note}` : ''}`
  if (scheduled) return `计划接种日期 ${scheduled}`
  return '未排接种日期'
})
</script>

<style scoped>
.item {
  padding: var(--space-md) 0;
  border-bottom: 1rpx solid var(--color-border);
}

.item-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.item-name {
  flex: 1;
  margin-right: var(--space-sm);
  font-size: 30rpx;
  color: var(--color-text-main);
}

.item-edit {
  padding-right: var(--space-sm);
  font-size: 24rpx;
  color: var(--color-primary);
}

.badge {
  padding: 4rpx 18rpx;
  border-radius: var(--radius-pill);
}

.badge--vaccinated {
  background-color: #e6f7ee;
}

.badge--overdue {
  background-color: #ffe6e4;
}

.badge--soon {
  background-color: #fff3e0;
}

.badge--pending {
  background-color: var(--color-bg-page);
}

.badge-text {
  font-size: 22rpx;
  color: var(--color-text-sub);
}

.badge--vaccinated .badge-text {
  color: #12b76a;
}

.badge--overdue .badge-text {
  color: #f04438;
}

.badge--soon .badge-text {
  color: #f79009;
}

.item-sub {
  display: block;
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.item-action {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64rpx;
  margin-top: var(--space-sm);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.item-action-text {
  font-size: 26rpx;
  color: var(--color-primary-deep);
}
</style>
