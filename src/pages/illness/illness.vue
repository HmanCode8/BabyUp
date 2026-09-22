<template>
  <view class="page">
    <!-- 头部：右上「记录」 -->
    <view class="app-card head">
      <view class="head-text">
        <text class="head-title">生病记录</text>
        <text class="head-sub">症状、体温、用药，家里人都能看到</text>
      </view>
      <view v-if="canWrite" class="head-action" @click="goCreate">
        <text class="head-action-text">记录</text>
      </view>
    </view>

    <!-- 空态 -->
    <view v-if="!items.length" class="app-card empty">
      <text class="empty-text">{{ emptyText }}</text>
    </view>

    <!-- 列表：按发病时间倒序 -->
    <view v-for="item in items" :key="item.id" class="app-card rec">
      <view class="rec-head">
        <text class="rec-date">{{ formatDate(item.occurred_at) }}</text>
        <text v-if="item.temperature != null" class="rec-temp">{{ item.temperature }} ℃</text>
        <text class="rec-recorder">{{ store.recorderSuffix(item) }}</text>
      </view>

      <text class="rec-symptoms">{{ symptomText(item.symptoms) }}</text>

      <text v-if="medicineText(item)" class="rec-line">{{ medicineText(item) }}</text>
      <text v-if="visitText(item)" class="rec-line">{{ visitText(item) }}</text>
      <text v-if="item.allergy_note" class="rec-line">过敏/不良反应：{{ item.allergy_note }}</text>
      <text v-if="item.note" class="rec-line">{{ item.note }}</text>

      <view v-if="item.photoUrls.length" class="rec-photos">
        <image
          v-for="(url, index) in item.photoUrls"
          :key="url"
          class="rec-photo"
          :src="url"
          mode="aspectFill"
          @click="previewPhotos(item, index)"
        />
      </view>

      <view v-if="canWrite" class="rec-actions">
        <text class="rec-action" @click="goEdit(item)">编辑</text>
        <text class="rec-action rec-action--danger" @click="onDelete(item)">删除</text>
      </view>
    </view>

    <!-- 医疗免责：合规表达，不是功能 -->
    <text class="disclaimer">本记录仅用于家庭内部留存，不构成医疗建议，请遵医嘱</text>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { listIllnessRecords, removeIllnessRecord, symptomText } from '@/services/illness'
import { formatDate } from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/illness/illness'

const store = useAuthStore()

const items = ref([])
const loading = ref(false)

/** viewer 只读：隐藏记录/编辑/删除（真正的拦截在服务端鉴权） */
const canWrite = computed(() => store.canWrite)

const emptyText = computed(() => {
  if (loading.value) return '加载中…'
  return canWrite.value ? '还没有生病记录，点右上「记录」添加一条' : '家人记录的生病情况会出现在这里'
})

/** 用药摘要：只列药名，详情在编辑页看 */
function medicineText(item) {
  const names = (item.medicines || []).map((med) => med && med.name).filter(Boolean)
  if (!names.length) return ''
  return `用药：${names.join('、')}`
}

/** 就诊摘要：医院与诊断拼一行 */
function visitText(item) {
  const parts = []
  if (item.hospital) parts.push(item.hospital)
  if (item.diagnosis) parts.push(item.diagnosis)
  if (!parts.length) return ''
  return `就诊：${parts.join(' · ')}`
}

function previewPhotos(item, index) {
  const urls = item.photoUrls.filter(Boolean)
  if (!urls.length) return
  uni.previewImage({ urls, current: urls[index] })
}

async function load() {
  if (!store.membership || !store.baby) {
    items.value = []
    return
  }
  loading.value = true
  try {
    items.value = await listIllnessRecords(store.membership.family_id, store.baby.id)
    console.log('[Illness] 列表已加载', items.value.length, '条')
  } catch (err) {
    console.error('[Illness] 加载失败', err)
    uni.showToast({ title: err.message || '加载失败，请重试', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function goCreate() {
  uni.navigateTo({ url: '/pages/illness-edit/illness-edit' })
}

function goEdit(item) {
  uni.navigateTo({ url: `/pages/illness-edit/illness-edit?id=${item.id}` })
}

function onDelete(item) {
  uni.showModal({
    title: '删除生病记录',
    content: `删除 ${formatDate(item.occurred_at)} 的这条记录？照片也会一并删除。`,
    confirmText: '删除',
    confirmColor: '#F04438',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await removeIllnessRecord(item)
        console.log('[Illness] 已删除', item.id)
        uni.showToast({ title: '已删除', icon: 'success' })
        await load()
      } catch (err) {
        console.error('[Illness] 删除失败', err)
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

.rec {
  margin-bottom: var(--space-md);
}

.rec-head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
}

.rec-date {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.rec-temp {
  margin-right: var(--space-sm);
  padding: 4rpx 18rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: var(--color-danger);
  background-color: rgba(240, 68, 56, 0.1);
  border-radius: var(--radius-pill);
}

.rec-recorder {
  font-size: 23rpx;
  color: var(--color-text-muted);
}

.rec-symptoms {
  display: block;
  margin-top: var(--space-sm);
  font-size: 28rpx;
  color: var(--color-text-main);
}

.rec-line {
  display: block;
  margin-top: var(--space-xs);
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--color-text-sub);
}

.rec-photos {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: var(--space-sm);
}

.rec-photo {
  width: 150rpx;
  height: 150rpx;
  margin-right: var(--space-sm);
  margin-bottom: var(--space-xs);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.rec-actions {
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  margin-top: var(--space-sm);
}

.rec-action {
  padding-left: var(--space-md);
  font-size: 26rpx;
  color: var(--color-primary);
}

.rec-action--danger {
  color: var(--color-danger);
}

.disclaimer {
  display: block;
  margin-top: var(--space-sm);
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
  text-align: center;
}
</style>
