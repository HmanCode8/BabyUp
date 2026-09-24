<template>
  <view class="page">
    <view class="intro">
      <text class="intro-title">育儿工具</text>
      <text class="intro-text">查食谱、看趋势、设提醒都在这儿；随手记一笔还是去「记录」页。</text>
    </view>

    <view class="grid">
      <view v-for="item in tools" :key="item.key" class="card" @click="openTool(item)">
        <view class="card-icon" :style="{ backgroundColor: item.bg }">
          <text class="card-glyph" :style="{ color: item.color }">{{ item.glyph }}</text>
        </view>
        <text class="card-title">{{ item.title }}</text>
        <text class="card-desc">{{ item.desc }}</text>
        <text v-if="item.status" class="card-status" :class="{ 'card-status--warn': item.statusWarn }">
          {{ item.status }}
        </text>
      </view>
    </view>

    <AppTabBar />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { isAiChatAvailable } from '@/services/ai'
import { formatFeedInterval, resolveFeedInterval } from '@/services/feeding'
import { listVaccinations, summarizeVaccinations } from '@/services/vaccine'
import { ensurePageAccess } from '@/utils/routeGuard'
import { syncActiveTabFromRoute } from '@/utils/tabbar'
import AppTabBar from '@/components/AppTabBar/index.vue'

const PAGE_PATH = 'pages/tools/tools'

const store = useAuthStore()

/**
 * 工具清单。这里放的都是「查 / 看 / 设置」类的入口，不放「记一笔」
 * （记录那套在记录页的宫格里，两边定位不同，不用刻意去重）。
 * 颜色沿用记录页宫格的色板，同一个功能在两个页面里颜色一致。
 */
const ALL_TOOLS = [
  {
    key: 'solid',
    glyph: '辅',
    title: '辅食资料库',
    desc: '按月龄找食谱，含做法与注意点',
    bg: '#FFF7E0',
    color: '#C08A00',
    url: '/pages/solid-food/solid-food',
  },
  {
    key: 'ai',
    glyph: 'AI',
    title: 'AI 照护助手',
    desc: '结合宝宝的记录问答',
    bg: '#F1EBFF',
    color: '#7A5AF8',
    url: '/pages/ai-chat/ai-chat',
  },
  {
    key: 'growth',
    glyph: '量',
    title: '生长曲线',
    desc: '身高体重头围看趋势',
    bg: '#E8F1FF',
    color: '#3B7DD8',
    url: '/pages/growth/growth',
  },
  {
    key: 'report',
    glyph: '报',
    title: '成长报告',
    desc: '按月生成，可分享给家人',
    bg: '#E3F4F6',
    color: '#2C8C99',
    url: '/pages/report/report',
  },
  {
    key: 'daily',
    glyph: '结',
    title: '每日小结',
    desc: '每天一张卡，纵向对比',
    bg: '#FFE9E1',
    color: '#F4703F',
    url: '/pages/daily/daily',
  },
  {
    key: 'vaccine',
    glyph: '苗',
    title: '疫苗与提醒',
    desc: '一键排接种计划、到期提醒',
    bg: '#E6F7EE',
    color: '#12B76A',
    url: '/pages/vaccine/vaccine',
  },
  {
    key: 'feeding',
    glyph: '奶',
    title: '喂奶提醒',
    desc: '喂养间隔与微信推送设置',
    bg: '#FFF1E8',
    color: '#E86A33',
    url: '/pages/feeding-reminder/feeding-reminder',
  },
]

/** 疫苗卡片的实时状态（文字 + 是否需要标红），失败就留空、不让徽标挡住整个页面 */
const vaccineStatus = ref({ text: '', warn: false })

/** 喂奶卡的实时状态：纯计算，不用发请求 */
const feedStatus = computed(() => {
  const baby = store.baby
  if (!baby) return ''
  if (!baby.feed_remind_enabled) return '未开启提醒'
  return `每 ${formatFeedInterval(resolveFeedInterval(baby))}`
})

// AI 只有云开发后端才有（Supabase / H5 下没有），不可用时整项不显示，
// 让人点了才发现打不开比少一个入口更糟。
//
// 疫苗和喂奶这两张卡顺带显示实时状态：原来这两个数字摆在「我的」页，
// 现在「我的」只留账号与设置，数字搬到这里，信息一点没少。
const tools = computed(() =>
  ALL_TOOLS.filter((item) => item.key !== 'ai' || isAiChatAvailable()).map((item) => {
    if (item.key === 'vaccine') {
      return { ...item, status: vaccineStatus.value.text, statusWarn: vaccineStatus.value.warn }
    }
    if (item.key === 'feeding') return { ...item, status: feedStatus.value }
    return item
  }),
)

async function loadVaccineStatus() {
  if (!store.membership || !store.baby) {
    vaccineStatus.value = { text: '', warn: false }
    return
  }
  try {
    const list = await listVaccinations(store.membership.family_id, store.baby.id)
    const summary = summarizeVaccinations(list)
    vaccineStatus.value = summary.todo
      ? { text: `待接种 ${summary.todo} · 已逾期 ${summary.overdue}`, warn: summary.overdue > 0 }
      : { text: '暂无待办', warn: false }
  } catch (err) {
    console.error('[Tools] 加载疫苗待办失败', err)
    vaccineStatus.value = { text: '', warn: false }
  }
}

function openTool(item) {
  uni.navigateTo({ url: item.url })
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  // 同步自定义底栏的高亮（底栏组件见 components/AppTabBar）
  syncActiveTabFromRoute()
  await store.bootstrap()
  await loadVaccineStatus()
})
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: var(--space-lg);
  /* 给底部的自定义 tabBar 让位（横条 + 安全区 + 一点呼吸），否则滑到底最后一张卡被压住 */
  padding-bottom: calc(var(--tabbar-height) + constant(safe-area-inset-bottom) + var(--space-lg));
  padding-bottom: calc(var(--tabbar-height) + env(safe-area-inset-bottom) + var(--space-lg));
  box-sizing: border-box;
}

.intro {
  margin-bottom: var(--space-lg);
}

.intro-title {
  display: block;
  font-size: 36rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.intro-text {
  display: block;
  margin-top: var(--space-sm);
  font-size: 25rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
}

.grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
}

.card {
  display: flex;
  flex-direction: column;
  width: 48%;
  padding: var(--space-lg) var(--space-md);
  margin-bottom: var(--space-md);
  box-sizing: border-box;
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  border-radius: var(--radius-md);
}

.card-glyph {
  font-size: 30rpx;
  font-weight: 600;
}

.card-title {
  margin-top: var(--space-md);
  font-size: 29rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.card-desc {
  margin-top: var(--space-xs);
  font-size: 23rpx;
  line-height: 1.5;
  color: var(--color-text-muted);
}

/* 实时状态：从「我的」页搬来的那两个数字，要比说明文字显眼 */
.card-status {
  margin-top: var(--space-xs);
  font-size: 23rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.card-status--warn {
  color: var(--color-danger);
}
</style>
