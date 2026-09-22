<template>
  <view class="page">
    <!-- 时间线头部：右上「打卡」 -->
    <view class="app-card head">
      <view class="head-text">
        <text class="head-title">成长里程碑</text>
        <text class="head-sub">第一次笑、第一颗牙……都值得记住</text>
      </view>
      <view v-if="canWrite" class="head-action" @click="goCreate">
        <text class="head-action-text">打卡</text>
      </view>
    </view>

    <!-- 空态 -->
    <view v-if="!items.length" class="app-card empty">
      <text class="empty-text">{{ emptyText }}</text>
    </view>

    <!-- 时间线：按达成日期倒序 -->
    <view v-for="item in items" :key="item.id" class="node">
      <view class="node-rail">
        <view class="node-dot">
          <text class="node-dot-text">{{ milestoneGlyph(item) }}</text>
        </view>
        <view class="node-line" />
      </view>

      <view class="app-card node-body">
        <view class="node-head">
          <text class="node-title">{{ milestoneTitle(item) }}</text>
          <text class="node-date">{{ item.achieved_date }}{{ store.recorderSuffix(item) }}</text>
        </view>

        <image
          v-if="item.photoUrl"
          class="node-photo"
          :src="item.photoUrl"
          mode="aspectFill"
          @click="previewPhoto(item)"
        />
        <view v-else-if="item.photo_url" class="node-photo node-photo--failed">
          <text class="node-photo-failed-text">照片加载失败</text>
        </view>

        <text v-if="item.note" class="node-note">{{ item.note }}</text>

        <view v-if="canWrite" class="node-actions">
          <text class="node-action" @click="goEdit(item)">编辑</text>
          <text class="node-action node-action--danger" @click="onDelete(item)">删除</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import {
  listMilestones,
  removeMilestone,
  milestoneTitle,
  milestoneGlyph,
} from '@/services/milestone'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/milestone/milestone'

const store = useAuthStore()

const items = ref([])
const loading = ref(false)

/** viewer 只读：隐藏打卡/编辑/删除（真正的拦截靠 RLS） */
const canWrite = computed(() => store.canWrite)

const emptyText = computed(() => {
  if (loading.value) return '加载中…'
  return canWrite.value ? '还没有里程碑，点右上「打卡」记下第一个' : '家人记录的里程碑会出现在这里'
})

async function load() {
  if (!store.membership || !store.baby) {
    items.value = []
    return
  }
  loading.value = true
  try {
    items.value = await listMilestones(store.membership.family_id, store.baby.id)
    console.log('[Milestone] 时间线已加载', items.value.length, '条')
  } catch (err) {
    console.error('[Milestone] 加载失败', err)
    uni.showToast({ title: err.message || '加载失败，请重试', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function goCreate() {
  uni.navigateTo({ url: '/pages/milestone-edit/milestone-edit' })
}

function goEdit(item) {
  uni.navigateTo({ url: `/pages/milestone-edit/milestone-edit?id=${item.id}` })
}

function previewPhoto(item) {
  if (!item.photoUrl) return
  uni.previewImage({ urls: [item.photoUrl] })
}

function onDelete(item) {
  uni.showModal({
    title: '删除里程碑',
    content: `删除「${milestoneTitle(item)}」这条记录？照片也会一并删除。`,
    confirmText: '删除',
    confirmColor: '#F04438',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await removeMilestone(item)
        console.log('[Milestone] 已删除', item.id)
        uni.showToast({ title: '已删除', icon: 'success' })
        await load()
      } catch (err) {
        console.error('[Milestone] 删除失败', err)
        uni.showToast({ title: err.message || '删除失败，请重试', icon: 'none' })
      }
    },
  })
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  await store.bootstrap()
  await load()
})

// 补丁 Step 4：统一分享卡片（标题与落地页见 @/utils/share）
onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  padding: var(--space-lg);
  box-sizing: border-box;
}

.head {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: var(--space-md);
}

.head-text {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.head-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.head-sub {
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.head-action {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64rpx;
  padding: 0 32rpx;
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.head-action-text {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200rpx;
}

.empty-text {
  font-size: 26rpx;
  color: var(--color-text-muted);
}

/* 时间线 */
.node {
  display: flex;
  flex-direction: row;
}

.node-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 76rpx;
  padding-top: var(--space-lg);
}

.node-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  background-color: var(--color-primary-soft);
  border-radius: 50%;
}

.node-dot-text {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.node-line {
  flex: 1;
  width: 2rpx;
  min-height: 40rpx;
  background-color: var(--color-border);
}

.node-body {
  flex: 1;
  margin-bottom: var(--space-md);
}

.node-head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
}

.node-title {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.node-date {
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.node-photo {
  width: 100%;
  height: 360rpx;
  margin-top: var(--space-md);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.node-photo--failed {
  display: flex;
  align-items: center;
  justify-content: center;
}

.node-photo-failed-text {
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.node-note {
  display: block;
  margin-top: var(--space-sm);
  font-size: 27rpx;
  color: var(--color-text-sub);
}

.node-actions {
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  margin-top: var(--space-sm);
}

.node-action {
  padding-left: var(--space-md);
  font-size: 26rpx;
  color: var(--color-primary);
}

.node-action--danger {
  color: var(--color-danger);
}
</style>
