---
home: true
heroImage: /logo.png
heroText: 书遥贝贝
tagline: 宝宝成长记录小程序 · 开发与维护文档
actions:
  - text: 快速上手
    link: /guide/quick-start.html
    type: primary
  - text: 系统全貌
    link: /guide/architecture.html
    type: secondary
features:
  - title: 先看这里
    details: 项目是什么、现在什么状态、代码怎么分层。接手这个项目请从「指南」开始读。
  - title: 双后端并存
    details: 微信云开发（当前启用）与 Supabase（随时可回滚）两套实现并存，改一个常量即可整体切换。
  - title: AI 能力
    details: 照护助手问答、一句话记一笔、每日小结、首页 AI 观察，四个触点的上下文与边界都有说明。
  - title: 需求归档
    details: 一期到三期的原始需求文档、补丁说明、双后端迁移计划，按时间顺序留档。
footer: 书遥贝贝 · 内部开发文档
---

## 这个文档站怎么用

| 我想… | 去哪 |
| --- | --- |
| 知道这是什么东西、做到哪一步了 | [项目概览](/guide/README.md) |
| 把代码跑起来 | [本地运行](/guide/quick-start.md) |
| 搞清楚代码分层与后端切换点 | [代码架构](/guide/architecture.md) |
| 查某个字段存在哪张表/哪个集合 | [数据模型](/guide/data-model.md) |
| 查某个功能在哪个页面、走哪条链路 | [功能地图](/guide/features.md) |
| 搞懂 AI 是怎么回答问题的 | [AI 能力说明](/ai/README.md) |
| 换后端 / 回滚到 Supabase | [双后端总览](/backend/README.md) |
| 发布、提审、真机验证 | [发布操作手册](/ops/release.md) |
| 提审前要关 AI、做搜一搜曝光 | [搜一搜 SEO](/ops/seo.md) |
| 翻历史需求与决策 | [需求文档归档](/product/README.md) |

> 文档里的代码路径都相对**仓库根目录**写（例如 `src/services/api.js`），
> 在编辑器里直接按路径打开即可。

## 文档的权威性与时效（先看这张表）

判断「哪份对应最新代码」看这里。**权威** = 与代码同步维护，有冲突时以它为准；**归档** = 记录当时的决策，不保证与今天一致。

| 文档 | 定位 | 权威性 | 最后校对 |
| --- | --- | --- | --- |
| [项目概览](/guide/README.md) | 现状快照、产品与技术定位、全程硬约束 | 权威 | 2026-10 |
| [本地运行](/guide/quick-start.md) | 装依赖 / 编译小程序 / 打开开发者工具 | 权威 | 2026-10 |
| [代码架构](/guide/architecture.md) | 分层、目录、启动链路、后端切换点、体积与分包 | 权威 | 2026-10 |
| [数据模型](/guide/data-model.md) | 集合 ↔ 表、字段、权限、导出/注销范围 | 权威 | 2026-10 |
| [功能地图](/guide/features.md) | 39 个页面各干什么、端到端主流程 | **权威（最贴近代码）** | 2026-10-09 |
| [AI 能力说明](/ai/README.md) | 四个 AI 触点、上下文、每日额度、边界、排查 | 权威 | 2026-10 |
| [双后端总览](/backend/README.md) | 两套后端逐项对照 | 权威 | 2026-10 |
| [双后端迁移计划](/backend/migration-plan.md) | 迁移契约、阶段拆解、风险与回滚边界 | 半归档（迁移已完成，回滚时看） | 2026-09 |
| [发布操作手册](/ops/release.md) | 提审发布操作记录 | ⚠️ **含大量历史快照**（顶部有说明） | 2026-10 局部修订 |
| [搜一搜 SEO](/ops/seo.md) | 提审、搜一搜、后台配置的落地步骤（含「提审前关掉 AI 开关」） | 权威 | 2026-09-30 |
| [需求文档归档](/product/README.md) | 一期~三期原始需求、补丁说明 | 归档 | — |
| [参赛资料](/contest/README.md) | 大赛文案包 | 归档（类目 / 待办可能已变） | — |

不在文档站里的只剩一份：仓库根目录 `README.md`（给开发者看的入口：怎么跑、后端在哪切）。

## 本地预览本文件站

```bash
cd docx
npm install     # 首次
npm run dev     # 开发预览，默认 http://localhost:8080
npm run build   # 产出静态站到 docx/.vuepress/dist
```
