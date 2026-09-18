<template>
  <view class="page">
    <view class="doc">
      <text class="doc-title">初芽 用户协议</text>
      <text class="doc-meta">生效日期：2026 年 9 月 18 日</text>
      <text class="doc-lead">
        欢迎使用「初芽」。本协议是你与开发者之间就使用本小程序达成的约定，请在使用前仔细阅读。开始使用即表示你已阅读并同意本协议。
      </text>

      <view v-for="section in sections" :key="section.title" class="section">
        <text class="section-title">{{ section.title }}</text>
        <view v-for="(line, index) in section.lines" :key="index" class="line">
          <text class="line-text">{{ line }}</text>
        </view>
      </view>

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
 * 用户协议（补丁 Step 2，文档 5.1）。
 *
 * ⚠️ 内容由 Agent 起草，必须经人工复核后才可上线；
 * 开发者名称与联系邮箱留占位符，禁止编造。
 */
const DEVELOPER_NAME = '【待填写：开发者或公司名称】'
const CONTACT_EMAIL = '【待填写：联系邮箱】'

const sections = [
  {
    title: '一、服务内容',
    lines: [
      '1. 「初芽」是一款家庭育儿记录工具，帮助你记录宝宝的喂养、睡眠、便便、生长、疫苗接种与成长里程碑，并生成成长报告分享图。',
      '2. 本服务不提供任何医疗建议、诊断或治疗方案。疫苗推荐月龄、生长参考等信息仅供记录时参考，实际请以当地接种门诊与医生的意见、《预防接种证》为准。',
      '3. 本服务为期免费工具，开发者可能在不另行收费的前提下调整或优化功能。',
    ],
  },
  {
    title: '二、账号规则',
    lines: [
      '1. 一个手机号只能注册一个账号。请妥善保管你的账号与密码，因你自身保管不当造成的损失由你自行承担。',
      '2. 绑定真实邮箱后，你可以用手机号或邮箱任一方式登录；该邮箱同时用于接收密码重置邮件。请务必确认邮箱填写正确，否则将无法通过邮箱找回密码。',
      '3. 你可以随时注销账号。注销后与该账号相关的数据将被删除且不可恢复。',
    ],
  },
  {
    title: '三、你录入的内容',
    lines: [
      '1. 你录入的文字、照片等内容归你所有。你需保证对上传内容拥有合法权利，且内容不违反法律法规。',
      '2. 请勿上传与育儿记录无关的违法、侵权或他人隐私内容。',
      '3. 你理解并同意：记录数据存储于云端，开发者会尽力保障数据安全，但仍建议你定期使用「导出数据」功能自行备份。',
    ],
  },
  {
    title: '四、家庭共享与权限',
    lines: [
      '1. 你可以创建家庭，并通过邀请码邀请家人加入。家庭成员按创建者分配的角色（创建者 / 成员 / 只读成员）访问数据。',
      '2. 家庭内的记录对所有成员可见。请只邀请你信任的人加入。',
      '3. 创建者注销账号或删除家庭时，该家庭的全部数据（含其他成员上传的照片与记录）会一并删除，请提前确认。',
    ],
  },
  {
    title: '五、免责与责任限制',
    lines: [
      '1. 因不可抗力、网络故障、第三方平台（如云服务商、微信）服务中断等导致的服务不可用，开发者不承担责任。',
      '2. 你在使用本服务过程中依据记录数据做出的任何判断与决定，由你自行负责。',
      '3. 若你违反本协议或法律法规，开发者有权限制或终止你对本服务的使用。',
    ],
  },
  {
    title: '六、协议的变更',
    lines: [
      '本协议更新后，我们会在小程序内提示你重新阅读。若你继续使用，即视为接受更新后的协议。',
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

.contact {
  display: flex;
  flex-direction: column;
  margin-top: var(--space-xl);
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
