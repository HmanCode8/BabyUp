<template>
  <view class="page">
    <!-- 头部：右上「记录」 -->
    <view class="app-card head">
      <view class="head-text">
        <text class="head-title">儿保体检</text>
        <text class="head-sub">体检日期、身高体重、医生建议，家里人都能看到</text>
      </view>
      <view v-if="canWrite" class="head-action" @click="goCreate">
        <text class="head-action-text">记录</text>
      </view>
    </view>

    <!-- 空态 -->
    <view v-if="!items.length" class="app-card empty">
      <text class="empty-text">{{ emptyText }}</text>
    </view>

    <!-- 列表：按体检日期倒序 -->
    <view v-for="item in items" :key="item.id" class="app-card rec">
      <view class="rec-head">
        <text class="rec-date">{{ item.checkup_date }}</text>
        <text v-if="ageText(item)" class="rec-age">{{ ageText(item) }}</text>
        <text class="rec-recorder">{{ store.recorderSuffix(item) }}</text>
      </view>

      <view v-if="stats(item).length" class="rec-stats">
        <view v-for="stat in stats(item)" :key="stat.label" class="stat">
          <text class="stat-value">{{ stat.value }}</text>
          <text class="stat-label">{{ stat.label }}</text>
        </view>
      </view>

      <text v-if="item.hospital" class="rec-line">{{ item.hospital }}</text>
      <text v-if="item.development" class="rec-line">发育评估：{{ item.development }}</text>
      <text v-if="item.doctor_advice" class="rec-line">医生建议：{{ item.doctor_advice }}</text>

      <view v-if="nextTip(item)" class="rec-next">
        <text class="rec-next-text">{{ nextTip(item) }}</text>
      </view>

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
import { listCheckupRecords, removeCheckupRecord } from '@/services/checkup'
import { formatAge } from '@/utils/age'
import { todayString, diffDays } from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/checkup/checkup'

const store = useAuthStore()

const items = ref([])
const loading = ref(false)

/** viewer 只读：隐藏记录/编辑/删除（真正的拦截在服务端鉴权） */
const canWrite = computed(() => store.canWrite)

const emptyText = computed(() => {
  if (loading.value) return '加载中…'
  return canWrite.value ? '还没有体检记录，点右上「记录」添加一条' : '家人记录的体检情况会出现在这里'
})

/** 月龄：按「宝宝生日 → 体检日期」算，与体检表里存的 month_age 同一口径 */
function ageText(item) {
  const text = formatAge(store.baby && store.baby.birthday, item.checkup_date)
  if (text) return text
  return item.month_age == null ? '' : `${item.month_age}个月`
}

/** 身高/体重/头围/血红蛋白：只展示填了的项 */
function stats(item) {
  const list = []
  if (item.height_cm != null) list.push({ label: '身高', value: `${item.height_cm}cm` })
  if (item.weight_kg != null) list.push({ label: '体重', value: `${item.weight_kg}kg` })
  if (item.head_cm != null) list.push({ label: '头围', value: `${item.head_cm}cm` })
  if (item.hemoglobin != null) list.push({ label: '血红蛋白', value: `${item.hemoglobin}` })
  return list
}

/** 「距下次体检还有 N 天」：没填 next_date 就不显示 */
function nextTip(item) {
  if (!item.next_date) return ''
  const days = diffDays(todayString(), item.next_date)
  if (days > 0) return `距下次体检还有 ${days} 天（${item.next_date}）`
  if (days === 0) return `今天该体检了（${item.next_date}）`
  return `下次体检日期已过 ${-days} 天（${item.next_date}）`
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
    items.value = await listCheckupRecords(store.membership.family_id, store.baby.id)
    console.log('[Checkup] 列表已加载', items.value.length, '条')
  } catch (err) {
    console.error('[Checkup] 加载失败', err)
    uni.showToast({ title: err.message || '加载失败，请重试', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function goCreate() {
  uni.navigateTo({ url: '/pages/checkup-edit/checkup-edit' })
}

function goEdit(item) {
  uni.navigateTo({ url: `/pages/checkup-edit/checkup-edit?id=${item.id}` })
}

async function doRemove(item, deleteGrowth) {
  try {
    await removeCheckupRecord(item, { deleteGrowth })
    console.log('[Checkup] 已删除', item.id, '删除生长记录：', deleteGrowth)
    uni.showToast({ title: '已删除', icon: 'success' })
    await load()
  } catch (err) {
    console.error('[Checkup] 删除失败', err)
    uni.showToast({ title: err.message || '删除失败，请重试', icon: 'none' })
  }
}

/**
 * 删除：体检记录联动了一条生长记录时，先让用户选「生长记录留不留」（文档 4.4）。
 * 用 actionSheet 而不是两次 modal：选择本身就是「要不要一起删」，语义更直接。
 */
function onDelete(item) {
  uni.showModal({
    title: '删除体检记录',
    content: `删除 ${item.checkup_date} 的这条体检记录？照片也会一并删除。`,
    confirmText: '删除',
    confirmColor: '#F04438',
    success: (res) => {
      if (!res.confirm) return
      if (!item.growth_id) {
        doRemove(item, false)
        return
      }
      uni.showActionSheet({
        itemList: ['同时删除关联的生长记录', '保留生长记录'],
        success: (picked) => doRemove(item, picked.tapIndex === 0),
        fail: () => {},
      })
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
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.rec-age {
  flex: 1;
  margin-left: var(--space-sm);
  font-size: 24rpx;
  color: var(--color-text-sub);
}

.rec-recorder {
  font-size: 23rpx;
  color: var(--color-text-muted);
}

.rec-stats {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: var(--space-sm);
}

.stat {
  display: flex;
  flex-direction: column;
  min-width: 140rpx;
  margin-right: var(--space-md);
  margin-bottom: var(--space-xs);
}

.stat-value {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.stat-label {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--color-text-muted);
}

.rec-line {
  display: block;
  margin-top: var(--space-xs);
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--color-text-sub);
}

.rec-next {
  display: flex;
  flex-direction: row;
  margin-top: var(--space-sm);
}

.rec-next-text {
  padding: 6rpx 20rpx;
  font-size: 24rpx;
  color: var(--color-warning);
  background-color: rgba(247, 144, 9, 0.1);
  border-radius: var(--radius-pill);
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
