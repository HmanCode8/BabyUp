// ============================================================================
// 微信一键登录 Edge Function（对应《第二期开发需求文档》3.2）
//
// 流程：小程序 uni.login 拿 code
//   -> 这里用 code 调微信 code2session 换 openid
//   -> 查 profiles.wechat_openid
//        有  -> 复用该用户
//        没有 -> admin.createUser 建号（邮箱 wx_{openid}@wechat.local，随机密码）
//               并补一行 profiles
//   -> 用 admin.generateLink(magiclink) + verifyOtp 换「正式可刷新 Session」
//   -> 只把 access_token / refresh_token 返回给小程序
//
// 安全约定：
//   - WECHAT_SECRET / SUPABASE_SERVICE_ROLE_KEY 只存在于本函数的环境变量里，绝不下发到前端
//   - 前端不保存 code，也不接触 session_key（本函数用完即弃，不返回）
//   - session_key 只有在需要解密微信加密数据时才用得上，二期全程不需要
//
// 注：需求文档写的 Admin API `generateUserTokens(userId)` 在 supabase-js v2 中不存在，
//     这里按官方现状改用 generateLink(magiclink) + verifyOtp 的等价做法（已实测可行）。
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** 微信用户映射成的 Supabase 邮箱账号域名（openid 为 28 位字母数字，邮箱格式合法） */
const OPENID_EMAIL_DOMAIN = 'wechat.local'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`服务端缺少环境变量 ${name}`)
  return value
}

function openidToEmail(openid: string): string {
  return `wx_${openid}@${OPENID_EMAIL_DOMAIN}`
}

/** 微信用户永远不需要知道密码，给一串随机值即可（每次建号都不同） */
function randomPassword(): string {
  return `wx-${crypto.randomUUID()}-${crypto.randomUUID()}`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: '只支持 POST' }, 405)
  }

  try {
    const body = await req.json().catch(() => ({}))
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    if (!code) {
      return json({ error: '缺少微信登录凭证 code' }, 400)
    }

    const appid = requireEnv('WECHAT_APPID')
    const secret = requireEnv('WECHAT_SECRET')
    const supabaseUrl = requireEnv('SUPABASE_URL')
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

    // ---------- 1. code2session 换 openid ----------
    const wxUrl =
      `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}` +
      `&secret=${secret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
    const wxRes = await fetch(wxUrl)
    const wxData = await wxRes.json()

    if (wxData.errcode) {
      console.error('[wechat-login] code2session 失败', wxData.errcode, wxData.errmsg)
      return json(
        { error: `微信登录失败：${wxData.errmsg || wxData.errcode}`, errcode: wxData.errcode },
        400,
      )
    }
    const openid: string = wxData.openid
    if (!openid) {
      console.error('[wechat-login] code2session 未返回 openid', wxData)
      return json({ error: '微信未返回 openid' }, 400)
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // ---------- 2. openid 已绑过就直接复用 ----------
    let userId: string | null = null
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id')
      .eq('wechat_openid', openid)
      .maybeSingle()
    if (profileError) {
      console.error('[wechat-login] 查 profiles 失败', profileError)
      return json({ error: '查询微信绑定关系失败，请重试' }, 500)
    }
    if (profile?.id) userId = profile.id

    const email = openidToEmail(openid)

    // ---------- 3. 没绑过就建号 ----------
    if (!userId) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: randomPassword(),
        email_confirm: true,
        user_metadata: { wechat_openid: openid, wechat_unionid: wxData.unionid ?? null },
      })

      if (createError || !created?.user) {
        // 邮箱已存在（上一次建号成功但 profiles 没写成功的极端情况）：用 magiclink 反查该用户
        console.warn('[wechat-login] 建号未成功，尝试按邮箱反查', createError?.message)
        const { data: link, error: linkError } = await admin.auth.admin.generateLink({
          type: 'magiclink',
          email,
        })
        const existingId = link?.user?.id
        if (linkError || !existingId) {
          console.error('[wechat-login] 建号与反查均失败', createError, linkError)
          return json({ error: '创建微信账号失败，请重试' }, 500)
        }
        userId = existingId
      } else {
        userId = created.user.id
      }
    }

    // ---------- 4. 补 profiles 行（绑定关系以这里为准） ----------
    const { error: upsertError } = await admin.from('profiles').upsert({
      id: userId,
      wechat_openid: openid,
      wechat_unionid: wxData.unionid ?? null,
      updated_at: new Date().toISOString(),
    })
    if (upsertError) {
      console.error('[wechat-login] 写入 profiles 失败', upsertError)
      return json({ error: '保存微信绑定关系失败，请重试' }, 500)
    }

    // ---------- 5. 签发可刷新 Session ----------
    const { data: linkData, error: genError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    const tokenHash = linkData?.properties?.hashed_token
    if (genError || !tokenHash) {
      console.error('[wechat-login] generateLink 失败', genError)
      return json({ error: '签发登录态失败，请重试' }, 500)
    }

    const { data: verified, error: verifyError } = await admin.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    })
    if (verifyError || !verified?.session) {
      console.error('[wechat-login] verifyOtp 失败', verifyError)
      return json({ error: '签发登录态失败，请重试' }, 500)
    }

    console.log('[wechat-login] 登录成功', userId, 'openid:', `${openid.slice(0, 6)}***`)
    return json({
      session: {
        access_token: verified.session.access_token,
        refresh_token: verified.session.refresh_token,
        expires_in: verified.session.expires_in,
        expires_at: verified.session.expires_at,
        token_type: verified.session.token_type,
        user: verified.user ?? verified.session.user,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[wechat-login] 未捕获异常', message)
    return json({ error: message || '微信登录失败，请稍后重试' }, 500)
  }
})
