<template>
  <view class="page">
    <view class="intro">
      <text class="intro-title">一句话记一笔</text>
      <text class="intro-text">
        像跟家人说话那样描述刚发生的事，AI 帮你填好类型、数量和时间 —— 你确认之后才会写进记录。
      </text>
    </view>

    <view v-if="!canWrite" class="app-card">
      <text class="readonly-text">你是这个家庭的只读成员，不能新增记录</text>
    </view>

    <template v-else>
      <view class="app-card">
        <textarea
          v-model="text"
          class="input"
          :maxlength="120"
          auto-height
          :disabled="parsing"
          placeholder="例如：刚喂了 120 毫升配方奶，有点吐奶"
          placeholder-class="input-placeholder"
        />
        <view class="examples">
          <text v-for="item in EXAMPLES" :key="item" class="example" @click="useExample(item)">
            {{ item }}
          </text>
        </view>
      </view>

      <view class="primary" :class="{ 'primary--disabled': !canSubmit }" @click="onParse">
        <text class="primary-text">{{ parsing ? 'AI 正在理解…' : '让 AI 记下来' }}</text>
      </view>

      <!-- 语音录入：按住说话 → 松手自动识别并解析（需要「同声传译」插件，见 utils/voice.js） -->
      <template v-if="voiceReady">
        <view
          class="voice"
          :class="{ 'voice--active': recording }"
          @touchstart.stop.prevent="onVoiceStart"
          @touchend.stop="onVoiceEnd"
          @touchcancel.stop="onVoiceEnd"
        >
          <text class="voice-text">{{ recording ? '正在听…松开结束' : '按住说话' }}</text>
        </view>
        <text class="voice-tip">松手后会自动识别，并把识别结果填进上面的输入框再解析。</text>
      </template>
      <!-- 插件没配好（或非微信端）时的兜底：键盘上的麦克风一样能说话录入 -->
      <text v-else class="voice-tip">想用语音？点上面的输入框，用键盘上的麦克风说话也一样。</text>

      <!-- 确认卡：AI 只负责把话说成字段，每个字段都能改，改完才写库 -->
      <view v-if="parsed" class="app-card result">
        <text class="result-title">确认一下，都能改</text>

        <view class="result-row">
          <text class="result-label">记什么</text>
          <text class="result-value">{{ kindLabel }}</text>
        </view>

        <view class="result-row">
          <text class="result-label">{{ parsed.kind === 'sleep' ? '睡醒' : '时间' }}</text>
          <view class="result-value edit-row">
            <picker mode="date" :value="atDate" @change="onAtDateChange">
              <text class="pick">{{ atDate }}</text>
            </picker>
            <picker mode="time" :value="atTime" @change="onAtTimeChange">
              <text class="pick">{{ atTime }}</text>
            </picker>
          </view>
        </view>

        <!-- 喂养：方式 / 奶量 / 时长 -->
        <template v-if="parsed.kind === 'feeding'">
          <view class="result-row">
            <text class="result-label">方式</text>
            <view class="result-value chips">
              <text
                v-for="item in FEED_TYPES"
                :key="item.key"
                class="chip"
                :class="{ 'chip--on': parsed.feeding.type === item.key }"
                @click="parsed.feeding.type = item.key"
              >
                {{ item.label }}
              </text>
            </view>
          </view>
          <view class="result-row">
            <text class="result-label">奶量</text>
            <view class="result-value edit-row">
              <input
                class="field"
                type="digit"
                :value="parsed.feeding.amountMl"
                placeholder="选填"
                placeholder-class="field-placeholder"
                @input="parsed.feeding.amountMl = $event.detail.value"
              />
              <text class="unit">ml</text>
            </view>
          </view>
          <view class="result-row">
            <text class="result-label">时长</text>
            <view class="result-value edit-row">
              <input
                class="field"
                type="digit"
                :value="parsed.feeding.durationMin"
                placeholder="选填"
                placeholder-class="field-placeholder"
                @input="parsed.feeding.durationMin = $event.detail.value"
              />
              <text class="unit">分钟</text>
            </view>
          </view>
        </template>

        <!-- 睡眠：时长可改，入睡时间由「睡醒 - 时长」推出来 -->
        <template v-else-if="parsed.kind === 'sleep'">
          <view class="result-row">
            <text class="result-label">时长</text>
            <view class="result-value edit-row">
              <input
                class="field"
                type="digit"
                :value="parsed.sleep.durationMin"
                placeholder-class="field-placeholder"
                @input="onSleepDurationInput"
              />
              <text class="unit">分钟</text>
            </view>
          </view>
          <view class="result-row">
            <text class="result-label">入睡</text>
            <text class="result-value">{{ formatTime(parsed.sleep.startedAt) }}</text>
          </view>
        </template>

        <!-- 便便：类型 / 性状 / 颜色（纯尿不记后两项） -->
        <template v-else-if="parsed.kind === 'diaper'">
          <view class="result-row">
            <text class="result-label">类型</text>
            <view class="result-value chips">
              <text
                v-for="item in DIAPER_TYPES"
                :key="item.key"
                class="chip"
                :class="{ 'chip--on': parsed.diaper.type === item.key }"
                @click="onDiaperTypeChange(item.key)"
              >
                {{ item.label }}
              </text>
            </view>
          </view>
          <view v-if="parsed.diaper.type !== 'pee'" class="result-row">
            <text class="result-label">性状</text>
            <view class="result-value chips">
              <text
                v-for="item in POOP_CHARACTERS"
                :key="item.key"
                class="chip"
                :class="{ 'chip--on': parsed.diaper.character === item.key }"
                @click="toggleDiaperField('character', item.key)"
              >
                {{ item.label }}
              </text>
            </view>
          </view>
          <view v-if="parsed.diaper.type !== 'pee'" class="result-row">
            <text class="result-label">颜色</text>
            <view class="result-value chips">
              <text
                v-for="item in POOP_COLORS"
                :key="item.key"
                class="chip"
                :class="{ 'chip--on': parsed.diaper.color === item.key }"
                @click="toggleDiaperField('color', item.key)"
              >
                {{ item.label }}
              </text>
            </view>
          </view>
        </template>

        <!-- 生长：三项都可留空，但至少填一项 -->
        <template v-else-if="parsed.kind === 'growth'">
          <view v-for="metric in GROWTH_METRICS" :key="metric.field" class="result-row">
            <text class="result-label">{{ metric.label }}</text>
            <view class="result-value edit-row">
              <input
                class="field"
                type="digit"
                :value="parsed.growth[metric.field]"
                placeholder="选填"
                placeholder-class="field-placeholder"
                @input="parsed.growth[metric.field] = $event.detail.value"
              />
              <text class="unit">{{ metric.unit }}</text>
            </view>
          </view>
        </template>

        <!-- 生病：症状多选 + 体温 -->
        <template v-else-if="parsed.kind === 'illness'">
          <view class="result-row">
            <text class="result-label">症状</text>
            <view class="result-value chips">
              <text
                v-for="item in ILLNESS_SYMPTOMS"
                :key="item.key"
                class="chip"
                :class="{ 'chip--on': parsed.illness.symptoms.indexOf(item.key) >= 0 }"
                @click="toggleSymptom(item.key)"
              >
                {{ item.label }}
              </text>
            </view>
          </view>
          <view class="result-row">
            <text class="result-label">体温</text>
            <view class="result-value edit-row">
              <input
                class="field"
                type="digit"
                :value="parsed.illness.temperature"
                placeholder="选填，如 38.5"
                placeholder-class="field-placeholder"
                @input="parsed.illness.temperature = $event.detail.value"
              />
              <text class="unit">℃</text>
            </view>
          </view>
        </template>

        <!-- 里程碑：名字可改，改了就按自定义记 -->
        <template v-else>
          <view class="result-row">
            <text class="result-label">里程碑</text>
            <view class="result-value edit-row">
              <input
                class="field"
                :value="parsed.milestone.name"
                placeholder="写上宝宝的新本事"
                placeholder-class="field-placeholder"
                @input="onMilestoneNameInput"
              />
            </view>
          </view>
        </template>

        <view class="result-row result-row--last">
          <text class="result-label">备注</text>
          <view class="result-value edit-row">
            <input
              class="field"
              :value="parsed.note"
              placeholder="选填"
              placeholder-class="field-placeholder"
              @input="parsed.note = $event.detail.value"
            />
          </view>
        </view>

        <view class="actions">
          <view class="ghost" @click="reset">
            <text class="ghost-text">重新说</text>
          </view>
          <view class="primary primary--inline" :class="{ 'primary--disabled': saving }" @click="onConfirm">
            <text class="primary-text">{{ saving ? '记录中…' : '确认记录' }}</text>
          </view>
        </view>
      </view>

      <text v-if="errorText" class="error">{{ errorText }}</text>

      <text class="footnote">
        听不出来时可以点「重新说」换个说法，也可以返回上一页手动记录。AI 只会把解析结果填进记录，
        不会替你判断病情。
      </text>
    </template>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShareAppMessage, onShow } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { isAiChatAvailable, parseQuickRecord, assertQuickRecord } from '@/services/ai'
import { createFeeding, FEED_TYPES } from '@/services/feeding'
import { createSleep } from '@/services/sleep'
import { createDiaper, DIAPER_TYPES, POOP_CHARACTERS, POOP_COLORS } from '@/services/diaper'
import { createGrowthRecord, GROWTH_RANGES } from '@/services/growth'
import { createIllnessRecord, ILLNESS_SYMPTOMS } from '@/services/illness'
import { createMilestone, CUSTOM_KEY } from '@/services/milestone'
import { formatDate, formatTime, toIsoFromLocal } from '@/utils/date'
import { ensurePageAccess, redirectTo } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'
import { isVoiceSupported, startVoiceRecognize, stopVoiceRecognize } from '@/utils/voice'

const PAGE_PATH = 'pages/ai-quick-record/ai-quick-record'

const store = useAuthStore()

/** 示例句：点一下直接填进输入框，省得用户不知道能怎么说（覆盖六类记录） */
const EXAMPLES = [
  '刚喂了 120 毫升配方奶',
  '睡了 40 分钟',
  '半小时前拉了稀便，绿色的',
  '今天量了身高 74，体重 9.1 公斤',
  '有点发烧 38.5 度，还流鼻涕',
  '今天第一次会翻身了',
]

const text = ref('')
const parsing = ref(false)
const saving = ref(false)
const errorText = ref('')
/** 解析结果（原始结构），null 表示还没解析出东西 */
const parsed = ref(null)

const canWrite = computed(() => store.canWrite)
const canSubmit = computed(() => Boolean(text.value.trim()) && !parsing.value)

/** 语音录入是否可用：插件没配好（或非微信端）时隐藏麦克风，只留键盘语音的提示 */
const voiceReady = isVoiceSupported()
const recording = ref(false)

/**
 * 按住说话：开始识别。
 * 先手动把按钮置为「正在听」，让按下就有反馈；识别真正开始时插件还会回调 onStart。
 */
function onVoiceStart() {
  if (parsing.value || saving.value || recording.value) return
  errorText.value = ''
  parsed.value = null
  recording.value = true

  const started = startVoiceRecognize({
    // 实时中间结果直接铺进输入框，让人看得见它在听
    onPartial: (partial) => {
      if (partial) text.value = partial
    },
    // 松手后的最终结果：填进输入框，然后走和打字完全一样的那条解析链路
    onResult: (result) => {
      recording.value = false
      if (!result) {
        errorText.value = '没听清，再说一次，或者直接打字。'
        return
      }
      text.value = result
      onParse()
    },
    onError: () => {
      recording.value = false
      errorText.value = '语音识别失败了，请再试一次或直接打字。'
    },
  })

  if (!started) {
    recording.value = false
    errorText.value = '语音识别启动失败，请检查麦克风权限后重试。'
  }
}

/** 松开结束：识别结果在 onResult 回调里返回，这里只负责喊停 */
function onVoiceEnd() {
  if (!recording.value) return
  stopVoiceRecognize()
}

/**
 * 每种记录怎么入库：label 是确认卡标题，save() 负责写库。
 * 字段编辑各类型在模板里自己写（表单长得都不一样），这里只管「落库」这一件事。
 *
 * 用一张表而不是一长串 if/else —— 以后再加记录类型（比如体检），只要在这里补一项。
 */
const KIND_HANDLERS = {
  feeding: {
    label: '喂养',
    save: (item, base) =>
      createFeeding({
        ...base,
        feedType: item.feeding.type,
        amountMl: item.feeding.amountMl,
        durationMin: item.feeding.durationMin,
        recordTime: item.at,
        note: item.note,
      }),
  },
  sleep: {
    label: '睡眠',
    // 睡眠的时间点看「睡醒」那一刻，比看开始时间更符合家长的语感
    at: (item) => item.sleep.endedAt,
    save: (item, base) =>
      createSleep({
        ...base,
        startedAt: item.sleep.startedAt,
        endedAt: item.sleep.endedAt,
        note: item.note,
      }),
  },
  diaper: {
    label: '便便',
    save: (item, base) =>
      createDiaper({
        ...base,
        diaperType: item.diaper.type,
        character: item.diaper.character,
        color: item.diaper.color,
        recordTime: item.at,
        note: item.note,
      }),
  },
  growth: {
    label: '生长',
    save: (item, base) =>
      createGrowthRecord({
        ...base,
        recordDate: item.growth.date,
        heightCm: item.growth.heightCm,
        weightKg: item.growth.weightKg,
        headCm: item.growth.headCm,
        note: item.note,
      }),
  },
  illness: {
    label: '生病',
    save: (item, base) =>
      createIllnessRecord({
        ...base,
        occurredAt: item.at,
        symptoms: item.illness.symptoms,
        temperature: item.illness.temperature,
        note: item.note,
      }),
  },
  milestone: {
    label: '里程碑',
    save: (item, base) =>
      createMilestone({
        ...base,
        milestoneKey: item.milestone.key,
        name: item.milestone.name,
        achievedDate: item.milestone.date,
        note: item.note,
      }),
  },
}

/** 确认卡标题 */
const kindLabel = computed(() => {
  const handler = parsed.value ? KIND_HANDLERS[parsed.value.kind] : null
  return handler ? handler.label : ''
})

/** 生长三项的编辑配置：中文名与单位都从 GROWTH_RANGES 取，避免两处写岔 */
const GROWTH_METRICS = [
  { field: 'heightCm', unit: 'cm' },
  { field: 'weightKg', unit: 'kg' },
  { field: 'headCm', unit: 'cm' },
].map((item) => ({ ...item, label: GROWTH_RANGES[item.field].label }))

/** 确认卡「时间」那一行对应的 ISO（睡眠看睡醒时刻，其余看记录时刻） */
function readPrimaryIso() {
  const item = parsed.value
  if (!item) return ''
  return item.kind === 'sleep' ? item.sleep.endedAt : item.at
}

/** 修改确认卡上的时间（各类型统一入口） */
function writePrimaryIso(iso) {
  const item = parsed.value
  if (!item) return
  if (item.kind === 'sleep') {
    item.sleep.endedAt = iso
    syncSleepStart()
    return
  }
  item.at = iso
  // 生长与里程碑在库里只存日期，跟着时间一起改，免得两者对不上
  if (item.kind === 'growth') item.growth.date = formatDate(iso)
  if (item.kind === 'milestone') item.milestone.date = formatDate(iso)
}

/** 睡眠的入睡时间由「睡醒 - 时长」推出来，改任一项都要重算 */
function syncSleepStart() {
  const sleep = parsed.value.sleep
  const minutes = Number(sleep.durationMin) || 0
  sleep.startedAt = new Date(new Date(sleep.endedAt).getTime() - minutes * 60000).toISOString()
}

const atDate = computed({
  get: () => formatDate(readPrimaryIso()),
  set: (value) => writePrimaryIso(toIsoFromLocal(value, formatTime(readPrimaryIso()))),
})

const atTime = computed({
  get: () => formatTime(readPrimaryIso()),
  set: (value) => writePrimaryIso(toIsoFromLocal(formatDate(readPrimaryIso()), value)),
})

function onAtDateChange(event) {
  atDate.value = event.detail.value
}

function onAtTimeChange(event) {
  atTime.value = event.detail.value
}

function onSleepDurationInput(event) {
  parsed.value.sleep.durationMin = event.detail.value
  syncSleepStart()
}

/** 切成纯尿时把性状与颜色清掉，与 services/diaper.js 的归一化口径一致 */
function onDiaperTypeChange(key) {
  const diaper = parsed.value.diaper
  diaper.type = key
  if (key === 'pee') {
    diaper.character = null
    diaper.color = null
  }
}

/** 性状/颜色是单选，再点一下取消 */
function toggleDiaperField(field, key) {
  const diaper = parsed.value.diaper
  diaper[field] = diaper[field] === key ? null : key
}

/** 症状多选 */
function toggleSymptom(key) {
  const list = parsed.value.illness.symptoms
  const index = list.indexOf(key)
  if (index >= 0) list.splice(index, 1)
  else list.push(key)
}

/** 手动改过里程碑名字就不再算那项预置里程碑，否则列表里会被预置名盖回去 */
function onMilestoneNameInput(event) {
  parsed.value.milestone.name = event.detail.value
  parsed.value.milestone.key = CUSTOM_KEY
}

function useExample(value) {
  text.value = value
  parsed.value = null
  errorText.value = ''
}

function reset() {
  parsed.value = null
  errorText.value = ''
}

async function onParse() {
  if (!canSubmit.value) return
  errorText.value = ''
  parsed.value = null
  parsing.value = true
  try {
    const result = await parseQuickRecord({ text: text.value })
    if (!result) {
      errorText.value = '没听清这句，换个说法再试，或者返回手动记一笔。'
      return
    }
    parsed.value = result
  } catch (err) {
    console.error('[QuickRecord] 解析失败', err)
    errorText.value = err.message || 'AI 暂时不可用，请稍后重试'
  } finally {
    parsing.value = false
  }
}

async function onConfirm() {
  if (saving.value || !parsed.value) return
  const baby = store.baby
  if (!baby || !store.membership) {
    errorText.value = '还没有宝宝档案'
    return
  }

  errorText.value = ''
  saving.value = true
  const result = parsed.value
  const handler = KIND_HANDLERS[result.kind]
  if (!handler) {
    saving.value = false
    errorText.value = '这条记录暂时不支持，请手动记录'
    return
  }
  try {
    // 用户可能在确认卡上改过数值，写库前再校验一次（顺便把输入框里的字符串转成数字）
    assertQuickRecord(result)
    await handler.save(result, { familyId: store.membership.family_id, babyId: baby.id })
    console.log('[QuickRecord] 已记录', result.kind)
    uni.showToast({ title: '已记录', icon: 'success' })
    // 回上一页（记录页），它的 onShow 会重新拉一次小结
    setTimeout(goBack, 700)
  } catch (err) {
    console.error('[QuickRecord] 写入失败', err)
    errorText.value = err.message || '记录失败，请重试'
  } finally {
    saving.value = false
  }
}

function goBack() {
  if (getCurrentPages().length > 1) uni.navigateBack()
  else redirectTo('/pages/record/record')
}

onShow(() => {
  ensurePageAccess(PAGE_PATH)
  // 直接分享/扫码进来时 AI 不可用（非微信端或 Supabase 后端），退回记录页
  if (!isAiChatAvailable()) {
    uni.showToast({ title: '当前版本不支持 AI', icon: 'none' })
    setTimeout(goBack, 800)
  }
})

onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  padding: var(--space-lg);
  box-sizing: border-box;
}

.intro {
  margin-bottom: var(--space-lg);
}

.intro-title {
  font-size: 36rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.intro-text {
  display: block;
  margin-top: var(--space-xs);
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
}

.app-card {
  margin-bottom: var(--space-md);
}

.readonly-text {
  font-size: 27rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
}

.input {
  width: 100%;
  min-height: 150rpx;
  padding: var(--space-md);
  font-size: 30rpx;
  line-height: 1.6;
  color: var(--color-text-main);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
  box-sizing: border-box;
}

.input-placeholder {
  color: var(--color-text-muted);
}

.examples {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: var(--space-sm);
}

.example {
  margin: 0 var(--space-sm) var(--space-sm) 0;
  padding: 8rpx 20rpx;
  font-size: 24rpx;
  color: var(--color-primary-deep);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.primary {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.primary--inline {
  flex: 1;
  height: 84rpx;
}

.primary--disabled {
  opacity: 0.5;
}

/* 按住说话：整条浅底按钮，按下时翻成主色，手感像对讲机 */
.voice {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  margin-top: var(--space-md);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.voice--active {
  background-color: var(--color-primary);
}

.voice-text {
  font-size: 31rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
}

.voice--active .voice-text {
  color: #ffffff;
}

.voice-tip {
  display: block;
  margin-top: var(--space-sm);
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
}

.primary-text {
  font-size: 31rpx;
  font-weight: 600;
  color: #ffffff;
}

.result-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.result-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  padding: var(--space-sm) 0;
  border-bottom: 1rpx solid var(--color-border);
}

.result-label {
  width: 140rpx;
  font-size: 27rpx;
  color: var(--color-text-muted);
}

.result-value {
  flex: 1;
  font-size: 28rpx;
  color: var(--color-text-main);
}

.result-row--last {
  border-bottom: none;
}

/* 可编辑的一行：日期/时间选择、输入框 + 单位并排 */
.edit-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.pick {
  margin-right: var(--space-md);
  padding: 4rpx 16rpx;
  font-size: 28rpx;
  color: var(--color-primary-deep);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-sm);
}

.field {
  flex: 1;
  min-width: 120rpx;
  font-size: 28rpx;
  color: var(--color-text-main);
}

.field-placeholder {
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.unit {
  margin-left: var(--space-xs);
  font-size: 26rpx;
  color: var(--color-text-muted);
}

/* 枚举选择：喂养方式、便便性状/颜色、症状都用它，点一下切换选中 */
.chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.chip {
  margin: 0 var(--space-xs) var(--space-xs) 0;
  padding: 6rpx 20rpx;
  font-size: 25rpx;
  color: var(--color-text-sub);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.chip--on {
  color: #ffffff;
  background-color: var(--color-primary);
}

.actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-top: var(--space-md);
}

.ghost {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 200rpx;
  height: 84rpx;
  margin-right: var(--space-md);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.ghost-text {
  font-size: 29rpx;
  color: var(--color-primary-deep);
}

.error {
  display: block;
  margin-top: var(--space-sm);
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--color-danger);
}

.footnote {
  display: block;
  margin-top: var(--space-md);
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--color-text-muted);
}
</style>
