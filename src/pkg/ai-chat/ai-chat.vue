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
          <!-- 今日额度：让家长在被拦住之前就知道还剩几次（问答/每日小结/一句话记一笔共用这一份） -->
          <view v-if="quotaKnown" class="quota" :class="{ 'quota--low': quotaLeft <= 1 }">
            <text class="quota-text">今天还能问 {{ quotaLeft }} 次</text>
          </view>

          <!-- 对话记录只在本机，给一个明确的清空入口 -->
          <view v-if="messages.length" class="toolbar">
            <text class="toolbar-hint">对话只保存在这台手机上</text>
            <text class="toolbar-clear" @click="onClear">清空对话</text>
          </view>

          <!-- 首次进入：欢迎语 + 快速提问 -->
          <view v-if="!messages.length" class="welcome">
            <text class="welcome-title">你好，我是照护助手</text>
            <text class="welcome-text">
              我可以结合{{ babyName ? `「${babyName}」` : '宝宝' }}的喂养、睡眠、便便、生病、生长、疫苗、体检等记录回答问题。
            </text>
            <view class="chips">
              <view v-for="item in QUICK_QUESTIONS" :key="item" class="chip" @click="askQuick(item)">
                <text class="chip-text">{{ item }}</text>
              </view>
            </view>
          </view>

          <view v-for="item in messages" :key="item.key" class="msg" :class="`msg--${item.role}`">
            <view class="msg-body">
              <view class="bubble" :class="`bubble--${item.role}`">
                <text v-if="item.content" class="bubble-text">{{ item.content }}</text>
                <text v-else class="bubble-text bubble-text--pending">正在思考…</text>
              </view>
              <!-- 依据：让家长看得见这一答读了多少记录（前端统计，不是模型自报） -->
              <text v-if="item.basis" class="basis">{{ item.basis }}</text>
              <!-- 反馈：准不准由家长说了算，也是后面改提示词与通用参考的依据 -->
              <view v-if="item.role === 'assistant' && item.content && !item.streaming" class="rate">
                <text
                  class="rate-btn"
                  :class="{ 'rate-btn--on': item.rating === 'up' }"
                  @click="onRate(item, 'up')"
                >
                  有帮助
                </text>
                <text
                  class="rate-btn"
                  :class="{ 'rate-btn--on': item.rating === 'down' }"
                  @click="onRate(item, 'down')"
                >
                  不准
                </text>
                <!--
                  把「刚才那句话」交给一句话记一笔去解析 —— 省掉「退出 → 进记录页 → 重打一遍」。
                  只在知道原话时出现（刷新后的历史里没有原话，就不显示）。
                -->
                <text v-if="item.fromUser" class="rate-btn rate-btn--record" @click="onQuickRecord(item)">
                  记成一笔
                </text>
              </view>
            </view>
          </view>
        </template>
      </view>
    </scroll-view>

    <!-- 输入区 -->
    <view v-if="available" class="composer">
      <!-- 额度用完：整块换成常驻提示，不让家长白打一行字、点了发送才被拦 -->
      <view v-if="quotaOut" class="composer-out" @click="goAiQuotaUpgrade">
        <text class="composer-out-text">{{ quotaOutText }}</text>
      </view>
      <template v-else>
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
      </template>
    </view>
    <text v-if="available" class="disclaimer">AI 建议仅供参考，不能替代医生诊断。</text>
  </view>
</template>

<script setup>
import { computed, onUnmounted, ref } from 'vue'
import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { askAssistant, isAiChatAvailable, isAiQuotaError, promptAiQuotaUpgrade, goAiQuotaUpgrade, loadChatHistory, saveChatHistory, clearChatHistory, refreshQuota, submitAiFeedback } from '@/services/ai'
import { flagEnabled } from '@/services/flags'
import { membershipState } from '@/services/membership'
import { aiQuota, remainingQuota } from '@/services/ai-quota'
import { capabilities } from '@/services/api'
import { ensurePageAccess } from '@/utils/routeGuard'
import { defaultShare } from '@/utils/share'

const PAGE_PATH = 'pkg/ai-chat/ai-chat'
/** 单次提问的长度上限（模型按 token 计费，过长的输入没必要） */
const QUESTION_MAX = 300
/** 流式刷新节流：每 100ms 落一次盘，避免每个 chunk 都触发渲染 */
const STREAM_FLUSH_MS = 100

const QUICK_QUESTIONS = ['今天喂了几次？', '宝宝最近睡得好吗？', '便便情况正常吗？']

/**
 * 交接给「一句话记一笔」的那句话；用 storage 而不是 URL 参数 ——
 * 原话可能很长（还带标点），塞进 path 既容易超长又要反复编解码。
 */
const QUICK_PREFILL_KEY = 'babyup.aiQuickPrefill'

/** 点「不准」时的原因选项；最后一项表示先不填原因，照样把这次差评记下来 */
const RATE_REASONS = ['数据不对', '答非所问', '太啰嗦', '不是我要的', '先不选原因']

const store = useAuthStore()

const available = ref(isAiChatAvailable())
/** { key, role: 'user' | 'assistant', content, streaming } */
const messages = ref([])
const input = ref('')
const sending = ref(false)
const scrollTop = ref(0)

const babyName = computed(() => (store.baby ? store.baby.name : ''))
const canSend = computed(() => !sending.value && input.value.trim().length > 0)
/** 今日额度：查得到服务端数据才显示那一行（集合没建时干脆不提） */
const quotaKnown = computed(() => aiQuota.value.known)
const quotaLeft = computed(() => remainingQuota())
/** 额度已用完：输入区整块换成常驻提示，不再让用户试探 */
const quotaOut = computed(() => {
  const quota = aiQuota.value
  return quota.known && quota.limit > 0 && remainingQuota() <= 0
})
const quotaOutText = computed(() =>
  membershipState.value.enabled ? '今日 AI 次数已用完 · 去开通会员' : '今日 AI 次数已用完 · 明天恢复',
)
const unavailableReason = computed(() => {
  // 被功能开关关掉的情况要说清楚，不然会误以为是微信版本的问题
  if (!flagEnabled('aiChat')) return '这个功能当前已关闭。'
  return capabilities.aiChat
    ? '当前微信版本过低，请更新微信到最新版后再试。'
    : 'AI 助手只在微信小程序端（云开发后端）提供。'
})

// 本机对话的归属：换账号或换宝宝都要看各自那份
const ownerUserId = computed(() => store.userId)
const ownerBabyId = computed(() => store.currentBabyId)

let keySeq = 0

function pushMessage(role, content, streaming, rating = '', reason = '') {
  keySeq += 1
  messages.value.push({
    key: `m${keySeq}`,
    role,
    content,
    streaming: Boolean(streaming),
    // 反馈状态跟着消息走，重进页面时按钮还是选中态
    rating,
    reason,
  })
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
    pushMessage(item.role, item.content, false, item.rating || '', item.reason || '')
  })
  scrollToBottom()
}

/** 本轮回答结束后整段落盘（不逐条写，也不落空消息） */
function persistHistory() {
  if (!ownerTag()) return
  const list = messages.value
    .filter((item) => item.content)
    .map((item) => ({
      role: item.role,
      content: item.content,
      rating: item.rating,
      reason: item.reason,
    }))
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

/**
 * 给某条回答打分。
 * 「不准」会再问一句原因（可选）：原因比分数有用 —— 数据不对 / 答非所问 / 太啰嗦，
 * 对应的改法完全不同（改上下文、改提示词、还是改语气）。
 */
/**
 * 点「记成一笔」：把这一答对应的**家长原话**交给「一句话记一笔」去解析。
 *
 * 为什么用原话而不是 AI 的回答：解析提示词是按「家长随口一句话」写的，
 * 用原话命中率最高，也最符合「我当时就是这么说的」的直觉。
 * 进去后会自动解析一次（花一次额度），解析结果仍要家长在确认卡上过目、可改。
 */
function onQuickRecord(item) {
  const text = String((item && item.fromUser) || '').trim()
  if (!text) return
  try {
    uni.setStorageSync(QUICK_PREFILL_KEY, text)
  } catch (err) {
    console.error('[AI Chat] 暂存待记内容失败', err)
  }
  uni.navigateTo({
    url: '/pkg/ai-quick-record/ai-quick-record',
    fail: (err) => console.error('[AI Chat] 打开一句话记一笔失败', err),
  })
}

function onRate(item, rating) {
  if (!item || !item.content || item.streaming) return
  if (rating === 'up') {
    sendFeedback(item, 'up', '')
    return
  }
  uni.showActionSheet({
    itemList: RATE_REASONS,
    success: (res) => {
      const picked = RATE_REASONS[res.tapIndex] || ''
      const isSkip = picked === RATE_REASONS[RATE_REASONS.length - 1]
      sendFeedback(item, 'down', isSkip ? '' : picked)
    },
    // 取消就当没点过：宁可不记，也不记一条没说清原因的差评
    fail: () => {},
  })
}

async function sendFeedback(item, rating, reason) {
  // 同一条只记一次，避免把同一句回答刷成一堆反馈
  if (item.rating) {
    uni.showToast({ title: '这条已经记过了', icon: 'none' })
    return
  }
  // 先改状态：按钮立刻有反馈，不用等网络
  item.rating = rating
  item.reason = reason
  persistHistory()

  const index = messages.value.indexOf(item)
  const previous = index > 0 ? messages.value[index - 1] : null
  const ok = await submitAiFeedback({
    familyId: store.membership ? store.membership.family_id : '',
    babyId: store.currentBabyId,
    rating,
    reason,
    question: previous && previous.content ? previous.content : '',
    answer: item.content,
    basis: item.basis || '',
  })

  if (ok) {
    uni.showToast({ title: '已记下，谢谢', icon: 'none' })
    return
  }
  // 没提交成功就把状态撤回去，否则家长以为记上了、再点又说「已经记过」
  item.rating = ''
  item.reason = ''
  persistHistory()
  uni.showToast({ title: '提交失败，稍后再试', icon: 'none' })
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
  let answerBasis = ''
  let quotaBlocked = false
  try {
    const answer = await askAssistant({ familyId, babyId, baby, history, question, onDelta: handleDelta })
    answerBasis = answer && answer.basis ? answer.basis : ''
  } catch (err) {
    console.error('[AI Chat] 回答失败', err)
    // 额度用完单独走弹窗引导开通会员，不再混在普通错误 toast 里
    if (isAiQuotaError(err)) quotaBlocked = true
    else errorText = (err && err.message) || 'AI 服务暂时不可用，请稍后重试'
  } finally {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = 0
    }
    const target = messages.value[placeholderIndex]
    if (target) {
      if (streamBuffer) target.content = streamBuffer
      // 「依据」是前端自己数出来的，不是模型自报的（见 services/ai.js 的 buildBabyContext）
      if (answerBasis) target.basis = answerBasis
      // 记着这一答是回应哪句话：答完可以在气泡下点「记成一笔」，把原话交给
      //「一句话记一笔」去解析（见 onQuickRecord）。只存在内存里，不落盘。
      if (target.content) target.fromUser = question
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
  if (quotaBlocked) promptAiQuotaUpgrade()
}

/**
 * 从首页「AI 观察」带问题进来时（?q=...）先把问题填进输入框。
 * 不自动发送：让用户看一眼、确认后自己点发送，也避免没打算提问就先花掉一次额度。
 */
onLoad((query) => {
  const raw = String((query && query.q) || '')
  if (!raw) return
  try {
    input.value = decodeURIComponent(raw)
  } catch (err) {
    // 平台已经解码过时 decodeURIComponent 会抛错，那就直接用原值
    input.value = raw
  }
})

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  await store.bootstrap()
  available.value = isAiChatAvailable()
  restoreHistory()
  // 今日额度（服务端只读，不扣次数）：让家长在被拦住之前就知道还剩几次
  refreshQuota(store.membership ? store.membership.family_id : '')
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

/* 今日额度：一行小字；快用完时换成暖色提醒 */
.quota {
  display: flex;
  flex-direction: row;
  justify-content: center;
  margin-bottom: var(--space-md);
}

.quota-text {
  padding: 8rpx var(--space-md);
  font-size: 22rpx;
  color: var(--color-text-sub);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-pill);
}

.quota--low .quota-text {
  color: var(--color-primary-deep);
  background-color: var(--color-primary-soft);
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

/* 一条回答竖着排：气泡 → 依据 → 反馈（原来是并排，会挤在半边） */
.msg-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  max-width: 82%;
}

.msg--user .msg-body {
  align-items: flex-end;
}

.bubble {
  max-width: 100%;
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

/* 依据：小字灰底提示，跟在助手气泡下面 */
.basis {
  margin: var(--space-xs) 0 0 4rpx;
  font-size: 22rpx;
  line-height: 1.5;
  color: var(--color-text-muted);
}

/* 反馈按钮：小药丸；选中后变暖色，一眼看出这条已经评过 */
.rate {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin: var(--space-xs) 0 0 4rpx;
}

.rate-btn {
  padding: 6rpx 22rpx;
  margin-right: var(--space-sm);
  font-size: 22rpx;
  color: var(--color-text-sub);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-pill);
}

.rate-btn--on {
  color: var(--color-primary-deep);
  background-color: var(--color-primary-soft);
}

/* 「记成一笔」是动作（不是评价），用主色描出来，和旁边两个反馈按钮区分开 */
.rate-btn--record {
  color: var(--color-primary-deep);
  background-color: var(--color-primary-soft);
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

/* 额度用完时的常驻提示条：占满输入区，点了直接去会员页 */
.composer-out {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 76rpx;
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.composer-out-text {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--color-primary-deep);
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
