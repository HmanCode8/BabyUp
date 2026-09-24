/**
 * 项目级配置。
 *
 * 安全边界（对应需求文档 3.3）：
 * - SUPABASE_ANON_KEY 只代表「匿名/已登录用户」角色，可以出现在前端；
 *   它能看到什么数据完全由数据库 RLS 决定。
 * - service_role key 与数据库密码绝不允许出现在前端代码里。
 */

/**
 * 应用名称（对外品牌名）。
 *
 * 改名字只改这一处：登录页的品牌名与 logo 字、用户协议/隐私政策里的名称、
 * 分享卡片标题、成长报告与日报分享图上的落款、AI 助手的自我介绍都读它。
 *
 * 有两处 JSON 读不到 JS 常量，改名时要手动同步：
 *   - src/manifest.json 的 name（小程序名称，会进构建产物）
 *   - src/pages.json 的 globalStyle.navigationBarTitleText（导航栏标题）
 * 另外，微信公众平台上登记的「小程序名称」才是用户看到的名字，
 * 改它要走平台的改名流程，跟代码无关。
 *
 * ⚠️ 别顺手改下面的 storage key（babyup.session 等）和邮箱域名
 * （phone.babyup.app）：改了会让老用户登录态丢失、老账号找不回。
 */
export const APP_NAME = '书遥贝贝'

/** 分享图/报告图上的品牌落款；想带英文后缀就写成 `${APP_NAME} BabyUp` 这样 */
export const APP_BRAND = APP_NAME

/** 品牌 logo 里那个字（取名称后两个字里的「贝」） */
export const APP_LOGO_TEXT = '贝'

/**
 * 后端选择：'supabase' | 'cloud'（微信云开发）。
 *
 * 两套数据层实现并存，业务代码统一通过 @/services/api 取用，不感知底层是哪一版；
 * 改这一个常量即可整体切换。Supabase 版实现永远保留，随时可切回。
 *
 * 默认值已定为 'cloud'（阶段 7 决策，2026-09-21）：微信小程序端走云开发，
 * H5 端由 @/services/api 里的条件编译强制回落到 Supabase。
 * 如需整体回滚，把这里改回 'supabase' 即可，无需改其他任何代码。
 */
export const BACKEND = 'cloud'

/** 微信云开发环境 ID（小程序后台 → 云开发 → 环境设置里查看） */
export const CLOUD_ENV_ID = 'cloudbase-d3gmqwgbx043c78eb'

/**
 * 云存储文件 ID 前缀（阶段 4 新增）。
 *
 * 云开发的文件 ID 形如：cloud://<环境ID>.<存储桶ID>/<相对路径>，
 * 其中「存储桶 ID」是随机分配、无法推导的，必须从控制台复制一次：
 *   云开发控制台 → 云存储 → 随便上传一个文件 → 复制它的 File ID，
 *   去掉最后的文件名与开头的 `cloud://`，剩下的就是本常量的值。
 * 例：cloud://cloudbase-d3gmqwgbx043c78eb.636c-cloudbase-d3gmqwgbx043c78eb-1322890583/a/b.jpg
 *     → 取 `cloudbase-d3gmqwgbx043c78eb.636c-cloudbase-d3gmqwgbx043c78eb-1322890583/`
 *
 * 业务表里存的一直是「相对路径」（如 {familyId}/{babyId}/xxx.jpg），
 * 由 src/services/cloud/storage.js 在调用 wx.cloud 存储接口前拼上本前缀。
 * 留空则所有云存储调用直接抛 STORAGE_NOT_CONFIGURED，不会静默失败。
 */
export const CLOUD_FILE_ID_PREFIX =
  'cloudbase-d3gmqwgbx043c78eb.636c-cloudbase-d3gmqwgbx043c78eb-1317399262/'

/** Supabase 项目地址 */
export const SUPABASE_URL = 'https://ohdqqfbabkglkeysccpt.supabase.co'

/** Supabase 匿名密钥（前端专用，非机密） */
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9oZHFxZmJhYmtnbGtleXNjY3B0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2MjY4NzIsImV4cCI6MjEwNTIwMjg3Mn0.P1tZYGP_UTeEuBP1bXu018XG0BF9TJR6agLwYtEz5JE'

/** 照片存储桶名称（private 桶，访问一律走 signed URL） */
export const STORAGE_BUCKET = 'baby-photos'

/**
 * 时光页一次最多能选几张照片（对应 chooseMedia 的 count）。
 * 微信基础库 2.25.0 之前上限 9，之后上限 20；取 9 保证各版本表现一致。
 */
export const PHOTO_MAX_COUNT = 9

/**
 * 允许上传的视频时长上限（秒）。
 *
 * 取值依据：云开发免费额度是 5GB 容量 + 5GB/月下载流量。
 * 压缩后一段 10 秒视频约 1～2MB，5GB 流量约能支撑两三千次播放；
 * 直接传原始长视频会很快吃满额度。想放宽改这一个数字即可。
 */
export const VIDEO_MAX_DURATION_SEC = 10

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
