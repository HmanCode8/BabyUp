<template>
  <view class="page">
    <!-- 月份选择 + 生成 -->
    <view class="app-card">
      <text class="card-label">选择月份</text>
      <picker
        mode="date"
        fields="month"
        :value="month"
        :end="maxMonth"
        @change="onMonthChange"
      >
        <view class="field">
          <text class="field-value">{{ monthLabel(month) }}</text>
          <text class="arrow">›</text>
        </view>
      </picker>
      <text class="field-tip">默认上月；可选任意历史月份，生成后保存到相册即可分享</text>

      <view class="primary" :class="{ 'primary--disabled': loading }" @click="onGenerate">
        <text class="primary-text">{{ loading ? '生成中…' : report ? '重新生成' : '生成报告' }}</text>
      </view>
      <text v-if="errorText" class="error">{{ errorText }}</text>
    </view>

    <!-- 空态：本月没有任何记录 -->
    <view v-if="report && !report.hasAny" class="app-card empty">
      <text class="empty-text">本月暂无记录</text>
      <text class="empty-tip">换一个有记录的月份试试</text>
    </view>

    <!-- 报告图（canvas 即预览，导出后保存到相册） -->
    <view v-if="report && report.hasAny" class="preview">
      <canvas
        id="reportCanvas"
        canvas-id="reportCanvas"
        class="canvas"
        :style="{ width: CANVAS_WIDTH + 'px', height: CANVAS_HEIGHT + 'px' }"
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
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { buildMonthlyReport, reportTextLines } from '@/services/report'
import {
  previousMonthString,
  currentMonthString,
  monthLabel,
} from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { ensurePrivacyAuthorized } from '@/utils/privacy'
import { defaultShare } from '@/utils/share'
import { track } from '@/utils/tracker'

const PAGE_PATH = 'pages/report/report'

/** 分享图逻辑尺寸（导出时按 2 倍放大，保证文字清晰） */
const CANVAS_WIDTH = 375
const CANVAS_HEIGHT = 790
const CANVAS_ID = 'reportCanvas'
const EXPORT_SCALE = 2

/* 版面常量：图面高度固定，各区块位置写死，避免内容多少导致排版跳动 */
const HEADER_HEIGHT = 100
const PHOTO_CELL = 90
const PHOTO_GAP = 6
const PHOTO_COLS = 3
const PHOTO_START_Y = 112
const CARD = { x: 24, y: 406, w: 327, h: 310, radius: 14 }
const DATA_LINE_START_Y = 476
const DATA_LINE_STEP = 22
const DATA_LINE_MAX = 6
const DIVIDER_Y = 608
const MILESTONE_TITLE_Y = 634
const MILESTONE_LINE_START_Y = 656
const MILESTONE_LINE_STEP = 22
const BRAND_Y = 750
const TAGLINE_Y = 770

const instance = getCurrentInstance()
const store = useAuthStore()

const month = ref(previousMonthString())
const maxMonth = currentMonthString()
const loading = ref(false)
const saving = ref(false)
const errorText = ref('')
const report = ref(null)

const babyName = computed(() => (store.baby ? store.baby.name : '宝宝'))

function onMonthChange(event) {
  month.value = event.detail.value
  // 换月份后旧图会过期，先清掉避免误保存
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
    const result = await buildMonthlyReport({
      familyId: store.membership.family_id,
      babyId: store.baby.id,
      month: month.value,
    })
    report.value = result
    console.log('[Report] 已聚合', month.value, {
      照片: result.photos.length,
      喂养: result.feeding.total,
      睡眠分钟: result.sleep.totalMinutes,
      便便: result.diaper.total,
      里程碑: result.milestones.length,
    })
    if (!result.hasAny) return
    await nextTick()
    await draw(result)
    // 报告图绘制完成后上报（换月份只清旧图，不触发本函数）
    track('action', 'report_generate', { month: month.value })
  } catch (err) {
    console.error('[Report] 生成失败', err)
    report.value = null
    errorText.value = err.message || '生成失败，请重试'
  } finally {
    loading.value = false
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
  const ctx = uni.createCanvasContext(CANVAS_ID, instance)

  // 背景 + 顶部标题区
  ctx.setFillStyle('#FFF6F1')
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  ctx.setFillStyle('#FFE9E1')
  ctx.fillRect(0, 0, CANVAS_WIDTH, HEADER_HEIGHT)

  ctx.setTextAlign('center')
  ctx.setFillStyle('#1F2329')
  ctx.setFontSize(20)
  ctx.fillText('成长报告', CANVAS_WIDTH / 2, 52)
  ctx.setFillStyle('#8A9099')
  ctx.setFontSize(12)
  ctx.fillText(`${babyName.value} · ${current.monthLabel}`, CANVAS_WIDTH / 2, 76)

  // 照片九宫格（不足 9 张时只画有图的位置）
  const startX = Math.round(
    (CANVAS_WIDTH - (PHOTO_COLS * PHOTO_CELL + (PHOTO_COLS - 1) * PHOTO_GAP)) / 2,
  )
  if (current.photos.length) {
    const paths = await Promise.all(current.photos.map((item) => loadImage(item.url)))
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
    ctx.fillText('本月暂无照片', CANVAS_WIDTH / 2, PHOTO_START_Y + 145)
  }

  // 数据卡
  ctx.setFillStyle('#FFFFFF')
  roundRect(ctx, CARD.x, CARD.y, CARD.w, CARD.h, CARD.radius)
  ctx.fill()

  ctx.setTextAlign('left')
  ctx.setFillStyle('#1F2329')
  ctx.setFontSize(15)
  ctx.fillText('本月数据', CARD.x + 20, CARD.y + 40)

  ctx.setFillStyle('#5C6370')
  ctx.setFontSize(13)
  reportTextLines(current)
    .slice(0, DATA_LINE_MAX)
    .forEach((line, index) => {
      ctx.fillText(line, CARD.x + 20, DATA_LINE_START_Y + index * DATA_LINE_STEP)
    })

  ctx.setFillStyle('#EEF0F3')
  ctx.fillRect(CARD.x + 20, DIVIDER_Y, CARD.w - 40, 1)

  // 里程碑
  const total = current.milestoneTotal || current.milestones.length
  ctx.setFillStyle('#1F2329')
  ctx.setFontSize(13)
  ctx.fillText(
    current.milestones.length ? `里程碑（${total}）` : '里程碑',
    CARD.x + 20,
    MILESTONE_TITLE_Y,
  )

  if (current.milestones.length) {
    ctx.setFillStyle('#5C6370')
    ctx.setFontSize(12)
    current.milestones.forEach((item, index) => {
      const text = `· ${truncate(item.title, 12)}  ${item.date}`
      ctx.fillText(text, CARD.x + 20, MILESTONE_LINE_START_Y + index * MILESTONE_LINE_STEP)
    })
  } else {
    ctx.setFillStyle('#8A9099')
    ctx.setFontSize(12)
    ctx.fillText('本月暂无里程碑', CARD.x + 20, MILESTONE_LINE_START_Y)
  }

  // 品牌落款
  ctx.setTextAlign('center')
  ctx.setFillStyle('#FF8F6B')
  ctx.setFontSize(15)
  ctx.fillText('初芽 BabyUp', CANVAS_WIDTH / 2, BRAND_Y)
  ctx.setFillStyle('#8A9099')
  ctx.setFontSize(11)
  ctx.fillText('记录宝宝的每一个第一次', CANVAS_WIDTH / 2, TAGLINE_Y)

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
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        destWidth: CANVAS_WIDTH * EXPORT_SCALE,
        destHeight: CANVAS_HEIGHT * EXPORT_SCALE,
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
