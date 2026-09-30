-- ============================================================================
-- 书遥贝贝 · 迁移 019：家庭邀请码可删除（补 invites_delete 策略）
--
-- 目的：家庭成员页的「邀请码记录」新增「删除」（整行删掉，不只是撤销）。
--
-- 为什么必须有这一份（双后端并存）：
--   006 只建了 invites_select / invites_insert / invites_update 三条策略，
--   **没有 invites_delete** —— 缺了它，前端新加的删除在 Supabase 侧会被 RLS
--   直接挡掉（表现为「删除失败」），而云开发侧是好的（data 云函数的 guardRemove
--   里已经写了「family_invitations 仅 owner」）。两侧必须对齐。
--
-- 权限与 invites_update 完全一致：本家庭 active 成员且 role = 'owner'。
--   owner 才能发码，自然也才谈得上删码；member / viewer 连列表都改不动。
--
-- 「撤销」与「删除」的分工（前端两种都给）：
--   撤销 = update status = 'revoked'，码失效，记录留着（走 invites_update）；
--   删除 = delete 整行，列表里再也查不到（走本迁移新加的策略）。
--   ⚠️ 删码**不等于**把人踢掉：成员归属在 family_members，邀请码行只是入场券。
--
-- 幂等：先 drop policy if exists 再 create，重复执行不报错。
--
-- ⚠️ 未执行（当前 BACKEND='cloud'，不跑也不影响现网）；
--    将来回滚 Supabase 时，要与 014 ~ 018 一起执行。
-- ============================================================================

drop policy if exists invites_delete on family_invitations;
create policy invites_delete on family_invitations for delete
using (exists (select 1 from family_members fm
               where fm.family_id = family_invitations.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role = 'owner'));
