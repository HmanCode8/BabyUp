import { viteBundler } from '@vuepress/bundler-vite'
import { defaultTheme } from '@vuepress/theme-default'
import { defineUserConfig } from 'vuepress'

/**
 * 文档站配置。
 *
 * 本目录（docx/）是一个独立的 VuePress 2 文档站，和外面 uni-app 工程互不影响：
 *   npm install && npm run dev    本地预览
 *   npm run build                 产出静态文件到 docx/.vuepress/dist
 *
 * 站点结构：
 *   guide/    入门与系统全貌（概览 / 本地运行 / 代码架构 / 数据模型 / 功能地图）
 *   backend/  双后端（微信云开发 / Supabase）与迁移记录
 *   ai/       AI 能力说明（四个 AI 触点的工作原理）
 *   ops/      发布与运维手册
 *   product/  历次需求文档归档（一/二/三期 + 补丁）
 *   contest/  微信小程序大赛参赛资料
 */
export default defineUserConfig({
  lang: 'zh-CN',
  title: '书遥贝贝 开发文档',
  description: '宝宝成长记录小程序（uni-app + Vue 3 + 微信云开发）的开发与维护文档',
  head: [['link', { rel: 'icon', href: '/logo.png' }]],
  bundler: viteBundler({
    viteOptions: {
      server: {
        // 构建产物就在 sourceDir 里面（.vuepress/dist），不排除的话
        // 一边跑 dev 一边 build 会让 dev server 把产物当源码，刷屏式热重载
        watch: {
          ignored: [
            '**/node_modules/**',
            '**/.vuepress/dist/**',
            '**/.vuepress/.cache/**',
            '**/.vuepress/.temp/**',
          ],
        },
      },
    },
  }),

  theme: defaultTheme({
    logo: '/logo.png',

    navbar: [
      { text: '指南', link: '/guide/' },
      { text: '双后端', link: '/backend/' },
      { text: 'AI 能力', link: '/ai/' },
      { text: '发布运维', link: '/ops/release.md' },
      { text: '需求归档', link: '/product/' },
      { text: '参赛资料', link: '/contest/' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '入门',
          children: ['/guide/README.md', '/guide/quick-start.md'],
        },
        {
          text: '系统全貌',
          children: [
            '/guide/architecture.md',
            '/guide/data-model.md',
            '/guide/features.md',
          ],
        },
      ],
      '/backend/': [
        {
          text: '双后端',
          children: [
            '/backend/README.md',
            '/backend/migration-plan.md',
          ],
        },
      ],
      '/ai/': [
        {
          text: 'AI 能力',
          children: ['/ai/README.md'],
        },
      ],
      '/ops/': [
        {
          text: '发布与运维',
          children: ['/ops/release.md'],
        },
      ],
      '/product/': [
        {
          text: '需求文档归档',
          children: [
            '/product/README.md',
            '/product/phase1.md',
            '/product/phase2.md',
            '/product/phase1-2-patch.md',
            '/product/phase3.md',
            '/product/phase3-cloud.md',
          ],
        },
      ],
      '/contest/': [
        {
          text: '参赛资料',
          children: ['/contest/README.md'],
        },
      ],
    },

    // 右侧目录只到三级标题即可，需求文档层级很深，全展开会很长
    sidebarDepth: 2,
    editLink: false,
    contributors: false,
    lastUpdated: true,
    lastUpdatedText: '最后更新',
    notFound: ['页面不存在'],
    backToHome: '返回首页',
    toggleSidebar: '切换侧边栏',
  }),
})
