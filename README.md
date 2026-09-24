# 书遥贝贝（BabyUp）

0-3 岁宝宝成长记录小程序：uni-app + Vue 3 + 微信云开发，含家庭共享记录、成长报告与 AI 育护助手。

## 文档

完整开发文档在 [`docx/`](./docx)（VuePress 2 文档站）：

```bash
cd docx
npm install
npm run dev      # 本地预览
npm run build    # 产出静态站到 docx/.vuepress/dist
```

- 项目概览 / 本地运行 / 代码架构 / 数据模型 / 功能地图：`docx/guide/`
- 双后端（微信云开发 ↔ Supabase）：`docx/backend/`
- AI 能力说明：`docx/ai/`
- 发布与运维手册：`docx/ops/`
- 历次需求文档归档：`docx/product/`
- 小程序大赛参赛资料：`docx/contest/`

## 开发

```bash
npm install
npm run build:mp-weixin     # 产物 dist/build/mp-weixin，用微信开发者工具导入
npm run dev:h5              # H5 调试（后端强制回落 Supabase）
```

后端选择在 `src/config/index.js` 的 `BACKEND` 常量（当前 `'cloud'`）。
