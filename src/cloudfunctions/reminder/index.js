/**
 * 疫苗提醒（订阅消息）定时云函数。
 *
 * 触发：见同目录 config.json 的 timer 触发器，每天 09:00 跑一次。
 * 逻辑：找出「计划接种日期 = 今天」且「还没接种」的疫苗，给该宝宝所属家庭的
 *       **全部 active 成员**逐个下发一条订阅消息（三期 P1-6 由「只发创建者」扩展而来）。
 *
 * 为什么发给全家人而不是只发 created_by：
 *   疫苗是全家的事，只提醒排计划的人等于其他家人收不到（爷爷奶奶带娃去打针的场景最常见）。
 *   代价是订阅消息是一次性的——每个成员必须自己授权过才有 1 条额度，没授权的会 43101 失败，
 *   所以发送必须逐个 try/catch，绝不能因为某个人没额度就中断整批。
 *
 * 为什么只发「今天到期」不发「已逾期」：
 *   逾期记录在疫苗页已经标红，再推消息属于骚扰。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

/** 订阅消息模板 ID（小程序后台 → 功能 → 订阅消息 → 我的模板） */
const TEMPLATE_ID = '9-P4ftotXMMapWSvVhH578lFR0LV4qvLewPMYyA0dns'

/** 点击消息卡片后跳转的页面 */
const TARGET_PAGE = 'pages/vaccine/vaccine'

/**
 * 跳转的小程序版本：小程序已在 2026-09-23 正式发布，所以用 'formal'。
 * 别改回 'trial'：体验版只有体验成员打得开，家人点卡片会提示无法打开。
 */
const MINIPROGRAM_STATE = 'formal'

/**
 * 模板关键词占位符（2026-09-21 从后台模板详情逐字抄下来的）。
 *
 * ⚠️ 写错不会报「字段缺失」，而是以 47003 发送失败，日志里能看到 errmsg 指明是哪个字段。
 *    模板编号 6486，标题「疫苗接种提醒」，详细内容：
 *      疫苗名称 {{thing1.DATA}}
 *      接种时间 {{thing2.DATA}}
 *      接种针数 {{short_thing12.DATA}}
 *      备注     {{thing5.DATA}}
 *    注意编号不是按位置递增的（thing1/thing2/short_thing12/thing5），不要凭顺序推。
 */
const KEY = {
  /** 疫苗名称 */
  name: 'thing1',
  /** 接种时间 */
  date: 'thing2',
  /** 接种针数 */
  dose: 'short_thing12',
  /** 备注 */
  note: 'thing5',
}

/**
 * 按字段类型的长度上限裁剪。
 *
 * thing 官方上限 20 字。short_thing 官方参数限制表里没有这一行（文档未覆盖），
 * 按「短事物」保守取 5 字 —— 本项目剂次实际值只有「第1剂」「第4剂」「加强针」这类 3 字，
 * 截到 5 字不会丢信息，也不会因为猜错上限而 47003。
 */
function text(value, fallback, max) {
  const raw = String(value === undefined || value === null ? '' : value).trim()
  return (raw || fallback).slice(0, max)
}

/**
 * 云函数运行环境时区不保证是北京时间，这里显式按 UTC+8 算「今天」，
 * 避免在 UTC 环境下把日期算错一天。
 */
function beijingDateString(timestamp) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 取某家庭的全部 active 成员 openid。
 *
 * 同一家庭的多个疫苗记录会共用一次查询结果（一次 cron 里家庭数远小于记录数），
 * 失败也不抛出：提醒是尽力而为，查不到成员时上层会退回记录创建者。
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
    console.error('[reminder] 读取家庭成员失败', familyId, err)
  }

  memberCache.set(familyId, openids)
  return openids
}

/** 发送单条；失败只记日志，不影响同一批的其他记录/成员 */
async function sendOne(record, today, touser) {
  const data = {
    [KEY.name]: { value: text(record.name, '疫苗接种', 20) },
    // 查的时候就是按 scheduled_date = today 捞的，兜底给 today 只为防字段被清空
    [KEY.date]: { value: text(record.scheduled_date, today, 20) },
    [KEY.dose]: { value: text(record.dose, '本次接种', 5) },
    [KEY.note]: { value: text(record.note, '记得带预防接种本', 20) },
  }

  try {
    await cloud.openapi.subscribeMessage.send({
      touser,
      templateId: TEMPLATE_ID,
      page: TARGET_PAGE,
      miniprogramState: MINIPROGRAM_STATE,
      data,
    })
    console.log('[reminder] 已发送', record._id, touser)
    return true
  } catch (err) {
    const errCode = err && (err.errCode || err.errcode)
    if (errCode === 43101) {
      // 用户没授权或额度已用完，属于常态，不当错误刷日志
      console.log('[reminder] 无订阅额度，跳过', touser)
    } else {
      console.error(
        '[reminder] 发送失败',
        errCode,
        (err && err.errMsg) || (err && err.message) || err,
        JSON.stringify(data),
      )
    }
    return false
  }
}

exports.main = async () => {
  const today = beijingDateString(Date.now())

  // 只按日期捞，是否已接种在内存里过滤：云数据库对 null 的匹配语义容易踩坑
  const { data } = await db
    .collection('vaccinations')
    .where({ scheduled_date: today })
    .limit(1000)
    .get()

  const due = data.filter((row) => !row.vaccinated_date && row.created_by)
  console.log('[reminder] 今日到期', today, '总数', data.length, '待提醒', due.length)

  let sent = 0
  let failed = 0
  for (let i = 0; i < due.length; i += 1) {
    const record = due[i]
    const members = await familyMembers(record.family_id)
    // 查不到成员（历史数据缺 family_id 等）时退回记录创建者，保证不比改动前更差
    const targets = members.length ? members : [record.created_by]
    for (let j = 0; j < targets.length; j += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (await sendOne(record, today, targets[j])) sent += 1
      else failed += 1
    }
  }

  return { date: today, total: due.length, sent, failed }
}
