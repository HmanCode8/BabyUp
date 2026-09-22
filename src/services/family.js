/**
 * 家庭与成员的业务数据访问层。
 * 页面/Store 只调用这里的方法，不关心底层是 REST 还是 SDK。
 */
import { api } from './api'

const MEMBER_COLUMNS = 'id,family_id,user_id,role,nickname,status,created_at'

const FAMILY_COLUMNS = 'id,name,created_at'

const INVITE_COLUMNS =
  'id,family_id,invite_code,role,expires_at,status,created_by,created_at'

/** 家庭角色中文标签（需求文档 5.2：owner=创建者 / member=成员 / viewer=只读） */
export const FAMILY_ROLE_LABEL = {
  owner: '创建者',
  member: '成员',
  viewer: '只读',
}

export function roleLabel(role) {
  return FAMILY_ROLE_LABEL[role] || '成员'
}

/** 可作为邀请码角色的两个选项（owner 不开放邀请，避免多创建者） */
export const INVITE_ROLES = [
  { key: 'member', label: '成员', desc: '可以新增和编辑记录' },
  { key: 'viewer', label: '只读', desc: '只能查看，不能修改' },
]

/** 邀请码有效期选项；days=null 表示永久有效 */
export const INVITE_EXPIRES = [
  { key: '7', label: '7 天', days: 7 },
  { key: '30', label: '30 天', days: 30 },
  { key: 'forever', label: '永久', days: null },
]

/** 邀请码状态中文标签；过期按 expires_at 实时判定 */
export const INVITE_STATUS_LABEL = {
  active: '未使用',
  used: '已使用',
  expired: '已过期',
  revoked: '已撤销',
}

/** 邀请码的实际状态：status 为 active 但已过期的，展示成「已过期」 */
export function inviteStatus(invite) {
  if (!invite) return 'expired'
  if (invite.status !== 'active') return invite.status
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) return 'expired'
  return 'active'
}

/**
 * 我的全部在册成员关系（二期加强：一个用户可以同时属于多个家庭）。
 * 顺序按加入时间升序，第一个作为默认选中的家庭。
 */
export async function listMyMemberships(userId) {
  if (!userId) return []
  const { data } = await api.db.select('family_members', {
    select: MEMBER_COLUMNS,
    match: { user_id: userId, status: 'active' },
    order: 'created_at.asc',
    limit: 50,
  })
  return data || []
}

/** 按 id 批量取家庭（RLS 只放行自己所属的家庭，取不到的自然不会返回） */
export async function listFamiliesByIds(ids) {
  const list = (ids || []).filter(Boolean)
  if (!list.length) return []
  const { data } = await api.db.select('families', {
    select: FAMILY_COLUMNS,
    filters: { id: `in.(${list.join(',')})` },
    limit: 50,
  })
  return data || []
}

/**
 * 创建家庭：由数据库函数原子完成「写入家庭 + 写入 owner 成员关系」。
 * 一期 families.invite_code 这个永久邀请码已停用（补丁 4.6），
 * 加入家庭一律走 family_invitations 的一次性邀请码（有过期时间、可撤销）。
 * 二期加强后允许一个用户创建/拥有多个家庭（数据库函数里已去掉「只能属于一个家庭」的限制）。
 */
export async function createFamily(name) {
  const result = await api.db.rpc('create_family', { p_name: name })
  return result && result.family ? result.family : null
}

/**
 * 按一次性邀请码加入家庭（二期新版）。
 * 角色只能来自邀请码本身（客户端指定不了），校验与写入都由数据库函数完成。
 * @returns {Promise<{family_id: string, role: string, alreadyMember: boolean}|null>}
 */
export async function joinFamilyByInvite(code) {
  const result = await api.db.rpc('join_family_by_invite', { p_code: code })
  return result || null
}

/**
 * 生成带角色的一次性邀请码（仅 owner，RLS 与函数内都会校验）。
 * @param {number|null} expiresDays null = 永久有效
 */
export async function createInvitation(familyId, role, expiresDays) {
  const result = await api.db.rpc('create_family_invitation', {
    p_family_id: familyId,
    p_role: role,
    p_expires_days: expiresDays,
  })
  return result || null
}

/** 本家庭的邀请码列表（新的在前；RLS 已放行本家庭成员读取） */
export async function listInvitations(familyId) {
  if (!familyId) return []
  const { data } = await api.db.select('family_invitations', {
    select: INVITE_COLUMNS,
    match: { family_id: familyId },
    order: 'created_at.desc',
    limit: 30,
  })
  return data || []
}

/**
 * 撤销邀请码（仅 owner）。
 * 整行 upsert：invites_insert 的 owner 校验与 invites_update 的 owner 校验都会通过。
 */
export async function revokeInvitation(invitation) {
  const rows = await api.db.upsert('family_invitations', {
    ...api.db.pickColumns(invitation, INVITE_COLUMNS),
    status: 'revoked',
  })
  return rows && rows.length ? rows[0] : null
}

/**
 * 修改成员角色（仅 owner，只能改成 member / viewer）。
 * 成员表的写操作一律走 SECURITY DEFINER 函数（见迁移 007）。
 */
export async function setMemberRole(memberId, role) {
  const result = await api.db.rpc('set_member_role', { p_member_id: memberId, p_role: role })
  return result && result.member ? result.member : null
}

/**
 * 修改家庭名称（填错了能改）。
 * families_update 策略只放行 owner，所以成员调用会被数据库拒绝——前端也不给成员渲染入口。
 * 同样因微信不支持 PATCH 而走 upsert 提交整行。
 */
export async function updateFamily(family, name) {
  const rows = await api.db.upsert('families', {
    ...api.db.pickColumns(family, FAMILY_COLUMNS),
    name: String(name == null ? '' : name).trim(),
  })
  return rows && rows.length ? rows[0] : null
}

/** 本家庭的在册成员（RLS 已放行「本家庭成员互相可见」） */
export async function listMembers(familyId) {
  if (!familyId) return []
  const { data } = await api.db.select('family_members', {
    select: MEMBER_COLUMNS,
    match: { family_id: familyId, status: 'active' },
    order: 'created_at.asc',
    limit: 50,
  })
  return data || []
}

/**
 * 修改自己的昵称。
 * 成员不能直接更新成员表（members_update 是 owner-only，防止被移除者把自己改回 active），
 * 所以走数据库函数，只放行 nickname 一个字段。
 */
export async function updateMyNickname(nickname) {
  const result = await api.db.rpc('set_my_nickname', { p_nickname: nickname })
  return result && result.member ? result.member : null
}

/**
 * 家庭创建者移除成员。
 * 用 upsert 会被 members_insert 的 auth.uid() = user_id 拦下，所以同样走数据库函数。
 */
export async function removeMember(memberId) {
  const result = await api.db.rpc('remove_family_member', { p_member_id: memberId })
  return result && result.member ? result.member : null
}

/**
 * 退出家庭。
 * 语义是「退出=删掉自己那行」：业务数据都挂在 family_id 上不会丢，
 * 日后凭邀请码重新加入即可恢复可见（join_family_by_code 会把 status 置回 active）。
 */
export async function leaveFamily(memberId) {
  await api.db.remove('family_members', { id: memberId })
}
