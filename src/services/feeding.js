/**
 * 喂养记录的业务数据访问层（二期 P0-2）。
 *
 * 数量字段按类型分工（需求文档 4.8 数据流约定）：
 *   breast  -> 只填 duration_min
 *   formula -> 填 amount_ml，喝不完再填 leftover_ml
 *   water   -> 填 amount_ml，喝不完再填 leftover_ml
 *   solid   -> 两者都空（辅食只记次数，次数 = 当日记录条数）
 * 入库前统一归一化，避免出现「选了母乳却带着上次填的毫升数」这类脏数据。
 *
 * amount_ml 是**冲/倒出来多少**，leftover_ml 是**剩下多少**；
 * 真正吃进去的是 netAmountMl()（见下），所有统计一律用它。
 *
 * 更新同样走 upsert（微信小程序不支持 PATCH），喂奶记录由本人当场记录，
 * 家属可代为修改，故 update 策略放行所有非 viewer 成员。
 */
import { api } from './api'
import { trackRecordCreated } from '@/utils/tracker'
import { ageParts } from '@/utils/age'

const FEEDING_COLUMNS =
  'id,family_id,baby_id,feed_type,amount_ml,leftover_ml,duration_min,record_time,note,created_by,created_at'

/** 前端常量表：类型 -> 中文名与数量单位（不落库，只有 code 进数据库） */
export const FEED_TYPES = [
  { key: 'breast', label: '母乳', unit: '分钟' },
  { key: 'formula', label: '配方奶', unit: 'ml' },
  { key: 'water', label: '水', unit: 'ml' },
  { key: 'solid', label: '辅食', unit: '' },
]

export const FEED_TYPE_LABEL = FEED_TYPES.reduce((acc, item) => {
  acc[item.key] = item.label
  return acc
}, {})

/** 单次喂养的数量上限，用于拦住明显的手滑输入 */
export const FEED_LIMITS = {
  amountMl: { min: 1, max: 500, label: '奶量' },
  leftoverMl: { min: 1, max: 500, label: '剩余' },
  durationMin: { min: 1, max: 240, label: '时长' },
}

/**
 * 一条喂养记录的**实际摄入量**（ml）。
 *
 * 家长习惯记「冲了多少」，但宝宝不一定喝完：冲 90 剩 30，实际只吃了 60。
 * 所有统计（今日小结、历史每天、成长报告、AI 上下文）都必须走这个净值 ——
 * 直接用 amount_ml 会系统性偏高，这正是「统计数据不符合实际」的来源。
 * 母乳亲喂没有毫升数（按时长另算），返回 0。
 */
export function netAmountMl(record) {
  if (!record) return 0
  const amount = Number(record.amount_ml)
  if (!Number.isFinite(amount)) return 0
  const leftover = Number(record.leftover_ml)
  if (!Number.isFinite(leftover) || leftover <= 0) return amount
  return Math.max(amount - leftover, 0)
}

/** 一组记录的实际摄入合计（ml） */
export function sumNetAmountMl(records) {
  return (records || []).reduce((total, row) => total + netAmountMl(row), 0)
}

/** 按类型挑出该用的数量字段，用不到的强制置空 */
function normalizeAmount(feedType, amountMl, durationMin, leftoverMl) {
  const leftoverRaw = String(leftoverMl == null ? '' : leftoverMl).trim()
  const leftover = leftoverRaw === '' ? NaN : Number(leftoverRaw)
  const hasLeftover = Number.isFinite(leftover) && leftover > 0
  if (feedType === 'breast') {
    return {
      amount_ml: null,
      leftover_ml: null,
      duration_min: durationMin == null ? null : durationMin,
    }
  }
  if (feedType === 'formula' || feedType === 'water') {
    return {
      amount_ml: amountMl == null ? null : amountMl,
      leftover_ml: hasLeftover ? leftover : null,
      duration_min: null,
    }
  }
  return { amount_ml: null, leftover_ml: null, duration_min: null }
}

/**
 * 列表用的一句话描述。
 * 例：'母乳 15 分钟' / '配方奶 120 ml' / '配方奶 60 ml（冲 90，剩 30）'
 * 报了剩余就显示实际吃进去多少，括号里交代冲了多少、剩了多少。
 */
export function formatFeeding(record) {
  if (!record) return ''
  const label = FEED_TYPE_LABEL[record.feed_type] || '喂养'
  if (record.feed_type === 'breast' && record.duration_min != null) {
    return `${label} ${record.duration_min} 分钟`
  }
  if (record.amount_ml != null) {
    const leftover = Number(record.leftover_ml)
    if (!Number.isFinite(leftover) || leftover <= 0) return `${label} ${record.amount_ml} ml`
    return `${label} ${netAmountMl(record)} ml（冲 ${record.amount_ml}，剩 ${leftover}）`
  }
  return label
}

/**
 * 拉取喂养记录（时间倒序）。
 * @param {object} [options] { fromIso, toIso } 只看该区间内的记录（左闭右开，UTC 时刻）
 */
export async function listFeedings(familyId, babyId, options = {}) {
  if (!familyId || !babyId) return []
  const { fromIso, toIso, limit = 200 } = options
  const range = []
  if (fromIso) range.push(`gte.${fromIso}`)
  if (toIso) range.push(`lt.${toIso}`)
  const { data } = await api.db.select('feeding_records', {
    select: FEEDING_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    filters: range.length ? { record_time: range } : undefined,
    order: 'record_time.desc',
    limit,
  })
  return data || []
}

/**
 * 取当前家庭 + 当前宝宝最近的一次喂养（今日小结里的「距上次喂养」用）。
 * 按 record_time 倒序只取 1 条，不为此拉全表；没有记录时返回 null。
 */
export async function fetchLatestFeeding(familyId, babyId) {
  if (!familyId || !babyId) return null
  return api.db.selectOne('feeding_records', {
    select: FEEDING_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    order: 'record_time.desc',
  })
}

/** 新增一条喂养记录 */
export async function createFeeding({
  familyId,
  babyId,
  feedType,
  amountMl,
  leftoverMl,
  durationMin,
  recordTime,
  note,
}) {
  const createdBy = api.auth.currentUserId()
  if (!createdBy) throw new api.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const rows = await api.db.insert('feeding_records', {
    family_id: familyId,
    baby_id: babyId,
    feed_type: feedType,
    ...normalizeAmount(feedType, amountMl, durationMin, leftoverMl),
    record_time: recordTime,
    note: note ? String(note).trim() : null,
    created_by: createdBy,
  })
  const row = rows && rows.length ? rows[0] : null
  if (row) trackRecordCreated('feeding')
  return row
}

/** 修改一条喂养记录（整行 upsert） */
export async function updateFeeding(record) {
  const row = api.db.pickColumns(record, FEEDING_COLUMNS)
  const rows = await api.db.upsert('feeding_records', {
    ...row,
    ...normalizeAmount(row.feed_type, row.amount_ml, row.duration_min, row.leftover_ml),
  })
  return rows && rows.length ? rows[0] : null
}

/** 删除一条喂养记录 */
export async function removeFeeding(id) {
  await api.db.remove('feeding_records', { id })
}

/* ---------- 喂奶提醒（三期 P1-8） ---------- */

/**
 * 月龄 → 喂养参考表：一张表同时回答三件事 —— 建议间隔区间、每次配方奶量、一天总奶量。
 *
 * 口径说明（页面文案与此保持一致，别改成「必须吃够」的语气）：
 * - 数值是**常见参考范围**，不是标准答案。母乳亲喂无法计量、个体差异很大，
 *   判断吃没吃够主要看体重增长与精神状态，拿不准要问儿保医生。
 * - dailyMl 是「一天总奶量」，母乳 + 配方奶合计；6 月龄起另有辅食，奶量随之下降。
 * - intervalMin 是「两次喂养之间」的参考区间，**上沿**就是提醒逻辑用的间隔上限：
 *   上沿一律取该月龄段常见间隔的偏晚值（0~1 月常见 2~3 小时，这里取 2.5 小时）——
 *   宁可晚提醒，也不要在宝宝刚吃完就催。
 *
 * 表按月龄上限升序排列，取第一个满足 totalMonths < maxMonths 的档位，
 * 因此边界月龄归下一档（满 1 个月即按 1~2 月档对待）。
 */
export const FEED_REFERENCE_TABLE = [
  {
    maxMonths: 1,
    label: '0~1 月',
    intervalMin: [120, 150],
    perFeedMl: [60, 120],
    timesLabel: '8~12 次',
    dailyMl: [400, 800],
    note: '按需喂养：饿了就喂，不必掐点叫醒',
  },
  {
    maxMonths: 2,
    label: '1~2 月',
    intervalMin: [150, 180],
    perFeedMl: [90, 150],
    timesLabel: '7~8 次',
    dailyMl: [600, 900],
  },
  {
    maxMonths: 3,
    label: '2~3 月',
    intervalMin: [180, 210],
    perFeedMl: [120, 180],
    timesLabel: '6~7 次',
    dailyMl: [700, 900],
  },
  {
    maxMonths: 6,
    label: '3~6 月',
    intervalMin: [180, 240],
    perFeedMl: [150, 210],
    timesLabel: '5~6 次',
    dailyMl: [800, 1000],
  },
  {
    maxMonths: 12,
    label: '6~12 月',
    intervalMin: [240, 270],
    perFeedMl: [180, 240],
    timesLabel: '3~4 次',
    dailyMl: [600, 800],
    note: '另外每天辅食 1~2 次，奶仍是主要营养来源',
  },
  {
    maxMonths: 24,
    label: '1~2 岁',
    intervalMin: [240, 300],
    perFeedMl: [200, 250],
    timesLabel: '2~3 次',
    dailyMl: [400, 500],
    note: '以三餐为主，奶作为补充',
  },
  {
    maxMonths: Infinity,
    label: '2 岁以上',
    intervalMin: [240, 300],
    perFeedMl: [200, 250],
    timesLabel: '1~2 次',
    dailyMl: [300, 500],
    note: '三餐两点为主，奶作为补充',
  },
]

/**
 * 月龄 → 间隔上限（分钟）推荐表：取参考表的上沿，喂奶提醒的判定用它。
 *
 * ⚠️ cloudfunctions/feeding-reminder/index.js 里有一份**数值必须一致**的副本
 * （云函数算月龄不依赖前端代码）。改上面的 intervalMin 上沿等于改提醒行为，
 * 记得同步那份，并重新部署云函数。
 */
export const FEED_INTERVAL_TABLE = FEED_REFERENCE_TABLE.map(
  ({ maxMonths, label, intervalMin }) => ({ maxMonths, label, minutes: intervalMin[1] }),
)

/** 自定义间隔的取值区间与步长（分钟）：1 小时 ~ 12 小时，每次调 15 分钟 */
export const FEED_INTERVAL_RANGE = { min: 60, max: 720, step: 15 }

/** 生日缺失/非法时的兜底上限（分钟），取 1~2 月档 */
export const FEED_INTERVAL_FALLBACK = 180

/** 月龄命中的参考档位；生日缺失/非法时返回 null */
function feedReferenceTier(birthday, now) {
  const parts = ageParts(birthday, now)
  if (!parts) return null
  return FEED_REFERENCE_TABLE.find((item) => parts.totalMonths < item.maxMonths) || null
}

/**
 * 当前月龄的喂养参考：间隔区间 + 每次奶量 + 一天次数 + 一天总奶量。
 * 生日缺失/非法时返回 null，页面据此提示去补生日。
 */
export function feedReferenceOf(birthday, now) {
  const tier = feedReferenceTier(birthday, now)
  if (!tier) return null
  return {
    label: tier.label,
    intervalMin: tier.intervalMin,
    perFeedMl: tier.perFeedMl,
    timesLabel: tier.timesLabel,
    dailyMl: tier.dailyMl,
    note: tier.note || '',
  }
}

/** 某月龄的推荐上限（分钟） */
export function recommendedFeedInterval(birthday, now) {
  const tier = feedReferenceTier(birthday, now)
  return tier ? tier.intervalMin[1] : FEED_INTERVAL_FALLBACK
}

/** 推荐档位的说明文案，例：'1~2 月'；生日缺失/非法时为 '' */
export function feedIntervalTierLabel(birthday, now) {
  const tier = feedReferenceTier(birthday, now)
  return tier ? tier.label : ''
}

/**
 * 宝宝档位上实际生效的上限（分钟）。
 *
 * 优先用自定义值，没设过才回落到月龄推荐值。档案上存的是「实际分钟数」而不是
 * 「是否自定义」的标记：这样云函数只读一个数字就行，不必在服务端再实现一遍
 * 月龄计算，杜绝两处口径不一致。
 */
export function resolveFeedInterval(baby, now) {
  const custom = Number(baby && baby.feed_interval_max_min)
  if (Number.isFinite(custom) && custom > 0) return custom
  return recommendedFeedInterval(baby && baby.birthday, now)
}

/** 把分钟数说成「2 小时 30 分钟」；设置页、我的页、记录页提示共用同一口径 */
export function formatFeedInterval(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (!hours) return `${mins} 分钟`
  if (!mins) return `${hours} 小时`
  return `${hours} 小时 ${mins} 分钟`
}

/**
 * 距上次喂奶是否已超过上限。
 *
 * recordTime 为空（从来没喂过）时一律不算超时：没有起点就无从判断间隔。
 *
 * @returns {{ overdue: boolean, minutes: number, limit: number }}
 */
export function feedOverdueState(baby, recordTime, now) {
  const limit = resolveFeedInterval(baby, now)
  const ts = recordTime ? new Date(recordTime).getTime() : NaN
  if (!Number.isFinite(ts)) return { overdue: false, minutes: 0, limit }
  const minutes = Math.floor(((now || Date.now()) - ts) / 60000)
  if (!Number.isFinite(minutes) || minutes < 0) return { overdue: false, minutes: 0, limit }
  return { overdue: minutes >= limit, minutes, limit }
}
