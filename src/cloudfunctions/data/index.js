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
]

/** 邀请码字符集：与 Supabase 侧 generate_invite_code 一致，去掉易混淆的 I/O/0/1 */
const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * 用户反馈（feedbacks）：账号维度表，没有 family_id，不能走家庭鉴权。
 * 鉴权规则 = 「只能看/写自己提交的」，身份字段由服务端从 OPENID 注入。
 */
const FEEDBACK_TYPES = ['bug', 'suggestion', 'content', 'other']
const FEEDBACK_MIN_LEN = 5
const FEEDBACK_MAX_LEN = 500
const FEEDBACK_MAX_IMAGES = 3
const FEEDBACK_MAX_CONTACT = 50

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

async function findMembership(userId, familyId) {
  const res = await db
    .collection('family_members')
    .where({ family_id: familyId, user_id: userId, status: 'active' })
    .limit(1)
    .get()
  return res.data[0] || null
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

/** 我作为 active 成员的全部家庭 id */
async function listActiveFamilyIds(userId) {
  const res = await db
    .collection('family_members')
    .where({ user_id: userId, status: 'active' })
    .field({ family_id: true })
    .limit(1000)
    .get()
  return res.data.map((row) => row.family_id)
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
    await assertMember(userId, doc.family_id, true)
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
      await db.collection('checkup_records').doc(checkup._id).update({ data: { growth_id: null } })
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
    await db.collection('growth_records').doc(linked._id).update({ data: values })
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
      for (const familyId of familyIds) await assertMember(userId, familyId)
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
      for (const familyId of familyIds) await assertMember(userId, familyId)
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
  const res = await query.skip(skip).limit(limit).get()

  let total = null
  if (event.count) {
    let countQuery = db.collection(table)
    if (where) countQuery = countQuery.where(where)
    const countRes = await countQuery.count()
    total = countRes.total
  }

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
        await db.collection(table).doc(id).update({ data: patch })
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
    .update({ data: { nickname } })

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
// 入口
// ---------------------------------------------------------------------------

exports.main = async (event) => {
  const payload = event || {}
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
