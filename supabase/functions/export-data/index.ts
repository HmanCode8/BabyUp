// ============================================================================
// 数据导出 Edge Function（补丁 Step 3，对应文档 3.2 / 流程 2）
//
// 入参：{}（无需参数，导出范围由登录态决定）
//
// 流程：
//   1. 从 Authorization 头解析登录态（只导出本人有权限看到的数据）
//   2. 查出「我是 active 成员」的全部家庭
//   3. 聚合导出这些家庭下的全部业务数据：
//      families / family_members / babies / baby_photos /
//      growth_records / vaccinations / feeding_records /
//      sleep_records / diaper_records / milestones
//   4. 返回 { json: '<格式化后的 JSON 字符串>' }
//
// 与文档的差异（已向用户说明）：
//   文档假设「一人一家庭」，写的是「查该用户所属家庭」；二期加强后一人可属多家庭，
//   这里导出「全部我有权限的家庭」，是用户权利的完整实现（不会导出别人的家庭）。
//
// 安全约定：
//   - service_role 只存在于本函数环境变量，绝不下发前端；
//   - 家庭范围完全由 token 对应的 user_id 推导，前端无法指定别人的 family_id；
//   - 照片只导出对象路径（storage_path / avatar_url / photo_url），不含图片二进制。
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

function bearerToken(req: Request): string {
  const raw = req.headers.get('Authorization') || req.headers.get('authorization') || ''
  const match = raw.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: '只支持 POST' }, 405)
  }

  try {
    const token = bearerToken(req)
    if (!token) {
      return json({ error: '登录态已失效，请重新登录' }, 401)
    }

    const supabaseUrl = requireEnv('SUPABASE_URL')
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // ---------- 1. 校验登录态 ----------
    const { data: authData, error: authError } = await admin.auth.getUser(token)
    const user = authData?.user
    if (authError || !user) {
      console.error('[export-data] 登录态校验失败', authError?.message)
      return json({ error: '登录态已失效，请重新登录' }, 401)
    }

    // ---------- 2. 我参与的全部家庭 ----------
    const { data: memberRows, error: memberError } = await admin
      .from('family_members')
      .select('family_id,role,status')
      .eq('user_id', user.id)
      .eq('status', 'active')
    if (memberError) {
      console.error('[export-data] 查询家庭成员关系失败', memberError.message)
      return json({ error: '导出失败，请稍后重试' }, 500)
    }
    const familyIds = (memberRows || []).map((row) => row.family_id)

    const empty = {
      exported_at: new Date().toISOString(),
      user: { id: user.id, email: user.email ?? null, created_at: user.created_at ?? null },
      families: [],
      family_members: [],
      babies: [],
      baby_photos: [],
      growth_records: [],
      vaccinations: [],
      feeding_records: [],
      sleep_records: [],
      diaper_records: [],
      milestones: [],
    }

    if (!familyIds.length) {
      // 一个家庭都没有：仍然返回结构完整的空档案，前端不必区分两种返回
      return json({ json: JSON.stringify(empty, null, 2) })
    }

    // ---------- 3. 逐表聚合（全部按「我所属的家庭」过滤，天然无越权） ----------
    const tables = [
      'families',
      'family_members',
      'babies',
      'baby_photos',
      'growth_records',
      'vaccinations',
      'feeding_records',
      'sleep_records',
      'diaper_records',
      'milestones',
    ]

    const payload: Record<string, unknown> = { ...empty }
    for (const table of tables) {
      // families 表本身没有 family_id 列，按 id 过滤；其余按 family_id 过滤
      const column = table === 'families' ? 'id' : 'family_id'
      const { data, error } = await admin.from(table).select('*').in(column, familyIds)
      if (error) {
        console.error(`[export-data] 导出 ${table} 失败`, error.message)
        return json({ error: '导出失败，请稍后重试' }, 500)
      }
      payload[table] = data || []
    }

    console.log('[export-data] 导出完成', user.id, '家庭数:', familyIds.length)
    return json({ json: JSON.stringify(payload, null, 2) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[export-data] 未捕获异常', message)
    return json({ error: '导出失败，请稍后重试' }, 500)
  }
})
