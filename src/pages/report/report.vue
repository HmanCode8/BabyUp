<template>
  <view class="page">
    <!-- 维度切换 + 周期选择 + 生成 -->
    <view class="app-card">
      <view class="range">
        <view
          v-for="item in RANGES"
          :key="item.key"
          class="range-item"
          :class="{ 'range-item--active': range === item.key }"
          @click="onRangeChange(item.key)"
        >
          <text class="range-text">{{ item.label }}</text>
        </view>
      </view>

      <text class="card-label">{{ isYear ? '选择年份' : '选择月份' }}</text>
      <picker
        mode="date"
        :fields="isYear ? 'year' : 'month'"
        :value="period"
        :end="maxPeriod"
        @change="onPeriodChange"
      >
        <view class="field">
          <text class="field-value">{{ periodLabel }}</text>
          <text class="arrow">›</text>
        </view>
      </picker>
      <text class="field-tip">
        {{ isYear ? '默认本年；生成后保存到相册即可分享' : '默认上月；可选任意历史月份，生成后保存到相册即可分享' }}
      </text>

      <view class="primary" :class="{ 'primary--disabled': loading }" @click="onGenerate">
        <text class="primary-text">{{ loading ? '生成中…' : report ? '重新生成' : '生成报告' }}</text>
      </view>
      <text v-if="errorText" class="error">{{ errorText }}</text>
    </view>

    <!-- 空态：该周期内没有任何记录 -->
    <view v-if="report && !report.hasAny" class="app-card empty">
      <text class="empty-text">{{ report.periodText }}暂无记录</text>
      <text class="empty-tip">{{ isYear ? '换一个有记录的年份试试' : '换一个有记录的月份试试' }}</text>
    </view>

    <!-- 报告图（canvas 即预览，导出后保存到相册） -->
    <view v-if="report && report.hasAny" class="preview">
      <canvas
        id="reportCanvas"
        canvas-id="reportCanvas"
        class="canvas"
        :style="{ width: CANVAS_WIDTH + 'px', height: canvasHeight + 'px' }"
      />
      <view class="actions">
        <!-- #ifdef MP-WEIXIN -->
        <view class="btn btn--primary" :class="{ 'btn--disabled': saving }" @click="onSave">
          <text class="btn-text">{{ saving ? '保存中…' : '保存到相册' }}</text>
        </view>
        <!-- #endif -->
        <!-- #ifndef MP-WEIXIN -->
        <text class="save-tip">在微信小程序里可一键保存到相册</text>
        <!-- #endif -->
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, ref } from 'vue'
import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { buildMonthlyReport, buildYearlyReport, reportTextLines } from '@/services/report'
import {
  previousMonthString,
  currentMonthString,
  monthLabel,
  todayString,
} from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { ensurePrivacyAuthorized } from '@/utils/privacy'
import { defaultShare } from '@/utils/share'
import { track } from '@/utils/tracker'

const PAGE_PATH = 'pages/report/report'

/** 报告维度：月度（二期既有）/ 年度（三期 P0-5） */
const RANGES = [
  { key: 'month', label: '月度报告' },
  { key: 'year', label: '年度报告' },
]

/** 分享图逻辑尺寸（导出时按 2 倍放大，保证文字清晰）；高度在年度报告里按内容撑开 */
const CANVAS_WIDTH = 375
const CANVAS_HEIGHT = 790
const CANVAS_ID = 'reportCanvas'
const EXPORT_SCALE = 2

/* 版面常量：各区块位置由 buildLayout() 统一算，这里只放尺寸与间距 */
const HEADER_HEIGHT = 100
const PHOTO_CELL = 90
const PHOTO_GAP = 6
const PHOTO_COLS = 3
const PHOTO_START_Y = 112
const CARD = { x: 24, y: 406, w: 327, radius: 14 }
const DATA_LINE_START_Y = 476
const DATA_LINE_STEP = 22
const DATA_LINE_MAX = 6
const MILESTONE_LINE_STEP = 22
/** 月度报告固定预留 3 条里程碑位置（超出不画，保证图面高度不变） */
const MILESTONE_LINE_MAX = 3

const instance = getCurrentInstance()
const store = useAuthStore()

const range = ref('month')
const period = ref(previousMonthString())
const loading = ref(false)
const saving = ref(false)
const errorText = ref('')
const report = ref(null)
const canvasHeight = ref(CANVAS_HEIGHT)

const isYear = computed(() => range.value === 'year')
const periodLabel = computed(() =>
  isYear.value ? `${period.value}年` : monthLabel(period.value),
)
/** 可选上限：月度到今天所在月份，年度到今年 */
const maxPeriod = computed(() =>
  isYear.value ? todayString().slice(0, 4) : currentMonthString(),
)

const babyName = computed(() => (store.baby ? store.baby.name : '宝宝'))

/** 切换维度：口径完全变了，周期回到「上一个完整周期」并清掉旧图，避免误保存 */
function onRangeChange(next) {
  if (range.value === next) return
  range.value = next
  period.value = next === 'year' ? todayString().slice(0, 4) : previousMonthString()
  report.value = null
  errorText.value = ''
  canvasHeight.value = CANVAS_HEIGHT
}

function onPeriodChange(event) {
  period.value = event.detail.value
  // 换周期后旧图会过期，先清掉避免误保存
  report.value = null
  errorText.value = ''
}

async function onGenerate() {
  if (loading.value) return
  if (!store.membership || !store.baby) {
    errorText.value = '还没有家庭或宝宝档案'
    return
  }
  loading.value = true
  errorText.value = ''
  try {
    const base = { familyId: store.membership.family_id, babyId: store.baby.id }
    const result = isYear.value
      ? await buildYearlyReport({ ...base, year: period.value, birthday: store.baby.birthday })
      : await buildMonthlyReport({ ...base, month: period.value })
    report.value = result
    console.log('[Report] 已聚合', result.periodLabel, {
      照片: result.photos.length,
      里程碑: result.milestones.length,
      hasAny: result.hasAny,
    })
    if (!result.hasAny) return
    // 年度报告图面高度按数据行数/里程碑条数撑开，必须在绘制前同步到 canvas 样式上
    canvasHeight.value = buildLayout(result).height
    await nextTick()
    await draw(result)
    // 报告图绘制完成后上报（换周期只清旧图，不触发本函数）
    track('action', 'report_generate', { range: result.range, period: result.period })
  } catch (err) {
    console.error('[Report] 生成失败', err)
    report.value = null
    errorText.value = err.message || '生成失败，请重试'
  } finally {
    loading.value = false
  }
}

/**
 * 计算报告图的版面尺寸与各区块 Y 坐标。
 *
 * 月度沿用二期固定版面：无论数据多少都按 6 行数据 + 3 条里程碑预留，输出与旧版完全一致；
 * 年度按实际数据行数与里程碑条数把画布撑开，保证「列出全部里程碑」不会被裁掉。
 */
function buildLayout(current) {
  const yearReport = current.range === 'year'
  const lineCount = yearReport ? reportTextLines(current).length : DATA_LINE_MAX
  const milestoneLines = yearReport
    ? Math.max(1, current.milestones.length)
    : MILESTONE_LINE_MAX
  const dividerY = DATA_LINE_START_Y + lineCount * DATA_LINE_STEP
  const milestoneTitleY = dividerY + 26
  const milestoneStartY = dividerY + 48
  const cardBottom =
    milestoneStartY + (milestoneLines - 1) * MILESTONE_LINE_STEP + 16
  return {
    height: cardBottom + 74,
    cardHeight: cardBottom - CARD.y,
    dividerY,
    milestoneTitleY,
    milestoneStartY,
    brandY: cardBottom + 34,
    taglineY: cardBottom + 54,
  }
}

/** 圆角矩形路径（legacy canvas 没有 roundRect，手写四段弧） */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * 把远程图片换成本地可绘制路径。
 * canvas 的 drawImage 在部分平台不接受网络地址，getImageInfo 会顺带下载到本地；
 * 取不到时退回原地址（至少小程序端仍有机会画出来）。
 */
function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve('')
      return
    }
    if (typeof uni.getImageInfo !== 'function') {
      resolve(src)
      return
    }
    uni.getImageInfo({
      src,
      success: (res) => resolve(res.path || src),
      fail: () => resolve(src),
    })
  })
}

/** 里程碑超过一行宽度就截断，避免文字压出卡片 */
function truncate(text, max) {
  const value = String(text || '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

async function draw(current) {
  const box = buildLayout(current)
  const ctx = uni.createCanvasContext(CANVAS_ID, instance)

  // 背景 + 顶部标题区
  ctx.setFillStyle('#FFF6F1')
  ctx.fillRect(0, 0, CANVAS_WIDTH, box.height)
  ctx.setFillStyle('#FFE9E1')
  ctx.fillRect(0, 0, CANVAS_WIDTH, HEADER_HEIGHT)

  ctx.setTextAlign('center')
  ctx.setFillStyle('#1F2329')
  ctx.setFontSize(20)
  ctx.fillText(current.range === 'year' ? '年度报告' : '成长报告', CANVAS_WIDTH / 2, 52)
  ctx.setFillStyle('#8A9099')
  ctx.setFontSize(12)
  ctx.fillText(`${babyName.value} · ${current.periodLabel}`, CANVAS_WIDTH / 2, 76)

  // 照片九宫格（不足 9 张时只画有图的位置）
  const startX = Math.round(
    (CANVAS_WIDTH - (PHOTO_COLS * PHOTO_CELL + (PHOTO_COLS - 1) * PHOTO_GAP)) / 2,
  )
  if (current.photos.length) {
    const paths = await Promise.all(
      // 视频取封面图（canvas 画不了 mp4），没有封面就留白
      current.photos.map((item) => loadImage(item.cover_url || item.url)),
    )
    paths.forEach((path, index) => {
      const col = index % PHOTO_COLS
      const row = Math.floor(index / PHOTO_COLS)
      const x = startX + col * (PHOTO_CELL + PHOTO_GAP)
      const y = PHOTO_START_Y + row * (PHOTO_CELL + PHOTO_GAP)
      ctx.setFillStyle('#FFFFFF')
      ctx.fillRect(x, y, PHOTO_CELL, PHOTO_CELL)
      if (path) ctx.drawImage(path, x, y, PHOTO_CELL, PHOTO_CELL)
    })
  } else {
    ctx.setFillStyle('#FFFFFF')
    roundRect(ctx, CARD.x, PHOTO_START_Y, CARD.w, 282, CARD.radius)
    ctx.fill()
    ctx.setTextAlign('center')
    ctx.setFillStyle('#8A9099')
    ctx.setFontSize(13)
    ctx.fillText(`${current.periodText}暂无照片`, CANVAS_WIDTH / 2, PHOTO_START_Y + 145)
  }

  // 数据卡（高度随数据行数变化）
  ctx.setFillStyle('#FFFFFF')
  roundRect(ctx, CARD.x, CARD.y, CARD.w, box.cardHeight, CARD.radius)
  ctx.fill()

  ctx.setTextAlign('left')
  ctx.setFillStyle('#1F2329')
  ctx.setFontSize(15)
  ctx.fillText(`${current.periodText}数据`, CARD.x + 20, CARD.y + 40)

  ctx.setFillStyle('#5C6370')
  ctx.setFontSize(13)
  // 行数已由 reportTextLines 按维度各自截断，这里不再二次裁剪
  reportTextLines(current).forEach((line, index) => {
    ctx.fillText(line, CARD.x + 20, DATA_LINE_START_Y + index * DATA_LINE_STEP)
  })

  ctx.setFillStyle('#EEF0F3')
  ctx.fillRect(CARD.x + 20, box.dividerY, CARD.w - 40, 1)

  // 里程碑
  const total = current.milestoneTotal || current.milestones.length
  ctx.setFillStyle('#1F2329')
  ctx.setFontSize(13)
  ctx.fillText(
    current.milestones.length ? `里程碑（${total}）` : '里程碑',
    CARD.x + 20,
    box.milestoneTitleY,
  )

  if (current.milestones.length) {
    ctx.setFillStyle('#5C6370')
    ctx.setFontSize(12)
    current.milestones.forEach((item, index) => {
      const text = `· ${truncate(item.title, 12)}  ${item.date}`
      ctx.fillText(text, CARD.x + 20, box.milestoneStartY + index * MILESTONE_LINE_STEP)
    })
  } else {
    ctx.setFillStyle('#8A9099')
    ctx.setFontSize(12)
    ctx.fillText(`${current.periodText}暂无里程碑`, CARD.x + 20, box.milestoneStartY)
  }

  // 品牌落款
  ctx.setTextAlign('center')
  ctx.setFillStyle('#FF8F6B')
  ctx.setFontSize(15)
  ctx.fillText('初芽 BabyUp', CANVAS_WIDTH / 2, box.brandY)
  ctx.setFillStyle('#8A9099')
  ctx.setFontSize(11)
  ctx.fillText('记录宝宝的每一个第一次', CANVAS_WIDTH / 2, box.taglineY)

  await new Promise((resolve) => {
    ctx.draw(false, () => resolve())
  })
  console.log('[Report] 报告图绘制完成')
}

/** canvas 导出成临时图片文件 */
function canvasToFile() {
  return new Promise((resolve, reject) => {
    uni.canvasToTempFilePath(
      {
        canvasId: CANVAS_ID,
        // 年度报告的画布更高，导出区域要跟着走，否则底部会被裁掉
        width: CANVAS_WIDTH,
        height: canvasHeight.value,
        destWidth: CANVAS_WIDTH * EXPORT_SCALE,
        destHeight: canvasHeight.value * EXPORT_SCALE,
        success: (res) => resolve(res.tempFilePath),
        fail: (err) => {
          console.error('[Report] 导出图片失败', err)
          reject(new Error('图片生成失败，请重试'))
        },
      },
      instance,
    )
  })
}

/** 保存到相册；用户拒绝过授权时引导去设置页打开 */
async function saveToAlbum(filePath) {
  // 写入相册属于隐私接口，需先确认用户已同意隐私协议
  const allowed = await ensurePrivacyAuthorized()
  if (!allowed) throw new Error('需要同意隐私政策后才能保存到相册')

  return new Promise((resolve, reject) => {
    uni.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: (err) => {
        const message = (err && err.errMsg) || ''
        console.error('[Report] 保存相册失败', err)
        if (/auth|deny|denied|permission/i.test(message)) {
          uni.showModal({
            title: '需要相册权限',
            content: '保存图片需要「保存到相册」权限，去设置里打开后即可保存',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm && typeof uni.openSetting === 'function') uni.openSetting()
            },
          })
          reject(new Error('未获得相册权限'))
          return
        }
        reject(new Error('保存失败，请重试'))
      },
    })
  })
}

async function onSave() {
  if (saving.value || !report.value) return
  saving.value = true
  try {
    const filePath = await canvasToFile()
    await saveToAlbum(filePath)
    console.log('[Report] 已保存到相册')
    uni.showToast({ title: '已保存到相册', icon: 'success' })
  } catch (err) {
    // 权限问题已经在 saveToAlbum 里用弹窗引导，这里只提示其它失败
    if (err && err.message && err.message !== '未获得相册权限') {
      uni.showToast({ title: err.message, icon: 'none' })
    }
  } finally {
    saving.value = false
  }
}

// 支持从外部带参进入：/pages/report/report?range=year[&period=2026]
onLoad((options) => {
  if (options && options.range === 'year') {
    range.value = 'year'
    period.value =
      options.period && /^\d{4}$/.test(options.period)
        ? options.period
        : todayString().slice(0, 4)
  }
})

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  await store.bootstrap()
})

// 补丁 Step 4：统一分享卡片（标题与落地页见 @/utils/share）
onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  padding: var(--space-lg);
  box-sizing: border-box;
}

.app-card {
  margin-bottom: var(--space-md);
}

/* 维度切换（月度 / 年度） */
.range {
  display: flex;
  flex-direction: row;
  padding: 6rpx;
  margin-bottom: var(--space-md);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.range-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64rpx;
  border-radius: var(--radius-pill);
}

.range-item--active {
  background-color: var(--color-primary);
}

.range-text {
  font-size: 26rpx;
  color: var(--color-text-sub);
}

.range-item--active .range-text {
  font-weight: 600;
  color: #ffffff;
}

.card-label {
  display: block;
  margin-bottom: var(--space-xs);
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.field {
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 96rpx;
  border-bottom: 1rpx solid var(--color-border);
}

.field-value {
  flex: 1;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.arrow {
  font-size: 36rpx;
  color: var(--color-text-muted);
}

.field-tip {
  display: block;
  margin-top: var(--space-xs);
  font-size: 23rpx;
  color: var(--color-text-muted);
}

.primary {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  margin-top: var(--space-md);
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.primary--disabled {
  opacity: 0.6;
}

.primary-text {
  font-size: 30rpx;
  font-weight: 600;
  color: #ffffff;
}

.error {
  display: block;
  margin-top: var(--space-sm);
  font-size: 26rpx;
  color: var(--color-danger);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 220rpx;
}

.empty-text {
  font-size: 30rpx;
  color: var(--color-text-sub);
}

.empty-tip {
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

/* 报告图预览：canvas 固定 375x790 逻辑像素，窄屏时横向可滚，避免被压扁 */
.preview {
  margin-bottom: var(--space-md);
  overflow-x: auto;
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  padding: var(--space-md);
}

.canvas {
  display: block;
}

.actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: var(--space-md);
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 88rpx;
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.btn--disabled {
  opacity: 0.6;
}

.btn-text {
  font-size: 30rpx;
  font-weight: 600;
  color: #ffffff;
}

.save-tip {
  font-size: 24rpx;
  color: var(--color-text-muted);
}
</style>
