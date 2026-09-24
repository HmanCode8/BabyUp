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
| 翻历史需求与决策 | [需求文档归档](/product/README.md) |

> 文档里的代码路径都相对**仓库根目录**写（例如 `src/services/api.js`），
> 在编辑器里直接按路径打开即可。

## 本地预览本文件站

```bash
cd docx
npm install     # 首次
npm run dev     # 开发预览，默认 http://localhost:8080
npm run build   # 产出静态站到 docx/.vuepress/dist
```
