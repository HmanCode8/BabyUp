/**
 * 微信一键登录云函数（迁移计划 · 阶段 3）。
 *
 * 与 Supabase 侧的 Edge Function `wechat-login` 做的是同一件事，但简单得多：
 * 云函数里的 OPENID 由微信侧注入、客户端伪造不了，所以
 *   - 不需要 code2session（没有 code 也没有 AppSecret）；
 *   - 不需要签发 / 续期 access_token（每次调用都能拿到可信身份）；
 *   - 不需要密码与邮箱（用户身份就是 openid）。
 *
 * 首次登录补一行 profiles（_id = OPENID），之后每次登录直接复用该行。
 *
 * 出参：
 *   成功 { ok: true, user, created }
 *   失败 { ok: false, code, message }
 *
 * user 的字段与 Supabase 侧的 user 对齐：`id` 是主键（映射自 `_id`），
 * 云开发后端下它等于 openid，页面与 store 靠它区分用户。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const CODE = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL: 'INTERNAL',
}

/** profiles 文档 -> 客户端用户对象；_id 补成 id，与 data 云函数的映射规则保持一致 */
function toUser(profile) {
  const out = { id: profile._id }
  Object.keys(profile).forEach((key) => {
    if (key !== '_id') out[key] = profile[key]
  })
  return out
}

async function findProfile(openid) {
  const res = await db.collection('profiles').where({ _id: openid }).limit(1).get()
  return res.data[0] || null
}

exports.main = async () => {
  const context = cloud.getWXContext()
  const openid = context && context.OPENID
  if (!openid) {
    return { ok: false, code: CODE.UNAUTHORIZED, message: '未获取到微信身份，请重新进入小程序' }
  }

  try {
    const existing = await findProfile(openid)
    if (existing) return { ok: true, user: toUser(existing), created: false }

    const now = new Date().toISOString()
    // 字段与 Supabase 的 profiles 表保持一致（无 created_at 列，只有 updated_at）
    const doc = {
      _id: openid,
      nickname: null,
      avatar_url: null,
      wechat_openid: openid,
      wechat_unionid: context.UNIONID || null,
      updated_at: now,
    }

    try {
      await db.collection('profiles').add({ data: doc })
    } catch (err) {
      // 同一用户并发首次登录可能撞上「_id 已存在」：再查一次即可；
      // 查不到说明是别的错（例如集合还没建），如实抛出。
      const retry = await findProfile(openid)
      if (!retry) throw err
      return { ok: true, user: toUser(retry), created: false }
    }

    console.log('[login] 新用户已建档', openid)
    return { ok: true, user: toUser(doc), created: true }
  } catch (err) {
    console.error('[login] 登录失败', err)
    return {
      ok: false,
      code: CODE.INTERNAL,
      message: (err && err.message) || '登录失败，请重试',
    }
  }
}
