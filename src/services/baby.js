/**
 * 宝宝档案的业务数据访问层。
 *
 * 一个家庭可以有多个宝宝（表结构一期即按多宝宝设计），
 * 「看哪个宝宝的数据」由 store 里的 currentBabyId 决定，页面不自己挑。
 */
import { api } from './api'

/** 家庭下的全部宝宝（按创建时间升序，第一个作为默认选中） */
export async function listBabies(familyId) {
  if (!familyId) return []
  const { data } = await api.db.select('babies', {
    select: '*',
    match: { family_id: familyId },
    order: 'created_at.asc',
    limit: 20,
  })
  return data || []
}

/** 新建宝宝档案 */
export async function createBaby(familyId, { name, gender, birthday }) {
  const rows = await api.db.insert('babies', {
    family_id: familyId,
    name: String(name || '').trim(),
    gender: gender || null,
    birthday: birthday || null,
  })
  return rows && rows.length ? rows[0] : null
}

/**
 * 保存宝宝档案。
 * 微信小程序不支持 PATCH（PostgREST 的部分更新用的就是 PATCH），
 * 因此统一走 upsert：提交整行，冲突按 id 合并。
 */
export async function saveBaby(baby) {
  const rows = await api.db.upsert('babies', {
    ...baby,
    updated_at: new Date().toISOString(),
  })
  return rows && rows.length ? rows[0] : null
}

/** 头像在存储桶中的对象路径约定 */
export function babyAvatarPath(familyId, babyId) {
  return `${familyId}/${babyId}/avatar.jpg`
}

/** 上传宝宝头像（同路径覆盖），返回对象路径 */
export async function uploadBabyAvatar(familyId, babyId, filePath) {
  const path = babyAvatarPath(familyId, babyId)
  await api.storage.uploadObject(path, filePath, { upsert: true })
  return path
}

/** 把存储对象路径换成临时可访问地址（照片桶是 private，必须走签名 URL） */
export async function resolveStorageUrl(path) {
  if (!path) return ''
  return api.storage.createSignedUrl(path, 3600)
}
