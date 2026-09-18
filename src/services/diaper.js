/**
 * 便便记录的业务数据访问层（二期 P0-4）。
 *
 * 数据库里存 code，中文映射写死在前端常量表（需求文档 4.1 的约定）。
 * 归一化：纯「尿」不记性状与颜色，入库前统一置空，避免脏数据。
 * 更新同样走 upsert（微信小程序不支持 PATCH）。
 */
import { supabase } from './supabase'
import { trackRecordCreated } from '@/utils/tracker'

const DIAPER_COLUMNS =
  'id,family_id,baby_id,diaper_type,poop_character,poop_color,record_time,note,created_by,created_at'

/** 类型：尿 / 便 / 混合 */
export const DIAPER_TYPES = [
  { key: 'pee', label: '尿' },
  { key: 'poop', label: '便' },
  { key: 'mixed', label: '混合' },
]

/** 性状 */
export const POOP_CHARACTERS = [
  { key: 'soft', label: '软便' },
  { key: 'loose', label: '稀便' },
  { key: 'hard', label: '硬便' },
  { key: 'watery', label: '水样' },
  { key: 'pasty', label: '糊状' },
]

/** 颜色；red / black 需提示就医 */
export const POOP_COLORS = [
  { key: 'yellow', label: '黄' },
  { key: 'golden', label: '金黄' },
  { key: 'green', label: '绿' },
  { key: 'brown', label: '棕' },
  { key: 'dark', label: '深色' },
  { key: 'red', label: '带血丝' },
  { key: 'black', label: '黑' },
]

/** 需要提醒就医的颜色（需求文档 4.1 / 流程 4） */
export const POOP_ALERT_COLORS = ['red', 'black']

export const DIAPER_TYPE_LABEL = DIAPER_TYPES.reduce((acc, item) => {
  acc[item.key] = item.label
  return acc
}, {})

const CHARACTER_LABEL = POOP_CHARACTERS.reduce((acc, item) => {
  acc[item.key] = item.label
  return acc
}, {})

const COLOR_LABEL = POOP_COLORS.reduce((acc, item) => {
  acc[item.key] = item.label
  return acc
}, {})

/** 类型里是否含「便」（尿以外的两种都要选性状与颜色） */
export function hasPoop(type) {
  return type === 'poop' || type === 'mixed'
}

/** 是否属于需要提示就医的颜色 */
export function isAlertColor(color) {
  return POOP_ALERT_COLORS.includes(color)
}

/** 纯尿不带性状与颜色 */
function normalizePoop(diaperType, character, color) {
  if (!hasPoop(diaperType)) return { poop_character: null, poop_color: null }
  return {
    poop_character: character || null,
    poop_color: color || null,
  }
}

/**
 * 「类型 · 性状 · 颜色」的中文片段（缺哪项就少哪项）。
 * 单独抽出来给今日小结用：它只要片段，不需要 formatDiaper 那套完整拼接。
 */
export function diaperLabelParts(record) {
  if (!record) return []
  const parts = [DIAPER_TYPE_LABEL[record.diaper_type] || '便便']
  if (record.poop_character) parts.push(CHARACTER_LABEL[record.poop_character] || record.poop_character)
  if (record.poop_color) parts.push(COLOR_LABEL[record.poop_color] || record.poop_color)
  return parts
}

/** 列表用的一句话描述：'尿' / '便 · 稀便 · 绿' / '混合 · 糊状 · 金黄' */
export function formatDiaper(record) {
  return diaperLabelParts(record).join(' · ')
}

/**
 * 拉取便便记录（时间倒序）。
 * @param {object} [options] { fromIso, toIso } 只看该区间内的记录（左闭右开，UTC 时刻）
 */
export async function listDiapers(familyId, babyId, options = {}) {
  if (!familyId || !babyId) return []
  const { fromIso, toIso, limit = 200 } = options
  const range = []
  if (fromIso) range.push(`gte.${fromIso}`)
  if (toIso) range.push(`lt.${toIso}`)
  const { data } = await supabase.db.select('diaper_records', {
    select: DIAPER_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    filters: range.length ? { record_time: range } : undefined,
    order: 'record_time.desc',
    limit,
  })
  return data || []
}

/** 新增一条便便记录 */
export async function createDiaper({ familyId, babyId, diaperType, character, color, recordTime, note }) {
  const createdBy = supabase.auth.currentUserId()
  if (!createdBy) throw new supabase.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const rows = await supabase.db.insert('diaper_records', {
    family_id: familyId,
    baby_id: babyId,
    diaper_type: diaperType,
    ...normalizePoop(diaperType, character, color),
    record_time: recordTime,
    note: note ? String(note).trim() : null,
    created_by: createdBy,
  })
  const row = rows && rows.length ? rows[0] : null
  if (row) trackRecordCreated('diaper')
  return row
}

/** 修改一条便便记录（整行 upsert） */
export async function updateDiaper(record) {
  const row = supabase.db.pickColumns(record, DIAPER_COLUMNS)
  const rows = await supabase.db.upsert('diaper_records', {
    ...row,
    ...normalizePoop(row.diaper_type, row.poop_character, row.poop_color),
  })
  return rows && rows.length ? rows[0] : null
}

/** 删除一条便便记录 */
export async function removeDiaper(id) {
  await supabase.db.remove('diaper_records', { id })
}
