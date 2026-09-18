/**
 * 项目级配置。
 *
 * 安全边界（对应需求文档 3.3）：
 * - SUPABASE_ANON_KEY 只代表「匿名/已登录用户」角色，可以出现在前端；
 *   它能看到什么数据完全由数据库 RLS 决定。
 * - service_role key 与数据库密码绝不允许出现在前端代码里。
 */

/** Supabase 项目地址 */
export const SUPABASE_URL = 'https://ohdqqfbabkglkeysccpt.supabase.co'

/** Supabase 匿名密钥（前端专用，非机密） */
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9oZHFxZmJhYmtnbGtleXNjY3B0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2MjY4NzIsImV4cCI6MjEwNTIwMjg3Mn0.P1tZYGP_UTeEuBP1bXu018XG0BF9TJR6agLwYtEz5JE'

/** 照片存储桶名称（private 桶，访问一律走 signed URL） */
export const STORAGE_BUCKET = 'baby-photos'

/**
 * 手机号映射为 Supabase 邮箱账号所用的域名。
 * 例：13800138000 -> 13800138000@phone.babyup.app
 *
 * 为什么不是文档原文的 phone.local：
 * Supabase 会校验邮箱域名并拉黑保留域名（phone.local / example.com 均被拒，
 * 报错 email_address_invalid），必须使用真实 TLD。
 * 邮箱确认关闭后不会真正发信，因此该域名无需真实可投递。
 */
export const PHONE_EMAIL_DOMAIN = 'phone.babyup.app'

/**
 * 微信用户映射为 Supabase 邮箱账号所用的域名。
 * 例：wx_{openid}@wechat.local
 *
 * 该值必须与 Edge Function `wechat-login` 里的 OPENID_EMAIL_DOMAIN 保持一致
 * （前端只用它来判断「当前账号邮箱是不是真实邮箱」，从而决定能否找回密码）。
 */
export const WECHAT_EMAIL_DOMAIN = 'wechat.local'

/** 本地持久化登录态的 storage key */
export const SESSION_STORAGE_KEY = 'babyup.session'

/**
 * 本地持久化「已同意的协议版本」的 storage key（补丁 Step 2 首次登录确认）。
 * 协议文案更新后把 LEGAL_VERSION 一起改掉，老用户会重新看到确认弹层。
 */
export const LEGAL_CONSENT_STORAGE_KEY = 'babyup.legalConsent'
export const LEGAL_VERSION = '2026-09-18'

/**
 * 本地持久化「当前家庭 + 每个家庭上次选中的宝宝」的 storage key（二期加强）。
 * 一个用户可属于多个家庭、一个家庭可有多宝宝，重启后要回到用户上次看的那一份。
 */
export const SELECTION_STORAGE_KEY = 'babyup.selection'

/**
 * 微信一键登录所用的 Edge Function 名称（二期新增，见需求文档 3.2）。
 * AppSecret 只配在该函数的环境变量里，前端永远拿不到。
 */
export const WECHAT_LOGIN_FUNCTION = 'wechat-login'

/**
 * 手机号兜底登录所用的 Edge Function 名称（补丁 Step 2 追加）。
 *
 * 背景：绑定真实邮箱后账号登录邮箱变成邮箱，客户端无法再由手机号推导登录邮箱，
 * 需要服务端按手机号反查当前登录邮箱后完成登录（邮箱不下发前端）。
 */
export const PHONE_LOGIN_FUNCTION = 'phone-login'

/** 数据导出 Edge Function 名称（补丁 Step 3，文档 3.2） */
export const EXPORT_DATA_FUNCTION = 'export-data'

/** 账号注销 Edge Function 名称（补丁 Step 3，文档 3.2） */
export const DELETE_ACCOUNT_FUNCTION = 'delete-account'

/**
 * Supabase 新版 publishable key（前端公开密钥，等价于旧的 anon key）。
 *
 * 为什么需要它：本项目已启用新版 API Key，Edge Functions 网关只接受新版格式，
 * 旧版 JWT 格式的 anon key 调用 /functions/v1/* 会直接被拒：
 *   HTTP 401 INVALID_API_KEY
 *   "The apikey header matched no key configured for auth mode(s): publishable, secret"
 * 因此仅「调用 Edge Function」这一条链路使用本 key；
 * Auth / PostgREST（/rest/v1） / Storage 继续使用 SUPABASE_ANON_KEY（实测正常）。
 */
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_N_JtOoT0RyANvFclSeD4KQ_BgiSusfC'
