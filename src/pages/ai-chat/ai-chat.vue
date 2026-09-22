<template>
  <view class="chat">
    <scroll-view class="list" scroll-y :scroll-top="scrollTop" :scroll-with-animation="false">
      <view class="list-inner">
        <!-- 后端不支持（Supabase / H5）或微信版本过低时的兜底 -->
        <view v-if="!available" class="notice">
          <text class="notice-title">AI 助手暂时不可用</text>
          <text class="notice-text">{{ unavailableReason }}</text>
        </view>

        <template v-else>
          <!-- 对话记录只在本机，给一个明确的清空入口 -->
          <view v-if="messages.length" class="toolbar">
            <text class="toolbar-hint">对话只保存在这台手机上</text>
            <text class="toolbar-clear" @click="onClear">清空对话</text>
          </view>

          <!-- 首次进入：欢迎语 + 快速提问 -->
          <view v-if="!messages.length" class="welcome">
            <text class="welcome-title">你好，我是照护助手</text>
            <text class="welcome-text">
              我可以结合{{ babyName ? `「${babyName}」` : '宝宝' }}最近的喂养、睡眠、便便记录回答问题。
            </text>
            <view class="chips">
              <view v-for="item in QUICK_QUESTIONS" :key="item" class="chip" @click="askQuick(item)">
                <text class="chip-text">{{ item }}</text>
              </view>
            </view>
          </view>

          <view v-for="item in messages" :key="item.key" class="msg" :class="`msg--${item.role}`">
            <view class="bubble" :class="`bubble--${item.role}`">
              <text v-if="item.content" class="bubble-text">{{ item.content }}</text>
              <text v-else class="bubble-text bubble-text--pending">正在思考…</text>
            </view>
          </view>
        </template>
      </view>
    </scroll-view>

    <!-- 输入区 -->
    <view v-if="available" class="composer">
      <textarea
        class="input"
        :value="input"
        :maxlength="QUESTION_MAX"
        :disabled="sending"
        auto-height
        placeholder="问点关于宝宝的事…"
        placeholder-class="input-placeholder"
        @input="onInput"
      />
      <view class="send" :class="{ 'send--disabled': !canSend }" @click="onSend">
        <text class="send-text">{{ sending ? '…' : '发送' }}</text>
      </view>
    </view>
    <text v-if="available" class="disclaimer">AI 建议仅供参考，不能替代医生诊断。</text>
  </view>
</template>

<script setup>
import { computed, onUnmounted, ref } from 'vue'
import { onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { askAssistant, isAiChatAvailable, loadChatHistory, saveChatHistory, clearChatHistory } from '@/services/ai'
import { capabilities } from '@/services/api'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pages/ai-chat/ai-chat'
/** 单次提问的长度上限（模型按 token 计费，过长的输入没必要） */
const QUESTION_MAX = 300
/** 流式刷新节流：每 100ms 落一次盘，避免每个 chunk 都触发渲染 */
const STREAM_FLUSH_MS = 100

const QUICK_QUESTIONS = ['今天喂了几次？', '宝宝最近睡得好吗？', '便便情况正常吗？']

const store = useAuthStore()

const available = ref(isAiChatAvailable())
/** { key, role: 'user' | 'assistant', content, streaming } */
const messages = ref([])
const input = ref('')
const sending = ref(false)
const scrollTop = ref(0)

const babyName = computed(() => (store.baby ? store.baby.name : ''))
const canSend = computed(() => !sending.value && input.value.trim().length > 0)
const unavailableReason = computed(() =>
  capabilities.aiChat
    ? '当前微信版本过低，请更新微信到最新版后再试。'
    : 'AI 助手只在微信小程序端（云开发后端）提供。',
)

// 本机对话的归属：换账号或换宝宝都要看各自那份
const ownerUserId = computed(() => store.userId)
const ownerBabyId = computed(() => store.currentBabyId)

let keySeq = 0

function pushMessage(role, content, streaming) {
  keySeq += 1
  messages.value.push({ key: `m${keySeq}`, role, content, streaming: Boolean(streaming) })
  return messages.value.length - 1
}

/** 已经读过的「账号:宝宝」，避免 onShow 反复覆盖内存里正在进行的对话 */
let loadedOwner = ''

function ownerTag() {
  const userId = ownerUserId.value
  const babyId = ownerBabyId.value
  return userId && babyId ? `${userId}:${babyId}` : ''
}

/** 进页面时把本机记录读回来（换宝宝 / 换账号时会换成对应那份） */
function restoreHistory() {
  // 正在回答时不要动 messages，否则会把流式气泡冲掉
  if (sending.value) return

  const tag = ownerTag()
  if (!tag || tag === loadedOwner) return
  loadedOwner = tag

  messages.value = []
  loadChatHistory(ownerUserId.value, ownerBabyId.value).forEach((item) => {
    pushMessage(item.role, item.content)
  })
  scrollToBottom()
}

/** 本轮回答结束后整段落盘（不逐条写，也不落空消息） */
function persistHistory() {
  if (!ownerTag()) return
  const list = messages.value
    .filter((item) => item.content)
    .map((item) => ({ role: item.role, content: item.content }))
  // 末尾还是提问，说明本轮没拿到任何回答（多为报错）：这条不落盘，免得下次进来只看到「问了没答」
  if (list.length && list[list.length - 1].role === 'user') list.pop()
  saveChatHistory(ownerUserId.value, ownerBabyId.value, list)
}

function onClear() {
  if (sending.value) return
  uni.showModal({
    title: '清空对话',
    content: '会删掉这台手机上保存的全部问答记录，删了不能恢复。',
    confirmText: '清空',
    success: (res) => {
      if (!res.confirm) return
      clearChatHistory(ownerUserId.value, ownerBabyId.value)
      messages.value = []
      scrollToBottom()
    },
  })
}

/**
 * 滚到底部。
 * scroll-top 只认「值发生变化」，流式期间同一个位置要反复滚动，
 * 所以用一个递增的序号让它每次都不同（超出内容高度会被自动夹到底部）。
 */
let scrollSeq = 0
function scrollToBottom() {
  scrollSeq += 1
  scrollTop.value = 100000 * scrollSeq
}

// 流式增量先攒在 buffer 里，定时器到点才写进 messages（节流）
let flushTimer = 0
let streamIndex = -1
let streamBuffer = ''

function flushStream() {
  flushTimer = 0
  if (streamIndex < 0) return
  const target = messages.value[streamIndex]
  if (target) target.content = streamBuffer
  scrollToBottom()
}

function handleDelta(delta) {
  streamBuffer += delta
  if (!flushTimer) flushTimer = setTimeout(flushStream, STREAM_FLUSH_MS)
}

function onInput(event) {
  input.value = event.detail.value
}

function askQuick(question) {
  if (sending.value) return
  input.value = question
  onSend()
}

async function onSend() {
  if (!canSend.value) return

  const question = input.value.trim()
  const familyId = store.membership ? store.membership.family_id : ''
  const babyId = store.currentBabyId
  const baby = store.baby

  input.value = ''
  pushMessage('user', question)

  // 本轮提问不进历史（askAssistant 会单独拼在末尾），历史里也不要空消息
  const history = messages.value
    .slice(0, -1)
    .filter((item) => item.content)
    .map((item) => ({ role: item.role, content: item.content }))

  sending.value = true
  scrollToBottom()

  streamBuffer = ''
  const placeholderIndex = pushMessage('assistant', '', true)
  streamIndex = placeholderIndex

  let errorText = ''
  try {
    await askAssistant({ familyId, babyId, baby, history, question, onDelta: handleDelta })
  } catch (err) {
    console.error('[AI Chat] 回答失败', err)
    errorText = (err && err.message) || 'AI 服务暂时不可用，请稍后重试'
  } finally {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = 0
    }
    const target = messages.value[placeholderIndex]
    if (target) {
      if (streamBuffer) target.content = streamBuffer
      target.streaming = false
      // 一个字都没收到（多为报错）：把空气泡去掉，错误用 toast 提示
      if (!target.content) messages.value.splice(placeholderIndex, 1)
    }
    streamIndex = -1
    streamBuffer = ''
    sending.value = false
    persistHistory()
    scrollToBottom()
    if (errorText) uni.showToast({ title: errorText, icon: 'none' })
  }
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  await store.bootstrap()
  available.value = isAiChatAvailable()
  restoreHistory()
})

onUnmounted(() => {
  if (flushTimer) clearTimeout(flushTimer)
})

onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  background-color: var(--color-bg-page);
}

.list {
  flex: 1;
  /* flex 子项里的 scroll-view 需要显式高度才会滚动 */
  height: 0;
}

.list-inner {
  padding: var(--space-lg) var(--space-lg) var(--space-md);
  box-sizing: border-box;
}

/* 记录归属提示 + 清空 */
.toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-md);
}

.toolbar-hint {
  font-size: 22rpx;
  color: var(--color-text-muted);
}

.toolbar-clear {
  padding: 8rpx var(--space-md);
  font-size: 24rpx;
  color: var(--color-text-sub);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-pill);
}

/* 不可用提示 */
.notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-xl) var(--space-lg);
}

.notice-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.notice-text {
  margin-top: var(--space-sm);
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--color-text-muted);
  text-align: center;
}

/* 欢迎语 + 快速提问 */
.welcome {
  padding: var(--space-md) 0 var(--space-lg);
}

.welcome-title {
  display: block;
  font-size: 34rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.welcome-text {
  display: block;
  margin-top: var(--space-sm);
  font-size: 27rpx;
  line-height: 1.7;
  color: var(--color-text-sub);
}

.chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: var(--space-md);
}

.chip {
  padding: 14rpx 28rpx;
  margin-right: var(--space-sm);
  margin-bottom: var(--space-sm);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-card);
}

.chip-text {
  font-size: 26rpx;
  color: var(--color-primary-deep);
}

/* 气泡 */
.msg {
  display: flex;
  flex-direction: row;
  margin-bottom: var(--space-md);
}

.msg--user {
  justify-content: flex-end;
}

.msg--assistant {
  justify-content: flex-start;
}

.bubble {
  max-width: 78%;
  padding: var(--space-md);
  border-radius: var(--radius-md);
}

.bubble--user {
  background-color: var(--color-primary);
  border-top-right-radius: var(--radius-sm);
}

.bubble--assistant {
  background-color: var(--color-bg-card);
  border-top-left-radius: var(--radius-sm);
  box-shadow: var(--shadow-card);
}

.bubble-text {
  font-size: 29rpx;
  line-height: 1.7;
  color: var(--color-text-main);
  word-break: break-word;
}

.bubble--user .bubble-text {
  color: #ffffff;
}

.bubble-text--pending {
  color: var(--color-text-muted);
}

/* 输入区 */
.composer {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  padding: var(--space-sm) var(--space-lg);
  background-color: var(--color-bg-card);
  border-top: 1rpx solid var(--color-border);
}

.input {
  flex: 1;
  max-height: 200rpx;
  padding: 18rpx var(--space-md);
  font-size: 29rpx;
  line-height: 1.5;
  color: var(--color-text-main);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
  box-sizing: border-box;
}

.input-placeholder {
  font-size: 27rpx;
  color: #c2c7ce;
}

.send {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 76rpx;
  padding: 0 var(--space-lg);
  margin-left: var(--space-sm);
  background-color: var(--color-primary);
  border-radius: var(--radius-pill);
}

.send--disabled {
  opacity: 0.45;
}

.send-text {
  font-size: 28rpx;
  font-weight: 600;
  color: #ffffff;
}

.disclaimer {
  display: block;
  padding: var(--space-xs) var(--space-lg) var(--space-sm);
  padding-bottom: calc(var(--space-sm) + env(safe-area-inset-bottom));
  font-size: 22rpx;
  color: var(--color-text-muted);
  text-align: center;
  background-color: var(--color-bg-card);
}
</style>
