/**
 * 账号注销云函数（迁移计划 · 阶段 5，对应 Supabase 侧 Edge Function `delete-account`）。
 *
 * 入参：{ confirm: string } —— 必须严格等于「删除」二字（前端双确认的第二道）
 *
 * 流程（与 Supabase 版一一对应）：
 *   1. 取 OPENID（云函数里由微信侧注入，前端伪造不了）——等价于 Supabase 的解析登录态
 *   2. 找出「我作为 owner 的 active 家庭」
 *   3. 先把要删的存储对象路径收集出来（删表后就查不到了）
 *   4. 删除这些家庭的业务数据
 *   5. 删除存储对象（尽力而为：失败只记日志，不影响注销本身）
 *   6. 删除「我在别人家庭里的成员关系」与 profiles 那行——等价于 Supabase 删 auth 用户后的级联
 *
 * 与 Supabase 侧的关键差异（云开发没有外键级联，必须手动逐个集合删）：
 *   - Postgres 里删 families 会级联清掉 10 张子表，这里必须按 family_id 逐个 remove；
 *   - Postgres 里删 auth.users 会级联清掉 family_members 与 profiles，这里要手动删；
 *   - app_logs 在 Supabase 侧是 `on delete set null`（日志保留、只把 user_id 置空），
 *     云开发同样保留日志行不动，保持一致。
 *
 * 安全约定：
 *   - 只能注销自己：身份只认 OPENID，前端传什么都不信；
 *   - 前端必须明确传 confirm=删除，缺省或写错一律拒绝；
 *   - 只会删「我是 owner 的家庭」，别人当 owner 的家庭不受影响（只退出我的成员关系）。
 *
 * ⚠️ 调用前请把本函数的超时时间调大（云开发控制台 → 云函数 → delete-account → 配置 → 超时时间，
 *    默认 3 秒不够，建议 20 秒）。数据量大时本函数要串行删多个集合。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const CODE = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL: 'INTERNAL',
}

/** 前端要求用户输入的确认词 */
const CONFIRM_WORD = '删除'

/** 云开发服务端单次查询上限 1000 */
const PAGE_SIZE = 1000

/** 云存储 deleteFile 单次上限（官方：一次最多 50 个） */
const FILE_BATCH = 50

/**
 * 云存储文件 ID 前缀（去掉 `cloud://` 的部分）。
 * 必须与 src/config/index.js 的 CLOUD_FILE_ID_PREFIX 保持一致，
 * 改了环境/存储桶时两处一起改（云函数跑在云端，读不到前端 config）。
 */
const FILE_ID_PREFIX =
  'cloudbase-d3gmqwgbx043c78eb.636c-cloudbase-d3gmqwgbx043c78eb-1317399262/'

/** 有 family_id 的家庭子表：删家庭时逐张清空（Supabase 侧靠外键级联） */
const FAMILY_CHILD_COLLECTIONS = [
  'babies',
  'baby_photos',
  'growth_records',
  'vaccinations',
  'feeding_records',
  'sleep_records',
  'diaper_records',
  'milestones',
]

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

/** 相对路径 → 文件 ID（拼回 cloud:// 协议头，与前端 storage.js 的规则一致） */
function toFileId(path) {
  if (!path) return ''
  if (/^(cloud|https?):\/\//.test(path)) return path
  return `cloud://${FILE_ID_PREFIX}${path}`
}

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * 按条件删光一个集合里的匹配行，返回删除条数。
 * 服务端 where().remove() 一次能删的条数有上限，所以循环到删不动为止；
 * 加最大轮次兜底，避免异常情况下死循环把云函数耗到超时。
 */
async function removeWhere(collection, where) {
  let removed = 0
  for (let round = 0; round < 20; round += 1) {
    const res = await db.collection(collection).where(where).remove()
    const count = (res && res.stats && res.stats.removed) || 0
    removed += count
    if (count === 0) break
  }
  return removed
}

/** 分页取全量（收集存储路径时用，避免默认 100 条/次漏数据） */
async function fetchAll(collection, where, field) {
  const rows = []
  for (;;) {
    let query = db.collection(collection).where(where)
    if (field) query = query.field(field)
    const res = await query.skip(rows.length).limit(PAGE_SIZE).get()
    rows.push(...res.data)
    if (res.data.length < PAGE_SIZE) return rows
  }
}

/** 删除存储对象：尽力而为，失败只记日志（与 Supabase 版一致，不影响注销本身） */
async function removeFiles(objectPaths) {
  if (!objectPaths.length) return 0
  const fileIds = objectPaths.map(toFileId)
  let removed = 0
  for (const ids of chunk(fileIds, FILE_BATCH)) {
    try {
      const res = await cloud.deleteFile({ fileList: ids })
      const rows = (res && res.fileList) || []
      rows.forEach((row) => {
        if (row && row.status === 0) removed += 1
        else if (row) console.error('[delete-account] 删除文件失败（不影响注销）', row)
      })
    } catch (err) {
      console.error('[delete-account] 删除文件异常（不影响注销）', err)
    }
  }
  return removed
}

exports.main = async (event) => {
  try {
    const body = event || {}
    if (String(body.confirm === undefined || body.confirm === null ? '' : body.confirm).trim() !== CONFIRM_WORD) {
      return { ok: false, code: 'BAD_REQUEST', message: `请确认后重试（需要输入「${CONFIRM_WORD}」二字）` }
    }

    const openid = currentOpenId()
    console.log('[delete-account] 开始注销', openid)

    // ---------- 1. 找出「我作为 owner 的家庭」 ----------
    const ownerRes = await db
      .collection('family_members')
      .where({ user_id: openid, role: 'owner', status: 'active' })
      .field({ family_id: true })
      .limit(PAGE_SIZE)
      .get()
    const familyIds = ownerRes.data.map((row) => row.family_id)

    // ---------- 2. 先把要删的存储对象路径收集出来（删表后就查不到了） ----------
    const objectPaths = []
    if (familyIds.length) {
      const where = { family_id: _.in(familyIds) }
      const [photoRows, babyRows, milestoneRows] = await Promise.all([
        fetchAll('baby_photos', where, { storage_path: true }),
        fetchAll('babies', where, { avatar_url: true }),
        fetchAll('milestones', where, { photo_url: true }),
      ])
      photoRows.forEach((row) => row.storage_path && objectPaths.push(row.storage_path))
      babyRows.forEach((row) => row.avatar_url && objectPaths.push(row.avatar_url))
      milestoneRows.forEach((row) => row.photo_url && objectPaths.push(row.photo_url))
    }

    // ---------- 3. 删除这些家庭的业务数据（Supabase 侧是外键级联，这里逐个集合删） ----------
    let deletedFamilies = 0
    if (familyIds.length) {
      const where = { family_id: _.in(familyIds) }
      for (const collection of FAMILY_CHILD_COLLECTIONS) {
        await removeWhere(collection, where)
      }
      await removeWhere('family_invitations', where)
      await removeWhere('family_members', where)
      deletedFamilies = await removeWhere('families', { _id: _.in(familyIds) })
    }

    // ---------- 4. 删除存储对象（尽力而为） ----------
    const removedFiles = await removeFiles(objectPaths)

    // ---------- 5. 清掉「我在别人家庭里的成员关系」与 profiles（等价于 Supabase 删 auth 用户后的级联） ----------
    // 第 3 步已删掉我作为 owner 的行，这里剩下的都是我加入别人的家庭（含 removed 的历史行）
    await removeWhere('family_members', { user_id: openid })
    await removeWhere('profiles', { _id: openid })

    console.log(
      '[delete-account] 注销完成',
      openid,
      '家庭:',
      deletedFamilies,
      '文件:',
      removedFiles,
    )
    return { ok: true, deletedFamilies, removedFiles }
  } catch (err) {
    console.error('[delete-account] 注销失败', err)
    return {
      ok: false,
      code: (err && err.code) || CODE.INTERNAL,
      message: (err && err.code) === CODE.UNAUTHORIZED ? err.message : '注销失败，请稍后重试',
    }
  }
}
