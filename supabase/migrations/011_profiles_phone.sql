-- ============================================================================
-- 初芽（BabyUp）· 一二期补丁 · 迁移 011
-- 目的：让「绑定真实邮箱后，手机号仍然可以登录」
--
-- 背景（用户已确认采用「手机号兜底登录」）：
--   补丁 Step 2 采用「路线 1：真实邮箱即账号邮箱」后，账号的登录邮箱由
--   `{手机号}@phone.babyup.app` 变成了真实邮箱，手机号派生的假邮箱不复存在，
--   客户端再也无法由手机号推导出登录邮箱 —— 手机号登录会失败。
--
--   兜底方案：新增 Edge Function `phone-login`，服务端按手机号反查该账号
--   「当前的登录邮箱」，再用「邮箱 + 密码」向 GoTrue 换取 Session 返回，
--   登录邮箱不下发前端。反查需要一份「手机号 → 用户」映射，故本迁移补 phone 列。
--
-- 安全性：
--   1. profiles 的 RLS 仍是 `auth.uid() = id`，普通用户读不到别人的手机号，
--      只有 Edge Function 内的 service_role 能查，不构成新的隐私暴露面。
--   2. phone 建唯一索引：一个手机号只对应一个账号（一期规则），
--      同时避免反查出现多行歧义。
--   3. 幂等：全部带 if not exists / 判空条件，可重复执行。
-- ============================================================================

-- ---------- 1. profiles 增加手机号 ----------
alter table profiles add column if not exists phone text;

-- 唯一索引（Postgres 唯一索引允许多个 null，微信账号不受影响）
create unique index if not exists idx_profiles_phone on profiles(phone);

-- ---------- 2. 补齐缺失的 profiles 行 ----------
-- 一期手机号用户注册时并没有写 profiles（profiles 目前只被 Edge Function
-- wechat-login 写入），没有行就无处承载 phone，所以先补行，其余字段留空。
insert into profiles (id)
select u.id
from auth.users u
left join profiles p on p.id = u.id
where p.id is null;

-- ---------- 3. 回填手机号 ----------
-- 一期手机号账号的登录邮箱形如 {手机号}@phone.babyup.app，直接从邮箱里取。
-- 注意：若某个账号在本迁移执行前就已经绑定过真实邮箱，其手机号已无法从邮箱反推，
-- 这类账号需要用户重新用手机号注册不了（本期上线前不存在这种账号）。
update profiles p
set phone = split_part(u.email, '@', 1),
    updated_at = now()
from auth.users u
where u.id = p.id
  and u.email like '%@phone.babyup.app'
  and p.phone is null;
