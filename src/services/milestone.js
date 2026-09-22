/**
 * 里程碑的业务数据访问层（二期 P0-5）。
 *
 * 数据库存 milestone_key（预置 key 或 'custom'）+ name（展示名），
 * 中文映射写死在前端常量表（需求文档 4.1）。
 * 照片存在 baby-photos 桶，路径 {family_id}/{baby_id}/milestone/{uuid}.jpg，
 * 表里 photo_url 存的是对象路径，展示时再换签名 URL。
 * 更新走 upsert（微信小程序不支持 PATCH）。
 */
import { api } from './api'
import { trackRecordCreated } from '@/utils/tracker'

const MILESTONE_COLUMNS =
  'id,family_id,baby_id,milestone_key,name,achieved_date,photo_url,note,created_by,created_at'

/** 自定义里程碑的固定 key */
export const CUSTOM_KEY = 'custom'

/**
 * 预置里程碑常量表（需求文档 4.1 的 9 个 + 自定义），
 * 按常见月龄先后排列（需求文档 5.2「按常见月龄排序」）。
 * glyph 是宫格/时间线上的单字图标，与记录页宫格保持同一套视觉。
 */
export const MILESTONE_PRESETS = [
  { key: 'first_smile', label: '第一次笑', glyph: '笑' },
  { key: 'first_roll', label: '第一次翻身', glyph: '翻' },
  { key: 'night_sleep', label: '睡整觉', glyph: '眠' },
  { key: 'first_sit', label: '会坐', glyph: '坐' },
  { key: 'first_tooth', label: '长第一颗牙', glyph: '牙' },
  { key: 'first_crawl', label: '会爬', glyph: '爬' },
  { key: 'first_stand', label: '会站', glyph: '站' },
  { key: 'first_step', label: '迈出第一步', glyph: '走' },
  { key: 'first_word', label: '第一次叫爸妈', glyph: '说' },
  { key: CUSTOM_KEY, label: '自定义', glyph: '＋' },
]

const PRESET_LABEL = MILESTONE_PRESETS.reduce((acc, item) => {
  acc[item.key] = item.label
  return acc
}, {})

const PRESET_GLYPH = MILESTONE_PRESETS.reduce((acc, item) => {
  acc[item.key] = item.glyph
  return acc
}, {})

/** 按 key 取预置项（自定义返回 null） */
export function presetOf(key) {
  return MILESTONE_PRESETS.find((item) => item.key === key) || null
}

/** 展示名：预置 key 用表里的中文名，自定义用用户输入的名字 */
export function milestoneTitle(record) {
  if (!record) return ''
  // custom 也在预置表里（它是选项之一），不能直接查表，否则会把用户输入的名字盖成「自定义」
  if (record.milestone_key && record.milestone_key !== CUSTOM_KEY) {
    return PRESET_LABEL[record.milestone_key] || record.name || '里程碑'
  }
  return record.name || '自定义'
}

/** 时间线左侧的单字图标；自定义统一用「记」 */
export function milestoneGlyph(record) {
  if (!record) return '记'
  if (!record.milestone_key || record.milestone_key === CUSTOM_KEY) return '记'
  return PRESET_GLYPH[record.milestone_key] || '记'
}

/** 对象路径：{family_id}/{baby_id}/milestone/{唯一串}.jpg */
function buildPhotoPath(familyId, babyId) {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${familyId}/${babyId}/milestone/${unique}.jpg`
}

/** 上传里程碑照片，返回对象路径 */
export async function uploadMilestonePhoto(familyId, babyId, filePath) {
  const path = buildPhotoPath(familyId, babyId)
  await api.storage.uploadObject(path, filePath)
  return path
}

/** 清理刚上传但未成功入库的对象 */
export async function discardMilestonePhoto(path) {
  if (!path) return
  try {
    await api.storage.removeObjects([path])
  } catch (err) {
    console.error('[Milestone] 清理孤儿文件失败', err)
  }
}

/** 给一批记录补临时可访问地址（一次请求批量签名） */
async function attachPhotoUrls(rows) {
  const list = rows || []
  const paths = list.map((row) => row.photo_url).filter(Boolean)
  if (!paths.length) return list.map((row) => ({ ...row, photoUrl: '' }))
  try {
    const signed = await api.storage.createSignedUrls(paths, 3600)
    const map = {}
    signed.forEach((item) => {
      if (item.url) map[item.path] = item.url
    })
    return list.map((row) => ({ ...row, photoUrl: map[row.photo_url] || '' }))
  } catch (err) {
    console.error('[Milestone] 批量签名失败，照片将无法显示', err)
    return list.map((row) => ({ ...row, photoUrl: '' }))
  }
}

/**
 * 时间线列表：按达成日期倒序（同日按创建时间倒序）。
 * @param {object} [options] { limit, fromDate, toDate } 日期为 'YYYY-MM-DD'，用于按月取报告用的里程碑
 */
export async function listMilestones(familyId, babyId, options = {}) {
  if (!familyId || !babyId) return []
  const { limit = 100, fromDate, toDate } = options
  const range = []
  if (fromDate) range.push(`gte.${fromDate}`)
  if (toDate) range.push(`lte.${toDate}`)
  const { data } = await api.db.select('milestones', {
    select: MILESTONE_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    filters: range.length ? { achieved_date: range } : undefined,
    order: 'achieved_date.desc,created_at.desc',
    limit,
  })
  return attachPhotoUrls(data)
}

/** 查单条（编辑回填用，含临时地址） */
export async function fetchMilestone(id) {
  if (!id) return null
  const row = await api.db.selectOne('milestones', {
    select: MILESTONE_COLUMNS,
    match: { id },
  })
  if (!row) return null
  const [withUrl] = await attachPhotoUrls([row])
  return withUrl
}

/** 打卡：新增一条里程碑 */
export async function createMilestone({
  familyId,
  babyId,
  milestoneKey,
  name,
  achievedDate,
  photoPath,
  note,
}) {
  const createdBy = api.auth.currentUserId()
  if (!createdBy) throw new api.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const rows = await api.db.insert('milestones', {
    family_id: familyId,
    baby_id: babyId,
    milestone_key: milestoneKey,
    name,
    achieved_date: achievedDate,
    photo_url: photoPath || null,
    note: note ? String(note).trim() : null,
    created_by: createdBy,
  })
  const row = rows && rows.length ? rows[0] : null
  if (row) trackRecordCreated('milestone')
  return row
}

/** 修改一条里程碑（整行 upsert，photoUrl 等派生字段先剔除） */
export async function updateMilestone(record) {
  const row = api.db.pickColumns(record, MILESTONE_COLUMNS)
  const rows = await api.db.upsert('milestones', row)
  return rows && rows.length ? rows[0] : null
}

/** 删除里程碑：先删对象（幂等），再删记录 */
export async function removeMilestone(record) {
  if (!record) return
  if (record.photo_url) await discardMilestonePhoto(record.photo_url)
  await api.db.remove('milestones', { id: record.id })
}
