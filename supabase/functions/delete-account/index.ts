// ============================================================================
// 账号注销 Edge Function（补丁 Step 3，对应文档 3.2 / 流程 3）
//
// 入参：{ confirm: string } —— 必须严格等于「删除」二字（前端双确认的第二道）
//
// 流程：
//   1. 从 Authorization 头解析登录态，只允许本人注销自己（严禁删他人数据）
//   2. 收集「我作为 owner 的家庭」下所有存储对象路径（照片 / 头像 / 里程碑照片）
//   3. 删除这些家庭 —— 业务数据靠外键级联清空
//      （babies / baby_photos / growth_records / vaccinations /
//        feeding_records / sleep_records / diaper_records / milestones /
//        family_members / family_invitations 全部 references families(id) on delete cascade）
//   4. 删除存储对象（尽力而为：失败只记日志，不影响注销本身）
//   5. 删除 auth 用户 —— family_members（其他家庭的成员关系）与 profiles
//      都是 references auth.users(id) on delete cascade，会一并清掉
//
// 安全约定：
//   - service_role 只存在于本函数环境变量，绝不下发前端；
//   - 必须带有效的用户 access_token，且只能操作 token 对应的那个用户；
//   - 前端必须明确传 confirm=删除，缺省或写错一律拒绝。
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** 照片存储桶（与前端 config 里的 STORAGE_BUCKET 保持一致） */
const STORAGE_BUCKET = 'baby-photos'

/** 前端要求用户输入的确认词 */
const CONFIRM_WORD = '删除'

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

/** 从 Authorization 头里取出 access_token */
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
    const body = await req.json().catch(() => ({}))
    if (String(body.confirm || '').trim() !== CONFIRM_WORD) {
      return json({ error: `请确认后重试（需要输入「${CONFIRM_WORD}」二字）` }, 400)
    }

    const token = bearerToken(req)
    if (!token) {
      return json({ error: '登录态已失效，请重新登录' }, 401)
    }

    const supabaseUrl = requireEnv('SUPABASE_URL')
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // ---------- 1. 校验登录态：只能注销自己 ----------
    const { data: authData, error: authError } = await admin.auth.getUser(token)
    const user = authData?.user
    if (authError || !user) {
      console.error('[delete-account] 登录态校验失败', authError?.message)
      return json({ error: '登录态已失效，请重新登录' }, 401)
    }
    console.log('[delete-account] 开始注销', user.id)

    // ---------- 2. 找出「我作为 owner 的家庭」 ----------
    const { data: ownerRows, error: ownerError } = await admin
      .from('family_members')
      .select('family_id')
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .eq('status', 'active')
    if (ownerError) {
      console.error('[delete-account] 查询 owner 家庭失败', ownerError.message)
      return json({ error: '注销失败，请稍后重试' }, 500)
    }
    const familyIds = (ownerRows || []).map((row) => row.family_id)

    // ---------- 3. 先把要删的存储对象路径收集出来（删表后就查不到了） ----------
    const objectPaths: string[] = []
    if (familyIds.length) {
      const [photoRes, babyRes, milestoneRes] = await Promise.all([
        admin.from('baby_photos').select('storage_path').in('family_id', familyIds),
        admin.from('babies').select('avatar_url').in('family_id', familyIds),
        admin.from('milestones').select('photo_url').in('family_id', familyIds),
      ])
      ;(photoRes.data || []).forEach((row) => row.storage_path && objectPaths.push(row.storage_path))
      ;(babyRes.data || []).forEach((row) => row.avatar_url && objectPaths.push(row.avatar_url))
      ;(milestoneRes.data || []).forEach((row) => row.photo_url && objectPaths.push(row.photo_url))
    }

    // ---------- 4. 删除这些家庭（业务数据靠外键级联清空） ----------
    let deletedFamilies = 0
    if (familyIds.length) {
      const { error: delFamilyError, count } = await admin
        .from('families')
        .delete({ count: 'exact' })
        .in('id', familyIds)
      if (delFamilyError) {
        console.error('[delete-account] 删除家庭失败', delFamilyError.message)
        return json({ error: '注销失败，请稍后重试' }, 500)
      }
      deletedFamilies = count ?? familyIds.length
    }

    // ---------- 5. 删除存储对象（尽力而为） ----------
    let removedFiles = 0
    if (objectPaths.length) {
      try {
        const { data: removed, error: storageError } = await admin.storage
          .from(STORAGE_BUCKET)
          .remove(objectPaths)
        if (storageError) {
          console.error('[delete-account] 删除存储对象失败（不影响注销）', storageError.message)
        } else {
          removedFiles = (removed || []).length
        }
      } catch (storageErr) {
        console.error('[delete-account] 删除存储对象异常（不影响注销）', storageErr)
      }
    }

    // ---------- 6. 删除 auth 用户（级联清掉其他家庭的成员关系与 profiles） ----------
    const { error: delUserError } = await admin.auth.admin.deleteUser(user.id)
    if (delUserError) {
      console.error('[delete-account] 删除账号失败', delUserError.message)
      return json({ error: '注销失败，请稍后重试' }, 500)
    }

    console.log(
      '[delete-account] 注销完成',
      user.id,
      '家庭:', deletedFamilies,
      '文件:', removedFiles,
    )
    return json({ ok: true, deletedFamilies, removedFiles })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[delete-account] 未捕获异常', message)
    return json({ error: '注销失败，请稍后重试' }, 500)
  }
})
