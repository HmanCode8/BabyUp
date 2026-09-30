/**
 * 数据导出云函数（迁移计划 · 阶段 5，对应 Supabase 侧 Edge Function `export-data`）。
 *
 * 入参：{}（无需参数，导出范围完全由登录态决定）
 *
 * 流程：
 *   1. 取 OPENID（云函数里由微信侧注入，前端伪造不了）
 *   2. 查出「我是 active 成员」的全部家庭
 *   3. 聚合导出这些家庭下的全部业务数据（与 Supabase 侧同样的 14 张表：
 *      13 张家庭维度 + 1 张账号维度 feedbacks）
 *   4. 返回 { ok: true, json: '<格式化后的 JSON 字符串>' }
 *
 * `schema_version` 只在结构变化（增删表、改字段名）时 +1：
 * 用户手里的备份是旧版时，我们能据此判断该按哪一版解释这个文件。
 *
 * 与 Supabase 侧的差异（都因为云开发没有 auth.users / 列默认值）：
 *   - user.email / user.created_at 恒为 null：云开发后端没有邮箱体系，profiles 也没有 created_at 列；
 *   - 集合里主键是 `_id`，这里统一映射成 `id` 再导出，导出文件与 Supabase 版结构保持一致。
 *
 * 安全约定：
 *   - 家庭范围完全由 OPENID 推导，前端无法指定别人的 family_id；
 *   - 照片只导出对象路径（storage_path / avatar_url / photo_url），不含图片二进制。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const CODE = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL: 'INTERNAL',
}

/** 云开发服务端单次查询上限就是 1000，超过的部分靠 skip 分页取 */
const PAGE_SIZE = 1000

/**
 * 家庭维度：按「我所属的家庭」导出。
 * families 表本身没有 family_id 列，按 _id 过滤；其余按 family_id 过滤（与 Supabase 侧一致）。
 */
const TABLES = [
  'families',
  'family_members',
  'babies',
  'baby_photos',
  'growth_records',
  'vaccinations',
  'feeding_records',
  'sleep_records',
  'diaper_records',
  'milestones',
  // 第三期新增（014）。原先漏了这两张，生病与体检记录一直不在备份里
  'illness_records',
  'checkup_records',
  // 照片文件夹：照片行导出时带的 album_id 就指向它，不导出的话备份里的照片会全部「无归属」
  'photo_albums',
]

/**
 * 账号维度：`feedbacks` 里**没有 family_id**（用户还没建家庭时也要能提交反馈），
 * 所以不能跟着上面的家庭过滤走，按键要换成 `user_id`（云开发侧就是 openid）。
 * 代价是它得单独取一次，见下面 main()。
 */
const ACCOUNT_TABLES = ['feedbacks']

/**
 * 导出文件的结构版本号。增删表或改字段名时 +1。
 * 云开发侧与 Supabase 侧必须保持一致，否则同一份备份换后端后版本对不上。
 */
const EXPORT_SCHEMA_VERSION = 1

/** 带 code 的业务错误，便于前端区分「重新登录」与「稍后重试」 */
function fail(message, code) {
  const err = new Error(message)
  err.code = code
  return err
}

function currentOpenId() {
  const context = cloud.getWXContext()
  const openid = context && context.OPENID
  if (!openid) throw fail('登录态已失效，请重新登录', CODE.UNAUTHORIZED)
  return openid
}

/** 集合文档 -> 客户端行：_id 补成 id（与 data 云函数的映射规则保持一致） */
function toClientRow(row) {
  const out = { id: row._id }
  Object.keys(row).forEach((key) => {
    if (key !== '_id') out[key] = row[key]
  })
  return out
}

function emptyTables() {
  const out = {}
  TABLES.concat(ACCOUNT_TABLES).forEach((table) => {
    out[table] = []
  })
  return out
}

/** 分页取全量，避免默认 100 条/次导致导出缺数据 */
async function fetchAll(collection, where) {
  const rows = []
  for (;;) {
    const res = await db
      .collection(collection)
      .where(where)
      .skip(rows.length)
      .limit(PAGE_SIZE)
      .get()
    rows.push(...res.data)
    if (res.data.length < PAGE_SIZE) return rows
  }
}

exports.main = async () => {
  try {
    const openid = currentOpenId()

    // 我参与的全部家庭（不看 role：viewer 也有权导出自己看得到的数据）
    const memberRes = await db
      .collection('family_members')
      .where({ user_id: openid, status: 'active' })
      .field({ family_id: true })
      .limit(PAGE_SIZE)
      .get()
    const familyIds = memberRes.data.map((row) => row.family_id)

    const payload = Object.assign(
      {
        schema_version: EXPORT_SCHEMA_VERSION,
        exported_at: new Date().toISOString(),
        user: { id: openid, email: null, created_at: null },
      },
      emptyTables(),
    )

    // 反馈是账号维度，与「有没有家庭」无关：放在早返回之前，一个家庭都没有也要导出来
    payload.feedbacks = (await fetchAll('feedbacks', { user_id: openid })).map(toClientRow)

    // 一个家庭都没有：仍然返回结构完整的空档案，前端不必区分两种返回
    if (!familyIds.length) {
      return { ok: true, json: JSON.stringify(payload, null, 2) }
    }

    for (const table of TABLES) {
      const where =
        table === 'families' ? { _id: _.in(familyIds) } : { family_id: _.in(familyIds) }
      payload[table] = (await fetchAll(table, where)).map(toClientRow)
    }

    console.log('[export-data] 导出完成', openid, '家庭数:', familyIds.length)
    return { ok: true, json: JSON.stringify(payload, null, 2) }
  } catch (err) {
    console.error('[export-data] 导出失败', err)
    return {
      ok: false,
      code: (err && err.code) || CODE.INTERNAL,
      message: (err && err.code) === CODE.UNAUTHORIZED ? err.message : '导出失败，请稍后重试',
    }
  }
}
