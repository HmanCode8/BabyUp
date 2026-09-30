/**
 * 功能开关（云开发版）。
 *
 * 分三个入口，权限逐层收紧：
 *   - status：**所有登录用户**读自己家的生效值（页面据此藏入口）。
 *   - familyDetail / setFamilyFlag：**家庭创建者**读/改自己家的覆盖。
 *   - 全局开关与「任意家庭」的覆盖在 admin.js 里（只有超级管理员）。
 *
 * Supabase 版没有这套东西，所以本文件只在 cloud 侧存在，
 * 业务层通过 capabilities.flags 判断可用性。
 */
import { callData } from './db'

/** 查某个家庭生效中的功能开关；不传 familyId 就是全局值 */
export async function status(familyId) {
  return callData({ action: 'featureFlags', familyId: familyId || '' })
}

/**
 * 家庭创建者读自己家的开关明细：清单 + 全局现状 + 本家覆盖 + 生效值。
 * 非该家创建者调会被服务端拒（assertOwner），前端只在创建者视角调用。
 */
export async function familyDetail(familyId) {
  return callData({ action: 'familyFlags', familyId: familyId || '' })
}

/**
 * 家庭创建者改自己家的覆盖。
 * value 传 null = 取消覆盖（跟随全局）；本家改不掉全局已经关掉的功能。
 */
export async function setFamilyFlag({ familyId, key, value }) {
  return callData({
    action: 'adminSetFlag',
    scope: 'family',
    familyId: String(familyId || ''),
    key: String(key || ''),
    value: value === null ? null : value === true,
  })
}

export const flags = { status, familyDetail, setFamilyFlag }

export default flags
