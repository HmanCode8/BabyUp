/**
 * 喂奶提醒（订阅消息）定时云函数（三期 P1-8）。
 *
 * 触发：见同目录 config.json 的 timer 触发器，每小时整点跑一次。
 * 逻辑：找出所有开启了提醒的宝宝，判断「距最近一条喂养记录」是否已超过该宝宝的
 *       喂养间隔上限，超时则给该宝宝所属家庭的 **全部 active 成员**逐个下发订阅消息。
 *
 * 为什么「每次超时只推一次」：
 *   订阅消息是一次性授权（每个成员授权一次只有 1 条额度），每小时都推会迅速烧光额度；
 *   而且家人一直没记录时每个整点响一次纯属骚扰。所以宝宝档案上记一个 feed_remind_at
 *   （上次提醒时间），只有「最近一条喂养记录的时间晚于 feed_remind_at」才说明这是
 *   新一轮超时，才推。家人记录了新的喂养 -> record_time 前进 -> 下一轮超时才推得出去。
 *
 * 为什么 feed_remind_at 直接加在 babies 上、不新建集合：
 *   data 云函数的白名单是按「集合」粒度，babies 已在册，加字段不用改任何已有代码；
 *   本函数用管理员权限直接写，也不需要客户端配合。
 *
 * ⚠️ 与 src/services/feeding.js 的口径必须一致：间隔上限、月龄档位表、超时判定。
 *    两边刻意各写一份：云函数不能 import 小程序源码，且这里必须时区无关（云函数运行
 *    环境时区不保证是北京时间，故全部用 UTC 算术 + 显式 +8 小时取「今天」）。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

/**
 * 订阅消息模板 ID（小程序后台 → 功能 → 订阅消息 → 我的模板）。
 *
 * ⚠️ 必须与小程序端 src/pages/feeding-reminder/feeding-reminder.vue 的
 *    SUBSCRIBE_TEMPLATE_ID 完全一致：那边负责让用户授权攒额度，这边负责消费额度发消息。
 */
const TEMPLATE_ID = 'NCXAOkXSusWa7FN3hLwRRbAgUF4fNTjM_gNU7HUhUfQ'

/** 点击消息卡片后跳转的页面：记录页有三期做的「该喂奶啦」站内提示 */
const TARGET_PAGE = 'pages/record/record'

/**
 * 跳转的小程序版本：小程序还没正式发布时只能用 'trial'（体验版），
 * 正式发布后改成 'formal'，否则用户点开消息会跳到不存在的正式版。
 */
const MINIPROGRAM_STATE = 'trial'

/**
 * 模板关键词占位符（2026-09-22 从后台模板详情逐字抄下来的）。
 *
 * ⚠️ 写错不会报「字段缺失」，而是以 47003 发送失败，日志里能看到 errmsg 指明是哪个字段。
 *    模板编号 7801，标题「奶瓶喂养提醒」，详细内容：
 *      上次时间 {{time1.DATA}}
 *      距离上次 {{thing2.DATA}}
 *      上次容量 {{character_string3.DATA}}
 *      上次类型 {{phrase4.DATA}}
 *      温馨提示 {{thing5.DATA}}
 *    注意编号不是按位置递增的（time1/thing2/character_string3/phrase4/thing5），不要凭顺序推。
 *    每个字段的值还受「类型」各自的字符集与长度限制，见下面每个键的注释。
 */
const KEY = {
  /** 上次时间（time 类型：必须是 'YYYY-MM-DD HH:mm'） */
  lastAt: 'time1',
  /** 距离上次（thing 类型：20 字以内，且不能是纯数字/字母，需含汉字） */
  since: 'thing2',
  /** 上次容量（character_string 类型：32 位以内，**只允许数字/字母/符号，写汉字会 47003**） */
  amount: 'character_string3',
  /** 上次类型（phrase 类型：5 个以内汉字） */
  type: 'phrase4',
  /** 温馨提示（thing 类型：20 字以内） */
  note: 'thing5',
}

/** 月龄 -> 间隔上限（分钟）推荐表，与 src/services/feeding.js 的 FEED_INTERVAL_TABLE 同步 */
const FEED_INTERVAL_TABLE = [
  { maxMonths: 1, minutes: 150 },
  { maxMonths: 2, minutes: 180 },
  { maxMonths: 3, minutes: 210 },
  { maxMonths: 6, minutes: 240 },
  { maxMonths: 12, minutes: 270 },
  { maxMonths: Infinity, minutes: 300 },
]

/** 生日缺失/非法时的兜底上限（分钟），取 1~2 月档 */
const FEED_INTERVAL_FALLBACK = 180

/**
 * 喂养类型 -> 中文名，与 src/services/feeding.js 的 FEED_TYPE_LABEL 同步。
 * 模板里这个字段是 phrase 类型，只认汉字，所以直接给中文而不是 code。
 */
const FEED_TYPE_LABEL = {
  breast: '母乳',
  formula: '配方奶',
  water: '水',
  solid: '辅食',
}

// ---------------------------------------------------------------------------
// 日期与文案小工具
// ---------------------------------------------------------------------------

/** 某年某月的天数（month 为 1~12），交给 Date 处理闰年 */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** 'YYYY-MM-DD' / Date -> { year, month, day }；非法返回 null */
function parseDateParts(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    // 与下面的 nowParts 同口径：按北京时间取年月日
    const shifted = new Date(value.getTime() + 8 * 60 * 60 * 1000)
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    }
  }
  const matched = String(value || '')
    .trim()
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!matched) return null
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (!year || !month || !day || month > 12 || day > 31) return null
  return { year, month, day }
}

/** 时间戳对应的北京时间年月日 */
function nowParts(timestamp) {
  const shifted = new Date(timestamp + 8 * 60 * 60 * 1000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

/** 两个日期相差的天数（to - from），全程 UTC 算术，不受运行环境时区影响 */
function daysBetween(from, to) {
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) /
      86400000,
  )
}

/** 生日往后推进 months 个自然月；日号夹到目标月的最后一天（1月31日 + 1月 = 2月28/29日） */
function addMonthsClamped(birth, months) {
  const monthIndex = birth.month - 1 + months
  const year = birth.year + Math.floor(monthIndex / 12)
  const month = (monthIndex % 12) + 1
  const day = Math.min(birth.day, daysInMonth(year, month))
  return { year, month, day }
}

/**
 * 已满月龄；生日非法或还没出生时返回 null。
 * 与 src/utils/age.js 的 ageParts 同一套算法（满足「推进 M 个自然月不超过今天」的最大 M）。
 */
function totalMonthsBetween(birthday, timestamp) {
  const birth = parseDateParts(birthday)
  if (!birth) return null
  const ref = nowParts(timestamp)
  if (daysBetween(birth, ref) < 0) return null

  let totalMonths = (ref.year - birth.year) * 12 + (ref.month - birth.month)
  if (totalMonths < 0) totalMonths = 0
  if (daysBetween(addMonthsClamped(birth, totalMonths), ref) < 0) totalMonths -= 1
  if (totalMonths < 0) totalMonths = 0
  return totalMonths
}

/** 月龄命中的推荐上限（分钟）；生日缺失/非法时用兜底值 */
function recommendedFeedInterval(birthday, timestamp) {
  const totalMonths = totalMonthsBetween(birthday, timestamp)
  if (totalMonths === null) return FEED_INTERVAL_FALLBACK
  const tier = FEED_INTERVAL_TABLE.find((item) => totalMonths < item.maxMonths)
  return tier ? tier.minutes : FEED_INTERVAL_FALLBACK
}

/**
 * 该宝宝实际生效的上限（分钟）。
 * 优先用档案上存的自定义值（存的是「实际分钟数」而非「是否自定义」的标记，
 * 所以这里只读一个数字，服务端不必再实现一遍月龄计算）。
 */
function resolveFeedInterval(baby, timestamp) {
  const custom = Number(baby && baby.feed_interval_max_min)
  if (Number.isFinite(custom) && custom > 0) return custom
  return recommendedFeedInterval(baby && baby.birthday, timestamp)
}

/** 分钟数说成「2 小时 30 分钟」，与前端 formatFeedInterval 同口径 */
function formatFeedInterval(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (!hours) return `${mins} 分钟`
  if (!mins) return `${hours} 小时`
  return `${hours} 小时 ${mins} 分钟`
}

/** 订阅消息 time 类型要求 'YYYY-MM-DD HH:mm'（北京时间），格式不对会 47003 */
function formatTime(timestamp) {
  const parts = nowParts(timestamp)
  const shifted = new Date(timestamp + 8 * 60 * 60 * 1000)
  const pad = (item) => String(item).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(shifted.getUTCHours())}:${pad(
    shifted.getUTCMinutes(),
  )}`
}

/**
 * 上次容量：模板里是 character_string 类型，**只允许数字、字母和符号，写汉字会 47003**。
 * 所以母乳换成「分钟」（min）、配方奶和水换成「ml」、辅食本就没有数量，退回一个占位符号。
 */
function formatFeedAmount(record) {
  const amount = Number(record && record.amount_ml)
  if (Number.isFinite(amount) && amount > 0) return `${Math.round(amount)}ml`
  const duration = Number(record && record.duration_min)
  if (Number.isFinite(duration) && duration > 0) return `${Math.round(duration)}min`
  return '-'
}

/** 按字段类型的长度上限裁剪（thing 官方上限 20 字，phrase 5 字） */
function text(value, fallback, max) {
  const raw = String(value === undefined || value === null ? '' : value).trim()
  return (raw || fallback).slice(0, max)
}

// ---------------------------------------------------------------------------
// 数据读取与发送
// ---------------------------------------------------------------------------

/**
 * 取某家庭的全部 active 成员 openid。
 *
 * 一次 cron 里家庭数远小于宝宝数，同一家庭共用一次查询结果。
 * 失败不抛出：提醒是尽力而为，查不到就这家不发，不能中断其他宝宝。
 */
const memberCache = new Map()

async function familyMembers(familyId) {
  if (!familyId) return []
  if (memberCache.has(familyId)) return memberCache.get(familyId)

  let openids = []
  try {
    const { data } = await db
      .collection('family_members')
      .where({ family_id: familyId, status: 'active' })
      .limit(1000)
      .get()
    openids = data.map((row) => row.user_id).filter((id) => typeof id === 'string' && id)
  } catch (err) {
    console.error('[feeding-reminder] 读取家庭成员失败', familyId, err)
  }

  memberCache.set(familyId, openids)
  return openids
}

/** 取某宝宝最近一条喂养记录（整行，模板要用到时间/容量/类型）；没有记录时返回 null */
async function latestFeeding(baby) {
  try {
    const { data } = await db
      .collection('feeding_records')
      .where({ family_id: baby.family_id, baby_id: baby._id })
      .orderBy('record_time', 'desc')
      .limit(1)
      .get()
    return data && data.length ? data[0] : null
  } catch (err) {
    console.error('[feeding-reminder] 读取喂养记录失败', baby._id, err)
    return null
  }
}

/**
 * 拼模板数据。按宝宝拼一次即可，同家庭多个成员共用同一份内容。
 *
 * 每个字段的值必须符合模板里该字段的「类型」限制，否则发出去也是 47003：
 *   time             -> 'YYYY-MM-DD HH:mm'
 *   thing            -> 20 字以内且含汉字
 *   character_string -> 只允许数字/字母/符号
 *   phrase           -> 5 字以内汉字
 */
function buildMessage(record, recordTs, minutes, limit) {
  return {
    [KEY.lastAt]: { value: formatTime(recordTs) },
    [KEY.since]: { value: text(formatFeedInterval(minutes), '有一会儿了', 20) },
    [KEY.amount]: { value: formatFeedAmount(record) },
    [KEY.type]: { value: text(FEED_TYPE_LABEL[record.feed_type], '喂养', 5) },
    [KEY.note]: {
      value: text(`已超过 ${formatFeedInterval(limit)} 没喂奶，该喂奶啦`, '该喂奶啦', 20),
    },
  }
}

/** 发送单条；失败只记日志，不影响同一批的其他宝宝/成员 */
async function sendOne(babyId, data, touser) {
  try {
    await cloud.openapi.subscribeMessage.send({
      touser,
      templateId: TEMPLATE_ID,
      page: TARGET_PAGE,
      miniprogramState: MINIPROGRAM_STATE,
      data,
    })
    console.log('[feeding-reminder] 已发送', babyId, touser)
    return true
  } catch (err) {
    const errCode = err && (err.errCode || err.errcode)
    if (errCode === 43101) {
      // 用户没授权或额度已用完，属于常态，不当错误刷日志
      console.log('[feeding-reminder] 无订阅额度，跳过', touser)
    } else {
      console.error(
        '[feeding-reminder] 发送失败',
        errCode,
        (err && err.errMsg) || (err && err.message) || err,
        JSON.stringify(data),
      )
    }
    return false
  }
}

/**
 * 记下「这轮超时已经提醒过了」，避免下一个整点重复推。
 *
 * 写入失败不影响本次提醒（已经发出去了），只是下一小时可能会重推一次，可以接受。
 */
async function markReminded(babyId, nowIso) {
  try {
    await db.collection('babies').doc(babyId).update({ data: { feed_remind_at: nowIso } })
  } catch (err) {
    console.error('[feeding-reminder] 写入提醒时间失败', babyId, err)
  }
}

exports.main = async () => {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()

  // 只捞开了提醒的宝宝：从没设置过的宝宝连字段都没有，天然不匹配
  const { data } = await db.collection('babies').where({ feed_remind_enabled: true }).limit(1000).get()

  let overdue = 0
  let sent = 0
  let failed = 0

  for (let i = 0; i < data.length; i += 1) {
    const baby = data[i]
    if (!baby.family_id) continue

    const limit = resolveFeedInterval(baby, now)
    const record = await latestFeeding(baby)
    // 从来没喂过就没有起点，无从判断间隔，不提醒
    if (!record) continue

    const recordTs = new Date(record.record_time).getTime()
    if (!Number.isFinite(recordTs)) continue

    const minutes = Math.floor((now - recordTs) / 60000)
    if (minutes < limit) continue

    // 最近一条喂养记录晚于上次提醒 -> 这是新一轮超时；否则上一轮已经推过，静默
    const remindedTs = baby.feed_remind_at ? new Date(baby.feed_remind_at).getTime() : NaN
    if (Number.isFinite(remindedTs) && remindedTs >= recordTs) continue

    overdue += 1

    if (!TEMPLATE_ID) {
      console.log(
        '[feeding-reminder] 未配置模板 ID，仅判定不发送',
        baby._id,
        '已过',
        minutes,
        '分钟 上限',
        limit,
      )
      continue
    }

    const targets = await familyMembers(baby.family_id)
    if (!targets.length) {
      console.log('[feeding-reminder] 家庭无 active 成员，跳过', baby._id)
      continue
    }

    // 内容按宝宝拼一次，同家庭各成员共用。
    // ⚠️ 不能叫 data：循环体里若有 const data，会遮蔽上面查出来的宝宝列表 data，
    //    且 const 的暂时性死区覆盖整个块，导致循环开头的 data[i] 直接报
    //    "Cannot access 'data' before initialization"。
    const messageData = buildMessage(record, recordTs, minutes, limit)
    for (let j = 0; j < targets.length; j += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (await sendOne(baby._id, messageData, targets[j])) sent += 1
      else failed += 1
    }

    // 不论成员是否真的有额度，本轮都算提醒过了：订阅消息是一次性额度，
    // 重试也换不来额度，只会让下一小时再空跑一轮。
    await markReminded(baby._id, nowIso)
  }

  console.log('[feeding-reminder] 检查', data.length, '个宝宝，超时', overdue, '发送', sent, '失败', failed)
  return { checked: data.length, overdue, sent, failed }
}
