// ============================================================================
// 手机号兜底登录 Edge Function（一二期补丁 · Step 2 追加）
//
// 为什么需要它：
//   采用「路线 1：真实邮箱即账号邮箱」后，账号的登录邮箱由
//   `{手机号}@phone.babyup.app` 变成了用户绑定的真实邮箱。
//   客户端无法再由手机号推导出登录邮箱，手机号登录会直接失败。
//   本函数在服务端按手机号反查该账号「当前的登录邮箱」，用它 + 用户提交的密码
//   向 GoTrue 换取 Session 返回；**登录邮箱不下发前端**，
//   因此这个接口不是「手机号 → 邮箱」的查询器。
//
// 安全约定：
//   - service_role / anon key 只存在于本函数环境变量，绝不下发前端；
//   - 只有密码校验通过才返回 Session；
//   - 「手机号未登记」与「密码错误」返回同一句提示，避免账号枚举；
//   - 日志不记录密码，也不记录完整邮箱。
//
// 依赖：profiles.phone（迁移 011 已建列并回填）
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** 中国大陆手机号 */
const PHONE_PATTERN = /^1[3-9]\d{9}$/

/** 手机号未登记与密码错误统一用这句，避免暴露「某手机号是否注册过」 */
const CREDENTIAL_ERROR = '手机号或密码错误'

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: '只支持 POST' }, 405)
  }

  try {
    const body = await req.json().catch(() => ({}))
    const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!PHONE_PATTERN.test(phone) || !password) {
      return json({ error: CREDENTIAL_ERROR }, 400)
    }

    const supabaseUrl = requireEnv('SUPABASE_URL')
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    // 校验密码要用匿名身份调用 Auth，不能借用 service_role 的权限
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || serviceRoleKey

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // ---------- 1. 按手机号反查账号 ----------
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id')
      .eq('phone', phone)
      .maybeSingle()
    if (profileError) {
      console.error('[phone-login] 查询手机号映射失败', profileError.message)
      return json({ error: '登录失败，请稍后重试' }, 500)
    }
    if (!profile?.id) {
      console.warn('[phone-login] 手机号未登记，拒绝登录')
      return json({ error: CREDENTIAL_ERROR }, 400)
    }

    // ---------- 2. 取该账号当前的登录邮箱（可能已是用户绑定的真实邮箱）----------
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id)
    const email = userData?.user?.email
    if (userError || !email) {
      console.error('[phone-login] 读取账号失败', userError?.message)
      return json({ error: '登录失败，请稍后重试' }, 500)
    }

    // ---------- 3. 用「账号邮箱 + 密码」校验密码并换取正式 Session ----------
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: signIn, error: signInError } = await authClient.auth.signInWithPassword({
      email,
      password,
    })
    if (signInError || !signIn?.session) {
      console.warn('[phone-login] 密码校验未通过')
      return json({ error: CREDENTIAL_ERROR }, 400)
    }

    console.log('[phone-login] 登录成功', profile.id)
    return json({
      session: {
        access_token: signIn.session.access_token,
        refresh_token: signIn.session.refresh_token,
        expires_in: signIn.session.expires_in,
        expires_at: signIn.session.expires_at,
        token_type: signIn.session.token_type,
        user: signIn.user ?? signIn.session.user,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[phone-login] 未捕获异常', message)
    return json({ error: '登录失败，请稍后重试' }, 500)
  }
})
