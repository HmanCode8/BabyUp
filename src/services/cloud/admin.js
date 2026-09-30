/**
 * 运维后台（云开发版）。
 *
 * 这里的 action 在 data 云函数里被 assertSuperAdmin 挡着（改自家功能开关那一个除外，
 * 它允许家庭创建者改自己家的）：服务端按 openid 判定，客户端改不了、也绕不过。
 * 本文件只是把 action 名收在一处，别在页面里散落字符串。
 *
 * Supabase 版没有这层（运维后端的身份来自云开发的 OPENID），
 * 所以本文件只在 cloud 侧存在，页面通过 capabilities.admin 判断可用性。
 */
import { callData } from './db'
import { toFileId } from './storage'

/** 运维概览：近 N 天的记录 / AI 用量 / 行为埋点 / 报错 / 规模 */
export async function overview(days) {
  return callData({ action: 'adminOverview', days: Number(days) || 7 })
}

/** 家庭列表：每家的规模与权益现状 */
export async function families() {
  return callData({ action: 'adminFamilies' })
}

/**
 * 改某个家庭的权益档位。
 *
 * @param {object} params { familyId, tier: 'member'|'free', until: 'YYYY-MM-DD'|'' }
 *        until 传空 = 永久；只在 tier=member 时有意义。
 */
export async function setTier({ familyId, tier, until }) {
  return callData({
    action: 'adminSetTier',
    familyId: String(familyId || ''),
    tier: tier === 'member' ? 'member' : 'free',
    until: String(until || ''),
  })
}

/** 功能开关的清单 + 全局现状（家庭覆盖在 families() 里一起返回） */
export async function flags() {
  return callData({ action: 'adminFlags' })
}

/**
 * 改一个功能开关。
 *
 * @param {object} params { scope: 'global'|'family', key, value, familyId }
 *        value 传 true/false；family 作用域下传 null = 取消覆盖、跟随全局。
 */
export async function setFlag({ scope, key, value, familyId }) {
  return callData({
    action: 'adminSetFlag',
    scope: scope === 'family' ? 'family' : 'global',
    key: String(key || ''),
    value: value === null ? null : value === true,
    familyId: String(familyId || ''),
  })
}

/**
 * 删除一个家庭（连同它的全部数据），不可撤销。
 *
 * confirmName 必须与家庭名完全一致（服务端会比对），这是防手滑的第二道门。
 * 返回里带 paths：该家庭的照片/头像/里程碑照片在云存储里的相对路径，
 * 调用方应接着把它们清掉（见 deleteFiles）。
 */
export async function deleteFamily({ familyId, confirmName }) {
  return callData({
    action: 'adminDeleteFamily',
    familyId: String(familyId || ''),
    confirmName: String(confirmName || ''),
  })
}

/** 运维删文件：入参是 deleteFamily 返回的**相对路径**列表，这里拼成 fileID 再发 */
export async function deleteFiles(paths) {
  const list = (paths || [])
    .map((path) => toFileId(path))
    .filter(Boolean)
  if (!list.length) return { removed: 0, total: 0 }
  return callData({ action: 'adminDeleteFiles', fileList: list })
}

/**
 * 全部成员一览：谁在用、在哪几个家、各是什么角色（只读，不授予任何权限）。
 */
export async function users() {
  return callData({ action: 'adminUsers' })
}

/** 某个家庭的成员列表（超管进这个家管人之前先拉这个） */
export async function familyMembers(familyId) {
  return callData({ action: 'adminFamilyMembers', familyId: String(familyId || '') })
}

/** 改成员角色：role 只能是 'member'（成员）或 'viewer'（只读） */
export async function setMemberRole({ familyId, memberId, role }) {
  return callData({
    action: 'adminSetMemberRole',
    familyId: String(familyId || ''),
    memberId: String(memberId || ''),
    role: role === 'viewer' ? 'viewer' : 'member',
  })
}

/** 把成员移出家庭（软删除，日后凭邀请码还能回来） */
export async function removeMember({ familyId, memberId }) {
  return callData({
    action: 'adminRemoveMember',
    familyId: String(familyId || ''),
    memberId: String(memberId || ''),
  })
}

/**
 * 转移家庭创建者（= 换这个家的家庭管理员）。
 * confirmName 必须与家庭名完全一致（服务端会比对），原创建者会降为成员。
 */
export async function transferOwner({ familyId, memberId, confirmName }) {
  return callData({
    action: 'adminTransferOwner',
    familyId: String(familyId || ''),
    memberId: String(memberId || ''),
    confirmName: String(confirmName || ''),
  })
}

/**
 * 意见反馈列表（超管视角）：普通用户只能看自己提交的，这里看全部。
 *
 * @param {object} params { status: 'pending'|'done'|'' } 不传 = 全部
 * @returns {Promise<{feedbacks: Array, pendingCount: number, totalCount: number}>}
 */
export async function feedbacks(params = {}) {
  const status = params.status === 'pending' || params.status === 'done' ? params.status : ''
  return callData({ action: 'adminFeedbacks', status })
}

/** 处理一条反馈：改状态 + 写一句给提交人看的回复（留空 = 只改状态） */
export async function setFeedbackStatus({ feedbackId, status, reply }) {
  return callData({
    action: 'adminSetFeedbackStatus',
    feedbackId: String(feedbackId || ''),
    status: status === 'done' ? 'done' : 'pending',
    reply: String(reply || ''),
  })
}

/**
 * 超管换文件链接：入参是**相对路径**列表（反馈截图就存在 feedbacks.images 里）。
 *
 * 不复用 storage.createSignedUrls 的原因：那条路走 tempFileURL，会按 fileID 路径里的
 * family_id 做家庭成员校验 —— 反馈截图可能属于别人家、也可能没有家庭，超管换不出来。
 * @returns {Promise<Array<{path: string, url: string}>>}
 */
export async function fileUrls(paths) {
  const list = (paths || []).filter(Boolean)
  if (!list.length) return []
  const fileIds = list.map((path) => toFileId(path))
  const res = await callData({ action: 'adminFileURL', fileList: fileIds })
  const byId = {}
  ;((res && res.data) || []).forEach((row) => {
    if (row && row.fileID) byId[row.fileID] = row.tempFileURL || ''
  })
  return list.map((path, index) => ({ path, url: byId[fileIds[index]] || '' }))
}

/**
 * 开通码台账（一码一用）。
 *
 * @param {object} params { status: ''|'unused'|'used'|'void' } 空 = 全部
 * @returns {Promise<{codes: Array, totalCount: number, unusedCount: number, usedCount: number}>}
 */
export async function codes(params = {}) {
  const allowed = ['unused', 'used', 'void']
  const status = allowed.indexOf(params.status) >= 0 ? params.status : ''
  return callData({ action: 'adminCodes', status })
}

/**
 * 批量生成开通码。
 *
 * @param {object} params { count, days, note }
 *        days = 0 表示永久；note 是备注（发给谁），只用于对账。
 * @returns {Promise<{created: Array<{id, code, days, note}>}>}
 */
export async function createCodes({ count, days, note }) {
  return callData({
    action: 'adminCreateCodes',
    count: Number(count) || 0,
    days: Number(days) || 0,
    note: String(note || ''),
  })
}

/** 作废 / 恢复一个**未被兑换**的码（已兑的改不动，权益已经落到家庭上了） */
export async function setCodeStatus({ codeId, status }) {
  return callData({
    action: 'adminSetCodeStatus',
    codeId: String(codeId || ''),
    status: status === 'void' ? 'void' : 'unused',
  })
}

export const admin = {
  overview,
  families,
  setTier,
  // 开通码台账
  codes,
  createCodes,
  setCodeStatus,
  flags,
  setFlag,
  deleteFamily,
  deleteFiles,
  users,
  familyMembers,
  setMemberRole,
  removeMember,
  transferOwner,
  feedbacks,
  setFeedbackStatus,
  fileUrls,
}

export default admin
