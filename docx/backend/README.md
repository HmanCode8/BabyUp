# 婴儿成长记录小程序 · 双后端功能对照

> 整理日期：2026-09-22
> 用途：一张表看清「哪些功能做了、哪些没做、两边差在哪」。
> 本文档内容**全部由代码核对得出**（不是抄需求文档），核对范围：
> `src/services/**`、`src/cloudfunctions/**`、`supabase/functions/**`、`supabase/migrations/**`、`src/pages/**`。

---

## 一、先说结论

**业务功能只有一份代码。** `src/services/` 下 16 个业务文件（`baby.js` / `growth.js` / `vaccine.js` / `checkup.js` …）
全部只调用 `@/services/api`，不认识底层是 Supabase 还是云开发。

所以「两边的差异」只来自两层：

| 层 | 说明 | 差在哪 |
|---|---|---|
| **后端能力差异** | 云开发侧先天缺 4 项能力 | 手机号登录、邮箱找回、绑定邮箱、需要 uni.login 换 code |
| **基础设施是否就绪** | 代码写完了，但集合 / 表 / 云函数是否已落地 | 第三期新增的 4 个功能 |

---

## 二、架构

```
页面 / 组件（src/pages/**、src/components/**）
        │
        ▼
业务服务层（src/services/*.js，共 16 个，两侧共用，只有一份）
        │
        ▼
src/services/api.js  ← ★ 唯一切换点
        │
        ├── BACKEND = 'cloud'  ──→  src/services/cloud/**   （微信云开发）
        └── BACKEND = 'supabase' ─→  src/services/supabase/** （Supabase）

特例：H5 平台没有 wx.cloud，api.js 用条件编译强制回落 Supabase，
      无论 BACKEND 配成什么都不受影响。
```

**切换方式**：改 [src/config/index.js](src/config/index.js) 里的 `BACKEND` 一个常量即可整体切换，无需改动任何其他代码。
**回滚保证**：Supabase 版实现永远保留，随时可切回。

### 两套客户端的同形契约

`cloud/index.js` 与 `supabase/index.js` 导出完全相同的结构：

```
{
  project,          // 项目信息（只读）
  capabilities,     // 能力开关，页面据此隐藏/显示入口
  auth,             // 账号体系
  functions,        // 服务端函数调用（Edge Function / 云函数）
  session,          // 登录态本地读写（两侧复用同一实现）
  db,               // 数据访问
  storage,          // 文件存储
  ApiError
}
```

`db` 的方法签名也完全一致：`select / selectOne / insert / insertSilent / upsert / remove / rpc / pickColumns`。
差异全部收在 `cloud/db.js` 的「翻译逻辑」里（PostgREST 语法 → 云函数 where 条件数组）。

---

## 三、后端能力差异（共 4 处）

定义位置：[cloud/index.js](src/services/cloud/index.js) 与 [supabase/index.js](src/services/supabase/index.js) 的 `capabilities`。

| 能力 | Supabase | 云开发 | 说明 |
|---|:---:|:---:|---|
| 微信一键登录 | ✅ | ✅ | 云开发反而更简单：openid 由微信侧注入，无需换 code、无需 AppSecret |
| 手机号 + 账号密码登录 | ✅ | ❌ | 已锁定决策：云开发版只保留微信一键登录 |
| 邮箱找回密码 | ✅ | ❌ | 云开发版无邮箱体系 |
| 绑定真实邮箱 | ✅ | ❌ | 同上 |
| `wechatLoginCode`（前端是否需先 `uni.login` 换 code） | true | false | 仅登录实现细节，页面无感 |

### 「只有一边有」的服务端能力（不是缺陷，是各自实现方式不同）

| 能力 | Supabase | 云开发 |
|---|:---:|:---:|
| 内容安全检测 `msgSecCheck` | ❌ 无 | ✅ 内置于 `data` 云函数 |
| 疫苗订阅消息定时提醒 | ❌ 无 | ✅ `reminder` 云函数（每天 09:00 触发） |
| 喂奶超时订阅消息提醒 | ❌ 无 | ✅ `feeding-reminder` 云函数（每小时触发，模板 7801「奶瓶喂养提醒」） |
| 通用 CRUD 代理 | 不需要（PostgREST 直连） | ✅ `data` 云函数 |
| 跨集合成员鉴权 | 由 RLS + RPC 承担 | 由 `data` 云函数内的 JS 校验承担 |

> **为什么云开发要多一个 `data` 云函数**：云开发的安全规则只认 `_openid`，
> 表达不了「必须是某家庭的 active 成员」「viewer 不可写」这类跨集合校验，
> 因此客户端**不直连数据库**，读写与云存储换链接/删文件统一由 `data` 云函数以管理员身份代理。

### H5 端说明

H5 端被 `api.js` 强制回落 Supabase，因此：

- 有：手机号登录、邮箱找回密码
- 没有：订阅消息提醒（微信小程序能力）
- 定位：**不作为对外产品**，仅作本地调试与兜底验证

---

## 四、业务功能清单

图例：✅ 已就绪 ｜ ⚠️ 代码已好，基础设施待落地 ｜ ❌ 该后端不支持

### 4.1 账号与家庭

| 功能 | 主要页面 | Supabase | 云开发 |
|---|---|:---:|:---:|
| 微信一键登录 | `login.vue` | ✅ | ✅ |
| 手机号 / 账号密码登录 | `login.vue` | ✅ | ❌ |
| 忘记密码 | `forgot-password.vue` | ✅ | ❌ |
| 绑定真实邮箱 | `account.vue` | ✅ | ❌ |
| 创建家庭 | `family.vue` | ✅ | ✅ |
| 邀请码生成 / 一次性加入 | `family.vue`、`join-family.vue` | ✅ | ✅ |
| 成员角色管理（owner / member / viewer） | `family.vue` | ✅ | ✅ |
| 移除成员（软删除） | `family.vue` | ✅ | ✅ |
| 修改我的昵称（多家庭同步） | `family.vue` | ✅ | ✅ |
| 微信一键登录后建档 | — | ✅ `wechat-login` | ✅ `login` 云函数 |

### 4.2 宝宝与记录

| 功能 | 主要页面 | Supabase | 云开发 |
|---|---|:---:|:---:|
| 宝宝资料增删改 | `baby-edit.vue`、`setup.vue` | ✅ | ✅ |
| 生长记录 + 曲线 | `growth.vue` | ✅ | ✅ |
| 喂养记录 | `feeding-edit.vue` | ✅ | ✅ |
| 睡眠记录 | `sleep-edit.vue` | ✅ | ✅ |
| 尿布记录 | `diaper-edit.vue` | ✅ | ✅ |
| 里程碑 | `milestone.vue`、`milestone-edit.vue` | ✅ | ✅ |
| 时光（照片 + 视频） | `record.vue`、`photo-detail.vue` | ✅ Storage | ✅ 云存储 |
| 时段汇总 | `src/services/summary.js` | ✅ | ✅ |
| 日报分享卡 | `record.vue` | ✅ | ✅ |
| 年度报告（`range=year`） | `report.vue` | ✅ | ✅ |
| 疫苗记录 + 疫苗字典 | `vaccine.vue`、`vaccine-library.js` | ✅ | ✅ |
| 疫苗订阅消息提醒 | `vaccine.vue` + 定时任务 | ❌ | ✅ 两端就绪，真实推送效果待真机验证 |
| 家庭动态墙 / 缓存（脏标记 + 30 分钟自动刷） | `record.vue` | ✅ | ✅ |

### 4.3 第三期新增（云开发侧已全部就绪；Supabase 侧卡在迁移未执行）

| 功能 | 主要页面 | Supabase | 云开发 |
|---|---|:---:|:---:|
| 生病 / 用药记录 | `illness.vue`、`illness-edit.vue` | ⚠️ 014 未执行 | ✅ 集合已建 + `data` 已重传 |
| 儿保体检记录 | `checkup.vue`、`checkup-edit.vue` | ⚠️ 014 未执行 | ✅ 集合已建 + `data` 已重传 |
| 体检 ↔ 生长服务端联动 | — | ⚠️ 015 未执行（触发器） | ✅ `data` 云函数内 JS 实现 |
| 用户反馈 | `feedback.vue` | ⚠️ 014 未执行 | ✅ 集合已建 + `data` 已重传 |
| 照片删除时级联清理体检关联 | — | ⚠️ 015 未执行 | ✅ `data` 云函数内 JS 实现 |

### 4.4 喂奶提醒（三期 P1-8，只做云开发侧）

按月龄给出喂养间隔上限（可自定义），距最近一条喂养记录超过上限即提醒。

| 功能 | 主要页面 | Supabase | 云开发 |
|---|---|:---:|:---:|
| 喂养间隔上限设置（开关 + 步进器 + 恢复月龄推荐） | `feeding-reminder.vue` | ❌ 不做 | ✅ 页面已登记 `pages.json` |
| 「我的」页入口卡片与摘要 | `profile.vue` | ❌ 不做 | ✅ |
| 记录页站内「该喂奶啦」提示 | `record.vue` | ❌ 不做 | ✅ |
| 超时给全家 active 成员推订阅消息 | `feeding-reminder` 云函数 | ❌ 不做 | ✅ 已部署并实测（2026-09-22，定时触发发送成功） |

> **Supabase 侧为什么不做**：提醒依赖微信订阅消息，是纯小程序能力，Supabase 侧没有对应通道。
> 页面与判定逻辑放在 `src/services/feeding.js` 等跨后端共用文件里，Supabase 侧加载这些文件不会报错，
> 只是不会收到任何推送（H5 端同理）。**不需要执行任何 SQL，也不新增迁移文件。**
>
> **数据落点**：复用 `babies` 集合，新增 3 个字段，**不需要建新集合、不需要改 `data` 云函数**
> （`data` 的白名单是按集合粒度，`babies` 已在册）：
>
> | 字段 | 类型 | 写入方 | 含义 |
> |---|---|---|---|
> | `feed_remind_enabled` | boolean | 设置页 | 是否开启喂奶提醒 |
> | `feed_interval_max_min` | number | 设置页 | 实际生效的间隔上限（分钟）；存「实际值」而非「是否自定义」标记，云函数只读一个数字即可 |
> | `feed_remind_at` | string(ISO) | 云函数 | 上次提醒时间；只用于「每轮超时只推一次」的去重，不让同一轮超时每小时重复推 |
>
> **月龄 → 上限推荐表**（`src/services/feeding.js` 的 `FEED_INTERVAL_TABLE`，云函数内同步了一份）：
> 0~1 月 150 / 1~2 月 180 / 2~3 月 210 / 3~6 月 240 / 6~12 月 270 / 1 岁以上 300（分钟）。
> 取的是各月龄段儿科常规间隔的**上沿**（1 月龄 2~3 小时 → 3 小时），宁可晚提醒也不在刚吃完就催；
> 自定义区间 1~12 小时、步长 15 分钟。判定起点是**最近一条喂养记录**，从来没记录过则不提醒。
>
> ⚠️ **云调用不能用「云端测试」验证**（疫苗提醒同理）：`cloud.openapi.*` 要求云函数**由小程序端触发**，
> 在云开发控制台点「云端测试」会报 `-501001 invalid wx openapi access_token`；
> 定时触发器触发是正常的（2026-09-22 实测整点触发发送成功）。
> 自测用开发者工具 Console 执行 `wx.cloud.callFunction({ name: 'feeding-reminder' })`，或等整点看日志。

---

## 五、基础设施清单

### 5.1 云开发侧（环境 `cloudbase-d3gmqwgbx043c78eb`）

**云函数（7 个）**

| 云函数 | 作用 | 部署状态 |
|---|---|---|
| `login` | 微信一键登录（openid 注入，首次建档 profiles） | ✅ 已部署（日常在用） |
| `data` | 通用 CRUD 代理 + 7 个 RPC + 云存储代理 + 内容安全检测 | ✅ 已重传（2026-09-22，含第三期新 action） |
| `init-db` | 建集合 + 给 `vaccine_library` 灌种子（一类 22 + 二类 28） | ✅ 已执行 |
| `reminder` | 疫苗到期订阅消息推送，定时器 `0 0 9 * * * *` | ✅ 已部署（含定时触发器） |
| `feeding-reminder` | 喂奶超时订阅消息推送，定时器 `0 0 * * * * *`（每小时整点），模板 7801 | ✅ 已部署并实测（2026-09-22） |
| `export-data` | 数据导出 | ✅ 已部署 |
| `delete-account` | 账号注销（破坏性操作） | ✅ 已部署 |

**集合（17 个）** —— 与 Supabase 侧 17 张表一一对应：

```
families / family_members / family_invitations / babies / baby_photos
growth_records / vaccinations / feeding_records / sleep_records / diaper_records
milestones / profiles / vaccine_library / app_logs
feedbacks / illness_records / checkup_records        ← 第三期新增 3 个
```

**RPC（7 个，已在 `data` 云函数内用 JS 重写）**

```
create_family / join_family_by_invite / create_family_invitation
set_member_role / set_my_nickname / remove_family_member / remove_checkup_record
```

> 📌 `reminder` 重部署时的注意事项（首次部署时已按此配置）：
> - `TEMPLATE_ID` 必须与 `src/pages/vaccine/vaccine.vue` 里的模板 ID 一致
> - `config.json` 里已配好定时触发器与 `subscribeMessage.send` 权限，必须一并上传
> - **推送效果无法在模拟器验证**，需真机 + 真实到期疫苗才可见

### 5.2 Supabase 侧

**Edge Functions（4 个）**

| 函数 | 作用 |
|---|---|
| `wechat-login` | 微信一键登录（code2session + 建号 + 签发 token） |
| `phone-login` | 手机号兜底登录（按手机号反查登录邮箱） |
| `export-data` | 数据导出 |
| `delete-account` | 账号注销 |

**迁移文件（14 个）**

```
001~013  ✅ 历史迁移，已执行
014_phase3_schema.sql          ⬜ 未执行 → 第三期三张表
015_checkup_sync_and_remove.sql ⬜ 未执行 → 体检↔生长触发器 + 级联清理
```

**数据表 17 张** / **RPC 7 个**（与云开发侧同名同语义）

---

## 六、剩余待办

| # | 事项 | 归属 | 状态 |
|---|---|---|---|
| 1 | 重传 `data` 云函数（含第三期 action） | 云开发 | ✅ 已完成（2026-09-22） |
| 2 | 部署 `reminder` / `export-data` / `delete-account` 云函数 | 云开发 | ✅ 已完成（2026-09-22） |
| 3 | 执行 `014_phase3_schema.sql` | Supabase | ⬜ 未执行（按约定需先确认再执行） |
| 4 | 执行 `015_checkup_sync_and_remove.sql` | Supabase | ⬜ 未执行（同上） |
| 5 | `npm run build:mp-weixin` 构建验证 | 两端 | ⬜ 未做 |
| 6 | 双后端回归：临时切 `BACKEND='supabase'` 跑一遍 H5 | 两端 | ⬜ 未做 |
| 7 | 数据备份（旧环境 17 集合 JSON + 云存储照片） | 运维 | ⬜ 未做 |

### 补充说明

- **任务 3 / 4 为什么一直没执行**：按既定约定「不改写/删除 Supabase 侧，只新增迁移文件」。
  这两条 SQL 只写不执行，执行前需要单独确认。
  **影响面**：云开发侧第三期功能已可用；Supabase 侧（含 H5 回落通道）的
  生病 / 体检 / 反馈三个功能目前会因表不存在而失败。
- **上线状态**：`MINIPROGRAM_STATE` 保持 `'trial'`。本项目只给家人用、不公开发布，
  因此无需改为 `'formal'`。
- **免费额度约束**：云开发免费额度为 5GB 存储 + 5GB/月下载流量，
  因此视频上传限制 `VIDEO_MAX_DURATION_SEC = 10` 秒。

---

## 七、风险与注意

| 风险 | 说明 | 现状 |
|---|---|---|
| 云开发环境到期 | 旧环境免费体验版曾被通知将于 2026-10-07 到期 | 已解决：成长计划自动升级为个人版，到期约 2027-03 |
| 两个环境分属两个腾讯云账号 | 新环境 `babyup-d1g39cvbp28739006`（PG 模式）在另一个账号下，跨账号资源不互通 | 新环境仅作备选，晾置不删（不删不收费） |
| 新环境是 PG 模式 | 无文档数据库，`wx.cloud.database()` 不可用 | 不影响小程序，小程序继续用旧环境 |
| 集合与表可能不一致 | 两侧同名但不保证字段完全一致 | 任何表结构改动需同步两份 |
| 单一用户身份模型 | 云开发侧用户 id = openid，Supabase 侧用户 id = uuid | 由各自客户端实现吸收，业务层无感 |

---

## 八、一句话记忆

> **功能一份代码，差异两处来源：**
> **① 云开发少 4 项账号能力（手机号/邮箱那一套）；**
> **② 第三期 4 个功能的表/集合还没落完（云开发已好，Supabase 的 014/015 还没执行）。**
