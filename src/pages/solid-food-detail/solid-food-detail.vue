<template>
  <view class="page">
    <template v-if="recipe">
      <view class="app-card head">
        <text class="name">{{ recipe.name }}</text>
        <text class="meta">
          {{ stageLabel(recipe.stage) }} · {{ categoryLabel(recipe.category) }} · {{ recipe.texture }}
        </text>
        <view v-if="recipe.tags.length" class="tags">
          <text v-for="tag in recipe.tags" :key="tag" class="tag">{{ tagLabel(tag) }}</text>
        </view>
      </view>

      <view class="app-card block">
        <text class="block-title">食材</text>
        <view class="ingredients">
          <view v-for="(item, index) in recipe.ingredients" :key="index" class="ingredient">
            <view class="dot" />
            <text class="ingredient-text">{{ item }}</text>
          </view>
        </view>
      </view>

      <view class="app-card block">
        <text class="block-title">做法</text>
        <view class="steps">
          <view v-for="(item, index) in recipe.steps" :key="index" class="step">
            <view class="step-index">
              <text class="step-index-text">{{ index + 1 }}</text>
            </view>
            <text class="step-text">{{ item }}</text>
          </view>
        </view>
      </view>

      <view v-if="recipe.tips.length" class="block block--tips">
        <text class="tips-title">注意点</text>
        <view class="tips">
          <view v-for="(item, index) in recipe.tips" :key="index" class="tip">
            <text class="tip-mark">·</text>
            <text class="tip-text">{{ item }}</text>
          </view>
        </view>
      </view>

      <text class="footnote">
        内容为日常照护参考。首次添加新食物请一次只加一种、观察 2~3 天；宝宝有过敏史或生长发育异常，请咨询儿保医生。
      </text>
    </template>

    <view v-else class="empty">
      <text class="empty-title">没找到这道食谱</text>
      <text class="empty-desc">可能链接失效了，返回列表再看一次</text>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { ensurePageAccess } from '@/utils/routeGuard'
import { categoryLabel, recipeById, stageLabel, tagLabel } from '@/services/solid-food'

const PAGE_PATH = 'pages/solid-food-detail/solid-food-detail'

const id = ref('')
const recipe = computed(() => recipeById(id.value))

onLoad((options) => {
  id.value = (options && options.id) || ''
})

onShow(() => {
  ensurePageAccess(PAGE_PATH)
})
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: var(--space-lg);
  box-sizing: border-box;
}

.head {
  margin-bottom: var(--space-md);
}

.name {
  display: block;
  font-size: 40rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.meta {
  display: block;
  margin-top: var(--space-sm);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.tags {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: var(--space-md);
}

.tag {
  padding: 6rpx 18rpx;
  margin: 0 var(--space-sm) var(--space-xs) 0;
  font-size: 22rpx;
  color: var(--color-primary-deep);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.block {
  margin-bottom: var(--space-md);
}

.block-title {
  display: block;
  margin-bottom: var(--space-md);
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.ingredients {
  display: flex;
  flex-direction: column;
}

.ingredient {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  margin-bottom: var(--space-sm);
}

.dot {
  width: 12rpx;
  height: 12rpx;
  margin: 14rpx var(--space-sm) 0 0;
  background-color: var(--color-primary);
  border-radius: 50%;
}

.ingredient-text {
  flex: 1;
  font-size: 27rpx;
  line-height: 1.6;
  color: var(--color-text-sub);
}

.steps {
  display: flex;
  flex-direction: column;
}

.step {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  margin-bottom: var(--space-md);
}

.step-index {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44rpx;
  height: 44rpx;
  margin: 4rpx var(--space-sm) 0 0;
  background-color: var(--color-primary-soft);
  border-radius: 50%;
}

.step-index-text {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.step-text {
  flex: 1;
  font-size: 28rpx;
  line-height: 1.7;
  color: var(--color-text-main);
}

/* 注意点里常是安全提示（防呛、必须熟透），单独用底色抬出来 */
.block--tips {
  padding: var(--space-lg);
  margin-bottom: var(--space-md);
  background-color: #fff7e0;
  border-radius: var(--radius-lg);
}

.tips-title {
  display: block;
  margin-bottom: var(--space-sm);
  font-size: 28rpx;
  font-weight: 600;
  color: #8a5b00;
}

.tips {
  display: flex;
  flex-direction: column;
}

.tip {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  margin-bottom: var(--space-xs);
}

.tip-mark {
  margin-right: var(--space-xs);
  font-size: 28rpx;
  line-height: 1.7;
  color: #8a5b00;
}

.tip-text {
  flex: 1;
  font-size: 26rpx;
  line-height: 1.7;
  color: #8a5b00;
}

.footnote {
  display: block;
  padding: 0 var(--space-sm) var(--space-xl);
  font-size: 22rpx;
  line-height: 1.7;
  color: var(--color-text-muted);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 160rpx var(--space-lg);
}

.empty-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.empty-desc {
  margin-top: var(--space-sm);
  font-size: 25rpx;
  color: var(--color-text-muted);
  text-align: center;
}
</style>
