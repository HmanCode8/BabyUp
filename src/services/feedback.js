/**
 * 用户反馈的业务数据访问层（三期 P0-2）。
 *
 * 反馈是「账号维度」的数据：没有 family_id / baby_id，可能用户在还没建家庭时就想提反馈。
 * 因此它不走家庭鉴权，规则只有一条——只能看/写自己提交的：
 *   - 云开发侧：data 云函数的 guardInsert / actionSelect 里把 created_by 钉成 OPENID；
 *   - Supabase 侧：feedbacks 表的 RLS 策略要求 user_id = auth.uid()。
 * 两侧行为一致，业务层只写一份。
 *
 * 状态只有 pending / done 两种，由管理员在控制台改，前端只读展示。
 */
import { api } from './api'

const FEEDBACK_COLUMNS =
  'id,user_id,created_by,content,type,contact,images,status,created_at,updated_at'

/** 反馈类型：key 进库，label 只在界面显示 */
export const FEEDBACK_TYPES = [
  { key: 'bug', label: '功能异常' },
  { key: 'suggestion', label: '体验建议' },
  { key: 'content', label: '内容有误' },
  { key: 'other', label: '其他' },
]

export const FEEDBACK_TYPE_LABEL = FEEDBACK_TYPES.reduce((acc, item) => {
  acc[item.key] = item.label
  return acc
}, {})

export const FEEDBACK_STATUS_LABEL = {
  pending: '待处理',
  done: '已处理',
}

/** 与 data 云函数里的服务端校验保持一致，前端先拦一遍给出更快的提示 */
export const FEEDBACK_LIMITS = {
  contentMin: 5,
  contentMax: 500,
  imageMax: 3,
  contactMax: 50,
}

function buildFeedbackImagePath(familyId) {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${familyId}/feedback/${unique}.jpg`
}

/** 上传一张反馈截图，返回相对路径（入库的是路径，不是完整 fileID） */
export async function uploadFeedbackImage(familyId, filePath) {
  const path = buildFeedbackImagePath(familyId)
  await api.storage.uploadObject(path, filePath)
  return path
}

/** 放弃已上传的截图（用户取消提交时清理，失败不阻断面上的流程） */
export async function discardFeedbackImage(path) {
  if (!path) return
  try {
    await api.storage.removeObjects([path])
  } catch (err) {
    console.error('[feedback] 清理截图失败', err)
  }
}

/** 提交一条反馈；身份字段由接口层/服务端注入，这里传的是同值，前端不可指定别人 */
export async function submitFeedback({ type, content, contact, images }) {
  const createdBy = api.auth.currentUserId()
  if (!createdBy) throw new api.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const rows = await api.db.insert('feedbacks', {
    user_id: createdBy,
    created_by: createdBy,
    content: String(content == null ? '' : content).trim(),
    type: type || 'other',
    contact: contact ? String(contact).trim() : null,
    images: Array.isArray(images) ? images.filter(Boolean) : [],
    status: 'pending',
  })
  return rows && rows.length ? rows[0] : null
}

/** 我提交过的反馈（时间倒序）；换账号看不到别人的 */
export async function listMyFeedback(limit = 50) {
  const createdBy = api.auth.currentUserId()
  if (!createdBy) return []
  const { data } = await api.db.select('feedbacks', {
    select: FEEDBACK_COLUMNS,
    match: { created_by: createdBy },
    order: 'created_at.desc',
    limit,
  })
  return data || []
}

/** 反馈截图预览地址（走各自后端的签名逻辑） */
export async function createFeedbackImageUrls(paths) {
  const list = (paths || []).filter(Boolean)
  if (!list.length) return []
  const signed = await api.storage.createSignedUrls(list, 3600)
  return list.map((path) => {
    const hit = signed.find((item) => item.path === path)
    return { path, url: (hit && hit.url) || '' }
  })
}

/** 挑出可以被数据库接受的列（整行写回时用） */
export function pickFeedbackColumns(row) {
  return api.db.pickColumns(row, FEEDBACK_COLUMNS)
}
