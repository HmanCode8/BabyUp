/**
 * 云开发通用数据访问云函数（迁移计划 · 阶段 2）。
 *
 * 为什么所有读写都走这一个云函数：
 *   云开发的安全规则只能按 `_openid` 判断，做不了「跨集合的成员校验」
 *   （例如「必须是 baby_photos.family_id 对应家庭的 active 成员才能读照片」）。
 *   所以客户端不直连数据库，统一由本函数用管理员权限访问、在函数内做鉴权。
 *
 * 入参（event）：
 *   { action, table, where, order, skip, limit, count, columns, rows, fn, args }
 * 出参：
 *   成功 { ok: true, data, total? }
 *   失败 { ok: false, code, message }
 *
 * 身份：一律取 cloud.getWXContext().OPENID，前端传什么都不信。
 *   family_members.user_id / created_by / app_logs.user_id 存的就是 OPENID。
 *
 * `_id` 与 `id` 的透明映射：
 *   集合沿用云开发自动生成的 `_id`；入口把条件/数据里的 `id` 改写成 `_id`，
 *   出口把 `_id` 补成 `id`。业务层（src/services/*.js）一行不用改。
 *
 * 原 Supabase 侧的 6 个存储过程（create_family / join_family_by_invite /
 * create_family_invitation / set_member_role / set_my_nickname / remove_family_member）
 * 在这里用 JS 重写；join_family_by_code 是已废弃的一期接口，前端未调用，故未实现。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const CODE = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONTENT_RISKY: 'CONTENT_RISKY',
  INTERNAL: 'INTERNAL',
}

/** 统一的业务错误：带 code，前端翻译成 ApiError */
class DataError extends Error {
  constructor(message, code = CODE.BAD_REQUEST) {
    super(message)
    this.code = code
  }
}

function fail(message, code) {
  throw new DataError(message, code)
}

/** 云开发没有列默认值，这些集合的 created_at 由云函数补 */
const HAS_CREATED_AT = [
  'families',
  'family_members',
  'family_invitations',
  'babies',
  'baby_photos',
  'growth_records',
  'vaccinations',
  'feeding_records',
  'sleep_records',
  'diaper_records',
  'milestones',
  'app_logs',
  'feedbacks',
  'illness_records',
  'checkup_records',
  'photo_albums',
]

/**
 * 第三期新增的集合：写入时自动维护 updated_at（云开发没有列默认值）。
 * 不动 babies / profiles 的既有行为，避免影响老数据。
 */
const TOUCH_UPDATED_AT = ['feedbacks', 'illness_records', 'checkup_records']

/** 家庭子表：读 = active 成员，写 = active 且非 viewer */
const FAMILY_CHILD_TABLES = [
  'babies',
  'baby_photos',
  'growth_records',
  'vaccinations',
  'feeding_records',
  'sleep_records',
  'diaper_records',
  'milestones',
  'illness_records',
  'checkup_records',
  // 照片文件夹（相册）。权限跟 baby_photos 一致，另外多两条业务约束：
  // 同一宝宝下不重名、每个宝宝最多 ALBUM_MAX_PER_BABY 个（见 assertAlbumCreatable）
  'photo_albums',
]

/** 文件夹名称长度上限（与 Supabase 侧约束、前端输入框 maxlength 保持一致） */
const ALBUM_NAME_MAX = 20
/** 每个宝宝最多能建多少个文件夹：纯防滥用，家人使用远远用不到 */
const ALBUM_MAX_PER_BABY = 50

/** 邀请码字符集：与 Supabase 侧 generate_invite_code 一致，去掉易混淆的 I/O/0/1 */
const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * 用户反馈（feedbacks）：账号维度表，没有 family_id，不能走家庭鉴权。
 * 鉴权规则 = 「只能看/写自己提交的」，身份字段由服务端从 OPENID 注入。
 * 超管在运维后台看全部、并改 status / 写一句回复（见 actionAdminFeedbacks），
 * 提交人在「我的 → 意见反馈」里能看到回复。
 */
const FEEDBACK_TYPES = ['bug', 'suggestion', 'content', 'other']
const FEEDBACK_MIN_LEN = 5
const FEEDBACK_MAX_LEN = 500
const FEEDBACK_MAX_IMAGES = 3
const FEEDBACK_MAX_CONTACT = 50
/** 超管处理反馈时写的那一句回复（给提交人看） */
const FEEDBACK_MAX_REPLY = 200

/**
 * 生病记录（illness_records）：家庭子表，走 FAMILY_CHILD_TABLES 的成员鉴权。
 * 症状是枚举（前端固定 8 项），服务端必须再校验一次 —— 前端校验可以被绕过。
 */
const ILLNESS_SYMPTOMS = [
  'fever',
  'cough',
  'runny_nose',
  'vomit',
  'diarrhea',
  'rash',
  'poor_appetite',
  'other',
]
const ILLNESS_MAX_PHOTOS = 3
const ILLNESS_MAX_MEDICINES = 10
const ILLNESS_TEMPERATURE_MIN = 30
const ILLNESS_TEMPERATURE_MAX = 45

/** 生病记录里的纯文本字段（label 只用于错误提示） */
const ILLNESS_TEXT_FIELDS = [
  { key: 'hospital', label: '就诊医院', max: 50 },
  { key: 'doctor', label: '医生', max: 30 },
  { key: 'diagnosis', label: '诊断', max: 200 },
  { key: 'allergy_note', label: '过敏/不良反应', max: 200 },
  { key: 'note', label: '备注', max: 200 },
]

/** 单条用药里的文本字段（days 是数字，单独处理） */
const ILLNESS_MEDICINE_FIELDS = [
  { key: 'dose', label: '剂量', max: 20 },
  { key: 'unit', label: '单位', max: 10 },
  { key: 'frequency', label: '频次', max: 30 },
  { key: 'note', label: '备注', max: 50 },
]

/**
 * 儿保体检记录（checkup_records）：家庭子表，走 FAMILY_CHILD_TABLES 的成员鉴权。
 * 与生病记录最大的不同是「体检 ↔ 生长」联动（文档 4.4），联动逻辑在
 * syncCheckupGrowth() 里，写入体检记录后由服务端补齐，不交给页面。
 */
const CHECKUP_MAX_PHOTOS = 3

/** 体检的数值字段：min/max 只拦明显录错的值，不做任何医学判断（文档明确不做 WHO 百分位评估） */
const CHECKUP_NUMERIC_FIELDS = [
  { key: 'height_cm', label: '身高', min: 20, max: 150, decimals: 1 },
  { key: 'weight_kg', label: '体重', min: 0.5, max: 60, decimals: 2 },
  { key: 'head_cm', label: '头围', min: 20, max: 70, decimals: 1 },
  { key: 'hemoglobin', label: '血红蛋白', min: 10, max: 300, decimals: 1 },
]

/** 体检记录里的纯文本字段（label 只用于错误提示） */
const CHECKUP_TEXT_FIELDS = [
  { key: 'hospital', label: '体检机构', max: 50 },
  { key: 'development', label: '发育评估', max: 500 },
  { key: 'doctor_advice', label: '医生建议', max: 500 },
]

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString()
}

function asArray(value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function trimOrNull(value) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  return text === '' ? null : text
}

/** 集合文档 -> 客户端行：_id 补成 id */
function toClientRow(row) {
  if (!row) return row
  const out = { id: row._id }
  Object.keys(row).forEach((key) => {
    if (key !== '_id') out[key] = row[key]
  })
  return out
}

function toClientRows(rows) {
  return (rows || []).map(toClientRow)
}

/** 客户端行 -> 集合文档：id 改写为 _id */
function toServerRow(row) {
  const out = {}
  Object.keys(row || {}).forEach((key) => {
    if (key === 'id') {
      if (row.id !== undefined && row.id !== null && row.id !== '') out._id = row.id
    } else {
      out[key] = row[key]
    }
  })
  return out
}

/**
 * 把一批要写入的字段逐个包成「显式赋值」（$set）。
 *
 * ⚠️ 云开发的 update **不能直接传普通对象** —— SDK 的 flattenQueryObject 里有两个坑：
 *   1. 普通对象会被**扁平化**成点号路径，于是 `{feature_flags: {...}}` 是「合并」
 *      而不是替换：本地删掉的 key 会被合并回来（「跟随全局」因此点了没反应）；
 *   2. 扁平化开头有 `if (!value) continue` —— **falsy 值整个被丢掉**，
 *      于是「把字段清空」（null / false / 0 / ''）静默不生效。
 * 包一层 $set 就绕开了扁平化，语义变成「把这个字段整体替换成我给的值」，
 * 空值与数组都按原样写入。
 *
 * 只能用在 update 上；新增（add）的数据里不能出现更新指令。
 * undefined 的字段直接跳过：JSON 里本来也传不过去，跳过等价于「不动这个字段」。
 */
function explicitSet(source) {
  const out = {}
  Object.keys(source || {}).forEach((key) => {
    if (source[key] === undefined) return
    out[key] = _.set(source[key])
  })
  return out
}

/** 写入前补默认值（云开发没有列默认值） */
function prepareDoc(table, doc) {
  if (HAS_CREATED_AT.indexOf(table) >= 0 && !doc.created_at) doc.created_at = nowIso()
  if (TOUCH_UPDATED_AT.indexOf(table) >= 0 && !doc.updated_at) doc.updated_at = nowIso()
  if ((table === 'babies' || table === 'profiles') && !doc.updated_at) {
    doc.updated_at = nowIso()
  }
}

// ---------------------------------------------------------------------------
// 查询条件编译（客户端只传普通 JSON，命令对象在这里构造）
// ---------------------------------------------------------------------------

function toCommand(condition) {
  const value = condition.value
  switch (condition.op) {
    case 'eq':
      return value
    case 'neq':
      return _.neq(value)
    case 'gt':
      return _.gt(value)
    case 'gte':
      return _.gte(value)
    case 'lt':
      return _.lt(value)
    case 'lte':
      return _.lte(value)
    case 'in':
      return _.in(value)
    // 「字段为空」：相册视图里的「未分类」照片走这条。返回裸 null 而不是 _.eq(null)，
    // 因为 MongoDB 的 { field: null } 同时匹配「值是 null」与「字段不存在」——
    // 老照片是在加 album_id 之前拍的，压根没有这个字段。
    case 'isnull':
      return null
    default:
      return fail(`不支持的查询操作符：${condition.op}`, CODE.BAD_REQUEST)
  }
}

/** 把 [{ field, op, value }] 编译成云开发 where 条件；同一字段的多个操作符用 and 串起来 */
function buildWhere(conditions) {
  const list = (conditions || []).filter((item) => item && item.field)
  if (!list.length) return null
  const grouped = new Map()
  list.forEach((item) => {
    const field = item.field === 'id' ? '_id' : item.field
    const bucket = grouped.get(field) || []
    bucket.push(item)
    grouped.set(field, bucket)
  })
  const query = {}
  grouped.forEach((bucket, field) => {
    if (bucket.length === 1) query[field] = toCommand(bucket[0])
    else query[field] = _.and.apply(_, bucket.map(toCommand))
  })
  return query
}

function buildField(columns) {
  const list = (columns || []).filter(Boolean)
  if (!list.length) return null
  const field = {}
  list.forEach((name) => {
    field[name === 'id' ? '_id' : name] = true
  })
  // 投影必须显式带上 _id：出口要把它映射成 id，业务层全靠这个字段定位行
  field._id = true
  return field
}

function applyOrder(query, order) {
  let result = query
  asArray(order).forEach((item) => {
    if (!item || !item.field) return
    const field = item.field === 'id' ? '_id' : item.field
    result = result.orderBy(field, item.direction === 'desc' ? 'desc' : 'asc')
  })
  return result
}

/** 取出某个字段上的等值条件值（用于定位 family_id） */
function eqValues(conditions, field) {
  return conditions
    .filter((item) => item.field === field && item.op === 'eq' && item.value)
    .map((item) => item.value)
}

/** 取出某个字段上的 in 条件值 */
function inValues(conditions, field) {
  return conditions
    .filter((item) => item.field === field && item.op === 'in')
    .reduce((acc, item) => acc.concat(asArray(item.value)), [])
}

/** 干掉某字段上的全部条件，再强制写一个等值条件（身份字段不允许客户端指定） */
function forceEq(conditions, field, value) {
  const rest = conditions.filter((item) => item.field !== field)
  rest.push({ field, op: 'eq', value })
  return rest
}

// ---------------------------------------------------------------------------
// 鉴权
// ---------------------------------------------------------------------------

function currentUserId() {
  const context = cloud.getWXContext()
  const openid = context && context.OPENID
  if (!openid) fail('登录态已失效，请重新登录', CODE.UNAUTHORIZED)
  return openid
}

/**
 * 请求级鉴权缓存：key 是 `${userId}|${familyId}`，value 是「查成员关系」这个 Promise。
 *
 * 为什么需要：一次请求里同一个 (人, 家庭) 常被反复校验 ——
 * 按 family_id 列表查询要为每个 id 校验一次，批量插入/更新要逐行校验一次，
 * 结果就是「客户端发一次查询、服务端查 N 次同一个成员关系」。
 *
 * ⚠️ 只在本次请求内有效：main 进来第一件事就是清空。热实例会复用模块变量，
 * 跨请求留着上一次的结论就是越权漏洞。
 */
const membershipCache = new Map()

function findMembership(userId, familyId) {
  const key = `${userId}|${familyId}`
  if (membershipCache.has(key)) return membershipCache.get(key)
  const task = db
    .collection('family_members')
    .where({ family_id: familyId, user_id: userId, status: 'active' })
    .limit(1)
    .get()
    .then((res) => res.data[0] || null)
  // 存 Promise 而不是结果：同一请求里并发发起的重复校验也只打库一次
  membershipCache.set(key, task)
  return task
}

/** 必须是该家庭的 active 成员；needWrite 时 viewer 也会被拒 */
async function assertMember(userId, familyId, needWrite) {
  if (!familyId) fail('缺少家庭标识', CODE.BAD_REQUEST)
  const member = await findMembership(userId, familyId)
  if (!member) fail('你不是该家庭的成员，无权访问该数据', CODE.FORBIDDEN)
  if (needWrite && member.role === 'viewer') fail('只读成员不能修改数据', CODE.FORBIDDEN)
  return member
}

async function assertOwner(userId, familyId) {
  const member = await assertMember(userId, familyId, true)
  if (member.role !== 'owner') fail('只有家庭创建者可以执行该操作', CODE.FORBIDDEN)
  return member
}

/** 请求级缓存：同一个用户在一次请求里最多查一次「我属于哪些家庭」 */
const activeFamilyIdsCache = new Map()

/** 我作为 active 成员的全部家庭 id */
function listActiveFamilyIds(userId) {
  if (activeFamilyIdsCache.has(userId)) return activeFamilyIdsCache.get(userId)
  const task = db
    .collection('family_members')
    .where({ user_id: userId, status: 'active' })
    .field({ family_id: true })
    .limit(1000)
    .get()
    .then((res) => res.data.map((row) => row.family_id))
  activeFamilyIdsCache.set(userId, task)
  return task
}

/** 清空请求级缓存；只在 main 开头调（见上面 membershipCache 的说明） */
function resetAuthCache() {
  membershipCache.clear()
  activeFamilyIdsCache.clear()
}

async function getDocById(table, id) {
  if (!id) return null
  const res = await db.collection(table).where({ _id: id }).limit(1).get()
  return res.data[0] || null
}

/**
 * 反馈内容校验并归一化（文档 4.2 的服务端校验）。
 * 前端也会校验一遍，但客户端可以被绕过，这里必须再拦一次。
 */
function normalizeFeedbackDoc(doc) {
  const content = trimOrNull(doc.content)
  if (!content) fail('请填写问题描述', CODE.BAD_REQUEST)
  if (content.length < FEEDBACK_MIN_LEN) {
    fail(`问题描述至少 ${FEEDBACK_MIN_LEN} 个字`, CODE.BAD_REQUEST)
  }
  if (content.length > FEEDBACK_MAX_LEN) {
    fail(`问题描述最多 ${FEEDBACK_MAX_LEN} 个字`, CODE.BAD_REQUEST)
  }
  doc.content = content

  const type = trimOrNull(doc.type) || 'other'
  if (FEEDBACK_TYPES.indexOf(type) < 0) fail('反馈类型不正确', CODE.BAD_REQUEST)
  doc.type = type

  const contact = trimOrNull(doc.contact)
  if (contact && contact.length > FEEDBACK_MAX_CONTACT) {
    fail(`联系方式最多 ${FEEDBACK_MAX_CONTACT} 个字`, CODE.BAD_REQUEST)
  }
  doc.contact = contact

  const images = asArray(doc.images).filter((path) => !!trimOrNull(path))
  if (images.length > FEEDBACK_MAX_IMAGES) {
    fail(`最多上传 ${FEEDBACK_MAX_IMAGES} 张截图`, CODE.BAD_REQUEST)
  }
  doc.images = images
}

/**
 * 生病记录校验并归一化（文档 4.3 的服务端校验）。
 * 症状/体温范围/用药结构/图片张数都在这里拦；文本字段统一 trim 成 null 或字符串。
 */
function normalizeIllnessDoc(doc) {
  const occurredAt = trimOrNull(doc.occurred_at)
  if (!occurredAt) fail('请选择发病时间', CODE.BAD_REQUEST)
  doc.occurred_at = occurredAt

  const symptoms = asArray(doc.symptoms)
    .map((item) => String(item).trim())
    .filter(Boolean)
  if (!symptoms.length) fail('请至少选择一项症状', CODE.BAD_REQUEST)
  symptoms.forEach((item) => {
    if (ILLNESS_SYMPTOMS.indexOf(item) < 0) fail(`症状标签不正确：${item}`, CODE.BAD_REQUEST)
  })
  doc.symptoms = symptoms

  if (doc.temperature === undefined || doc.temperature === null || doc.temperature === '') {
    doc.temperature = null
  } else {
    const temperature = Number(doc.temperature)
    if (
      !Number.isFinite(temperature) ||
      temperature < ILLNESS_TEMPERATURE_MIN ||
      temperature > ILLNESS_TEMPERATURE_MAX
    ) {
      fail(
        `体温应在 ${ILLNESS_TEMPERATURE_MIN}~${ILLNESS_TEMPERATURE_MAX} ℃ 之间`,
        CODE.BAD_REQUEST,
      )
    }
    doc.temperature = Math.round(temperature * 10) / 10
  }

  const medicines = []
  asArray(doc.medicines).forEach((item) => {
    if (!item || typeof item !== 'object') return
    const name = trimOrNull(item.name)
    // 只留填了药名的行：用户点了「添加用药」又没填内容，不该存成一条空记录
    if (!name) return
    if (name.length > 50) fail('药品名最多 50 个字', CODE.BAD_REQUEST)
    const row = { name }
    ILLNESS_MEDICINE_FIELDS.forEach((field) => {
      const text = trimOrNull(item[field.key])
      if (text && text.length > field.max) {
        fail(`用药${field.label}最多 ${field.max} 个字`, CODE.BAD_REQUEST)
      }
      row[field.key] = text
    })
    const days = Number(item.days)
    row.days = Number.isFinite(days) && days > 0 ? Math.round(days) : null
    medicines.push(row)
  })
  if (medicines.length > ILLNESS_MAX_MEDICINES) {
    fail(`最多记录 ${ILLNESS_MAX_MEDICINES} 条用药`, CODE.BAD_REQUEST)
  }
  doc.medicines = medicines

  ILLNESS_TEXT_FIELDS.forEach((field) => {
    const text = trimOrNull(doc[field.key])
    if (text && text.length > field.max) {
      fail(`${field.label}最多 ${field.max} 个字`, CODE.BAD_REQUEST)
    }
    doc[field.key] = text
  })

  const photos = asArray(doc.photos)
    .map((item) => trimOrNull(item))
    .filter(Boolean)
  if (photos.length > ILLNESS_MAX_PHOTOS) {
    fail(`最多上传 ${ILLNESS_MAX_PHOTOS} 张图片`, CODE.BAD_REQUEST)
  }
  doc.photos = photos
}

/**
 * 儿保体检记录校验并归一化（文档 4.4 的服务端校验）。
 * month_age 由客户端按宝宝生日算好传上来（页面上只读展示、不手填），这里只做整数兜底；
 * growth_id 是服务端自己维护的联动字段，客户端传什么都不认（见 guardInsert / guardUpsert）。
 */
function normalizeCheckupDoc(doc) {
  const checkupDate = trimOrNull(doc.checkup_date)
  if (!checkupDate) fail('请选择体检日期', CODE.BAD_REQUEST)
  doc.checkup_date = checkupDate

  const months = Number(doc.month_age)
  doc.month_age = Number.isFinite(months) && months >= 0 ? Math.round(months) : null

  CHECKUP_NUMERIC_FIELDS.forEach((field) => {
    const raw = doc[field.key]
    if (raw === undefined || raw === null || raw === '') {
      doc[field.key] = null
      return
    }
    const value = Number(raw)
    if (!Number.isFinite(value) || value < field.min || value > field.max) {
      fail(`${field.label}应在 ${field.min}~${field.max} 之间`, CODE.BAD_REQUEST)
    }
    const factor = Math.pow(10, field.decimals)
    doc[field.key] = Math.round(value * factor) / factor
  })

  // 建议下次体检日期：只做提醒，允许为空
  doc.next_date = trimOrNull(doc.next_date)

  CHECKUP_TEXT_FIELDS.forEach((field) => {
    const text = trimOrNull(doc[field.key])
    if (text && text.length > field.max) {
      fail(`${field.label}最多 ${field.max} 个字`, CODE.BAD_REQUEST)
    }
    doc[field.key] = text
  })

  const photos = asArray(doc.photos)
    .map((item) => trimOrNull(item))
    .filter(Boolean)
  if (photos.length > CHECKUP_MAX_PHOTOS) {
    fail(`最多上传 ${CHECKUP_MAX_PHOTOS} 张图片`, CODE.BAD_REQUEST)
  }
  doc.photos = photos

  delete doc.growth_id
}

/**
 * 照片文件夹（相册）字段规范化：名称去空白、限长，sort_order 归成数字。
 * 与 Supabase 侧的列约束保持一致。
 */
function normalizeAlbumDoc(doc) {
  const name = trimOrNull(doc.name)
  if (!name) fail('请填写文件夹名称', CODE.BAD_REQUEST)
  if (name.length > ALBUM_NAME_MAX) {
    fail(`文件夹名称最多 ${ALBUM_NAME_MAX} 个字`, CODE.BAD_REQUEST)
  }
  doc.name = name
  const sort = Number(doc.sort_order)
  doc.sort_order = Number.isFinite(sort) ? sort : 0
}

/**
 * 同一宝宝下不能有同名文件夹（exceptId 用于「改名」时排除自己）。
 *
 * 集合上还有唯一索引 idx_album_unique_name 兜底 —— 先查后写之间有并发窗口，
 * 这里查一遍只是为了给出人话的提示，撞到索引报出来的是内部错误码。
 */
async function assertAlbumNameFree(doc, exceptId) {
  const res = await db
    .collection('photo_albums')
    .where({ family_id: doc.family_id, baby_id: doc.baby_id, name: doc.name })
    .limit(2)
    .get()
  const hit = (res.data || []).some((row) => row._id !== exceptId)
  if (hit) fail('已经有同名文件夹了', 'DUPLICATE_NAME')
}

/** 新建相册前的数量校验（必须在 assertMember 之后调用，否则可以用别人的 family_id 探数据） */
async function assertAlbumCountUnderLimit(doc) {
  const { total } = await db
    .collection('photo_albums')
    .where({ family_id: doc.family_id, baby_id: doc.baby_id })
    .count()
  if (total >= ALBUM_MAX_PER_BABY) {
    fail(`一个宝宝最多建 ${ALBUM_MAX_PER_BABY} 个文件夹`, 'ALBUM_LIMIT')
  }
}

/** 走 insert 新建相册时的两条校验 */
async function assertAlbumCreatable(doc) {
  await assertAlbumNameFree(doc, null)
  await assertAlbumCountUnderLimit(doc)
}

/**
 * 把某个相册下的照片全部移回「未分类」（album_id 置空）。
 *
 * Supabase 侧靠外键的 `on delete set null` 自动完成，云开发没有外键，只能手动清。
 * 分批 + 循环：服务端一次 update 能覆盖的条数有限，照片多的相册要跑几轮；
 * 加最大轮次兜底，避免异常情况下死循环把云函数耗到超时。
 */
async function detachAlbumPhotos(album) {
  for (let round = 0; round < 20; round += 1) {
    const res = await db
      .collection('baby_photos')
      .where({ family_id: album.family_id, album_id: album._id })
      .field({ _id: true })
      .limit(1000)
      .get()
    const ids = (res.data || []).map((row) => row._id)
    if (!ids.length) return
    // explicitSet 是必须的：直接传普通对象时云开发会把 falsy 值（null）整个丢掉，
    // 「把 album_id 清空」会静默失效
    await db
      .collection('baby_photos')
      .where({ _id: _.in(ids) })
      .update({ data: explicitSet({ album_id: null }) })
  }
  console.warn('[data] 相册解绑照片未清干净', album._id)
}

/** 新增时的鉴权 */
async function guardInsert(userId, table, doc) {
  if (table === 'app_logs') return
  if (table === 'profiles') {
    doc._id = userId
    return
  }
  if (table === 'feedbacks') {
    normalizeFeedbackDoc(doc)
    // 身份与状态一律服务端定，前端传什么都不认
    doc.user_id = userId
    doc.created_by = userId
    doc.status = 'pending'
    return
  }
  if (table === 'families') fail('请通过 create_family 创建家庭', CODE.FORBIDDEN)
  if (table === 'family_members') fail('成员关系只能通过创建/加入家庭变更', CODE.FORBIDDEN)
  if (table === 'family_invitations') {
    fail('请通过 create_family_invitation 生成邀请码', CODE.FORBIDDEN)
  }
  if (table === 'vaccine_library') fail('疫苗字典不可写', CODE.FORBIDDEN)
  if (FAMILY_CHILD_TABLES.indexOf(table) >= 0) {
    if (table === 'illness_records') normalizeIllnessDoc(doc)
    if (table === 'checkup_records') {
      normalizeCheckupDoc(doc)
      // 身份服务端定，前端传什么都不认（与 feedbacks 同一套做法）
      doc.created_by = userId
    }
    if (table === 'photo_albums') {
      normalizeAlbumDoc(doc)
      doc.created_by = userId
    }
    await assertMember(userId, doc.family_id, true)
    // 重名与数量校验放在鉴权之后：否则可以用一个自己不属于的 family_id 去探别人家有几个相册
    if (table === 'photo_albums') await assertAlbumCreatable(doc)
    return
  }
  fail(`不支持的集合：${table}`, CODE.BAD_REQUEST)
}

/**
 * 整行覆盖（upsert）时的鉴权。
 *
 * existing 是同 id 的库里已有行（新增时为 null）。鉴权必须同时取决于「已有行」：
 * 否则 A 家庭的成员可以拿 B 家庭某行的 id、把 family_id 填成 A 提交上来，
 * 从而改写别的家庭的数据（Supabase 侧是靠 RLS 的 USING 子句挡住这类跨家庭更新的）。
 * 因此这里一律按已有行的 family_id 鉴权，并把 family_id 钉死，不允许整行写回时挪家庭。
 */
async function guardUpsert(userId, table, doc, existing) {
  if (table === 'profiles') {
    doc._id = userId
    return
  }
  if (table === 'families') {
    await assertOwner(userId, doc._id)
    return
  }
  if (table === 'family_invitations') {
    const familyId = (existing || doc).family_id
    await assertOwner(userId, familyId)
    doc.family_id = familyId
    return
  }
  if (table === 'family_members') {
    fail('成员关系只能通过创建/加入/移除成员等接口变更', CODE.FORBIDDEN)
  }
  if (table === 'vaccine_library') fail('疫苗字典不可写', CODE.FORBIDDEN)
  if (table === 'feedbacks') fail('反馈提交后不可修改', CODE.FORBIDDEN)
  if (table === 'app_logs') fail('埋点日志不支持更新', CODE.FORBIDDEN)
  if (FAMILY_CHILD_TABLES.indexOf(table) >= 0) {
    const familyId = (existing || doc).family_id
    await assertMember(userId, familyId, true)
    doc.family_id = familyId
    if (table === 'illness_records') normalizeIllnessDoc(doc)
    if (table === 'checkup_records') {
      normalizeCheckupDoc(doc)
      // 联动字段不能被整行写回篡改：客户端可能拿别的家庭的生长记录 id 填进来
      doc.growth_id = (existing && existing.growth_id) || null
    }
    if (table === 'photo_albums') {
      normalizeAlbumDoc(doc)
      // baby_id 同样不许整行写回时挪走：否则能把 A 宝宝的文件夹改挂到 B 宝宝名下
      doc.baby_id = (existing && existing.baby_id) || doc.baby_id
      // 改名同样受重名校验；exceptId 排除自己，否则「只改 sort_order」会撞上自己
      await assertAlbumNameFree(doc, existing ? existing._id : null)
      // 带 id 却查不到 existing 时会走到上面的新增分支，数量上限照样要管
      if (!existing) await assertAlbumCountUnderLimit(doc)
    }
    return
  }
  fail(`不支持的集合：${table}`, CODE.BAD_REQUEST)
}

/** 删除时的鉴权：doc 是库里已存在的行 */
async function guardRemove(userId, table, doc) {
  if (table === 'family_members') {
    // 退出家庭 = 删掉自己那行
    if (doc.user_id !== userId) fail('只能退出自己的家庭成员关系', CODE.FORBIDDEN)
    return
  }
  if (table === 'family_invitations') {
    await assertOwner(userId, doc.family_id)
    return
  }
  // 体检记录必须走 remove_checkup_record：删除时要让用户选「联动的生长记录留不留」，
  // 普通 remove 没有地方承载这个选择，放行会留下指向已删记录的 growth_id
  if (table === 'checkup_records') {
    fail('请通过 remove_checkup_record 删除体检记录', CODE.FORBIDDEN)
  }
  if (FAMILY_CHILD_TABLES.indexOf(table) >= 0) {
    await assertMember(userId, doc.family_id, true)
    return
  }
  fail(`不支持的集合：${table}`, CODE.BAD_REQUEST)
}

// ---------------------------------------------------------------------------
// 体检 ↔ 生长联动（文档 4.4）
// ---------------------------------------------------------------------------

/**
 * 保存体检记录后同步生长记录，返回补好 growth_id 的体检行。
 *
 * 为什么放在服务端一次完成：页面分两步写（先写体检、再写生长），中途失败会留下
 * 「有体检没生长」或「生长多一条」的脏数据；改数值时还要先查出关联的生长记录 id ——
 * 这些都不该交给页面拼。
 *
 * 规则：
 *   - 填了身高或体重 → 产生/更新一条同日期、同数值的生长记录，id 记在 checkup_records.growth_id；
 *     之后编辑改的就是这一条，不会每存一次多一条；
 *   - 只填头围、没有身高体重 → 不算生长记录（文档只要求身高/体重触发联动）；
 *   - 编辑时把身高体重都清空了 → 删掉之前联动出来的生长记录，并清空 growth_id；
 *   - 生长记录只同步 record_date / 身高 / 体重 / 头围，家长在生长页写的备注不会被覆盖。
 */
async function syncCheckupGrowth(userId, checkup) {
  const height = checkup.height_cm === undefined ? null : checkup.height_cm
  const weight = checkup.weight_kg === undefined ? null : checkup.weight_kg
  const head = checkup.head_cm === undefined ? null : checkup.head_cm

  // growth_id 只信库里那条：客户端可以把它改成别的家庭的生长记录 id
  let linked = null
  if (checkup.growth_id) {
    const found = await getDocById('growth_records', checkup.growth_id)
    if (found && found.family_id === checkup.family_id && found.baby_id === checkup.baby_id) {
      linked = found
    }
  }

  if (height === null && weight === null) {
    if (linked) await db.collection('growth_records').doc(linked._id).remove()
    if (linked || checkup.growth_id) {
      await db
        .collection('checkup_records')
        .doc(checkup._id)
        .update({ data: explicitSet({ growth_id: null }) })
      checkup.growth_id = null
    }
    return checkup
  }

  const values = {
    record_date: checkup.checkup_date,
    height_cm: height,
    weight_kg: weight,
    head_cm: head,
  }
  if (linked) {
    // 家长把身高/体重/头围清空时这里传的就是 null，必须走 $set，否则那几列会留着旧值
    await db
      .collection('growth_records')
      .doc(linked._id)
      .update({ data: explicitSet(values) })
    return checkup
  }

  const added = await db.collection('growth_records').add({
    data: Object.assign({}, values, {
      family_id: checkup.family_id,
      baby_id: checkup.baby_id,
      note: null,
      created_by: userId,
      created_at: nowIso(),
    }),
  })
  await db.collection('checkup_records').doc(checkup._id).update({ data: { growth_id: added._id } })
  checkup.growth_id = added._id
  return checkup
}

// ---------------------------------------------------------------------------
// 动作：select
// ---------------------------------------------------------------------------

async function actionSelect(userId, event) {
  const table = event.table
  let conditions = asArray(event.where).slice()

  if (table === 'profiles') {
    conditions = forceEq(conditions, 'id', userId)
  } else if (table === 'feedbacks') {
    // 账号维度：只能看自己提交的，客户端传的 created_by 一律覆盖掉
    conditions = forceEq(conditions, 'created_by', userId)
  } else if (table === 'vaccine_library') {
    // 公共字典：登录即可读，无额外限制
  } else if (table === 'app_logs') {
    fail('埋点日志不支持读取', CODE.FORBIDDEN)
  } else if (table === 'family_members') {
    const familyIds = eqValues(conditions, 'family_id')
    if (familyIds.length) {
      // 并行校验：逐个 await 会让 N 个家庭叠成 N 个数据库往返
      await Promise.all(familyIds.map((familyId) => assertMember(userId, familyId)))
    } else {
      // 只能查自己的成员关系（listMyMemberships 走这条）
      conditions = forceEq(conditions, 'user_id', userId)
    }
  } else if (table === 'families') {
    // 只放行「我是 active 成员」的家庭：把客户端的 id 条件与我的家庭取交集
    const myIds = await listActiveFamilyIds(userId)
    const requested = eqValues(conditions, 'id').concat(inValues(conditions, 'id'))
    const allowed = requested.length ? requested.filter((id) => myIds.indexOf(id) >= 0) : myIds
    if (!allowed.length) return { data: [], total: event.count ? 0 : null }
    conditions = conditions.filter((item) => item.field !== 'id')
    conditions.push({ field: 'id', op: 'in', value: allowed })
  } else if (table === 'family_invitations' || FAMILY_CHILD_TABLES.indexOf(table) >= 0) {
    const familyIds = eqValues(conditions, 'family_id')
    if (familyIds.length) {
      await Promise.all(familyIds.map((familyId) => assertMember(userId, familyId)))
    } else {
      // 只带 id 的「查单条」也放行。Supabase 侧靠 RLS 按行过滤，业务层因此只传 id
      // （fetchPhoto / fetchMilestone），这里若一律拒绝，同一份业务代码在云开发侧就查不到。
      // 安全性不降级：先查出这些行归属的家庭，再逐行校验成员身份。
      const ids = eqValues(conditions, 'id').concat(inValues(conditions, 'id'))
      if (!ids.length) fail('缺少 family_id 查询条件', CODE.BAD_REQUEST)
      const owned = await db
        .collection(table)
        .where({ _id: _.in(ids) })
        .field({ family_id: true })
        .limit(1000)
        .get()
      if (!owned.data.length) return { data: [], total: event.count ? 0 : null }
      const ownerIds = owned.data
        .map((row) => row.family_id)
        .filter((id, index, list) => id && list.indexOf(id) === index)
      for (const familyId of ownerIds) await assertMember(userId, familyId)
    }
  } else {
    fail(`不支持的集合：${table}`, CODE.BAD_REQUEST)
  }

  const where = buildWhere(conditions)
  let query = db.collection(table)
  if (where) query = query.where(where)
  query = applyOrder(query, event.order)
  const field = buildField(event.columns)
  if (field) query = query.field(field)

  const skip = Number(event.skip) > 0 ? Number(event.skip) : 0
  const limit = Number(event.limit) > 0 ? Number(event.limit) : 1000

  // 总数与数据并行查：以前是主查询回来才发 count，白白多一个数据库往返
  let countQuery = null
  if (event.count) {
    countQuery = db.collection(table)
    if (where) countQuery = countQuery.where(where)
  }
  const [res, countRes] = await Promise.all([
    query.skip(skip).limit(limit).get(),
    countQuery ? countQuery.count() : Promise.resolve(null),
  ])
  const total = countRes ? countRes.total : null

  return { data: toClientRows(res.data), total }
}

// ---------------------------------------------------------------------------
// 内容安全（云调用 security.msgSecCheck）
// ---------------------------------------------------------------------------

/**
 * 需要做文本检测的用户自由输入字段（按集合）。
 * 只列「用户手打」的字段：枚举值（poop_color 之类）、数字、时间、存储路径都不检测。
 * 整行写回（upsert）时字段没带上来就跳过，不做二次查询。
 */
const CONTENT_FIELDS = {
  babies: ['name'],
  families: ['name'],
  family_members: ['nickname'],
  feeding_records: ['note'],
  sleep_records: ['note'],
  diaper_records: ['note'],
  growth_records: ['note'],
  milestones: ['name', 'note'],
  vaccinations: ['name', 'hospital', 'note'],
  baby_photos: ['note'],
  feedbacks: ['content'],
  illness_records: ['hospital', 'doctor', 'diagnosis', 'allergy_note', 'note'],
  checkup_records: ['hospital', 'development', 'doctor_advice'],
}

/** 资料类集合走 scene=1（资料），记录类走 scene=4（社交日志）；scene 只影响风控模型，传错不报错 */
const PROFILE_TABLES = ['babies', 'families', 'family_members']

/** 云调用错误码：内容含违法违规 */
const ERR_CONTENT_RISKY = 87014

/** msgSecCheck 的 content 上限 2500 字（本项目的备注远达不到，仅作兜底） */
const CONTENT_MAX_LEN = 2500

/** 违规时的统一提示（前端直接把 err.message 弹 toast） */
const CONTENT_RISKY_MESSAGE = '内容包含违规信息，请修改后再保存'

/**
 * 云调用返回体在不同文档/版本里出现过 { result: { suggest } } 与 { suggest } 两种形态，
 * 这里两种都认；取不到就返回空串，按「放行」处理（见 checkText 的降级说明）。
 */
function readSuggest(res) {
  if (!res || typeof res !== 'object') return ''
  const inner = res.result && typeof res.result === 'object' ? res.result : res
  return String(inner.suggest || '')
}

/**
 * 送检一段文本，命中违规直接抛错。
 *
 * 为什么是「调用异常一律放行」：
 *   msgSecCheck 需要在云函数目录的 config.json 里声明 permissions.openapi，
 *   权限首次生效还有约 10 分钟缓存；接口本身也会抖动。这些都不该让家长记不了数据 ——
 *   只拦「确定违规」，其余（-604101 缺权限、网络失败、返回体变化）放行并打日志。
 * openid 要求「用户近两小时访问过小程序」，这里取当前调用者（getWXContext），天然满足。
 */
async function checkText(content, scene) {
  const text = String(content === undefined || content === null ? '' : content)
    .trim()
    .slice(0, CONTENT_MAX_LEN)
  if (!text) return

  let res
  try {
    res = await cloud.openapi.security.msgSecCheck({
      openid: currentUserId(),
      scene,
      version: 2,
      content: text,
    })
  } catch (err) {
    const errCode = err && (err.errCode || err.errcode)
    if (errCode === ERR_CONTENT_RISKY) fail(CONTENT_RISKY_MESSAGE, CODE.CONTENT_RISKY)
    console.error('[data] 内容安全检测调用失败，已放行', errCode, (err && err.message) || err)
    return
  }

  if (readSuggest(res) === 'risky') fail(CONTENT_RISKY_MESSAGE, CODE.CONTENT_RISKY)
}

/** 写入前检测一行数据里的自由文本字段 */
async function assertTextSafe(table, row) {
  const fields = CONTENT_FIELDS[table]
  if (!fields || !row) return
  const chunks = []
  fields.forEach((field) => {
    const value = trimOrNull(row[field])
    if (value) chunks.push(value)
  })
  if (!chunks.length) return
  await checkText(chunks.join('\n'), PROFILE_TABLES.indexOf(table) >= 0 ? 1 : 4)
}

// ---------------------------------------------------------------------------
// 动作：insert / insertSilent / upsert / remove
// ---------------------------------------------------------------------------

async function actionInsert(userId, event) {
  const table = event.table
  const rows = asArray(event.rows)
  if (!rows.length) return { data: [] }
  const out = []
  for (const row of rows) {
    const doc = toServerRow(row)
    await guardInsert(userId, table, doc)
    await assertTextSafe(table, doc)
    prepareDoc(table, doc)
    const res = await db.collection(table).add({ data: doc })
    let saved = await getDocById(table, res._id)
    if (!saved) saved = Object.assign({ _id: res._id }, doc)
    // 体检记录：填了身高/体重就顺手同步一条生长记录（文档 4.4）
    if (table === 'checkup_records') saved = await syncCheckupGrowth(userId, saved)
    out.push(saved)
  }
  return { data: toClientRows(out) }
}

/** 只写不回读（app_logs 专用） */
async function actionInsertSilent(userId, event) {
  const table = event.table
  if (table !== 'app_logs') fail('insertSilent 仅支持 app_logs', CODE.BAD_REQUEST)
  const rows = asArray(event.rows)
  for (const row of rows) {
    const doc = toServerRow(row)
    // 身份以 OPENID 为准
    doc.user_id = userId
    prepareDoc(table, doc)
    await db.collection(table).add({ data: doc })
  }
  return { data: null }
}

async function actionUpsert(userId, event) {
  const table = event.table
  const rows = asArray(event.rows)
  if (!rows.length) return { data: [] }
  const out = []
  for (const row of rows) {
    const doc = toServerRow(row)
    const id = doc._id
    const existing = id ? await getDocById(table, id) : null
    await guardUpsert(userId, table, doc, existing)
    // 更新分支紧接着就 continue 了，检测必须放在它前面
    await assertTextSafe(table, doc)
    if (existing) {
      const patch = Object.assign({}, doc)
      delete patch._id
      if (TOUCH_UPDATED_AT.indexOf(table) >= 0) patch.updated_at = nowIso()
      if (Object.keys(patch).length) {
        // 整行覆盖必须逐字段 $set：直接传普通对象时，云开发会把对象字段「合并」、
        // 并把 falsy 值（null/false/0/''）整个丢掉 —— 于是「清空某个字段」静默失效
        await db.collection(table).doc(id).update({ data: explicitSet(patch) })
      }
      let merged = Object.assign({}, existing, patch)
      // 体检记录：改了身高/体重就同步那条联动的生长记录（文档 4.4）
      if (table === 'checkup_records') merged = await syncCheckupGrowth(userId, merged)
      out.push(merged)
      continue
    }
    prepareDoc(table, doc)
    const res = await db.collection(table).add({ data: doc })
    let saved = await getDocById(table, res._id)
    if (!saved) saved = Object.assign({ _id: res._id }, doc)
    if (table === 'checkup_records') saved = await syncCheckupGrowth(userId, saved)
    out.push(saved)
  }
  return { data: toClientRows(out) }
}

async function actionRemove(userId, event) {
  const table = event.table
  const where = buildWhere(event.where)
  if (!where) fail('缺少删除条件', CODE.BAD_REQUEST)

  let query = db.collection(table)
  query = query.where(where)
  const res = await query.limit(1000).get()
  const rows = res.data
  if (!rows.length) return { data: null }

  for (const row of rows) {
    await guardRemove(userId, table, row)
  }
  // 删文件夹 = 里面的照片回到「未分类」，**不删照片**。
  // Supabase 侧靠 baby_photos.album_id 的 `on delete set null` 自动完成，
  // 云开发没有外键，必须在这里手动清引用。顺序也重要：先把引用清干净再删相册行，
  // 中途失败重跑仍然安全（清引用是幂等的，第二次查不到照片就直接返回）。
  if (table === 'photo_albums') {
    for (const row of rows) await detachAlbumPhotos(row)
  }
  for (const row of rows) {
    await db.collection(table).doc(row._id).remove()
  }
  return { data: null }
}

// ---------------------------------------------------------------------------
// 动作：rpc（原 Supabase 的数据库函数）
// ---------------------------------------------------------------------------

function randomInviteCode() {
  let code = ''
  for (let i = 0; i < 6; i += 1) {
    code += INVITE_CODE_CHARS.charAt(Math.floor(Math.random() * INVITE_CODE_CHARS.length))
  }
  return code
}

/** 生成不重复的邀请码（family_invitations 有唯一 invite_code） */
async function generateUniqueInviteCode(table) {
  for (let i = 0; i < 20; i += 1) {
    const code = randomInviteCode()
    const res = await db.collection(table).where({ invite_code: code }).limit(1).get()
    if (!res.data.length) return code
  }
  return fail('邀请码生成失败，请重试', CODE.INTERNAL)
}

/** 创建家庭：把当前用户写成 owner（加入一律走 family_invitations 一次性邀请码） */
async function rpcCreateFamily(userId, args) {
  const name = trimOrNull(args.p_name) || '我的家'
  await assertTextSafe('families', { name })
  const createdAt = nowIso()

  const familyRes = await db
    .collection('families')
    .add({ data: { name, created_at: createdAt } })
  const familyId = familyRes._id

  try {
    await db.collection('family_members').add({
      data: {
        family_id: familyId,
        user_id: userId,
        role: 'owner',
        nickname: null,
        status: 'active',
        created_at: createdAt,
      },
    })
  } catch (err) {
    // 补偿：Supabase 侧的 create_family() 是一个函数、天然原子；
    // 云开发分两步写，第二步失败会留下「没有任何成员的家庭」——
    // 这种家庭谁也看不见（families 的可见性靠 family_members 推导），纯属垃圾数据，直接删掉。
    try {
      await db.collection('families').doc(familyId).remove()
    } catch (rollbackErr) {
      console.error('[data] create_family 回滚失败，可能残留无成员家庭', familyId, rollbackErr)
    }
    throw err
  }

  return { family: { id: familyId, name, created_at: createdAt } }
}

/** 用一次性邀请码加入家庭：角色只能来自邀请码，客户端指定不了 */
async function rpcJoinFamilyByInvite(userId, args) {
  const code = String(args.p_code === undefined || args.p_code === null ? '' : args.p_code)
    .trim()
    .toUpperCase()
  if (!code) fail('请输入邀请码', CODE.BAD_REQUEST)

  const invRes = await db.collection('family_invitations').where({ invite_code: code }).limit(1).get()
  const invite = invRes.data[0]
  if (!invite) fail('邀请码无效', CODE.BAD_REQUEST)

  if (invite.status === 'used') fail('邀请码已被使用', CODE.BAD_REQUEST)
  if (invite.status === 'revoked') fail('邀请码已被撤销', CODE.BAD_REQUEST)
  if (
    invite.status === 'expired' ||
    (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now())
  ) {
    fail('邀请码已过期', CODE.BAD_REQUEST)
  }

  const familyId = invite.family_id
  const already = await findMembership(userId, familyId)
  if (already) {
    return { family_id: familyId, role: invite.role, alreadyMember: true }
  }

  // 曾被移除/退出过的：把原成员行复活并更新为新角色
  const previous = await db
    .collection('family_members')
    .where({ family_id: familyId, user_id: userId })
    .limit(1)
    .get()

  const existing = previous.data[0] || null
  let memberId = ''
  if (existing) {
    memberId = existing._id
    await db
      .collection('family_members')
      .doc(memberId)
      .update({ data: { role: invite.role, status: 'active' } })
  } else {
    const added = await db.collection('family_members').add({
      data: {
        family_id: familyId,
        user_id: userId,
        role: invite.role,
        nickname: null,
        status: 'active',
        created_at: nowIso(),
      },
    })
    memberId = added._id
  }

  // 云开发没有跨文档事务：本步骤失败会留下「码还能用、但人已经进组」的不一致。
  // 这里做补偿——回滚刚写的成员关系，让状态回到调用前，用户重试即可。
  try {
    await db.collection('family_invitations').doc(invite._id).update({ data: { status: 'used' } })
  } catch (err) {
    console.error('[data] 作废邀请码失败，开始回滚成员关系', memberId, err)
    try {
      if (existing) {
        // 复活过的行：还原成调用前的角色与状态
        await db
          .collection('family_members')
          .doc(memberId)
          .update({ data: { role: existing.role, status: existing.status } })
      } else {
        await db.collection('family_members').doc(memberId).remove()
      }
    } catch (rollbackErr) {
      console.error('[data] 回滚成员关系失败，数据可能不一致', memberId, rollbackErr)
    }
    throw err
  }

  return { family_id: familyId, role: invite.role, alreadyMember: false }
}

/** 生成带角色的一次性邀请码（仅 owner） */
async function rpcCreateFamilyInvitation(userId, args) {
  const familyId = args.p_family_id
  if (!familyId) fail('缺少家庭标识', CODE.BAD_REQUEST)
  await assertOwner(userId, familyId)

  const role = trimOrNull(args.p_role) || 'member'
  if (role !== 'member' && role !== 'viewer') {
    fail('邀请角色只能是 member（成员）或 viewer（只读）', CODE.BAD_REQUEST)
  }

  const days = args.p_expires_days
  if (days !== undefined && days !== null && Number(days) <= 0) {
    fail('有效期必须大于 0 天', CODE.BAD_REQUEST)
  }

  const inviteCode = await generateUniqueInviteCode('family_invitations')
  const expiresAt = days === undefined || days === null
    ? null
    : new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000).toISOString()

  const doc = {
    family_id: familyId,
    invite_code: inviteCode,
    role,
    expires_at: expiresAt,
    status: 'active',
    created_by: userId,
    created_at: nowIso(),
  }
  const res = await db.collection('family_invitations').add({ data: doc })
  return Object.assign({ id: res._id }, doc)
}

/** 修改成员角色（仅 owner，只能改成 member / viewer） */
async function rpcSetMemberRole(userId, args) {
  const memberId = args.p_member_id
  if (!memberId) fail('缺少成员标识', CODE.BAD_REQUEST)

  const target = await getDocById('family_members', memberId)
  if (!target) fail('成员不存在', CODE.BAD_REQUEST)

  await assertOwner(userId, target.family_id)

  if (target.role === 'owner') fail('不能修改家庭创建者的角色', CODE.BAD_REQUEST)
  if (target.status !== 'active') fail('该成员已被移除', CODE.BAD_REQUEST)

  const role = trimOrNull(args.p_role)
  if (role !== 'member' && role !== 'viewer') {
    fail('角色只能是 member（成员）或 viewer（只读）', CODE.BAD_REQUEST)
  }

  await db.collection('family_members').doc(memberId).update({ data: { role } })
  return { member: toClientRow(Object.assign({}, target, { role })) }
}

/** 修改自己的昵称（只改 nickname 一个字段；多家庭时全部成员关系一起改） */
async function rpcSetMyNickname(userId, args) {
  const nickname = trimOrNull(args.p_nickname)
  if (nickname && nickname.length > 12) fail('昵称最多 12 个字', CODE.BAD_REQUEST)
  await assertTextSafe('family_members', { nickname })

  const matched = await db
    .collection('family_members')
    .where({ user_id: userId, status: 'active' })
    .limit(1000)
    .get()
  if (!matched.data.length) fail('你还没有加入任何家庭', CODE.BAD_REQUEST)

  await db
    .collection('family_members')
    .where({ user_id: userId, status: 'active' })
    .update({ data: explicitSet({ nickname }) })

  return { member: toClientRow(Object.assign({}, matched.data[0], { nickname })) }
}

/** 家庭创建者移除成员：软删除（status = 'removed'），保留成员行以便日后重新加入 */
async function rpcRemoveFamilyMember(userId, args) {
  const memberId = args.p_member_id
  if (!memberId) fail('缺少成员标识', CODE.BAD_REQUEST)

  const target = await getDocById('family_members', memberId)
  if (!target) fail('该成员不存在', CODE.BAD_REQUEST)

  await assertOwner(userId, target.family_id)

  if (target.user_id === userId) fail('不能移除自己', CODE.BAD_REQUEST)
  if (target.role === 'owner') fail('不能移除家庭创建者', CODE.BAD_REQUEST)

  await db.collection('family_members').doc(memberId).update({ data: { status: 'removed' } })
  return { member: toClientRow(Object.assign({}, target, { status: 'removed' })) }
}

/**
 * 删除体检记录（文档 4.4：让用户选「联动的生长记录一并删除 / 保留」）。
 * 为什么必须走 rpc：api.db.remove 只能传 where 条件、没有扩展位，
 * 这个选择没有地方能带到服务端，所以整件事在这里一次做完。
 */
async function rpcRemoveCheckupRecord(userId, args) {
  const id = args.p_id
  if (!id) fail('缺少体检记录标识', CODE.BAD_REQUEST)

  const checkup = await getDocById('checkup_records', id)
  if (!checkup) fail('该体检记录不存在', CODE.BAD_REQUEST)
  await assertMember(userId, checkup.family_id, true)

  let growthDeleted = false
  if (args.p_delete_growth === true && checkup.growth_id) {
    const growth = await getDocById('growth_records', checkup.growth_id)
    // 只在确实属于同一个宝宝时删，避免历史脏数据误删别人家的记录
    if (growth && growth.family_id === checkup.family_id && growth.baby_id === checkup.baby_id) {
      await db.collection('growth_records').doc(growth._id).remove()
      growthDeleted = true
    }
  }

  await db.collection('checkup_records').doc(id).remove()
  return { growth_deleted: growthDeleted }
}

async function actionRpc(userId, event) {
  const args = event.args || {}
  switch (event.fn) {
    case 'create_family':
      return { data: await rpcCreateFamily(userId, args) }
    case 'join_family_by_invite':
      return { data: await rpcJoinFamilyByInvite(userId, args) }
    case 'create_family_invitation':
      return { data: await rpcCreateFamilyInvitation(userId, args) }
    case 'set_member_role':
      return { data: await rpcSetMemberRole(userId, args) }
    case 'set_my_nickname':
      return { data: await rpcSetMyNickname(userId, args) }
    case 'remove_family_member':
      return { data: await rpcRemoveFamilyMember(userId, args) }
    case 'remove_checkup_record':
      return { data: await rpcRemoveCheckupRecord(userId, args) }
    default:
      return fail(`云开发后端未实现的数据库函数：${event.fn}`, CODE.BAD_REQUEST)
  }
}

// ---------------------------------------------------------------------------
// 动作：云存储代理（换临时链接 / 删文件）
// ---------------------------------------------------------------------------
// 为什么存储操作也要走云函数：
//   小程序端直接调 wx.cloud.getTempFileURL 受「云存储安全规则」约束，只有文件是「公有读」
//   时才能换出任意文件的链接；权限一旦收紧，成员就换不出别人上传的文件的链接，
//   表现为「照片只有上传者本人看得到，同一家庭其他成员看到的是裂图」。
//   云函数用管理员身份调用、不受安全规则限制，因此统一改由这里代理，
//   业务层（src/services/cloud/storage.js）调用方式不变。
//
// 安全：本项目的对象路径约定是 {family_id}/{baby_id}/...（见 photo.js、baby.js、milestone.js），
//   所以从 fileID 路径首段取出 family_id 做一次成员校验，
//   避免登录用户拿任意 fileID 去换链接或删别人家的文件。

/**
 * 从 fileID 里取出家庭 id。
 *
 * fileID 的完整格式是 cloud://<环境ID>.<存储桶ID>/<family_id>/<baby_id>/<文件名>，
 * 注意 `cloud://` 后面的第一段是平台自动拼的「环境ID.存储桶ID」，不是我们上传时给的路径，
 * 真正的 family_id 是第二段。这里取错一度导致所有换链接请求都被判成「非本家庭成员」。
 */
function familyIdOfFile(fileId) {
  const text = String(fileId || '')
  const rest = text.replace(/^cloud:\/\//, '')
  const parts = rest.split('/').filter(Boolean)
  // parts: [环境ID.存储桶ID, family_id, baby_id, 文件名...]
  if (parts.length < 4 || !parts[1]) fail(`非法的云文件 ID：${text}`, CODE.BAD_REQUEST)
  return parts[1]
}

/** 校验这一批文件都属于「我是 active 成员」的家庭，返回规范化后的 fileID 数组 */
async function guardFiles(userId, fileList, needWrite) {
  const ids = asArray(fileList)
    .map((item) => (typeof item === 'string' ? item : item && item.fileID))
    .filter(Boolean)
    .map(String)
  if (!ids.length) fail('缺少 fileList', CODE.BAD_REQUEST)

  const familyIds = []
  ids.forEach((id) => {
    const familyId = familyIdOfFile(id)
    if (familyIds.indexOf(familyId) < 0) familyIds.push(familyId)
  })
  for (const familyId of familyIds) await assertMember(userId, familyId, needWrite)
  return ids
}

/** 管理员身份换取临时链接（不受云存储安全规则限制，能换出任意家庭成员的文件的链接） */
async function actionTempFileURL(userId, event) {
  const ids = await guardFiles(userId, event.fileList, false)
  const res = await cloud.getTempFileURL({ fileList: ids })
  return { data: (res && res.fileList) || [] }
}

/** 管理员身份删除文件（照片、头像、里程碑照片的清理都走这里） */
async function actionDeleteFile(userId, event) {
  const ids = await guardFiles(userId, event.fileList, true)
  const res = await cloud.deleteFile({ fileList: ids })
  return { data: (res && res.fileList) || [] }
}

// ---------------------------------------------------------------------------
// 会员权益 + AI 用量（额度骨架）
// ---------------------------------------------------------------------------

/**
 * 会员制总开关。
 *
 * false = 不上线会员制：所有人一律按「会员档」对待（功能全开、AI 按会员额度），
 *         前端也不会显示任何会员入口 —— 就是「正常使用小程序」。
 * true  = 按家庭的 member_tier 分级，前端出现会员入口与开通流程。
 *
 * ⚠️ 这里是**唯一真源**，前端不存第二份配置：开关状态由 actionMembershipStatus 下发。
 *    上线/下线 = 改这一行 + 重新上传本云函数。
 *
 * ⚠️ 打开之后不是「多一个入口」这么简单：没开通的家庭立刻掉到 free 档，
 *    也就是 AI 从 50 次/天 变成 5 次/天、上下文从 30 天变成 7 天。别在没想清楚时打开。
 */
const MEMBERSHIP_ENABLED = true

/**
 * 两档权益。
 *
 * 现在**只分级 AI 问答**（唯一实打实烧 token 的功能），其余全部不分级：
 * 记录、时光、工具、疫苗、辅食、报告、每日小结、一句话记一笔、首页观察都不受会员限制。
 * 理由：核心记录功能锁起来只会赶人，而成本只发生在 AI 上。
 */
const MEMBERSHIP_PLANS = {
  free: { chatPerDay: 5, contextDays: 7 },
  member: { chatPerDay: 50, contextDays: 30 },
}

/**
 * 开通码台账（集合 membership_codes）：一行一个码。
 *
 * 字段：`code`（唯一，大写）/ `days`（0 = 永久）/ `status` / `note`（备注，便于对账）/
 *      `used_by_family` / `used_by_user` / `used_at` / `created_at` / `updated_at`。
 *
 * 为什么要有这张表（而不是把码写死在代码里）：
 *   1. **一码一用** —— 兑换时用「条件更新」抢码，抢不到就说明已被别人兑走；
 *   2. **可作废** —— 发错了想收回，把 status 改成 void 即可，不用重传云函数；
 *   3. **可对账** —— 发给了谁、谁兑的，在运维后台一眼看到。
 *
 * ⚠️ 只拦「还没被兑换」的码。已经兑换出去的权益落在 families 上，
 *    作废那个码**收不回**已开通的会员 —— 要收回得改那一家的档位（adminSetTier）。
 */
const MEMBERSHIP_CODE_TABLE = 'membership_codes'

/** 开通码状态 */
const CODE_STATUS = { UNUSED: 'unused', USED: 'used', VOID: 'void' }

/** 码形状 `SHY-XXXX-XXXX`；字符集与邀请码一致（去掉易混淆的 I/O/0/1） */
const CODE_PREFIX = 'SHY'
const CODE_GROUP_LEN = 4
const CODE_GROUP_COUNT = 2
/** 一次最多生成多少个（防止手滑填 10000） */
const CODE_MAX_GENERATE = 100
/** 台账一次最多回多少行 */
const CODE_LIST_LIMIT = 500

/**
 * 兜底码：写死在代码里、**不进台账**，只留给「自己家」这种不需要对账的固定码。
 * ⚠️ 它的存在不改台账逻辑，但改它要重传云函数，而且兑过的家庭不受作废影响 ——
 * 发给别人请一律用运维后台生成的码。
 */
const MEMBERSHIP_CODES = {
  // 自己家用：永久（0 天 = 不设到期时间）
  'SHUYAO-FAMILY': 0,
}

/** AI 用量的集合：按「人 + 北京日期」记一天用了几次 */
const AI_USAGE_TABLE = 'ai_usage'

/** AI 回答反馈的集合：家长给某一条回答打「有帮助 / 不准」 */
const AI_FEEDBACK_TABLE = 'ai_feedback'

/** 反馈里正文最多留多少字：回答可能很长，全存没意义还占容量 */
const AI_FEEDBACK_ANSWER_MAX = 600

/** 时间戳对应的北京日期 'YYYY-MM-DD'（与 feeding-reminder 的 todayKey 同一口径） */
function beijingDayKey(timestamp) {
  const shifted = new Date(timestamp + 8 * 60 * 60 * 1000)
  const pad = (item) => String(item).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

/**
 * 某个家庭当前生效的权益档位。
 *
 * - 会员制没上线 / 没传家庭 id（还没建家庭）→ 一律 'member'（全功能）；
 * - 家庭的 member_tier 不是 member，或 member_until 已过期 → 'free'。
 *   过期只在读取时判定、不回写库，省掉一个定时任务。
 */
async function resolveTier(familyId) {
  if (!MEMBERSHIP_ENABLED || !familyId) return 'member'
  const family = await getDocById('families', familyId)
  if (!family || family.member_tier !== 'member') return 'free'
  const until = family.member_until ? new Date(family.member_until).getTime() : 0
  if (Number.isFinite(until) && until > 0 && until <= Date.now()) return 'free'
  return 'member'
}

/**
 * 查当前权益：前端进场时调一次，缓存到本机。
 * 同时把两档额度一起下发，会员页的对照表就不用在前端再写一份数字。
 */
async function actionMembershipStatus(userId, event) {
  const familyId = event.familyId ? String(event.familyId) : ''
  if (familyId) await assertMember(userId, familyId, false)
  const family = familyId ? await getDocById('families', familyId) : null
  return {
    enabled: MEMBERSHIP_ENABLED,
    tier: await resolveTier(familyId),
    until: (family && family.member_until) || null,
    plans: MEMBERSHIP_PLANS,
    // 顺带告诉前端「你是不是超级管理员」：前端据此决定要不要显示运维入口。
    // 只是 UX，真正的门在服务端 assertSuperAdmin。
    superAdmin: isSuperAdmin(userId),
  }
}

function randomMembershipCode() {
  const group = () => {
    let out = ''
    for (let i = 0; i < CODE_GROUP_LEN; i += 1) {
      out += INVITE_CODE_CHARS.charAt(Math.floor(Math.random() * INVITE_CODE_CHARS.length))
    }
    return out
  }
  const groups = []
  for (let i = 0; i < CODE_GROUP_COUNT; i += 1) groups.push(group())
  return `${CODE_PREFIX}-${groups.join('-')}`
}

/** 生成一个台账里没有的码（撞了就重试，最多 20 次） */
async function generateUniqueMembershipCode() {
  for (let i = 0; i < 20; i += 1) {
    const code = randomMembershipCode()
    const res = await db.collection(MEMBERSHIP_CODE_TABLE).where({ code }).limit(1).get()
    if (!res.data.length) return code
  }
  return fail('开通码生成失败，请重试', CODE.INTERNAL)
}

/** 统一码形状：去首尾空格 + 转大写（用户手输时大小写不该导致失败） */
function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
}

/**
 * 从台账里「抢」一个码：只有还处于 `unused` 的那一行会被改成 `used`。
 *
 * 为什么判断要塞进 where 里：云开发没有跨文档事务，「先查 → 再判 → 再写」两个并发请求
 * 会同时查到 unused，于是同一个码开两家。这里用**条件更新**做 CAS，
 * 改完再读一次确认「拿到手的确实是自己」——不同 SDK 版本 update 的返回形状不一致，
 * 读一次比赌 stats.updated 稳。
 *
 * @returns 台账里没有这个码时返回 null（交给写死的兜底码去判）
 */
async function claimCodeFromLedger(code, { familyId, userId }) {
  const found = await db.collection(MEMBERSHIP_CODE_TABLE).where({ code }).limit(1).get()
  const row = found.data && found.data[0]
  if (!row) return null
  if (row.status === CODE_STATUS.USED) fail('这个开通码已经被使用过了', 'INVALID_CODE')
  if (row.status === CODE_STATUS.VOID) fail('这个开通码已作废', 'INVALID_CODE')

  const now = nowIso()
  await db
    .collection(MEMBERSHIP_CODE_TABLE)
    .where({ _id: row._id, status: CODE_STATUS.UNUSED })
    .update({
      data: explicitSet({
        status: CODE_STATUS.USED,
        used_by_family: familyId,
        used_by_user: userId,
        used_at: now,
        updated_at: now,
      }),
    })

  const check = await getDocById(MEMBERSHIP_CODE_TABLE, row._id)
  const mine =
    check && check.status === CODE_STATUS.USED && check.used_by_family === familyId
  if (!mine) fail('这个开通码已经被使用过了', 'INVALID_CODE')

  return { days: Number(row.days) || 0, code }
}

/**
 * 开通码兑换：只有家庭创建者能兑换（会员按家庭计，一个家庭开通、全家共享）。
 * 已是会员时从到期时间往后续，不会把剩余天数吃掉。
 *
 * 码有两个来源，**先查台账**：
 *   1. `membership_codes` 台账（运维后台生成，一码一用、可作废）—— 发人用这个；
 *   2. 写死的 `MEMBERSHIP_CODES` 兜底码 —— 只留给自己家的固定码。
 */
async function actionMembershipRedeem(userId, event) {
  if (!MEMBERSHIP_ENABLED) fail('会员制还没上线', 'MEMBERSHIP_OFF')
  const familyId = event.familyId ? String(event.familyId) : ''
  if (!familyId) fail('请先创建或加入一个家庭', CODE.BAD_REQUEST)
  await assertOwner(userId, familyId)

  const code = normalizeCode(event.code)
  if (!code) fail('请输入开通码', CODE.BAD_REQUEST)

  const family = await getDocById('families', familyId)
  /**
   * 已经是永久会员就别再兑了。
   *
   * 两个理由：
   *   1. 永久的 `member_until` 是 `null`，**拿不到「顺延基准」** —— 再兑一个 7 天的码
   *      会从今天重新起算，等于把永久降成 7 天（曾经的真实 bug）；
   *   2. 就算保住永久，那个码也被白白消耗掉了，不如直接拦住、让人知道「你不需要了」。
   */
  if (family && family.member_tier === 'member' && !family.member_until) {
    fail('这个家庭已经是永久会员，不需要再兑换', 'ALREADY_PERMANENT')
  }

  const claimed = await claimCodeFromLedger(code, { familyId, userId })
  let days
  if (claimed) {
    days = claimed.days
  } else if (code in MEMBERSHIP_CODES) {
    days = Number(MEMBERSHIP_CODES[code]) || 0
  } else {
    fail('开通码无效或已停用', 'INVALID_CODE')
  }

  // 没到期就从到期日往后顺延（不吃掉剩余天数），否则从今天起算
  const current = family && family.member_until ? new Date(family.member_until).getTime() : 0
  const base = Number.isFinite(current) && current > Date.now() ? current : Date.now()
  const until = days > 0 ? new Date(base + days * 86400000).toISOString() : null

  await db.collection('families').doc(familyId).update({
    // 0 天的开通码 = 永久，member_until 传 null；普通对象传进去会被丢掉，
    // 旧到期日留在库里 —— 所以走 $set
    data: explicitSet({
      member_tier: 'member',
      member_until: until,
      member_code: code,
      member_redeemed_at: nowIso(),
    }),
  })
  return { tier: 'member', until, days }
}

/** 运维：开通码台账（全部 / 未用 / 已用 / 作废） */
async function actionAdminCodes(userId, event) {
  assertSuperAdmin(userId, '查看开通码')
  const rawStatus = String(event.status || '')
  const allowed = [CODE_STATUS.UNUSED, CODE_STATUS.USED, CODE_STATUS.VOID]
  const status = allowed.indexOf(rawStatus) >= 0 ? rawStatus : ''

  const res = await db
    .collection(MEMBERSHIP_CODE_TABLE)
    .where(status ? { status } : {})
    .orderBy('created_at', 'desc')
    .limit(CODE_LIST_LIMIT)
    .get()
  const codes = (res.data || []).map((row) => ({
    id: row._id,
    code: row.code || '',
    days: Number(row.days) || 0,
    status: row.status || CODE_STATUS.UNUSED,
    note: row.note || '',
    usedByFamily: row.used_by_family || '',
    usedAt: row.used_at || '',
    createdAt: row.created_at || '',
  }))

  // 三个计数各自 count 一次（云开发没有 group by）
  const [all, unused, used] = await Promise.all([
    db.collection(MEMBERSHIP_CODE_TABLE).count(),
    db.collection(MEMBERSHIP_CODE_TABLE).where({ status: CODE_STATUS.UNUSED }).count(),
    db.collection(MEMBERSHIP_CODE_TABLE).where({ status: CODE_STATUS.USED }).count(),
  ])
  return {
    codes,
    status,
    totalCount: (all && all.total) || 0,
    unusedCount: (unused && unused.total) || 0,
    usedCount: (used && used.total) || 0,
  }
}

/** 运维：批量生成开通码（一次最多 CODE_MAX_GENERATE 个） */
async function actionAdminCreateCodes(userId, event) {
  assertSuperAdmin(userId, '生成开通码')
  const count = Number(event.count)
  if (!Number.isInteger(count) || count < 1 || count > CODE_MAX_GENERATE) {
    fail(`一次生成 1 ~ ${CODE_MAX_GENERATE} 个`, CODE.BAD_REQUEST)
  }
  const days = Number(event.days) || 0
  if (!Number.isInteger(days) || days < 0 || days > 3650) {
    fail('有效天数应为 0（永久）~ 3650', CODE.BAD_REQUEST)
  }
  const note = (trimOrNull(event.note) || '').slice(0, 50)

  const created = []
  for (let i = 0; i < count; i += 1) {
    const code = await generateUniqueMembershipCode()
    const now = nowIso()
    const res = await db.collection(MEMBERSHIP_CODE_TABLE).add({
      data: {
        code,
        days,
        status: CODE_STATUS.UNUSED,
        note,
        used_by_family: null,
        used_by_user: null,
        used_at: null,
        created_by: userId,
        created_at: now,
        updated_at: now,
      },
    })
    created.push({
      id: (res && res._id) || '',
      code,
      days,
      status: CODE_STATUS.UNUSED,
      note,
      createdAt: now,
    })
  }
  await logAdminAction(userId, 'create_codes', { count, days, note })
  return { created }
}

/**
 * 运维：作废 / 恢复一个码。
 *
 * ⚠️ 只能改**还没被兑换**的码。已兑出去的权益已经落在 families 上，
 * 作废那个码收不回来 —— 要收回请去改那一家的档位。
 */
async function actionAdminSetCodeStatus(userId, event) {
  assertSuperAdmin(userId, '修改开通码状态')
  const codeId = String(event.codeId || '')
  if (!codeId) fail('缺少开通码 id', CODE.BAD_REQUEST)
  const next = event.status === CODE_STATUS.VOID ? CODE_STATUS.VOID : CODE_STATUS.UNUSED

  const row = await getDocById(MEMBERSHIP_CODE_TABLE, codeId)
  if (!row) fail('开通码不存在', CODE.BAD_REQUEST)
  if (row.status === CODE_STATUS.USED) {
    fail('这个码已经被兑换过了，作废收不回已开通的会员 —— 请去改那一家的档位', 'CODE_ALREADY_USED')
  }

  await db.collection(MEMBERSHIP_CODE_TABLE).doc(codeId).update({
    data: explicitSet({ status: next, updated_at: nowIso() }),
  })
  await logAdminAction(userId, 'code_status', { codeId, status: next })
  return { codeId, status: next }
}

/* ---------------------------------------------------------------------------
 * 功能开关（feature flags）
 *
 * 两件不同的事要分清：
 *   - **全局开关**：整个小程序关掉某个功能，属于「出问题了赶紧摁下去」的闸门。
 *     存在 app_config 集合的一条固定文档上（_id = feature_flags），集合或文档
 *     不存在都当「没配过」。
 *   - **家庭覆盖**：某个家单独关（或单独开）。存在 families.feature_flags 上，
 *     只记「被明确改过」的 key，没记的一律跟随全局。
 *
 * 生效值 = 家庭覆盖 ?? 全局 ?? true。
 * 默认给「开」而不是「关」：开关是用来**关掉东西**的，读不到配置时应该保持现状，
 * 不能因为一次读取失败或集合还没建，就把全家的功能藏起来。
 * ------------------------------------------------------------------------- */

const APP_CONFIG_TABLE = 'app_config'
/** 全局开关固定存在这一条文档上（集合里就这一条，读的时候不用扫表） */
const FEATURE_FLAG_DOC_ID = 'feature_flags'

/**
 * 可开关的功能清单：服务端是唯一真源，前端只按 key 判断。
 * 新增一个开关 = 这里加一项 + 在前端该功能的入口处读一次 flagEnabled(key)。
 */
const FEATURE_FLAGS = [
  {
    key: 'aiChat',
    label: 'AI 照护助手',
    desc: '含底栏凸起按钮、工具页入口、「一句话记一笔」「AI 观察」「AI 小结」',
  },
  { key: 'solidFood', label: '辅食资料库', desc: '工具页入口' },
  { key: 'report', label: '成长报告', desc: '工具页入口' },
  { key: 'daily', label: '每日小结', desc: '工具页入口 + 记录页「历史」' },
]

const FEATURE_KEYS = FEATURE_FLAGS.map((item) => item.key)

/** 读全局开关；集合或文档不存在都当「没配」，返回 { } */
async function readGlobalFlags() {
  try {
    const doc = await getDocById(APP_CONFIG_TABLE, FEATURE_FLAG_DOC_ID)
    return (doc && doc.flags) || {}
  } catch (err) {
    // app_config 还没建：不算错误，全部按默认（开）走
    console.error('[data] 读全局功能开关失败，按默认处理', err)
    return {}
  }
}

/**
 * 算生效值：**总闸 + 分闸**。
 *
 *   全局关            → 一律关（哪家都开不回来）
 *   全局开 + 家庭标关  → 关
 *   其余              → 开
 *
 * 为什么不用「家庭覆盖优先」：那样某一家能把超管关掉的功能又打开，
 * 「全局闸门」就不成立了 —— 超管要关某个功能，就该谁都看不到。
 */
function resolveFlags(globalFlags, familyFlags) {
  const global = globalFlags || {}
  const family = familyFlags || {}
  const flags = {}
  FEATURE_KEYS.forEach((key) => {
    const globalOn = typeof global[key] === 'boolean' ? global[key] : true
    flags[key] = globalOn ? family[key] !== false : false
  })
  return flags
}

/** 查当前生效的功能开关；传 familyId 时按该家庭的覆盖算，不传就是全局值 */
async function actionFeatureFlags(userId, event) {
  const familyId = event.familyId ? String(event.familyId) : ''
  if (familyId) await assertMember(userId, familyId, false)
  const family = familyId ? await getDocById('families', familyId) : null
  const globalFlags = await readGlobalFlags()
  return { flags: resolveFlags(globalFlags, family && family.feature_flags) }
}

/**
 * 家庭创建者看自己家的功能开关：清单 + 全局现状 + 本家覆盖 + 生效值。
 *
 * 为什么要单独一个 action、不复用 featureFlags：featureFlags 只回「生效值」，
 * 创建者分不清「哪项是本家关的、哪项是全局关的」，界面上就没法正确显示
 * 「已被管理员关闭，本家改不掉」。这里只对该家创建者开放（assertOwner）。
 */
async function actionFamilyFlags(userId, event) {
  const familyId = event.familyId ? String(event.familyId) : ''
  if (!familyId) fail('缺少家庭 id', CODE.BAD_REQUEST)
  await assertOwner(userId, familyId)
  const family = await getDocById('families', familyId)
  const globalFlags = await readGlobalFlags()
  const overrides = (family && family.feature_flags) || {}
  return {
    catalog: FEATURE_FLAGS,
    globals: resolveFlags(globalFlags, null),
    overrides,
    effective: resolveFlags(globalFlags, overrides),
  }
}

/* ---------------------------------------------------------------------------
 * 运维后台（站内）
 *
 * 权限只有两层，都以「家庭」为单位划清：
 *   - **超级管理员**：写死在代码里的那个 openid（见 SUPER_ADMIN_OPENIDS）。
 *     跨家庭：看运维概览、进任意家庭管成员、改任意家庭的开关与会员档位、删家庭、
 *     转移家庭创建者。
 *   - **家庭创建者**（family_members.role = 'owner'）：只管自己那一个家 ——
 *     改成员角色、移除成员、发/撤销邀请码、改家庭名、改本家的功能开关覆盖。
 *
 * 曾经有过「全局管理员」（名单存 app_config.admins、能在界面上任命）——
 * 已按需求撤掉：权限改成家庭维度之后，一个「能管所有家」的中间层既没有用武之地，
 * 又多一层看不懂的权限面。现在运维后台只有超级管理员进得来。
 *
 * 判断一律在服务端，前端藏不藏入口只是 UX。
 * ------------------------------------------------------------------------- */

/**
 * 超级管理员：**写死在代码里**，界面上不可移除、也不可被降级。
 *
 * 这是整套权限的根：如果哪天它也能从界面上改，一次误操作就可能让所有人家
 * 都进不去运维后台，只能改代码重新部署才能救。要加人只能改这里 + 重新部署。
 *
 * 为什么认 openid 而不是手机号/微信名：小程序没做手机号授权，微信名用户随时能改，
 * 这两样都拿不到、也都不适合当身份凭证。openid 是云开发唯一稳定给到的身份。
 */
const SUPER_ADMIN_OPENIDS = [
  // 开发者本人。三条独立证据都指向这个 openid：
  //   ① app_logs 里 69 条 vue_error 全部出自它（报错栈是 127.0.0.1，即开发者工具）；
  //   ② 2026-09-20 14:04 用它建了第一个家庭，比第二个账号早 17 小时；
  //   ③ 现在在用的「贝贝」家的创建者也是它。
  'ok5I_5T0pnFRjk3vJuyYgxE7YQtg',
]

/** 是不是超级管理员（只看代码里的名单，不需要查库） */
function isSuperAdmin(userId) {
  return Boolean(userId) && SUPER_ADMIN_OPENIDS.indexOf(userId) >= 0
}

/**
 * 超级管理员这道门。
 *
 * 用在所有「跨家庭」的动作上：看概览、进任意家庭管成员、改开关与档位、删家庭、
 * 转移创建者。家庭创建者不走这里 —— 他们走 assertOwner，只管自己那一个家。
 * actionText 只用于把报错说清楚。
 */
function assertSuperAdmin(userId, actionText) {
  if (!isSuperAdmin(userId)) fail(`只有超级管理员能${actionText || '做这个操作'}`, CODE.FORBIDDEN)
}

/**
 * 敏感操作留痕。
 *
 * 写进 app_logs（这张表只写不可读，见 guardSelect），所以运维后台里看不到，
 * 需要时用控制台或脚本查。留痕失败**不能影响业务**：删家庭已经做完了，
 * 日志写不进去也只是少一条记录。
 */
async function logAdminAction(userId, eventName, payload) {
  try {
    await db.collection('app_logs').add({
      data: {
        user_id: userId,
        family_id: (payload && payload.familyId) || null,
        event_type: 'action',
        event_name: eventName,
        payload: payload || null,
        created_at: nowIso(),
      },
    })
  } catch (err) {
    console.error('[data] 写管理动作日志失败', eventName, err)
  }
}

/** 概览默认统计近 7 天 */
const ADMIN_WINDOW_DAYS = 7
/** 概览里最多回多少条报错 */
const ADMIN_ERROR_LIMIT = 20
/** 单次聚合最多拉多少行（数据量很小，留足余量即可） */
const ADMIN_SCAN_LIMIT = 1000

/** 进概览的「记录」类集合：键是集合名，值是给家长看的中文名 */
const ADMIN_RECORD_TABLES = {
  feeding_records: '喂养',
  sleep_records: '睡眠',
  diaper_records: '便便',
  baby_photos: '照片',
  growth_records: '生长',
  milestones: '里程碑',
  illness_records: '生病',
  checkup_records: '体检',
  vaccinations: '疫苗',
}

/** 把 ISO 时刻说成北京的日期键（与 ai_usage 的 day 口径一致） */
function beijingDayOf(value) {
  const ts = new Date(value).getTime()
  return Number.isFinite(ts) ? beijingDayKey(ts) : ''
}

/**
 * 运维概览：规模 + 近 N 天的活跃度 + 报错。
 *
 * 为什么在云函数里自己聚合：云开发没有 group by / 聚合管道，
 * 只能把行拉回来在内存里算。这个量级（每天几十条记录）完全够用，
 * 真要涨到几万行再考虑落一张汇总表。
 */
async function actionAdminOverview(userId, event) {
  assertSuperAdmin(userId, '查看运维概览')
  const days = Math.min(Math.max(Number(event.days) || ADMIN_WINDOW_DAYS, 1), 30)
  const sinceMs = Date.now() - days * 86400000
  const sinceIso = new Date(sinceMs).toISOString()
  const sinceDay = beijingDayKey(sinceMs)

  // 各集合近 N 天的条数 + 按天分布 + 活跃家庭
  const recordByType = []
  const recordByDay = {}
  const activeFamilies = {}
  let recordTotal = 0
  const tables = Object.keys(ADMIN_RECORD_TABLES)
  for (let i = 0; i < tables.length; i += 1) {
    const table = tables[i]
    let rows = []
    try {
      const res = await db
        .collection(table)
        .where({ created_at: _.gte(sinceIso) })
        .field({ family_id: true, created_at: true })
        .limit(ADMIN_SCAN_LIMIT)
        .get()
      rows = res.data || []
    } catch (err) {
      // 某个集合还没建（比如刚上线还没有体检记录）不该让整页打不开
      console.error('[data] 运维概览读取失败', table, err)
    }
    recordByType.push({ label: ADMIN_RECORD_TABLES[table], count: rows.length })
    recordTotal += rows.length
    rows.forEach((row) => {
      if (row.family_id) activeFamilies[row.family_id] = true
      const day = beijingDayOf(row.created_at)
      if (day) recordByDay[day] = (recordByDay[day] || 0) + 1
    })
  }

  // AI 用量：ai_usage 一行 = 一个人一天用了几次
  const aiByDay = {}
  let aiTotal = 0
  let aiPeople = {}
  try {
    const res = await db
      .collection(AI_USAGE_TABLE)
      .where({ day: _.gte(sinceDay) })
      .field({ day: true, count: true, user_id: true })
      .limit(ADMIN_SCAN_LIMIT)
      .get()
    ;(res.data || []).forEach((row) => {
      const count = Number(row.count) || 0
      aiTotal += count
      if (row.day) aiByDay[row.day] = (aiByDay[row.day] || 0) + count
      if (row.user_id) aiPeople[row.user_id] = true
    })
  } catch (err) {
    console.error('[data] 运维概览读取 AI 用量失败', err)
  }

  // 行为埋点按事件名汇总
  const actionByName = {}
  let actionTotal = 0
  try {
    const res = await db
      .collection('app_logs')
      .where({ event_type: 'action', created_at: _.gte(sinceIso) })
      .field({ event_name: true })
      .limit(ADMIN_SCAN_LIMIT)
      .get()
    ;(res.data || []).forEach((row) => {
      actionTotal += 1
      const name = row.event_name || 'unknown'
      actionByName[name] = (actionByName[name] || 0) + 1
    })
  } catch (err) {
    console.error('[data] 运维概览读取行为埋点失败', err)
  }

  // 报错：总数 + 「同一处报错」的分组（EventName+页面）+ 最近若干条（带 payload，排障就靠它）
  // 分组比逐条更重要：一次循环刷屏的报错，本质往往只有一两个原因。
  let errorTotal = 0
  let errors = []
  let errorGroups = []
  try {
    const res = await db
      .collection('app_logs')
      .where({ event_type: 'error', created_at: _.gte(sinceIso) })
      .orderBy('created_at', 'desc')
      .field({ event_name: true, payload: true, created_at: true })
      .limit(ADMIN_SCAN_LIMIT)
      .get()
    const rows = res.data || []
    errors = rows.slice(0, ADMIN_ERROR_LIMIT).map((row) => ({
      at: row.created_at || '',
      name: row.event_name || 'error',
      message: (row.payload && row.payload.msg) || '',
      page: (row.payload && row.payload.page) || '',
    }))
    const grouped = {}
    rows.forEach((row) => {
      const name = row.event_name || 'error'
      const page = (row.payload && row.payload.page) || ''
      const key = `${name}|${page}`
      if (!grouped[key]) grouped[key] = { name, page, count: 0, lastAt: '', message: '' }
      grouped[key].count += 1
      const at = row.created_at || ''
      if (at > grouped[key].lastAt) grouped[key].lastAt = at
      // 只留第一条的 message 作样本（同一个原因刷屏时，正文都一样）
      if (!grouped[key].message && row.payload && row.payload.msg) {
        grouped[key].message = row.payload.msg
      }
    })
    errorGroups = Object.keys(grouped)
      .map((key) => grouped[key])
      .sort((a, b) => b.count - a.count)
    const counted = await db
      .collection('app_logs')
      .where({ event_type: 'error', created_at: _.gte(sinceIso) })
      .count()
    errorTotal = (counted && counted.total) || errors.length
  } catch (err) {
    console.error('[data] 运维概览读取报错失败', err)
  }

  // 规模：这几个集合都是整表 count，不受窗口影响
  const scale = {}
  const scaleTables = { families: '家庭', babies: '宝宝', family_members: '成员', profiles: '用户' }
  const scaleKeys = Object.keys(scaleTables)
  for (let i = 0; i < scaleKeys.length; i += 1) {
    const table = scaleKeys[i]
    try {
      const counted = await db.collection(table).count()
      scale[table] = { label: scaleTables[table], count: (counted && counted.total) || 0 }
    } catch (err) {
      console.error('[data] 运维概览统计失败', table, err)
      scale[table] = { label: scaleTables[table], count: 0 }
    }
  }

  /**
   * 待处理反馈：运维后台存在的意义之一就是「有人提了反馈，我得知道」。
   * 放在概览里是为了让超管一进来就看见，不用主动去翻反馈页签。
   * 用两次 count 相减（云开发没有 group by）。
   */
  let pendingFeedbackCount = 0
  try {
    const [allFb, doneFb] = await Promise.all([
      db.collection('feedbacks').count(),
      db.collection('feedbacks').where({ status: 'done' }).count(),
    ])
    pendingFeedbackCount = ((allFb && allFb.total) || 0) - ((doneFb && doneFb.total) || 0)
  } catch (err) {
    console.error('[data] 运维概览统计反馈失败', err)
  }

  /** 补齐没有记录的日期，前端画柱状不用再补空档 */
  const dayList = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = beijingDayKey(Date.now() - i * 86400000)
    dayList.push({ day, records: recordByDay[day] || 0, ai: aiByDay[day] || 0 })
  }

  return {
    days,
    scale,
    recordTotal,
    recordByType,
    aiTotal,
    aiPeople: Object.keys(aiPeople).length,
    actionTotal,
    actionByName: Object.keys(actionByName).map((name) => ({ name, count: actionByName[name] })),
    activeFamilyCount: Object.keys(activeFamilies).length,
    errorTotal,
    errors,
    errorGroups,
    pendingFeedbackCount,
    dayList,
  }
}

/**
 * 家庭列表：每家的规模 + 权益现状，供运维改档位。
 *
 * 记录总数按家庭现算（一次拉 family_id 就够，数据量小）；
 * 会员制没上线时前端不展示会员列，但接口照旧返回，省得两套。
 */
async function actionAdminFamilies(userId) {
  assertSuperAdmin(userId, '查看家庭列表')
  const [familyRes, memberRes, babyRes] = await Promise.all([
    db.collection('families').limit(ADMIN_SCAN_LIMIT).get(),
    db.collection('family_members').field({ family_id: true, role: true, status: true, user_id: true, nickname: true }).limit(ADMIN_SCAN_LIMIT).get(),
    db.collection('babies').field({ family_id: true, name: true }).limit(ADMIN_SCAN_LIMIT).get(),
  ])
  const families = familyRes.data || []
  const members = memberRes.data || []
  const babies = babyRes.data || []

  // 每家在各记录表里的条数 + 最近记录时间
  const perFamily = {}
  const bump = (familyId) => {
    if (!perFamily[familyId]) perFamily[familyId] = { records: 0, lastAt: '' }
    return perFamily[familyId]
  }
  const tables = Object.keys(ADMIN_RECORD_TABLES)
  for (let i = 0; i < tables.length; i += 1) {
    const table = tables[i]
    try {
      const res = await db
        .collection(table)
        .field({ family_id: true, created_at: true })
        .limit(ADMIN_SCAN_LIMIT)
        .get()
      ;(res.data || []).forEach((row) => {
        if (!row.family_id) return
        const item = bump(row.family_id)
        item.records += 1
        const at = row.created_at || ''
        if (at && at > item.lastAt) item.lastAt = at
      })
    } catch (err) {
      console.error('[data] 运维家庭列表读取失败', table, err)
    }
  }

  const now = Date.now()
  const list = families.map((family) => {
    const stat = perFamily[family._id] || { records: 0, lastAt: '' }
    const memberRows = members.filter((row) => row.family_id === family._id && row.status === 'active')
    const babyRows = babies.filter((row) => row.family_id === family._id)
    const untilMs = family.member_until ? new Date(family.member_until).getTime() : 0
    const storedTier = family.member_tier === 'member' ? 'member' : 'free'
    // 这家的家庭管理员 = 创建者（role='owner'）。运维要能一眼看到是谁。
    const owner = memberRows.find((row) => row.role === 'owner')
    return {
      id: family._id,
      name: family.name || '未命名',
      createdAt: family.created_at || '',
      inviteCode: family.invite_code || '',
      memberCount: memberRows.length,
      ownerCount: memberRows.filter((row) => row.role === 'owner').length,
      ownerId: owner ? owner.user_id || '' : '',
      ownerName: owner ? owner.nickname || '' : '',
      ownerShortId: owner && owner.user_id ? owner.user_id.slice(-6) : '',
      babies: babyRows.map((row) => row.name || '').filter(Boolean),
      records: stat.records,
      lastRecordAt: stat.lastAt,
      // 库里存的档位（运维照着改），与「当前是否真的生效」分开给
      tier: storedTier,
      until: family.member_until || null,
      expired: Boolean(untilMs && untilMs <= now),
      code: family.member_code || '',
      redeemedAt: family.member_redeemed_at || '',
      // 这家的功能开关覆盖（只含被明确改过的 key；没记的跟随全局）
      flags: family.feature_flags || {},
    }
  })
  list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { families: list, membershipEnabled: MEMBERSHIP_ENABLED }
}

/**
 * 改某个家庭的权益档位（运维直接生效，不用再发开通码让家长自己兑）。
 *
 * until 收 'YYYY-MM-DD'，按**北京时间的当天 23:59:59** 存成 ISO：
 * 家长看到「9 月 30 日到期」时，那天全天应该都还能用。
 * 传空字符串 = 永久（与开通码的「0 天」语义一致）。
 */
async function actionAdminSetTier(userId, event) {
  assertSuperAdmin(userId, '修改会员档位')
  const familyId = event.familyId ? String(event.familyId) : ''
  if (!familyId) fail('缺少家庭 id', CODE.BAD_REQUEST)
  const family = await getDocById('families', familyId)
  if (!family) fail('家庭不存在', CODE.BAD_REQUEST)

  const tier = event.tier === 'member' ? 'member' : 'free'
  const rawUntil = String(event.until || '').trim()
  let until = null
  if (tier === 'member' && rawUntil) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawUntil)) fail('到期日格式应为 YYYY-MM-DD', CODE.BAD_REQUEST)
    const ts = new Date(`${rawUntil}T23:59:59+08:00`).getTime()
    if (!Number.isFinite(ts)) fail('到期日不合法', CODE.BAD_REQUEST)
    until = new Date(ts).toISOString()
  }

  await db.collection('families').doc(familyId).update({
    // member_until 传 null 表示「永久」，必须走 $set，否则旧到期日清不掉，
    // 家长会一直看到「会员 · 已过期」
    data: explicitSet({
      member_tier: tier,
      member_until: until,
      member_code: 'ADMIN',
      member_redeemed_at: nowIso(),
    }),
  })
  await logAdminAction(userId, 'set_tier', { familyId, tier, until })
  console.log('[data] 改档位', familyId, tier, until)
  return { familyId, tier, until }
}

/** 运维查功能开关的清单与全局现状（家庭覆盖在 adminFamilies 里一起给） */
async function actionAdminFlags(userId) {
  assertSuperAdmin(userId, '查看功能开关')
  const globalFlags = await readGlobalFlags()
  return { catalog: FEATURE_FLAGS, globals: resolveFlags(globalFlags, null) }
}

/**
 * 改一个功能开关。
 *
 * 权限按作用域分：
 *   - scope='global'：整个小程序生效 → **只有超管**。这是总闸，不该下放。
 *   - scope='family'：某家的覆盖 → **超管或该家的创建者**。创建者管自己家天经地义。
 *
 * value 传 null = 取消覆盖（改成跟随全局）。
 *
 * 注意生效规则是「总闸 + 分闸」而不是「家庭覆盖优先」：
 * 全局关掉的东西，谁家都开不回来（见 resolveFlags）。所以某家即使标了开，
 * 全局一关照样看不到 —— 这是超管全局闸门该有的语义。
 */
async function actionAdminSetFlag(userId, event) {
  const key = String(event.key || '')
  if (FEATURE_KEYS.indexOf(key) < 0) fail('未知的功能开关', CODE.BAD_REQUEST)
  const scope = event.scope === 'family' ? 'family' : 'global'

  if (scope === 'global') {
    assertSuperAdmin(userId, '修改全局功能开关')
    const value = event.value === true
    const next = { ...(await readGlobalFlags()) }
    next[key] = value
    // set 是 upsert：文档不存在就建。但集合必须已经存在（读不存在只会报错，写会失败），
    // 所以上线时要在控制台建一个空的 app_config。
    await db.collection(APP_CONFIG_TABLE).doc(FEATURE_FLAG_DOC_ID).set({
      data: { flags: next, updated_at: nowIso() },
    })
    await logAdminAction(userId, 'flag_global', { key, value })
    console.log('[data] 改全局开关', key, value)
    return { scope, key, value }
  }

  const familyId = event.familyId ? String(event.familyId) : ''
  if (!familyId) fail('缺少家庭 id', CODE.BAD_REQUEST)
  const family = await getDocById('families', familyId)
  if (!family) fail('家庭不存在', CODE.BAD_REQUEST)
  // 超管能改任意家庭；其余必须是这一家的创建者
  if (!isSuperAdmin(userId)) await assertOwner(userId, familyId)

  const value = event.value === null || event.value === undefined ? null : event.value === true
  const next = { ...(family.feature_flags || {}) }
  if (value === null) delete next[key]
  else next[key] = value

  /**
   * ⚠️ 这里必须用 `_.set()` / `_.remove()`，不能直接传普通对象。
   *
   * 云开发的 update 对**对象字段做的是「合并」而不是替换**（官方 Command.set 文档
   * 写得很明确：`update({style: {color:'red'}})` 只改 style.color，不动 style 的其他字段）。
   * 于是 `delete next[key]` 只在本地那份副本里去掉了 key，写进库时被合并回来 ——
   * 「跟随全局」点了等于没点，界面上那条例外永远消不掉。
   * 实测踩过：连着写 10 次 value=null 全部记进日志，families.feature_flags 一动不动。
   *
   * 没有任何覆盖时干脆把整个字段移除，读侧把「字段不存在」和「空对象」都当没覆盖。
   */
  const override = Object.keys(next).length ? _.set(next) : _.remove()
  await db.collection('families').doc(familyId).update({ data: { feature_flags: override } })
  await logAdminAction(userId, 'flag_family', { familyId, key, value })
  console.log('[data] 改家庭开关', familyId, key, value)
  return { scope, familyId, key, value }
}

/** 删除家庭时要清的集合（都按 family_id 归属） */
const ADMIN_PURGE_TABLES = [
  'family_members',
  'family_invitations',
  'babies',
  'baby_photos',
  'growth_records',
  'vaccinations',
  'feeding_records',
  'sleep_records',
  'diaper_records',
  'milestones',
  'illness_records',
  'checkup_records',
]

/**
 * 删除一个家庭（连同它的全部数据），不可撤销。
 *
 * 两道保险，都是防手滑：
 *   1. 必须把家庭名原样传进来（前端弹层要求手输），避免点错一家；
 *   2. 不允许删掉调用者**唯一的那个家** —— 删完就无处可去，下次进小程序会
 *      被改道到「开始使用」。自己属于多个家时允许删（清理自建的空家正是这种场景）。
 *
 * 权限：**只有超级管理员**。被授权的管理员能看数据、改开关、改档位，但删家庭
 * 一次清掉一整家的记录且不可撤销，这种不可逆的动作不往下放。
 *
 * 账号维度的 profiles / app_logs / ai_usage / ai_feedback **不动**：
 * 它们记在人身上，跟家庭无关。
 *
 * 顺序：先收集云存储路径 → 删数据库 → 删家庭本身。
 * 文件不在这里删（云函数拿不到「环境ID.存储桶ID」前缀），把路径回给前端，
 * 由前端拼成 fileID 再调 adminDeleteFiles；前端漏删最多留几个孤儿文件，不影响使用。
 */
async function actionAdminDeleteFamily(userId, event) {
  assertSuperAdmin(userId, '删除家庭')
  const familyId = event.familyId ? String(event.familyId) : ''
  if (!familyId) fail('缺少家庭 id', CODE.BAD_REQUEST)
  const family = await getDocById('families', familyId)
  if (!family) fail('家庭不存在', CODE.BAD_REQUEST)

  const typed = String(event.confirmName || '').trim()
  if (!typed || typed !== String(family.name || '').trim()) {
    fail('家庭名不一致，已取消', CODE.BAD_REQUEST)
  }
  const mine = await findMembership(userId, familyId)
  if (mine) {
    const myFamilies = await listActiveFamilyIds(userId)
    if (myFamilies.length <= 1) {
      fail('这是你自己唯一的家，删掉之后就没地方可去了，已取消', CODE.BAD_REQUEST)
    }
  }

  // 1. 先把云存储路径收集起来：记录删掉之后就再也找不到这些文件了
  const paths = []
  const collect = async (table, field) => {
    try {
      const res = await db
        .collection(table)
        .where({ family_id: familyId })
        .field({ [field]: true })
        .limit(ADMIN_SCAN_LIMIT)
        .get()
      ;(res.data || []).forEach((row) => {
        if (row[field]) paths.push(String(row[field]))
      })
    } catch (err) {
      console.error('[data] 删除家庭时收集文件失败', table, err)
    }
  }
  await collect('baby_photos', 'storage_path')
  await collect('babies', 'avatar_url')
  await collect('milestones', 'photo_url')

  // 2. 逐表按 family_id 清理；缺表的跳过，别让一张表把整件事卡住
  const removed = {}
  for (let i = 0; i < ADMIN_PURGE_TABLES.length; i += 1) {
    const table = ADMIN_PURGE_TABLES[i]
    try {
      const res = await db.collection(table).where({ family_id: familyId }).remove()
      removed[table] = (res && res.stats && res.stats.removed) || 0
    } catch (err) {
      console.error('[data] 删除家庭清理失败', table, err)
      // -1 = 这张表没清干净，前端会标出来，方便人工再看一眼
      removed[table] = -1
    }
  }

  // 3. 最后删家庭本身（顺序放在最后：中途失败时，家庭还在、孩子数据已清，比反过来好排查）
  await db.collection('families').doc(familyId).remove()
  // 留痕里连家庭名一起记：事后只看 id 认不出删的是谁家
  await logAdminAction(userId, 'delete_family', { familyId, name: family.name || '', removed, files: paths.length })
  console.log('[data] 删除家庭', familyId, family.name, JSON.stringify(removed))
  return { familyId, removed, paths }
}

/**
 * 运维删文件（删家庭后清残留的照片/头像/里程碑照片）。
 *
 * 这些文件已经没有任何记录了，所以这里只校验身份、不再查家庭成员。
 * 但**必须是超级管理员**：它是「删家庭」的收尾步骤，而且入参是任意 fileID 列表，
 * 不能作为一项独立能力发给被授权的管理员（他拿不到别人的 fileID，但也没必要给这个口子）。
 */
async function actionAdminDeleteFiles(userId, event) {
  assertSuperAdmin(userId, '删除文件')
  const ids = asArray(event.fileList)
    .filter(Boolean)
    .map(String)
  let removed = 0
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const res = await cloud.deleteFile({ fileList: ids.slice(i, i + 50) })
      const list = (res && res.fileList) || []
      removed += list.filter((item) => item && item.status === 0).length
    } catch (err) {
      console.error('[data] 运维删文件失败', err)
    }
  }
  return { removed, total: ids.length }
}

/**
 * 全部成员一览：谁在用、在哪几个家、各是什么角色。
 *
 * 真源是 family_members —— 云开发侧的身份就是 openid，一个人可能同时在几个家里，
 * 所以这里按 user_id 聚合。家庭名另查一次 families 建映射（家庭就那么几个）。
 *
 * 这是**只读**视图：这里不授予任何权限。家庭的成员管理在各家自己做 ——
 * 家庭创建者管本家、超管能进任意家庭管；没有「全局管理员」这么一层。
 *
 * openid 只回后 6 位：列表是给人看的，完整值没必要摆出来。
 *
 * 刻意不带「这个人生成了多少条记录」：那要扫 9 张表，代价远大于这条信息的价值。
 * 真要看清某个家用了多少，去看「运维概览」。
 */
async function actionAdminUsers(userId) {
  assertSuperAdmin(userId, '查看成员一览')
  const memberRes = await db.collection('family_members').limit(ADMIN_SCAN_LIMIT).get()
  const familyRes = await db.collection('families').limit(ADMIN_SCAN_LIMIT).get()
  const nameById = {}
  ;(familyRes.data || []).forEach((row) => {
    nameById[row._id] = row.name || '未命名'
  })

  const byUser = {}
  ;(memberRes.data || []).forEach((row) => {
    const id = row.user_id
    if (!id) return
    if (!byUser[id]) byUser[id] = { userId: id, nickname: '', families: [], joinedAt: '' }
    const person = byUser[id]
    if (!person.nickname && row.nickname) person.nickname = String(row.nickname)
    person.families.push({
      familyId: row.family_id || '',
      name: nameById[row.family_id] || '（家庭已不在）',
      role: row.role || 'member',
      status: row.status || 'active',
    })
    const at = row.created_at || ''
    if (at && (!person.joinedAt || at < person.joinedAt)) person.joinedAt = at
  })

  const users = Object.keys(byUser).map((id) => {
    const person = byUser[id]
    // 他是哪几个家的创建者（= 那几个家的家庭管理员）
    const ownerOf = person.families
      .filter((item) => item.role === 'owner' && item.status === 'active')
      .map((item) => item.name)
    return {
      userId: person.userId,
      nickname: person.nickname,
      shortId: person.userId.slice(-6),
      families: person.families,
      // 只数还有效的成员关系：退出过的家不算「在用」
      activeFamilyCount: person.families.filter((item) => item.status === 'active').length,
      joinedAt: person.joinedAt,
      superAdmin: isSuperAdmin(id),
      ownerOf,
    }
  })
  // 超管排最前，其次「管着家的创建者」，最后按加入时间（谁是先来的）
  users.sort((a, b) => {
    if (a.superAdmin !== b.superAdmin) return a.superAdmin ? -1 : 1
    if (a.ownerOf.length !== b.ownerOf.length) return b.ownerOf.length - a.ownerOf.length
    return String(a.joinedAt).localeCompare(String(b.joinedAt))
  })

  return { users, superAdminCount: SUPER_ADMIN_OPENIDS.length }
}

/** 某个家庭的成员列表（超管视角）。多给 openid 后 6 位，重名时能分辨谁是谁 */
async function actionAdminFamilyMembers(userId, event) {
  assertSuperAdmin(userId, '查看家庭成员')
  const familyId = event.familyId ? String(event.familyId) : ''
  if (!familyId) fail('缺少家庭 id', CODE.BAD_REQUEST)
  const family = await getDocById('families', familyId)
  if (!family) fail('家庭不存在', CODE.BAD_REQUEST)

  const res = await db
    .collection('family_members')
    .where({ family_id: familyId, status: 'active' })
    .orderBy('created_at', 'asc')
    .limit(ADMIN_SCAN_LIMIT)
    .get()
  const members = (res.data || []).map((row) => ({
    id: row._id,
    userId: row.user_id || '',
    shortId: row.user_id ? String(row.user_id).slice(-6) : '',
    nickname: row.nickname || '',
    role: row.role || 'member',
    joinedAt: row.created_at || '',
  }))
  return {
    family: { id: familyId, name: family.name || '未命名' },
    members,
    // 谁是这个家的创建者（= 家庭管理员）
    ownerId: (members.find((item) => item.role === 'owner') || {}).id || '',
  }
}

/**
 * 取出并校验「这个成员确实属于这个家、且不是创建者」。
 * 改角色和移除成员共用这段判断，语义要一致 —— 免得两处规则悄悄跑偏。
 */
async function loadManageableMember(familyId, memberId) {
  const target = await getDocById('family_members', memberId)
  if (!target) fail('成员不存在', CODE.BAD_REQUEST)
  // 传了 familyId 就再校一次，避免拿着 A 家的成员 id 在 B 家界面上乱改
  if (familyId && String(target.family_id) !== String(familyId)) {
    fail('该成员不属于这个家庭', CODE.BAD_REQUEST)
  }
  if (target.role === 'owner') fail('家庭创建者不在这里改，要换请用「转移创建者」', CODE.BAD_REQUEST)
  if (target.status !== 'active') fail('该成员已被移除', CODE.BAD_REQUEST)
  return target
}

/** 改成员角色（超管替这个家的创建者做）。规则与 rpcSetMemberRole 完全一致 */
async function actionAdminSetMemberRole(userId, event) {
  assertSuperAdmin(userId, '修改成员角色')
  const target = await loadManageableMember(event.familyId, event.memberId)
  const role = event.role === 'viewer' ? 'viewer' : 'member'
  await db.collection('family_members').doc(target._id).update({ data: { role } })
  await logAdminAction(userId, 'set_member_role', {
    familyId: target.family_id,
    memberId: target._id,
    role,
  })
  return { memberId: target._id, role }
}

/**
 * 把成员移出家庭（超管替这个家的创建者做）。
 * 软删除（status='removed'），与 rpcRemoveFamilyMember 一致：保留成员行，
 * 日后凭邀请码重新加入时能把 status 置回 active。
 */
async function actionAdminRemoveMember(userId, event) {
  assertSuperAdmin(userId, '移除家庭成员')
  const target = await loadManageableMember(event.familyId, event.memberId)
  await db.collection('family_members').doc(target._id).update({ data: { status: 'removed' } })
  await logAdminAction(userId, 'remove_member', {
    familyId: target.family_id,
    memberId: target._id,
    userId: target.user_id || '',
  })
  return { memberId: target._id }
}

/**
 * 转移家庭创建者 —— 也就是「换这个家的家庭管理员」。
 *
 * 这是全部运维动作里最容易出事的一个，所以门槛刻意设高：
 * 必须手输**当前家庭名**（和删家庭同一套防手滑），且不能转给已被移除的人。
 * 转完之后原创建者降为「成员」，立刻失去发邀请码与改家庭名的能力。
 *
 * 用事务的原因：这是「降一个、升一个」两步。中途断掉就会出现
 * 「一个家没有创建者」（谁都发不了邀请码、改不了家庭名）或「两个创建者」的坏状态，
 * 必须一起成功或一起失败。
 */
async function actionAdminTransferOwner(userId, event) {
  assertSuperAdmin(userId, '转移家庭创建者')
  const familyId = event.familyId ? String(event.familyId) : ''
  if (!familyId) fail('缺少家庭 id', CODE.BAD_REQUEST)
  const family = await getDocById('families', familyId)
  if (!family) fail('家庭不存在', CODE.BAD_REQUEST)
  const typed = String(event.confirmName || '').trim()
  if (!typed || typed !== String(family.name || '').trim()) {
    fail('家庭名不一致，已取消', CODE.BAD_REQUEST)
  }

  const memberId = event.memberId ? String(event.memberId) : ''
  if (!memberId) fail('缺少新的创建者', CODE.BAD_REQUEST)
  const target = await getDocById('family_members', memberId)
  if (!target || String(target.family_id) !== familyId) fail('该成员不属于这个家庭', CODE.BAD_REQUEST)
  if (target.status !== 'active') fail('该成员已被移除，不能担任创建者', CODE.BAD_REQUEST)
  if (target.role === 'owner') fail('他已经是这个家的创建者了', CODE.BAD_REQUEST)

  // 理论上只有一个 owner，这里按多条处理：数据万一脏了也能一次收干净
  const ownerRes = await db
    .collection('family_members')
    .where({ family_id: familyId, role: 'owner', status: 'active' })
    .limit(10)
    .get()
  const oldOwners = ownerRes.data || []

  await db.runTransaction(async (transaction) => {
    for (let i = 0; i < oldOwners.length; i += 1) {
      await transaction
        .collection('family_members')
        .doc(oldOwners[i]._id)
        .update({ data: { role: 'member' } })
    }
    await transaction.collection('family_members').doc(memberId).update({ data: { role: 'owner' } })
  })

  await logAdminAction(userId, 'transfer_owner', {
    familyId,
    memberId,
    oldOwnerIds: oldOwners.map((row) => row._id),
  })
  console.log('[data] 转移创建者', familyId, memberId)
  return { familyId, memberId, oldOwnerCount: oldOwners.length }
}

/**
 * 意见反馈列表（超管视角）。
 *
 * 反馈是账号维度的数据（没有 family_id），普通用户走 actionSelect 只能看到自己提交的。
 * 超管在这里看全部：谁提的、什么时候提的、内容与截图、回没回过。
 *
 * status 传 'pending' / 'done' 只看一类，不传 = 全部。
 * 无论筛选与否都回一个 pendingCount：页签上要显示「还有几条没处理」。
 *
 * 截图存的是相对路径，前端用 adminFileURL 换链接 —— 反馈截图可能落在提交人
 * 当时那个家的目录下（超管不是那家的成员），也可能完全没有家庭，走不通
 * tempFileURL 的成员校验，所以那条路要单独开。
 */
async function actionAdminFeedbacks(userId, event) {
  assertSuperAdmin(userId, '查看意见反馈')
  const status = event.status === 'pending' || event.status === 'done' ? event.status : ''

  const res = await db
    .collection('feedbacks')
    .orderBy('created_at', 'desc')
    .limit(ADMIN_SCAN_LIMIT)
    .get()
  const rows = res.data || []

  let pendingCount = 0
  rows.forEach((row) => {
    if ((row.status || 'pending') !== 'done') pendingCount += 1
  })

  const feedbacks = rows
    .filter((row) => !status || (row.status || 'pending') === status)
    .map((row) => ({
      id: row._id,
      shortId: row.user_id ? String(row.user_id).slice(-6) : '',
      content: row.content || '',
      type: row.type || 'other',
      contact: row.contact || '',
      images: asArray(row.images).filter(Boolean),
      status: row.status === 'done' ? 'done' : 'pending',
      reply: row.reply || '',
      createdAt: row.created_at || '',
      handledAt: row.handled_at || '',
    }))

  return { feedbacks, pendingCount, totalCount: rows.length, status: status || 'all' }
}

/**
 * 处理一条反馈：改状态 + 写一句回复。
 *
 * reply 是给提交人看的（「我的 → 意见反馈」里显示），所以为空时一并清掉，
 * 免得出现「已处理但没有回复」的半截状态。handled_at / handled_by 只用于排障。
 */
async function actionAdminSetFeedbackStatus(userId, event) {
  assertSuperAdmin(userId, '处理意见反馈')
  const feedbackId = event.feedbackId ? String(event.feedbackId) : ''
  if (!feedbackId) fail('缺少反馈 id', CODE.BAD_REQUEST)
  const row = await getDocById('feedbacks', feedbackId)
  if (!row) fail('反馈不存在', CODE.BAD_REQUEST)

  const status = event.status === 'done' ? 'done' : 'pending'
  const reply = String(event.reply == null ? '' : event.reply).trim()
  if (reply.length > FEEDBACK_MAX_REPLY) {
    fail(`回复最多 ${FEEDBACK_MAX_REPLY} 个字`, CODE.BAD_REQUEST)
  }

  await db.collection('feedbacks').doc(feedbackId).update({
    // 标回待处理时 reply / handled_at / handled_by 都是 null，
    // 普通对象传进去会被丢掉（旧回复留在库里），所以走 $set
    data: explicitSet({
      status,
      reply: reply || null,
      handled_at: status === 'done' ? nowIso() : null,
      handled_by: status === 'done' ? userId : null,
      updated_at: nowIso(),
    }),
  })
  await logAdminAction(userId, 'set_feedback_status', {
    feedbackId,
    status,
    replied: Boolean(reply),
  })
  return { feedbackId, status, reply }
}

/**
 * 超管换文件链接：不查家庭归属，只看是不是超级管理员。
 *
 * 为什么不能复用 tempFileURL：那条路会从 fileID 路径首段取出 family_id 做成员校验，
 * 而反馈截图恰恰可能落在「提交人当时那个家」的目录下 —— 超管不是那家的成员，换不出来；
 * 用户在还没建家庭时提交的反馈，路径首段是 'feedback'，连 fileID 的合法性检查都过不去。
 * 这里是运维后台专用的只读换链接口，入参是任意 fileID 列表。
 */
async function actionAdminFileURL(userId, event) {
  assertSuperAdmin(userId, '查看文件')
  const ids = asArray(event.fileList)
    .map((item) => (typeof item === 'string' ? item : item && item.fileID))
    .filter(Boolean)
    .map(String)
  if (!ids.length) fail('缺少 fileList', CODE.BAD_REQUEST)

  const out = []
  for (let i = 0; i < ids.length; i += 50) {
    const res = await cloud.getTempFileURL({ fileList: ids.slice(i, i + 50) })
    out.push(...((res && res.fileList) || []))
  }
  return { data: out }
}

/**
 * 领一次 AI 额度：够就 +1 并把用量返回给前端（前端只用来打日志），超了直接报错。
 *
 * 两个约定：
 * 1. **先扣后调、失败不退**：AI 是客户端直连模型的，请求一旦发出就可能已经计费，
 *    所以不在失败时退还，否则「刷失败」就能把额度刷回来。
 * 2. 读-改-写**不是原子的**（云开发没有跨文档事务）：极端并发下可能多放一两次。
 *    对「防滥用」这个目的足够；真正的成本闸门是资源包总量，不是这里。
 *
 * 额度按家庭的权益档位取（免费 5 次/天、会员 50 次/天），记账仍按人。
 *
 * event.peek = true 时只读不扣：AI 页顶部要显示「今天还能问几次」，
 * 那次查询不能反过来把次数吃掉。
 */
async function actionAiUsage(userId, event) {
  const familyId = event.familyId ? String(event.familyId) : ''
  if (familyId) await assertMember(userId, familyId, false)

  const tier = await resolveTier(familyId)
  const limit = (MEMBERSHIP_PLANS[tier] || MEMBERSHIP_PLANS.free).chatPerDay
  const day = beijingDayKey(Date.now())
  const collection = db.collection(AI_USAGE_TABLE)
  const found = await collection.where({ user_id: userId, day }).limit(1).get()
  const row = found.data && found.data[0]
  const used = row ? Number(row.count) || 0 : 0

  if (event.peek) return { used, limit, day, tier }

  if (used >= limit) {
    fail(`今天的 AI 次数用完了（每天 ${limit} 次），明天再来`, 'AI_QUOTA_EXCEEDED')
  }

  const next = used + 1
  if (row) {
    await collection.doc(row._id).update({ data: { count: next, updated_at: nowIso() } })
  } else {
    await collection.add({
      data: { user_id: userId, day, count: 1, created_at: nowIso(), updated_at: nowIso() },
    })
  }
  return { used: next, limit, day, tier }
}

/**
 * 记一条 AI 回答反馈。
 *
 * 存下来是为了「知道该改哪儿」：提示词、通用参考、上下文裁剪，哪个方向该动，
 * 靠猜不如看差评里家长问的是什么、答成了什么样。
 * 正文只留前 600 字（够看出问题），不保留完整回答，避免集合长得太快。
 */
async function actionAiFeedback(userId, event) {
  const familyId = event.familyId ? String(event.familyId) : ''
  if (familyId) await assertMember(userId, familyId, false)

  const rating = event.rating === 'up' || event.rating === 'down' ? event.rating : ''
  if (!rating) fail('缺少评价结果', CODE.BAD_REQUEST)

  const clip = (value, max) => String(value == null ? '' : value).slice(0, max)
  await db.collection(AI_FEEDBACK_TABLE).add({
    data: {
      user_id: userId,
      family_id: familyId || null,
      baby_id: event.babyId ? String(event.babyId) : null,
      rating,
      reason: clip(event.reason, 40),
      question: clip(event.question, 300),
      answer: clip(event.answer, AI_FEEDBACK_ANSWER_MAX),
      basis: clip(event.basis, 200),
      created_at: nowIso(),
    },
  })
  return { saved: true }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

exports.main = async (event) => {
  const payload = event || {}
  // 鉴权缓存只在本次请求内有效：热实例会复用模块变量，跨请求留着就是越权
  resetAuthCache()
  try {
    const userId = currentUserId()
    let result
    switch (payload.action) {
      case 'select':
        result = await actionSelect(userId, payload)
        break
      case 'insert':
        result = await actionInsert(userId, payload)
        break
      case 'insertSilent':
        result = await actionInsertSilent(userId, payload)
        break
      case 'upsert':
        result = await actionUpsert(userId, payload)
        break
      case 'remove':
        result = await actionRemove(userId, payload)
        break
      case 'rpc':
        result = await actionRpc(userId, payload)
        break
      case 'tempFileURL':
        result = await actionTempFileURL(userId, payload)
        break
      case 'deleteFile':
        result = await actionDeleteFile(userId, payload)
        break
      case 'aiUsage':
        result = await actionAiUsage(userId, payload)
        break
      // 只读查额度（不扣次数）。
      // 刻意单独开一个 action，而不是复用 aiUsage 加个 peek 参数：
      // 万一前端先上线、云函数还是旧版，旧版会把这次查询当成一次真实扣费 ——
      // 打开一次 AI 页白扣一次额度太伤了。单独 action 在旧版只会回「不支持的 action」。
      case 'aiQuota':
        result = await actionAiUsage(userId, { familyId: payload.familyId, peek: true })
        break
      case 'aiFeedback':
        result = await actionAiFeedback(userId, payload)
        break
      case 'membershipStatus':
        result = await actionMembershipStatus(userId, payload)
        break
      case 'membershipRedeem':
        result = await actionMembershipRedeem(userId, payload)
        break
      // 功能开关（所有登录用户都能读自己家的生效值）
      case 'featureFlags':
        result = await actionFeatureFlags(userId, payload)
        break
      // 家庭创建者读自己家的开关明细（含全局现状与自家覆盖）
      case 'familyFlags':
        result = await actionFamilyFlags(userId, payload)
        break
      // 运维后台：除了 adminSetFlag 的家庭作用域（创建者也能改自己家的），
      // 其余一律只认超级管理员 —— 见 SUPER_ADMIN_OPENIDS / assertSuperAdmin
      case 'adminOverview':
        result = await actionAdminOverview(userId, payload)
        break
      case 'adminFamilies':
        result = await actionAdminFamilies(userId)
        break
      case 'adminSetTier':
        result = await actionAdminSetTier(userId, payload)
        break
      // 开通码台账：列表 / 批量生成 / 作废恢复
      case 'adminCodes':
        result = await actionAdminCodes(userId, payload)
        break
      case 'adminCreateCodes':
        result = await actionAdminCreateCodes(userId, payload)
        break
      case 'adminSetCodeStatus':
        result = await actionAdminSetCodeStatus(userId, payload)
        break
      case 'adminFlags':
        result = await actionAdminFlags(userId)
        break
      case 'adminSetFlag':
        // 超管改全局或任意家庭；家庭创建者改自己家（函数内自己判）
        result = await actionAdminSetFlag(userId, payload)
        break
      case 'adminDeleteFamily':
        result = await actionAdminDeleteFamily(userId, payload)
        break
      case 'adminDeleteFiles':
        result = await actionAdminDeleteFiles(userId, payload)
        break
      case 'adminUsers':
        result = await actionAdminUsers(userId)
        break
      // 超管进某个家庭管成员
      case 'adminFamilyMembers':
        result = await actionAdminFamilyMembers(userId, payload)
        break
      case 'adminSetMemberRole':
        result = await actionAdminSetMemberRole(userId, payload)
        break
      case 'adminRemoveMember':
        result = await actionAdminRemoveMember(userId, payload)
        break
      case 'adminTransferOwner':
        result = await actionAdminTransferOwner(userId, payload)
        break
      // 意见反馈：超管看全部、写回复；截图换链接单独走 adminFileURL
      case 'adminFeedbacks':
        result = await actionAdminFeedbacks(userId, payload)
        break
      case 'adminSetFeedbackStatus':
        result = await actionAdminSetFeedbackStatus(userId, payload)
        break
      case 'adminFileURL':
        result = await actionAdminFileURL(userId, payload)
        break
      default:
        fail(`不支持的 action：${payload.action}`, CODE.BAD_REQUEST)
    }
    return Object.assign({ ok: true }, result)
  } catch (err) {
    return {
      ok: false,
      code: (err && err.code) || CODE.INTERNAL,
      message: (err && err.message) || String(err),
    }
  }
}
