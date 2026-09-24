# 本地运行

## 环境依赖

| 依赖 | 说明 |
| --- | --- |
| Node.js | 开发机实测 **v22.12.0**（项目本身没锁 engines；文档站 vuepress 官方要求 ≥ 22.18，实测 22.12 也能正常安装构建，只是 npm 会给一条 `EBADENGINE` 警告） |
| npm | 实测 10.9.0 |
| 微信开发者工具 | 编译小程序端必需；云函数的创建/上传/触发器配置都只能在它里面做 |
| 微信小程序 AppID | `wx1b8ee065d7975ac7`（`src/manifest.json` 的 `mp-weixin.appid`） |
| 云开发环境 | `cloudbase-d3gmqwgbx043c78eb`（`src/config/index.js` 的 `CLOUD_ENV_ID`） |

## 装依赖

在**仓库根目录**执行（`docx/` 是独立文档站，依赖单独装，见最后一节）：

```bash
npm install
```

## 跑起来

### 编译微信小程序（主路径）

```bash
npm run build:mp-weixin     # 产物：dist/build/mp-weixin
# 或开发模式（watch）
npm run dev:mp-weixin       # 产物：dist/dev/mp-weixin
```

然后用**微信开发者工具导入 `dist/build/mp-weixin` 目录**（项目类型：小程序；AppID 填上面的 AppID）。

> ⚠️ 每次构建会**先清空再重写 dist**，导入时请选 `dist/build/mp-weixin`，不要选仓库根目录。

### 跑 H5（仅调试用）

```bash
npm run dev:h5
```

H5 端没有 `wx.cloud`，`src/services/api.js` 会用条件编译把后端**强制回落成 Supabase**，
因此 H5 上 AI 相关能力不可用，仅适合调样式和普通页面。H5 不作为对外产品。

## 云函数怎么上去

云函数的源码在 `src/cloudfunctions/`，但**微信开发者工具看不到源码目录**——
`vite.config.js` 里有一个 `copy-cloudfunctions` 插件，每次构建会把 `src/cloudfunctions`
整体拷进小程序产物目录（对应 `src/manifest.json` 里 `mp-weixin.cloudfunctionRoot` 的配置）。

所以改完云函数后的流程是：

1. 重新编译（`npm run build:mp-weixin`）；
2. 在微信开发者工具里展开产物中的 `cloudfunctions/`；
3. 对着具体函数目录右键 → **上传并部署：云端安装依赖**。

> 定时触发器**不在代码里**，只能在开发者工具的「云函数 → 触发器」中配置；
> 标准触发器（通过 API 建的）拿不到云调用鉴权，必须建在**微信云开发触发器**那一栏。

## 配置在哪

所有需要改的项目级常量集中在 `src/config/index.js`，常用的几个：

| 常量 | 作用 |
| --- | --- |
| `BACKEND` | 后端开关：`'cloud'`（微信云开发）/ `'supabase'` |
| `CLOUD_ENV_ID` | 云开发环境 ID |
| `CLOUD_FILE_ID_PREFIX` | 云存储文件 ID 前缀（控制台复制一次，留空会让云存储调用直接抛错） |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Supabase 项目地址与匿名密钥（前端公开，能看什么数据由 RLS 决定） |
| `APP_NAME` / `APP_BRAND` / `APP_LOGO_TEXT` | 对外品牌名（改名只改这里 + 两处 JSON） |
| `PHOTO_MAX_COUNT` / `VIDEO_MAX_DURATION_SEC` | 一次最多选几张照片 / 视频时长上限 |

> `SUPABASE_ANON_KEY` 可以进前端；**service_role key 与数据库密码绝不能出现在前端代码里**。

## 已知需要手工启用的东西

| 能力 | 状态 | 怎么启用 |
| --- | --- | --- |
| AI 助手 | 依赖微信基础库 ≥ 3.15.1 | 不需要额外配置，走 `wx.cloud.extend.AI`，复用云开发鉴权 |
| 语音「按住说话」 | 代码就绪但**插件未启用** | 后台添加「微信同声传译」插件（**用 AppID `wx069ba97219f66d99` 搜**），再把 `src/manifest.json` 里被注释掉的 `mp-weixin.plugins` 片段恢复。未启用时按钮自动隐藏，见 `src/utils/voice.js` |
| 订阅消息推送 | 代码就绪 | 定时触发器 + 模板 ID 配好后才能收到，额度是「一次授权 = 一条」，详见 [发布操作手册](/ops/release.md) |

## 文档站（docx/）

文档站是独立的 npm 工程（VuePress 2），依赖与根工程隔离：

```bash
cd docx
npm install       # 首次
npm run dev       # 本地预览，默认 http://localhost:8080
npm run build     # 产出 docx/.vuepress/dist
```

> **版本组合必须成套**：`vuepress@2.0.0-rc.31` + `@vuepress/theme-default@2.0.0-rc.134`。
> 主题的插件依赖在新版本里换了编号，混用旧版主题会报
> `Missing "./style" specifier in "@vuepress/plugin-palette" package`，构建直接失败。

## 构建产物验证小抄

产物被压缩过，页面的函数名可能被改名，验证时优先看**字符串常量**而不是函数名：

```bash
# 例：确认某个常量/文案进了产物
node -e "const s=require('fs').readFileSync('dist/build/mp-weixin/common/vendor.js','utf8');console.log(s.includes('关键词'))"
```

另外注意：本机终端是 bash 环境，PowerShell 的 cmdlet（如 `Select-Object`）不可用。
