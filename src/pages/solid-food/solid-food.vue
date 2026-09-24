<template>
  <view class="page">
    <!-- 顶部说明：告诉家长「为什么是这些」，并按宝宝月龄自动选档 -->
    <view class="app-card intro">
      <text class="intro-title">辅食资料库</text>
      <text class="intro-text">{{ introText }}</text>
      <text class="intro-note">
        只讲适宜月龄、食材和做法，不给克数与营养剂量。日常照护参考用，首次添加辅食、过敏体质或生长发育异常，请咨询儿保医生。
      </text>
    </view>

    <!-- 月龄筛选：换成「全部月龄」时会看到所有档，方便提前看下一阶段 -->
    <view class="filter">
      <text class="filter-label">月龄</text>
      <view class="chips">
        <text
          class="chip"
          :class="{ 'chip--active': stage === '' }"
          @click="onStageClick('')"
        >
          全部
        </text>
        <text
          v-for="item in STAGES"
          :key="item.key"
          class="chip"
          :class="{ 'chip--active': stage === item.key }"
          @click="onStageClick(item.key)"
        >
          {{ item.label }}
        </text>
      </view>
    </view>

    <!-- 食材分类 -->
    <view class="filter">
      <text class="filter-label">食材</text>
      <view class="chips">
        <text
          class="chip"
          :class="{ 'chip--active': category === '' }"
          @click="category = ''"
        >
          全部
        </text>
        <text
          v-for="item in CATEGORIES"
          :key="item.key"
          class="chip"
          :class="{ 'chip--active': category === item.key }"
          @click="category = item.key"
        >
          {{ item.label }}
        </text>
      </view>
    </view>

    <!-- 选了具体月龄档时提示这一档的喂养要点 -->
    <view v-if="stageHint" class="hint-card">
      <text class="hint-text">{{ stageHint }}</text>
    </view>

    <view class="count">
      <text class="count-text">共 {{ list.length }} 道</text>
    </view>

    <view
      v-for="item in list"
      :key="item.id"
      class="app-card recipe"
      @click="openRecipe(item)"
    >
      <view class="recipe-body">
        <text class="recipe-name">{{ item.name }}</text>
        <text class="recipe-meta">
          {{ stageLabel(item.stage) }} · {{ categoryLabel(item.category) }} · {{ item.texture }}
        </text>
        <view v-if="item.tags.length" class="recipe-tags">
          <text v-for="tag in item.tags" :key="tag" class="tag">{{ tagLabel(tag) }}</text>
        </view>
      </view>
      <text class="arrow">›</text>
    </view>

    <view v-if="!list.length" class="empty">
      <text class="empty-title">这一组还没有食谱</text>
      <text class="empty-desc">换个食材分类，或者把月龄切到「全部」看看</text>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { ageParts } from '@/utils/age'
import { ensurePageAccess } from '@/utils/routeGuard'
import {
  CATEGORIES,
  STAGES,
  categoryLabel,
  filterRecipes,
  stageForMonths,
  stageLabel,
  tagLabel,
} from '@/services/solid-food'

const PAGE_PATH = 'pages/solid-food/solid-food'

const store = useAuthStore()

/** 当前月龄（拿不到生日时为 null） */
const totalMonths = computed(() => {
  const baby = store.baby
  if (!baby || !baby.birthday) return null
  const parts = ageParts(baby.birthday)
  return parts ? parts.totalMonths : null
})

/**
 * 默认档位在进页面时算一次就固定住，之后由用户自己点。
 * 不做成 computed：否则用户手动切到「全部」后，任何一次重渲染都会被自动档位覆盖回去。
 */
const stage = ref('')
const category = ref('')

const list = computed(() => filterRecipes(stage.value, category.value))

const stageHint = computed(() => {
  const matched = STAGES.find((item) => item.key === stage.value)
  return matched ? matched.hint : ''
})

const introText = computed(() => {
  const months = totalMonths.value
  if (months === null) {
    return '在「我的」里填上宝宝生日，就能自动按当前月龄推荐。现在可以先按月龄和食材自己翻。'
  }
  if (months < 6) {
    return `宝宝现在 ${months} 个月，还不到加辅食的时候，先以奶为主。下面是 6 月龄起可以吃的，提前看看也行。`
  }
  const key = stageForMonths(months)
  const label = stageLabel(key)
  return `宝宝现在 ${months} 个月，已默认筛出「${label}」适合的食谱。想提前看下一阶段，把上面的月龄切到更大一档。`
})

/** 按当前月龄预选档位（用户点过就不再动） */
let stageTouched = false
function applyDefaultStage() {
  if (stageTouched) return
  const months = totalMonths.value
  stage.value = months === null ? '' : stageForMonths(months)
}

function onStageClick(key) {
  stageTouched = true
  stage.value = key
}

function openRecipe(item) {
  uni.navigateTo({ url: `/pages/solid-food-detail/solid-food-detail?id=${item.id}` })
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  // 现在是 tab 页，微信会记住上次停在哪一页：冷启动直接落在本页时宝宝上下文还没就绪，
  // 月龄算不出来就会选错默认档位（还会显示成「没填生日」），所以先等 bootstrap
  await store.bootstrap()
  applyDefaultStage()
})
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: var(--space-lg);
  box-sizing: border-box;
}

.intro {
  margin-bottom: var(--space-lg);
}

.intro-title {
  display: block;
  font-size: 34rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.intro-text {
  display: block;
  margin-top: var(--space-sm);
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--color-text-sub);
}

.intro-note {
  display: block;
  margin-top: var(--space-sm);
  padding-top: var(--space-sm);
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
  border-top: 1rpx solid var(--color-border);
}

.filter {
  margin-bottom: var(--space-md);
}

.filter-label {
  display: block;
  margin-bottom: var(--space-sm);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

/* 直接换行排布，不用 scroll-view：横向滚动在真机上容易和页面的下拉手势打架 */
.chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.chip {
  padding: 10rpx 24rpx;
  margin: 0 var(--space-sm) var(--space-sm) 0;
  font-size: 25rpx;
  color: var(--color-text-sub);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-pill);
  border: 1rpx solid var(--color-border);
}

.chip--active {
  font-weight: 600;
  color: var(--color-primary-deep);
  background-color: var(--color-primary-soft);
  border-color: var(--color-primary-soft);
}

.hint-card {
  padding: var(--space-md);
  margin-bottom: var(--space-md);
  background-color: #f1ebff;
  border-radius: var(--radius-md);
}

.hint-text {
  font-size: 24rpx;
  line-height: 1.6;
  color: #5b46c4;
}

.count {
  margin-bottom: var(--space-md);
}

.count-text {
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.recipe {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: var(--space-md);
}

.recipe-body {
  flex: 1;
}

.recipe-name {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.recipe-meta {
  display: block;
  margin-top: var(--space-xs);
  font-size: 23rpx;
  color: var(--color-text-muted);
}

.recipe-tags {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: var(--space-sm);
}

.tag {
  padding: 4rpx 16rpx;
  margin: 0 var(--space-xs) var(--space-xs) 0;
  font-size: 21rpx;
  color: var(--color-primary-deep);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.arrow {
  margin-left: var(--space-sm);
  font-size: 34rpx;
  color: var(--color-text-muted);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 120rpx var(--space-lg);
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
