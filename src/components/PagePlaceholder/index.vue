<template>
  <view class="placeholder">
    <view class="icon" />
    <text class="title">{{ title }}</text>
    <text class="desc">{{ desc || '功能正在开发中…' }}</text>
  </view>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
  desc: { type: String, default: '' },
})
</script>

<style scoped>
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 70vh;
  padding: 0 var(--space-xl);
}

.icon {
  width: 120rpx;
  height: 120rpx;
  margin-bottom: var(--space-lg);
  border-radius: 50%;
  background-color: var(--color-primary-soft);
}

.title {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.desc {
  margin-top: var(--space-sm);
  font-size: 26rpx;
  color: var(--color-text-muted);
  text-align: center;
}
</style>
