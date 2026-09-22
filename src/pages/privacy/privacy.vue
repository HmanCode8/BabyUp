<template>
  <view class="page">
    <view class="doc">
      <text class="doc-title">初芽 隐私政策</text>
      <text class="doc-meta">生效日期：2026 年 9 月 18 日</text>
      <text class="doc-lead">
        我们深知个人信息对你的重要性。本政策说明「初芽」小程序会收集哪些信息、如何使用与保护这些信息，以及你可以如何管理自己的信息。请在开始使用前仔细阅读。
      </text>

      <view v-for="section in sections" :key="section.title" class="section">
        <text class="section-title">{{ section.title }}</text>
        <view v-for="(line, index) in section.lines" :key="index" class="line">
          <text class="line-text">{{ line }}</text>
        </view>
      </view>

      <text class="doc-foot">如对本政策有疑问，可通过下方联系方式与我们沟通。</text>
      <view class="contact">
        <text class="contact-text">开发者：{{ DEVELOPER_NAME }}</text>
        <text class="contact-text">联系邮箱：{{ CONTACT_EMAIL }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { onShareAppMessage } from '@dcloudio/uni-app'
import { defaultShare } from '@/utils/share'
/**
 * 隐私政策（补丁 Step 2，文档 5.1）。
 *
 * ⚠️ 内容由 Agent 起草，必须经人工复核后才可上线：
 * 文档明确禁止编造监管机关备案号、禁止虚构客服电话，
 * 因此开发者名称与联系邮箱一律留成待填占位符。
 */
const DEVELOPER_NAME = '【待填写：开发者或公司名称】'
const CONTACT_EMAIL = '【待填写：联系邮箱】'

const sections = [
  {
    title: '一、我们收集哪些信息',
    lines: [
      '1. 账号信息：你注册时填写的手机号；你主动绑定的邮箱；使用微信一键登录时，微信返回的用户标识（openid）。我们不获取你的微信昵称、头像以外的其他微信资料，也不接触微信支付信息。',
      '2. 宝宝档案：你为宝宝填写的昵称、性别、出生日期、头像。',
      '3. 成长记录：你录入的喂养、睡眠、便便、生长（身高/体重）、疫苗接种、成长里程碑记录，以及你上传的照片。',
      '4. 运行日志：为了排查故障，我们会记录必要的错误日志与操作日志（如页面路径、错误信息）。日志中不包含照片内容，也不包含你在备注里填写的文字明细。',
      '5. 反馈信息：你通过「意见反馈」提交的问题描述、你主动上传的截图，以及你选填的联系方式。截图由你自行选择，可能包含你的手机界面信息，请在提交前确认。',
    ],
  },
  {
    title: '二、我们如何使用这些信息',
    lines: [
      '1. 提供记录、展示与统计功能，例如生成月度成长报告分享图。',
      '2. 在你所属的家庭内共享记录：家庭成员可以看到同一个家庭的记录，权限由家庭创建者分配。',
      '3. 提供账号服务：登录、绑定邮箱、找回密码、安全风控。',
      '4. 维护服务稳定与定位故障。',
      '5. 查看并处理你提交的反馈；仅在你填写了联系方式时，才会通过该联系方式回复你。反馈内容只有你本人和开发者可见，不会展示给其他用户。',
      '我们不会将你的信息出售给第三方，也不会用于广告投放。',
    ],
  },
  {
    title: '三、存储与安全',
    lines: [
      '1. 数据存储于腾讯云（微信云开发）提供的云端数据库与对象存储服务。',
      '2. 数据按家庭做权限隔离：所有数据读写都经服务端校验，每个账号只能访问自己所属家庭的数据，其它账号即使知道数据编号也无法读取。',
      '3. 照片存放于云端对象存储，文件标识不对公众公开；查看照片时由云服务签发有效期 2 小时的临时链接，链接过期后自动失效。',
      '4. 前端代码中不包含任何可直接访问数据库的凭证，所有涉及权限的操作都在服务端完成。',
    ],
  },
  {
    title: '四、儿童个人信息保护',
    lines: [
      '1. 本产品由监护人使用并录入儿童信息，请在取得监护人同意后录入。',
      '2. 我们只收集实现记录功能所必需的最少信息，不收集儿童的人脸、指纹等生物识别信息，也不采集儿童的声音。',
      '3. 监护人对儿童信息享有查询、更正、删除与导出的权利，可通过「我的 - 账号与安全」行使。',
      '4. 若你认为我们不当处理了儿童信息，可通过下方联系方式联系我们，我们会尽快核实并处理。',
    ],
  },
  {
    title: '五、你的权利：导出与注销',
    lines: [
      '1. 导出：你可以将所属家庭的记录导出为文件，自行保存或备份。',
      '2. 注销：你可以随时注销账号。注销后与该账号相关的数据将被删除且无法恢复。',
      '3. 请注意：如果你是家庭的创建者，注销账号会同时删除该家庭的全部数据（包括其他家庭成员上传的照片与记录）。',
    ],
  },
  {
    title: '六、政策更新',
    lines: [
      '本政策更新后，我们会在小程序内提示你重新阅读。若你继续使用，即视为接受更新后的政策。',
    ],
  },
]

// 补丁 Step 4：统一分享卡片（标题与落地页见 @/utils/share）
onShareAppMessage(() => defaultShare())
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: var(--space-lg);
  box-sizing: border-box;
  background-color: var(--color-bg-page);
}

.doc {
  padding: var(--space-lg);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.doc-title {
  display: block;
  font-size: 38rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.doc-meta {
  display: block;
  margin-top: var(--space-xs);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.doc-lead {
  display: block;
  margin-top: var(--space-md);
  font-size: 27rpx;
  line-height: 1.7;
  color: var(--color-text-sub);
}

.section {
  margin-top: var(--space-xl);
}

.section-title {
  display: block;
  margin-bottom: var(--space-sm);
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.line {
  margin-top: var(--space-sm);
}

.line-text {
  font-size: 27rpx;
  line-height: 1.75;
  color: var(--color-text-sub);
}

.doc-foot {
  display: block;
  margin-top: var(--space-xl);
  font-size: 27rpx;
  color: var(--color-text-sub);
}

.contact {
  display: flex;
  flex-direction: column;
  margin-top: var(--space-sm);
  padding: var(--space-md);
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-md);
}

.contact-text {
  font-size: 26rpx;
  line-height: 1.8;
  color: var(--color-primary-deep);
}
</style>
