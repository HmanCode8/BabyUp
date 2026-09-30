/**
 * 会员权益（云开发版）。
 *
 * 权益落在「家庭」上（families 集合的 member_tier / member_until），
 * 由 data 云函数读写：客户端既拿不到别人的、也改不了自己的 ——
 * 兑换走 membershipRedeem，且只有家庭创建者能调（会员按家庭计，开通一次全家共享）。
 *
 * Supabase 版没有这套东西（AI 也是那边没有），所以本文件只在 cloud 侧存在，
 * 业务层通过 capabilities.membership 判断可用性。
 */
import { callData } from './db'

/** 查权益状态（没建家庭就不传 familyId，服务端会按全功能档返回） */
export async function status(familyId) {
  return callData({ action: 'membershipStatus', familyId: familyId || '' })
}

/** 用开通码开通或续期；只有家庭创建者能调用 */
export async function redeem(familyId, code) {
  return callData({
    action: 'membershipRedeem',
    familyId: familyId || '',
    code: String(code || ''),
  })
}

export const membership = { status, redeem }

export default membership
