-- ============================================================================
-- 初芽（BabyUp）· 一二期补丁 · 迁移 010
-- 对应《婴儿成长记录小程序-一二期补丁开发需求文档》第四节 4.6「旧邀请码停用」
--
-- ⚠️ 破坏性操作，需用户单独确认后才可执行。本文件创建时用户明确选择「暂不停用」。
--
-- 背景：
--   - 一期 families.invite_code 永久有效，存在安全隐患，补丁要求置空停用；
--   - 二期起加入家庭改为只查 family_invitations（有过期时间、可撤销）；
--   - join_family_by_code() 以 `invite_code = v_code` 匹配，null 永远匹配不上，
--     故置空后旧码自然全部失效；
--   - 该列是建表时内联的 NOT NULL 约束，必须先放开约束，否则 set null 会报错。
--
-- 影响面：families 表全部行（当前 5 行）的 invite_code 被清空，不可恢复。
--         一期前端已无任何引用（前端自二期起只走 family_invitations）。
-- ============================================================================

alter table families alter column invite_code drop not null;
update families set invite_code = null where invite_code is not null;
