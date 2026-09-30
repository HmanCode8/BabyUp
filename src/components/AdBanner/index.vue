<template>
  <!--
    广告位只存在于微信小程序：`<ad>` 是微信原生组件，条件编译把整段挡在其他平台外，
    H5 / 其他端不会因为这段代码报错。
  -->
  <!-- #ifdef MP-WEIXIN -->
  <!-- 没配广告位 id 就整块不渲染：「开关关掉」和「还没配」在页面上都是零痕迹 -->
  <view v-if="unitId" class="ad-wrap">
    <ad
      class="ad-banner"
      :unit-id="unitId"
      ad-type="banner"
      ad-theme="white"
      @error="onAdError"
    />
  </view>
  <!-- #endif -->
</template>

<script setup>
import { computed } from 'vue'
import { bannerUnitId } from '@/services/ads'

/** 广告位 id；开关关掉、没配置、非微信端都拿到空字符串 */
const unitId = computed(() => bannerUnitId())

/**
 * 广告拉不到是常态 —— 流量主还没开通、当天没库存、部分机型不投，
 * 都不是故障。所以只记一条日志：不弹提示、也不占位留白。
 */
function onAdError(err) {
  const detail = (err && err.detail) || err
  console.error('[Ad] Banner 加载失败', detail)
}
</script>

<style scoped>
/* 上一张工具卡自带 24rpx 下边距，这里不再加，保持与卡片间距一致 */
.ad-wrap {
  overflow: hidden;
  border-radius: var(--radius-md);
}
</style>
