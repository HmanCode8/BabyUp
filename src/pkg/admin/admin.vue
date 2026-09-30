<template>
  <view class="page">
    <!-- 进不来就只说清楚为什么：后端不支持 / 不是运维 -->
    <view v-if="blocked" class="app-card">
      <text class="blocked-title">无法访问运维后台</text>
      <text class="blocked-desc">{{ blocked }}</text>
    </view>

    <template v-else>
      <view class="tabs">
        <view
          v-for="item in TABS"
          :key="item.key"
          class="tab"
          :class="{ 'tab--on': tab === item.key }"
          @click="switchTab(item.key)"
        >
          <text class="tab-text" :class="{ 'tab-text--on': tab === item.key }">{{ item.label }}</text>
        </view>
      </view>

      <!-- ================= 运维概览 ================= -->
      <template v-if="tab === 'overview'">
        <!-- 有人提了反馈还没回：放在最前面，免得要靠自己想起来去翻那个页签 -->
        <view v-if="overview && overview.pendingFeedbackCount" class="app-card card--todo">
          <view class="card-head">
            <text class="section-title">待处理意见反馈</text>
            <text class="card-head-value card-head-value--warn">
              {{ overview.pendingFeedbackCount }} 条
            </text>
          </view>
          <text class="hint">有家长提了反馈还没回复，去看内容并写一句回复。</text>
          <view class="fam-actions">
            <view class="app-button fam-btn" @click="switchTab('feedback')">
              <text class="fam-btn-text">去处理</text>
            </view>
          </view>
        </view>

        <view class="app-card">
          <view class="card-head">
            <text class="section-title">统计窗口</text>
            <view class="days">
              <view
                v-for="item in DAY_OPTIONS"
                :key="item"
                class="day-chip"
                :class="{ 'day-chip--on': days === item }"
                @click="onPickDays(item)"
              >
                <text class="day-chip-text" :class="{ 'day-chip-text--on': days === item }">
                  {{ item }} 天
                </text>
              </view>
            </view>
          </view>
          <text class="hint">数据口径：北京时间自然日；记录类按 created_at 归日。</text>
        </view>

        <view class="app-card">
          <text class="section-title">规模</text>
          <view class="grid">
            <view v-for="item in scaleItems" :key="item.key" class="grid-item">
              <text class="grid-num">{{ item.count }}</text>
              <text class="grid-label">{{ item.label }}</text>
            </view>
          </view>
        </view>

        <view class="app-card">
          <text class="section-title">近 {{ days }} 天</text>
          <view class="grid">
            <view v-for="item in metricItems" :key="item.key" class="grid-item">
              <text class="grid-num">{{ item.value }}</text>
              <text class="grid-label">{{ item.label }}</text>
            </view>
          </view>
        </view>

        <view class="app-card">
          <text class="section-title">按天分布</text>
          <view class="legend">
            <view class="legend-item">
              <view class="dot dot--record" />
              <text class="legend-text">记录</text>
            </view>
            <view class="legend-item">
              <view class="dot dot--ai" />
              <text class="legend-text">AI 问答</text>
            </view>
          </view>
          <view class="chart">
            <view v-for="item in dayList" :key="item.day" class="chart-col">
              <view class="chart-bars">
                <view class="bar bar--record" :style="{ height: barHeight(item.records) }" />
                <view class="bar bar--ai" :style="{ height: barHeight(item.ai) }" />
              </view>
              <text class="chart-label">{{ item.day.slice(8) }}</text>
            </view>
          </view>
        </view>

        <view class="app-card">
          <text class="section-title">记录构成</text>
          <view v-for="item in recordTypes" :key="item.label" class="line">
            <text class="line-label">{{ item.label }}</text>
            <text class="line-value">{{ item.count }}</text>
          </view>
          <text v-if="!recordTypes.length" class="hint">这段时间没有记录。</text>
        </view>

        <view class="app-card">
          <text class="section-title">行为事件</text>
          <view v-for="item in actionRows" :key="item.name" class="line">
            <text class="line-label">{{ item.name }}</text>
            <text class="line-value">{{ item.count }}</text>
          </view>
          <text v-if="!actionRows.length" class="hint">这段时间没有行为埋点。</text>
        </view>

        <view class="app-card">
          <view class="card-head">
            <text class="section-title">报错</text>
            <text class="card-head-value">近 {{ days }} 天 {{ errorTotal }} 条</text>
          </view>
          <!-- 先看分组：一次刷屏的报错往往就一两个原因，比逐条读有用 -->
          <text v-if="errorGroups.length" class="sub-title">按原因分组</text>
          <view v-for="(item, index) in errorGroups" :key="`g${index}`" class="error-item">
            <view class="error-head">
              <text class="error-name">{{ item.name }} · {{ item.count }} 次</text>
              <text class="error-time">{{ shortTime(item.lastAt) }}</text>
            </view>
            <text v-if="item.page" class="error-page">{{ item.page }}</text>
            <text v-if="item.message" class="error-msg">{{ item.message }}</text>
          </view>

          <text v-if="errors.length" class="sub-title">最近 {{ errors.length }} 条明细</text>
          <view v-for="(item, index) in errors" :key="index" class="error-item">
            <view class="error-head">
              <text class="error-name">{{ item.name }}</text>
              <text class="error-time">{{ shortTime(item.at) }}</text>
            </view>
            <text v-if="item.page" class="error-page">{{ item.page }}</text>
            <text v-if="item.message" class="error-msg">{{ item.message }}</text>
          </view>
          <text v-if="!errors.length" class="hint">这段时间没有报错，很干净。</text>
        </view>
      </template>

      <!-- ================= 家庭与权限 ================= -->
      <template v-else-if="tab === 'family'">
        <!-- 全局功能开关：整个小程序生效，出问题时的紧急闸门 -->
        <view class="app-card">
          <view class="card-head">
            <text class="section-title">全局功能开关</text>
            <text class="card-head-value">整个小程序</text>
          </view>
          <text class="hint">
            关掉后所有家庭的对应入口都会消失。只让某一家的例外，用下面那张卡里的「功能开关」。
          </text>
          <view v-for="item in catalog" :key="item.key" class="flag-row">
            <view class="flag-main">
              <text class="flag-label">{{ item.label }}</text>
              <text class="flag-desc">{{ item.desc }}</text>
            </view>
            <switch
              :checked="globals[item.key] !== false"
              color="#ff8f6b"
              :disabled="saving"
              @change="onToggleGlobal(item, $event)"
            />
          </view>
        </view>

        <view v-for="item in families" :key="item.id" class="app-card">
          <view class="fam-head">
            <text class="fam-name">{{ item.name }}</text>
            <text class="fam-tier" :class="tierClass(item)">{{ tierText(item) }}</text>
          </view>
          <view class="line">
            <text class="line-label">成员 / 宝宝</text>
            <text class="line-value">{{ item.memberCount }} 人 · {{ item.babies.length }} 个</text>
          </view>
          <view class="line">
            <text class="line-label">家庭管理员</text>
            <text class="line-value">{{ ownerText(item) }}</text>
          </view>
          <view class="line">
            <text class="line-label">宝宝</text>
            <text class="line-value">{{ item.babies.join('、') || '—' }}</text>
          </view>
          <view class="line">
            <text class="line-label">记录 / 最近</text>
            <text class="line-value">
              {{ item.records }} 条 · {{ item.lastRecordAt ? shortTime(item.lastRecordAt) : '无' }}
            </text>
          </view>
          <view class="line">
            <text class="line-label">创建时间</text>
            <text class="line-value">{{ shortTime(item.createdAt) }}</text>
          </view>
          <!-- 这家的开关覆盖（只显示与全局不一致的那几项） -->
          <view v-if="overrideText(item)" class="line">
            <text class="line-label">开关例外</text>
            <text class="line-value line-value--warn">{{ overrideText(item) }}</text>
          </view>

          <view class="fam-actions">
            <view class="app-button fam-btn" @click="openMembers(item)">
              <text class="fam-btn-text">管成员</text>
            </view>
            <view class="app-button app-button--ghost fam-btn" @click="openFlagEditor(item)">
              <text class="fam-btn-text fam-btn-text--ghost">功能开关</text>
            </view>
            <view
              v-if="membershipEnabled"
              class="app-button app-button--ghost fam-btn"
              @click="openEditor(item)"
            >
              <text class="fam-btn-text fam-btn-text--ghost">改档位</text>
            </view>
          </view>
          <!-- 删家庭单独一行、靠右：它是不可撤销的，不跟日常操作挤在一起 -->
          <view class="fam-actions fam-actions--end">
            <view
              class="app-button app-button--ghost fam-btn fam-btn--danger"
              @click="openDeleter(item)"
            >
              <text class="fam-btn-text fam-btn-text--danger">删除家庭</text>
            </view>
          </view>
        </view>
        <view v-if="!families.length" class="app-card">
          <text class="hint">还没有任何家庭。</text>
        </view>
      </template>

      <!-- ================= 全部成员 ================= -->
      <template v-else-if="tab === 'members'">
        <view class="app-card">
          <view class="card-head">
            <text class="section-title">全部成员</text>
            <text class="card-head-value">{{ users.length }} 人</text>
          </view>
          <text class="hint">
            权限只有两层：超级管理员（{{ superAdminCount }} 人，写死在代码里，管所有家庭）与家庭创建者
            （只管自己那一个家，就是各家的「管理员」）。这一页只是看谁在用 ——
            要管某个家的人，去「家庭与权限」那张卡上点「管成员」。
          </text>
        </view>

        <view v-for="item in users" :key="item.userId" class="app-card">
          <view class="fam-head">
            <text class="fam-name">{{ item.nickname || '未设昵称' }}</text>
            <text class="role-badge" :class="roleClass(item)">{{ roleText(item) }}</text>
          </view>
          <view class="line">
            <text class="line-label">账号</text>
            <text class="line-value">…{{ item.shortId }}</text>
          </view>
          <view class="line">
            <text class="line-label">所在家庭</text>
            <text class="line-value">{{ familyText(item) }}</text>
          </view>
          <view class="line">
            <text class="line-label">加入时间</text>
            <text class="line-value">{{ shortTime(item.joinedAt) }}</text>
          </view>
        </view>
        <view v-if="!users.length" class="app-card">
          <text class="hint">还没有任何用户。</text>
        </view>
      </template>

      <!-- ================= 意见反馈 ================= -->
      <template v-else-if="tab === 'feedback'">
        <view class="app-card">
          <view class="card-head">
            <text class="section-title">意见反馈</text>
            <text class="card-head-value">
              待处理 {{ feedbackPendingCount }} 条 · 共 {{ feedbackTotalCount }} 条
            </text>
          </view>
          <text class="hint">
            这里能看到所有人提交的反馈（普通用户只看得到自己那几条）。处理时写的那句话，会显示在
            提交人的「我的 → 意见反馈」里。
          </text>
          <view class="seg seg--tight">
            <view
              class="seg-item"
              :class="{ 'seg-item--on': feedbackFilter === 'pending' }"
              @click="onPickFeedbackFilter('pending')"
            >
              <text
                class="seg-text seg-text--small"
                :class="{ 'seg-text--on': feedbackFilter === 'pending' }"
              >
                待处理
              </text>
            </view>
            <view
              class="seg-item"
              :class="{ 'seg-item--on': feedbackFilter === 'done' }"
              @click="onPickFeedbackFilter('done')"
            >
              <text
                class="seg-text seg-text--small"
                :class="{ 'seg-text--on': feedbackFilter === 'done' }"
              >
                已处理
              </text>
            </view>
            <view
              class="seg-item"
              :class="{ 'seg-item--on': feedbackFilter === 'all' }"
              @click="onPickFeedbackFilter('all')"
            >
              <text
                class="seg-text seg-text--small"
                :class="{ 'seg-text--on': feedbackFilter === 'all' }"
              >
                全部
              </text>
            </view>
          </view>
        </view>

        <view v-for="item in feedbacks" :key="item.id" class="app-card">
          <view class="fam-head">
            <text class="fam-name">{{ feedbackTypeLabel(item.type) }}</text>
            <text class="fb-status" :class="{ 'fb-status--done': item.status === 'done' }">
              {{ item.status === 'done' ? '已处理' : '待处理' }}
            </text>
          </view>
          <text class="fb-content">{{ item.content }}</text>
          <view v-if="item.thumbs.length" class="fb-shots">
            <image
              v-for="(thumb, index) in item.thumbs"
              :key="thumb.path"
              class="fb-shot"
              :src="thumb.url"
              mode="aspectFill"
              lazy-load
              @click="previewFeedbackShot(item, index)"
            />
          </view>
          <view v-if="item.contact" class="line">
            <text class="line-label">联系方式</text>
            <text class="line-value">{{ item.contact }}</text>
          </view>
          <view class="line">
            <text class="line-label">提交人</text>
            <text class="line-value">…{{ item.shortId }} · {{ shortTime(item.createdAt) }}</text>
          </view>
          <view v-if="item.reply" class="line">
            <text class="line-label">我的回复</text>
            <text class="line-value line-value--warn">{{ item.reply }}</text>
          </view>
          <view class="fam-actions">
            <view class="app-button fam-btn" @click="openFeedback(item)">
              <text class="fam-btn-text">{{ item.status === 'done' ? '改状态 / 回复' : '处理' }}</text>
            </view>
          </view>
        </view>

        <view v-if="!feedbacks.length && !loading" class="app-card">
          <text class="hint">
            {{ feedbackFilter === 'pending' ? '没有待处理的反馈。' : '没有反馈。' }}
          </text>
        </view>
      </template>

      <!-- ================= 开通码 ================= -->
      <template v-else>
        <view class="app-card">
          <view class="card-head">
            <text class="section-title">开通码台账</text>
            <text class="card-head-value">
              未用 {{ codeUnusedCount }} · 已用 {{ codeUsedCount }} · 共 {{ codeTotalCount }}
            </text>
          </view>
          <text class="hint">
            「一码一用」：兑换时服务端先把这个码占下来，同一个码开不了第二家。
            作废只拦得住还没兑换的码 —— 已经开通出去的会员要收回，得去「家庭」页签改那一家的档位。
          </text>
          <text class="hint">
            复制：点「复制码」一键拿走（首次会弹隐私授权）；也可以长按码值手动选中复制。
          </text>
          <view class="seg seg--tight">
            <view
              v-for="item in CODE_FILTERS"
              :key="item.key"
              class="seg-item"
              :class="{ 'seg-item--on': codeFilter === item.key }"
              @click="onPickCodeFilter(item.key)"
            >
              <text
                class="seg-text seg-text--small"
                :class="{ 'seg-text--on': codeFilter === item.key }"
              >
                {{ item.label }}
              </text>
            </view>
          </view>
          <view class="fam-actions">
            <view class="app-button fam-btn" @click="openCodeCreator">
              <text class="fam-btn-text">生成新码</text>
            </view>
          </view>
        </view>

        <view v-for="item in codes" :key="item.id" class="app-card">
          <view class="fam-head">
            <!-- selectable 是 uni-app 的写法；user-select 是微信现在的写法（selectable 自基础库 2.12.1 起已废弃），两个都写 -->
            <text class="code-value" selectable :user-select="true">{{ item.code }}</text>
            <text class="fam-tier" :class="codeStatusClass(item)">{{ codeStatusText(item) }}</text>
          </view>
          <view class="line">
            <text class="line-label">有效天数</text>
            <text class="line-value">{{ item.days ? `${item.days} 天` : '永久' }}</text>
          </view>
          <view class="line">
            <text class="line-label">备注</text>
            <text class="line-value">{{ item.note || '—' }}</text>
          </view>
          <view class="line">
            <text class="line-label">生成时间</text>
            <text class="line-value">{{ shortTime(item.createdAt) }}</text>
          </view>
          <view v-if="item.usedAt" class="line">
            <text class="line-label">兑换时间</text>
            <text class="line-value">{{ shortTime(item.usedAt) }}</text>
          </view>
          <view class="fam-actions">
            <view class="app-button app-button--ghost fam-btn" @click="onCopyCode(item)">
              <text class="fam-btn-text fam-btn-text--ghost">复制码</text>
            </view>
            <view
              v-if="item.status === 'unused'"
              class="app-button app-button--ghost fam-btn"
              @click="onSetCodeStatus(item, 'void')"
            >
              <text class="fam-btn-text fam-btn-text--ghost">作废</text>
            </view>
            <view
              v-if="item.status === 'void'"
              class="app-button app-button--ghost fam-btn"
              @click="onSetCodeStatus(item, 'unused')"
            >
              <text class="fam-btn-text fam-btn-text--ghost">恢复</text>
            </view>
          </view>
        </view>

        <view v-if="!codes.length && !loading" class="app-card">
          <text class="hint">
            {{ codeFilter === 'unused' ? '没有可用的开通码，点上面「生成新码」。' : '这个筛选下没有开通码。' }}
          </text>
        </view>
      </template>

      <text v-if="errorText" class="error">{{ errorText }}</text>
      <text v-if="loading" class="hint loading">加载中…</text>
    </template>

    <!-- 改档位 -->
    <view v-if="editor" class="mask" @click="editor = null">
      <view class="sheet" @click.stop>
        <text class="sheet-title">修改权益档位</text>
        <text class="sheet-sub">{{ editor.name }}</text>

        <view class="seg">
          <view
            class="seg-item"
            :class="{ 'seg-item--on': editorTier === 'free' }"
            @click="editorTier = 'free'"
          >
            <text class="seg-text" :class="{ 'seg-text--on': editorTier === 'free' }">免费版</text>
          </view>
          <view
            class="seg-item"
            :class="{ 'seg-item--on': editorTier === 'member' }"
            @click="editorTier = 'member'"
          >
            <text class="seg-text" :class="{ 'seg-text--on': editorTier === 'member' }">会员</text>
          </view>
        </view>

        <template v-if="editorTier === 'member'">
          <text class="hint">到期日留空 = 永久有效；到期当晚 23:59:59 前都还能用。</text>
          <view class="until-row">
            <picker mode="date" :value="editorUntil" @change="onPickUntil">
              <view class="until-input">
                <text class="until-text">{{ editorUntil || '永久（留空）' }}</text>
              </view>
            </picker>
            <view class="app-button app-button--ghost clear-btn" @click="editorUntil = ''">
              <text class="clear-text">清空</text>
            </view>
          </view>
          <view class="quick">
            <view v-for="item in QUICK_DAYS" :key="item" class="quick-chip" @click="editorUntil = addDays(item)">
              <text class="quick-text">{{ item }} 天</text>
            </view>
          </view>
        </template>

        <view class="sheet-actions">
          <view class="app-button app-button--ghost sheet-btn" @click="editor = null">
            <text class="sheet-btn-text sheet-btn-text--ghost">取消</text>
          </view>
          <view
            class="app-button sheet-btn"
            :class="{ 'app-button--disabled': saving }"
            @click="onSaveTier"
          >
            <text class="sheet-btn-text">{{ saving ? '保存中…' : '保存' }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 某一家单独的功能开关（覆盖全局） -->
    <view v-if="flagEditor" class="mask" @click="flagEditor = null">
      <view class="sheet" @click.stop>
        <text class="sheet-title">这家的功能开关</text>
        <text class="sheet-sub">{{ flagEditor.name }}</text>
        <text class="hint">「跟随全局」表示不做例外；改这里只影响这一家。</text>

        <view v-for="item in catalog" :key="item.key" class="flag-edit">
          <text class="flag-label">{{ item.label }}</text>
          <view class="seg seg--tight">
            <view
              class="seg-item"
              :class="{ 'seg-item--on': familyFlagValue(item.key) === null }"
              @click="onSetFamilyFlag(item.key, null)"
            >
              <text class="seg-text seg-text--small" :class="{ 'seg-text--on': familyFlagValue(item.key) === null }">
                跟随全局
              </text>
            </view>
            <view
              class="seg-item"
              :class="{ 'seg-item--on': familyFlagValue(item.key) === true }"
              @click="onSetFamilyFlag(item.key, true)"
            >
              <text class="seg-text seg-text--small" :class="{ 'seg-text--on': familyFlagValue(item.key) === true }">
                开
              </text>
            </view>
            <view
              class="seg-item"
              :class="{ 'seg-item--on': familyFlagValue(item.key) === false }"
              @click="onSetFamilyFlag(item.key, false)"
            >
              <text class="seg-text seg-text--small" :class="{ 'seg-text--on': familyFlagValue(item.key) === false }">
                关
              </text>
            </view>
          </view>
          <text class="flag-state">当前生效：{{ effectiveFlagText(item.key) }}</text>
        </view>
      </view>
    </view>

    <!-- 删除家庭：要求手输家庭名，不可撤销 -->
    <view v-if="deleter" class="mask" @click="deleter = null">
      <view class="sheet" @click.stop>
        <text class="sheet-title">删除家庭</text>
        <text class="sheet-sub">{{ deleter.name }}</text>
        <text class="danger-note">
          会一并删掉 {{ deleter.memberCount }} 名成员关系、{{ deleter.babies.length }} 个宝宝档案、
          {{ deleter.records }} 条记录，以及对应的照片文件。这一步不可撤销。
        </text>
        <text class="hint">账号本身、以及成员在别的家庭的记录都不受影响；某个人唯一的家不允许删。</text>
        <input
          class="code-input"
          :value="deleteText"
          maxlength="40"
          :disabled="deleting"
          placeholder="输入家庭名以确认"
          placeholder-class="code-placeholder"
          @input="deleteText = $event.detail.value"
        />
        <view class="sheet-actions">
          <view class="app-button app-button--ghost sheet-btn" @click="closeDeleter">
            <text class="sheet-btn-text sheet-btn-text--ghost">取消</text>
          </view>
          <view
            class="app-button sheet-btn sheet-btn--danger"
            :class="{ 'app-button--disabled': deleting || !canDelete }"
            @click="onDeleteFamily"
          >
            <text class="sheet-btn-text">{{ deleting ? '删除中…' : '确认删除' }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 某个家庭的成员管理（超管对任意家庭） -->
    <view v-if="memberSheet" class="mask" @click="memberSheet = null">
      <view class="sheet" @click.stop>
        <text class="sheet-title">家庭成员</text>
        <text class="sheet-sub">{{ memberSheet.familyName }}</text>
        <text class="hint">
          创建者就是这家的家庭管理员，他被保护着：改不了角色、也移不出去。要换人得用「设为创建者」。
        </text>

        <view v-for="item in members" :key="item.id" class="member-row">
          <view class="member-main">
            <text class="member-name">{{ memberLabel(item) }}</text>
            <text class="member-sub">
              {{ roleOfMember(item) }} · 加入 {{ shortTime(item.joinedAt) }}
            </text>
          </view>
          <text v-if="isOwnerMember(item)" class="member-tag">受保护</text>
          <view v-else class="member-op" @click="memberTarget = item">
            <text class="member-op-text">调整</text>
          </view>
        </view>

        <text v-if="membersLoading" class="hint">加载中…</text>
        <text v-if="!members.length && !membersLoading" class="hint">这个家还没有成员。</text>

        <view class="sheet-actions">
          <view class="app-button app-button--ghost sheet-btn" @click="memberSheet = null">
            <text class="sheet-btn-text sheet-btn-text--ghost">关闭</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 对单个成员的操作 -->
    <view v-if="memberTarget" class="mask mask--top" @click="memberTarget = null">
      <view class="sheet" @click.stop>
        <text class="sheet-title">{{ memberTarget.nickname || '未设昵称' }}</text>
        <text class="sheet-sub">{{ memberSheet ? memberSheet.familyName : '' }} · 家庭成员</text>

        <view class="opt-list">
          <view
            class="opt-row"
            :class="{ 'opt-row--on': memberTarget.role === 'member' }"
            @click="onSetRole(memberTarget, 'member')"
          >
            <view class="opt-main">
              <text class="opt-text">成员</text>
              <text class="opt-desc">可以新增和编辑记录</text>
            </view>
            <text v-if="memberTarget.role === 'member'" class="opt-check">当前</text>
          </view>
          <view
            class="opt-row"
            :class="{ 'opt-row--on': memberTarget.role === 'viewer' }"
            @click="onSetRole(memberTarget, 'viewer')"
          >
            <view class="opt-main">
              <text class="opt-text">只读</text>
              <text class="opt-desc">只能查看，不能修改</text>
            </view>
            <text v-if="memberTarget.role === 'viewer'" class="opt-check">当前</text>
          </view>
          <view class="opt-row" @click="openTransfer(memberTarget)">
            <view class="opt-main">
              <text class="opt-text">设为这个家的创建者</text>
              <text class="opt-desc">原创建者会降为成员，并失去发邀请码、改家庭名的能力</text>
            </view>
          </view>
          <view class="opt-row" @click="onRemoveMember(memberTarget)">
            <view class="opt-main">
              <text class="opt-text opt-text--danger">移出这个家庭</text>
              <text class="opt-desc">他记过的内容仍留在这个家</text>
            </view>
          </view>
        </view>

        <view class="sheet-actions">
          <view class="app-button app-button--ghost sheet-btn" @click="memberTarget = null">
            <text class="sheet-btn-text sheet-btn-text--ghost">取消</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 转移创建者：要求手输家庭名，不可撤销 -->
    <view v-if="transferTarget" class="mask mask--top" @click="closeTransfer">
      <view class="sheet" @click.stop>
        <text class="sheet-title">转移创建者</text>
        <text class="sheet-sub">
          {{ transferTarget.familyName }} → {{ transferTarget.memberName }}
        </text>
        <text class="danger-note">
          转完之后原创建者降为「成员」，立刻失去发邀请码与改家庭名的能力；新创建者成为这个家的
          家庭管理员。这一步不可撤销。
        </text>
        <input
          class="code-input"
          :value="transferText"
          maxlength="40"
          :disabled="transferring"
          placeholder="输入家庭名以确认"
          placeholder-class="code-placeholder"
          @input="transferText = $event.detail.value"
        />
        <view class="sheet-actions">
          <view class="app-button app-button--ghost sheet-btn" @click="closeTransfer">
            <text class="sheet-btn-text sheet-btn-text--ghost">取消</text>
          </view>
          <view
            class="app-button sheet-btn sheet-btn--danger"
            :class="{ 'app-button--disabled': transferring || !canTransfer }"
            @click="onTransferOwner"
          >
            <text class="sheet-btn-text">{{ transferring ? '转移中…' : '确认转移' }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 处理意见反馈：改状态 + 写一句给提交人看的回复 -->
    <view v-if="feedbackEditor" class="mask mask--top" @click="feedbackEditor = null">
      <view class="sheet" @click.stop>
        <text class="sheet-title">处理反馈</text>
        <text class="sheet-sub">{{ feedbackTypeLabel(feedbackEditor.type) }}</text>

        <view class="quote">
          <text class="quote-text">{{ feedbackEditor.content }}</text>
        </view>
        <view v-if="feedbackEditor.contact" class="line">
          <text class="line-label">联系方式</text>
          <text class="line-value">{{ feedbackEditor.contact }}</text>
        </view>

        <text class="hint">
          回复会显示在提交人的「我的 → 意见反馈」里；留空就只改状态、不写回复。
        </text>
        <textarea
          class="reply-input"
          :maxlength="FEEDBACK_REPLY_MAX"
          :value="feedbackReply"
          :disabled="saving"
          placeholder="写一句回复（选填）"
          placeholder-class="code-placeholder"
          @input="feedbackReply = $event.detail.value"
        />

        <view class="sheet-actions">
          <view
            class="app-button app-button--ghost sheet-btn"
            :class="{ 'app-button--disabled': saving }"
            @click="onSetFeedbackStatus('pending')"
          >
            <text class="sheet-btn-text sheet-btn-text--ghost">标回待处理</text>
          </view>
          <view
            class="app-button sheet-btn"
            :class="{ 'app-button--disabled': saving }"
            @click="onSetFeedbackStatus('done')"
          >
            <text class="sheet-btn-text">{{ saving ? '保存中…' : '标记已处理' }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 生成开通码：一码一用，生成后整批复制到剪贴板 -->
    <view v-if="codeCreator" class="mask mask--top" @click="codeCreator = false">
      <view class="sheet" @click.stop>
        <text class="sheet-title">生成开通码</text>
        <text class="sheet-sub">一码一用，生成后发给对方家庭的创建者</text>

        <text class="hint">数量（1 ~ 100）</text>
        <input
          class="code-input"
          type="number"
          :value="codeCount"
          :disabled="saving"
          @input="codeCount = $event.detail.value"
        />

        <text class="hint">有效天数（0 = 永久）</text>
        <input
          class="code-input"
          type="number"
          :value="codeDays"
          :disabled="saving"
          @input="codeDays = $event.detail.value"
        />
        <view class="quick">
          <view
            v-for="item in CODE_DAY_PRESETS"
            :key="item"
            class="quick-chip"
            @click="codeDays = String(item)"
          >
            <text class="quick-text">{{ item === 0 ? '永久' : `${item} 天` }}</text>
          </view>
        </view>

        <text class="hint">备注（发给谁，方便以后对账）</text>
        <input
          class="code-input"
          :value="codeNote"
          maxlength="50"
          :disabled="saving"
          placeholder="例：给表姐（选填）"
          placeholder-class="code-placeholder"
          @input="codeNote = $event.detail.value"
        />

        <view class="sheet-actions">
          <view class="app-button app-button--ghost sheet-btn" @click="codeCreator = false">
            <text class="sheet-btn-text sheet-btn-text--ghost">关闭</text>
          </view>
          <view
            class="app-button sheet-btn"
            :class="{ 'app-button--disabled': saving }"
            @click="onCreateCodes"
          >
            <text class="sheet-btn-text">{{ saving ? '生成中…' : '生成并复制' }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { api, capabilities } from '@/services/api'
import { ensureMembership, isSuperAdmin } from '@/services/membership'
import { ensureFlags } from '@/services/flags'
import { FEEDBACK_TYPE_LABEL } from '@/pkg/services/feedback'
import { formatDateTime } from '@/utils/date'
import { ensurePageAccess } from '@/utils/routeGuard'
import { ensurePrivacyAuthorized } from '@/utils/privacy'

const PAGE_PATH = 'pkg/admin/admin'

const DAY_OPTIONS = [7, 14, 30]
const QUICK_DAYS = [30, 90, 365]

/**
 * 五个页签；key 同时是 switchTab 的分支依据。
 * 标签刻意用短词（最长 3 个字）：底栏是 5 等分的 flex，长标签会挤成两行，
 * 完整名字写在每个页签里的 section-title 上。
 */
const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'family', label: '家庭' },
  { key: 'codes', label: '开通码' },
  { key: 'members', label: '成员' },
  { key: 'feedback', label: '反馈' },
]

/** 开通码台账的筛选项 */
const CODE_FILTERS = [
  { key: 'unused', label: '未用' },
  { key: 'used', label: '已用' },
  { key: 'void', label: '已作废' },
  { key: 'all', label: '全部' },
]

/** 生成弹层里的天数快捷键（0 = 永久） */
const CODE_DAY_PRESETS = [0, 7, 30, 90, 365]

/** 与 data 云函数的 FEEDBACK_MAX_REPLY 保持一致 */
const FEEDBACK_REPLY_MAX = 200

/** 行为事件名的中文名；没配到的直接显示原始名，别为了好看把排障信息藏起来 */
const EVENT_LABELS = {
  record_created: '新建记录',
  first_record: '首次记录',
  share: '分享卡片',
  report_generate: '生成成长报告',
  daily_card_generate: '生成每日卡片',
  family_created: '创建家庭',
  photo_upload_fail: '照片上传失败',
}

const store = useAuthStore()

const tab = ref('overview')
const blocked = ref('')
const loading = ref(false)
const errorText = ref('')
const days = ref(7)

const overview = ref(null)
const families = ref([])
const membershipEnabled = ref(false)

/** 开通码台账 */
const codeFilter = ref('unused')
const codes = ref([])
const codeTotalCount = ref(0)
const codeUnusedCount = ref(0)
const codeUsedCount = ref(0)
/** 生成弹层的开关与三个输入 */
const codeCreator = ref(false)
const codeCount = ref('1')
const codeDays = ref('30')
const codeNote = ref('')

const editor = ref(null)
const editorTier = ref('free')
const editorUntil = ref('')
const saving = ref(false)

/** 功能开关：清单 + 全局现状（服务端下发，前端不写死有哪些开关） */
const catalog = ref([])
const globals = ref({})
/** 正在改开关的那一家：{ id, name } */
const flagEditor = ref(null)
/** 正在编辑的这家的覆盖值（本地即时反馈，服务端返回后以服务端为准） */
const flagEditorFlags = ref({})

/** 正在确认删除的那一家 */
const deleter = ref(null)
const deleteText = ref('')
const deleting = ref(false)

/** 全部成员一览（只读）+ 超管数量 */
const users = ref([])
const superAdminCount = ref(0)

/**
 * 家庭成员管理面板。
 *
 * 权限只有两层，所以这个面板超管能对**任意家庭**打开，
 * 而家庭创建者是走小程序里「我的 → 家庭」那一套（同一个 assertOwner 规则）。
 * 弹层里动不了的只有创建者本人：改不了角色、移不出，要换人得用「转移创建者」。
 */
const memberSheet = ref(null)
const members = ref([])
const membersLoading = ref(false)
/** 正在操作的成员（弹出角色选择） */
const memberTarget = ref(null)
/** 正在转移创建者：{ familyId, familyName, memberId, memberName } */
const transferTarget = ref(null)
const transferText = ref('')
const transferring = ref(false)

/**
 * 意见反馈页签。
 *
 * 反馈是账号维度的（没有家庭），普通用户只看得到自己提交的，这里看全部。
 * filter 是 'pending' | 'done' | 'all'，对应服务端的 ''（不筛）。
 */
const feedbacks = ref([])
const feedbackFilter = ref('pending')
const feedbackPendingCount = ref(0)
const feedbackTotalCount = ref(0)
/** 正在处理的那条：{ id, type, content, contact, status } */
const feedbackEditor = ref(null)
const feedbackReply = ref('')

const dayList = computed(() => (overview.value && overview.value.dayList) || [])
const errors = computed(() => (overview.value && overview.value.errors) || [])
const errorGroups = computed(() => (overview.value && overview.value.errorGroups) || [])
const errorTotal = computed(() => (overview.value && overview.value.errorTotal) || 0)
const recordTypes = computed(() =>
  ((overview.value && overview.value.recordByType) || []).filter((item) => item.count > 0),
)
const actionRows = computed(() => {
  const rows = (overview.value && overview.value.actionByName) || []
  return rows
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((item) => ({ name: EVENT_LABELS[item.name] || item.name, count: item.count }))
})

const scaleItems = computed(() => {
  const scale = (overview.value && overview.value.scale) || {}
  return Object.keys(scale).map((key) => ({ key, label: scale[key].label, count: scale[key].count }))
})

const metricItems = computed(() => {
  const data = overview.value || {}
  return [
    { key: 'record', label: '记录', value: data.recordTotal || 0 },
    { key: 'ai', label: 'AI 问答', value: data.aiTotal || 0 },
    { key: 'action', label: '行为事件', value: data.actionTotal || 0 },
    { key: 'active', label: '活跃家庭', value: data.activeFamilyCount || 0 },
    { key: 'aiPeople', label: '用过 AI 的人', value: data.aiPeople || 0 },
    { key: 'error', label: '报错', value: data.errorTotal || 0 },
  ]
})

/** 柱高百分比：以窗口内最大值为满格；0 也给一点点高度，不然看不出「这天没有」 */
function barHeight(value) {
  const rows = dayList.value
  let max = 1
  rows.forEach((item) => {
    max = Math.max(max, item.records || 0, item.ai || 0)
  })
  const count = Number(value) || 0
  if (count <= 0) return '2rpx'
  return `${Math.max(Math.round((count / max) * 100), 6)}%`
}

function shortTime(iso) {
  const text = formatDateTime(iso)
  return text ? text.slice(5) : '—'
}

function tierText(item) {
  if (!membershipEnabled.value) return '会员制未上线'
  if (item.tier !== 'member') return '免费版'
  if (!item.until) return '会员 · 永久'
  const date = String(item.until).slice(0, 10)
  return item.expired ? `会员 · 已过期（${date}）` : `会员 · ${date} 到期`
}

function tierClass(item) {
  if (!membershipEnabled.value) return 'fam-tier--off'
  if (item.tier !== 'member') return 'fam-tier--off'
  return item.expired ? 'fam-tier--expired' : 'fam-tier--on'
}

/** 这家的家庭管理员 = 创建者；没昵称就只拿 openid 后 6 位认人 */
function ownerText(item) {
  if (!item.ownerShortId && !item.ownerName) return '—'
  const name = item.ownerName || '未设昵称'
  return item.ownerShortId ? `${name}（…${item.ownerShortId}）` : name
}

function addDays(count) {
  const date = new Date(Date.now() + count * 86400000)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

async function loadOverview() {
  if (!api.admin) return
  loading.value = true
  errorText.value = ''
  try {
    overview.value = await api.admin.overview(days.value)
  } catch (err) {
    console.error('[Admin] 读取概览失败', err)
    errorText.value = (err && err.message) || '读取概览失败'
  } finally {
    loading.value = false
  }
}

async function loadFamilies() {
  if (!api.admin) return
  loading.value = true
  errorText.value = ''
  try {
    // 家庭列表与开关清单一起拉：两者都在这一个页签里展示，分两次会让「改完立刻看到」
    // 中间夹一个空窗
    const [flagResult, famResult] = await Promise.all([api.admin.flags(), api.admin.families()])
    catalog.value = flagResult.catalog || []
    globals.value = flagResult.globals || {}
    families.value = famResult.families || []
    membershipEnabled.value = Boolean(famResult.membershipEnabled)
  } catch (err) {
    console.error('[Admin] 读取家庭与开关失败', err)
    errorText.value = (err && err.message) || '读取家庭与开关失败'
  } finally {
    loading.value = false
  }
}

/* ---------------------------------------------------------------------------
 * 开通码台账（超管生成、作废；家庭创建者在小程序里兑换）
 * ------------------------------------------------------------------------- */

function codeStatusText(item) {
  if (item.status === 'used') return '已兑换'
  if (item.status === 'void') return '已作废'
  return '未使用'
}

/** 复用家庭档位那三个徽章配色：未用=绿、已用=灰、作废=红 */
function codeStatusClass(item) {
  if (item.status === 'used') return 'fam-tier--off'
  if (item.status === 'void') return 'fam-tier--expired'
  return 'fam-tier--on'
}

function onPickCodeFilter(next) {
  if (codeFilter.value === next) return
  codeFilter.value = next
  loadCodes()
}

async function loadCodes() {
  if (!api.admin) return
  loading.value = true
  errorText.value = ''
  try {
    const status = codeFilter.value === 'all' ? '' : codeFilter.value
    const result = await api.admin.codes({ status })
    codes.value = result.codes || []
    codeTotalCount.value = Number(result.totalCount) || 0
    codeUnusedCount.value = Number(result.unusedCount) || 0
    codeUsedCount.value = Number(result.usedCount) || 0
  } catch (err) {
    console.error('[Admin] 读取开通码失败', err)
    errorText.value = (err && err.message) || '读取开通码失败'
  } finally {
    loading.value = false
  }
}

function openCodeCreator() {
  codeCount.value = '1'
  codeDays.value = '30'
  codeNote.value = ''
  errorText.value = ''
  codeCreator.value = true
}

async function onCreateCodes() {
  if (saving.value) return
  saving.value = true
  errorText.value = ''
  try {
    const result = await api.admin.createCodes({
      count: Number(codeCount.value),
      days: Number(codeDays.value) || 0,
      note: codeNote.value,
    })
    const rows = (result && result.created) || []
    // 生成就是为了发出去，直接整批塞进剪贴板，省得一个个点。
    // await：写入剪切板要先过隐私授权，等它结束再关弹层，免得弹窗还没答完界面就没了。
    if (rows.length) await onCopyText(rows.map((row) => row.code).join('\n'), false)
    codeCreator.value = false
    // 新生成的码是「未用」，切回未用筛选才能立刻看到
    codeFilter.value = 'unused'
    await loadCodes()
    uni.showToast({ title: `已生成 ${rows.length} 个码`, icon: 'none' })
  } catch (err) {
    console.error('[Admin] 生成开通码失败', err)
    errorText.value = (err && err.message) || '生成失败'
  } finally {
    saving.value = false
  }
}

function onCopyCode(item) {
  onCopyText(item.code)
}

/**
 * 复制到剪切板。
 *
 * ⚠️ `uni.setClipboardData` 是**隐私接口**（后台声明的是「读取你的剪切板」）：
 * 用户没同意隐私协议时微信会直接拦掉，表现为「点了没反应」—— 所以必须先过
 * `ensurePrivacyAuthorized()`。与 family.vue / record.vue 的写法保持一致。
 *
 * toast 可关：批量复制时后面还会弹「已生成 N 个」，两条 toast 会互相顶掉。
 */
async function onCopyText(text, withToast = true) {
  const data = String(text || '')
  if (!data) return

  const allowed = await ensurePrivacyAuthorized()
  if (!allowed) {
    uni.showToast({ title: '需要同意隐私政策后才能复制', icon: 'none' })
    return
  }

  uni.setClipboardData({
    data,
    success: () => {
      if (withToast) uni.showToast({ title: '已复制', icon: 'none' })
    },
    fail: (err) => {
      console.error('[Admin] 复制失败', err)
      // errno 112 = 后台《用户隐私保护指引》没声明「读取你的剪切板」，
      // 代码绕不过去，只能长按码值手动选中复制
      uni.showToast({ title: '复制失败，长按码值可手动复制', icon: 'none' })
    },
  })
}

async function onSetCodeStatus(item, status) {
  if (saving.value) return
  const label = status === 'void' ? '作废' : '恢复'
  const tip =
    status === 'void'
      ? '作废后这个码不能再被兑换。已经兑换过的会员不受影响。'
      : '恢复后这个码可以继续被兑换。'
  const confirmed = await new Promise((resolve) => {
    uni.showModal({
      title: `${label}这个码？`,
      content: `${item.code}\n${tip}`,
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })
  if (!confirmed) return

  saving.value = true
  errorText.value = ''
  try {
    await api.admin.setCodeStatus({ codeId: item.id, status })
    await loadCodes()
    uni.showToast({ title: `已${label}`, icon: 'none' })
  } catch (err) {
    console.error('[Admin] 改开通码状态失败', err)
    errorText.value = (err && err.message) || `${label}失败`
  } finally {
    saving.value = false
  }
}

/** 某个页签要拉的数据；switchTab 与 onShow 共用，免得两处分支写岔 */
function loadTab(next) {
  if (next === 'overview') return loadOverview()
  if (next === 'family') return loadFamilies()
  if (next === 'codes') return loadCodes()
  if (next === 'members') return loadUsers()
  return loadFeedbacks()
}

function switchTab(next) {
  if (tab.value === next) return
  tab.value = next
  loadTab(next)
}

/* ---------------------------------------------------------------------------
 * 意见反馈（超管看全部并回复）
 * ------------------------------------------------------------------------- */

function feedbackTypeLabel(type) {
  return FEEDBACK_TYPE_LABEL[type] || '其他'
}

function onPickFeedbackFilter(next) {
  if (feedbackFilter.value === next) return
  feedbackFilter.value = next
  loadFeedbacks()
}

async function loadFeedbacks() {
  if (!api.admin) return
  loading.value = true
  errorText.value = ''
  try {
    const status = feedbackFilter.value === 'all' ? '' : feedbackFilter.value
    const result = await api.admin.feedbacks({ status })
    const rows = result.feedbacks || []

    // 截图链接一次换完：逐条换会让「10 条反馈」变成 10 次云函数调用。
    // 走 admin.fileUrls 而不是 storage.createSignedUrls —— 反馈截图可能属于别人家
    // 或根本不在任何家庭目录下，普通那条路会被家庭成员校验挡住。
    const paths = []
    rows.forEach((item) => {
      ;(item.images || []).forEach((path) => {
        if (paths.indexOf(path) < 0) paths.push(path)
      })
    })
    const urls = await api.admin.fileUrls(paths)
    const urlByPath = {}
    urls.forEach((item) => {
      if (item.url) urlByPath[item.path] = item.url
    })

    feedbacks.value = rows.map((item) => ({
      ...item,
      thumbs: (item.images || [])
        .filter((path) => urlByPath[path])
        .map((path) => ({ path, url: urlByPath[path] })),
    }))
    feedbackPendingCount.value = Number(result.pendingCount) || 0
    feedbackTotalCount.value = Number(result.totalCount) || 0
  } catch (err) {
    console.error('[Admin] 读取意见反馈失败', err)
    errorText.value = (err && err.message) || '读取意见反馈失败'
    feedbacks.value = []
  } finally {
    loading.value = false
  }
}

function previewFeedbackShot(item, index) {
  const urls = item.thumbs.map((thumb) => thumb.url).filter(Boolean)
  if (!urls.length) return
  uni.previewImage({ urls, current: urls[index] })
}

function openFeedback(item) {
  feedbackEditor.value = item
  // 预填上次的回复：改一句话比重写一遍轻松
  feedbackReply.value = item.reply || ''
}

async function onSetFeedbackStatus(status) {
  if (!feedbackEditor.value || saving.value) return
  saving.value = true
  try {
    await api.admin.setFeedbackStatus({
      feedbackId: feedbackEditor.value.id,
      status,
      reply: feedbackReply.value,
    })
    feedbackEditor.value = null
    feedbackReply.value = ''
    await loadFeedbacks()
    // 概览里那张「待处理 N 条」不在这里同步：切回概览页签会重新拉一次
    uni.showToast({ title: status === 'done' ? '已标记处理' : '已标回待处理', icon: 'success' })
  } catch (err) {
    console.error('[Admin] 处理反馈失败', err)
    uni.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

async function loadUsers() {
  if (!api.admin) return
  loading.value = true
  errorText.value = ''
  try {
    const result = await api.admin.users()
    users.value = result.users || []
    superAdminCount.value = Number(result.superAdminCount) || 0
  } catch (err) {
    console.error('[Admin] 读取成员一览失败', err)
    errorText.value = (err && err.message) || '读取成员一览失败'
  } finally {
    loading.value = false
  }
}

/** 角色徽章：超管 > 某家的创建者（= 那家的家庭管理员） > 普通成员 */
function roleText(item) {
  if (item.superAdmin) return '超级管理员'
  if (item.ownerOf && item.ownerOf.length) return `创建者 · ${item.ownerOf.join('、')}`
  return '普通成员'
}

function roleClass(item) {
  if (item.superAdmin) return 'role-badge--super'
  if (item.ownerOf && item.ownerOf.length) return 'role-badge--admin'
  return 'role-badge--none'
}

/** 所在家庭；全员退出的账号单独标一下，免得看着像还在用 */
function familyText(item) {
  const rows = (item.families || []).map(
    (row) => `${row.name}${row.status === 'active' ? '' : '（已退出）'}`,
  )
  if (!rows.length) return '—'
  return item.activeFamilyCount ? rows.join('、') : `${rows.join('、')} · 已不在任何家庭`
}

/* ---------------------------------------------------------------------------
 * 进某个家庭管成员（超管）
 *
 * 与家庭创建者在小程序里管成员走的是同一套规则（改角色 / 软删除 / 动不了创建者），
 * 只是这里能对**任意家庭**做，而不是只有自己那一家。
 * ------------------------------------------------------------------------- */

async function openMembers(item) {
  memberSheet.value = { familyId: item.id, familyName: item.name, ownerId: '' }
  members.value = []
  await loadMembers()
}

async function loadMembers() {
  if (!api.admin || !memberSheet.value) return
  membersLoading.value = true
  errorText.value = ''
  try {
    const result = await api.admin.familyMembers(memberSheet.value.familyId)
    members.value = result.members || []
    memberSheet.value = { ...memberSheet.value, ownerId: result.ownerId || '' }
  } catch (err) {
    console.error('[Admin] 读取家庭成员失败', err)
    errorText.value = (err && err.message) || '读取家庭成员失败'
    uni.showToast({ title: (err && err.message) || '读取家庭成员失败', icon: 'none' })
  } finally {
    membersLoading.value = false
  }
}

/** 昵称 + openid 后 6 位：重名时靠这个分辨谁是谁 */
function memberLabel(member) {
  return `${member.nickname || '未设昵称'}（…${member.shortId}）`
}

function isOwnerMember(member) {
  return Boolean(memberSheet.value && memberSheet.value.ownerId === member.id)
}

/** 成员在这个家里的角色；创建者单独说清楚，因为它就是「家庭管理员」 */
function roleOfMember(member) {
  if (isOwnerMember(member)) return '创建者 · 家庭管理员'
  return member.role === 'viewer' ? '只读' : '成员'
}

async function onSetRole(member, role) {
  if (!memberSheet.value || saving.value) return
  if (member.role === role) {
    memberTarget.value = null
    return
  }
  saving.value = true
  try {
    await api.admin.setMemberRole({
      familyId: memberSheet.value.familyId,
      memberId: member.id,
      role,
    })
    memberTarget.value = null
    await loadMembers()
    await loadFamilies()
  } catch (err) {
    console.error('[Admin] 改成员角色失败', err)
    uni.showToast({ title: (err && err.message) || '改角色失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

function onRemoveMember(member) {
  if (!memberSheet.value) return
  uni.showModal({
    title: '移出家庭',
    content: `把「${member.nickname || '这位成员'}」移出「${memberSheet.value.familyName}」？他记过的内容仍留在这个家，但他看不到也改不了了。`,
    confirmText: '移出',
    confirmColor: '#f04438',
    success: async (res) => {
      if (!res.confirm) return
      saving.value = true
      try {
        await api.admin.removeMember({
          familyId: memberSheet.value.familyId,
          memberId: member.id,
        })
        memberTarget.value = null
        await loadMembers()
        await loadFamilies()
        uni.showToast({ title: '已移出', icon: 'success' })
      } catch (err) {
        console.error('[Admin] 移出成员失败', err)
        uni.showToast({ title: (err && err.message) || '移出失败', icon: 'none' })
      } finally {
        saving.value = false
      }
    },
  })
}

/* ---------- 转移创建者（换这个家的家庭管理员） ---------- */

function openTransfer(member) {
  if (!memberSheet.value) return
  memberTarget.value = null
  transferTarget.value = {
    familyId: memberSheet.value.familyId,
    familyName: memberSheet.value.familyName,
    memberId: member.id,
    memberName: member.nickname || '这位成员',
  }
  transferText.value = ''
}

function closeTransfer() {
  transferTarget.value = null
  transferText.value = ''
}

/** 家庭名要一字不差，按钮才可点（服务端也会再比一次） */
const canTransfer = computed(() => {
  if (!transferTarget.value) return false
  return transferText.value.trim() === String(transferTarget.value.familyName || '').trim()
})

async function onTransferOwner() {
  if (transferring.value || !transferTarget.value || !canTransfer.value) return
  transferring.value = true
  try {
    await api.admin.transferOwner({
      familyId: transferTarget.value.familyId,
      memberId: transferTarget.value.memberId,
      confirmName: transferText.value.trim(),
    })
    closeTransfer()
    uni.showToast({ title: '已转移', icon: 'success' })
    await loadMembers()
    await loadFamilies()
  } catch (err) {
    console.error('[Admin] 转移创建者失败', err)
    // 弹层盖住了页面底部的错误行，用 modal 才看得见服务端的话
    uni.showModal({
      title: '转移失败',
      content: (err && err.message) || '转移失败',
      showCancel: false,
    })
  } finally {
    transferring.value = false
  }
}

function onPickDays(value) {
  if (days.value === value) return
  days.value = value
  loadOverview()
}

function openEditor(item) {
  editor.value = item
  editorTier.value = item.tier === 'member' ? 'member' : 'free'
  editorUntil.value = item.until ? String(item.until).slice(0, 10) : ''
}

function onPickUntil(event) {
  editorUntil.value = event.detail.value || ''
}

async function onSaveTier() {
  if (saving.value || !editor.value) return
  const familyId = editor.value.id
  saving.value = true
  errorText.value = ''
  try {
    await api.admin.setTier({
      familyId,
      tier: editorTier.value,
      until: editorTier.value === 'member' ? editorUntil.value : '',
    })
    editor.value = null
    uni.showToast({ title: '已保存', icon: 'success' })
    await loadFamilies()
    // 改的正好是自己家时，权益快照也得跟着变，否则 AI 额度文案还是旧的
    if (familyId === store.currentFamilyId) {
      await ensureMembership({ familyId: store.currentFamilyId, force: true })
    }
  } catch (err) {
    console.error('[Admin] 改档位失败', err)
    errorText.value = (err && err.message) || '保存失败'
  } finally {
    saving.value = false
  }
}

/** 某一家有没有与全局不一致的开关，有就用中文列出来（卡片上那一行提示） */
function overrideText(item) {
  const overrides = item.flags || {}
  const labels = catalog.value
    .filter((flag) => typeof overrides[flag.key] === 'boolean')
    .map((flag) => `${flag.label}${overrides[flag.key] ? '开' : '关'}`)
  return labels.join('、')
}

/** 改全局开关：整个小程序生效 */
async function onToggleGlobal(item, event) {
  if (saving.value) return
  const value = Boolean(event.detail && event.detail.value)
  saving.value = true
  errorText.value = ''
  try {
    await api.admin.setFlag({ scope: 'global', key: item.key, value })
    await loadFamilies()
    await refreshOwnFlags()
  } catch (err) {
    console.error('[Admin] 改全局开关失败', err)
    errorText.value = (err && err.message) || '改开关失败'
    // 失败时把开关拨回去：界面上不能停在一个没生效的状态
    await loadFamilies()
  } finally {
    saving.value = false
  }
}

function openFlagEditor(item) {
  flagEditor.value = { id: item.id, name: item.name }
  flagEditorFlags.value = { ...(item.flags || {}) }
}

/** 这家的覆盖值：true / false / null（null = 跟随全局） */
function familyFlagValue(key) {
  const value = flagEditorFlags.value[key]
  return typeof value === 'boolean' ? value : null
}

/** 生效值 = 覆盖 ?? 全局 ?? 开 */
function effectiveFlagText(key) {
  const own = familyFlagValue(key)
  const value = own === null ? globals.value[key] !== false : own
  const source = own === null ? '跟随全局' : '本家指定'
  return `${value ? '开' : '关'}（${source}）`
}

async function onSetFamilyFlag(key, value) {
  if (!flagEditor.value || saving.value) return
  const familyId = flagEditor.value.id
  saving.value = true
  errorText.value = ''
  try {
    await api.admin.setFlag({ scope: 'family', familyId, key, value })
    // 先改本地，界面立刻跟手；再拉一次拿服务端的最终值
    const next = { ...flagEditorFlags.value }
    if (value === null) delete next[key]
    else next[key] = value
    flagEditorFlags.value = next
    await loadFamilies()
    // 以服务端返回的值为准重新对齐弹层：只信乐观值的话，万一写入没落库，
    // 弹层会一直显示「已保存」而卡片上的例外还在，越看越糊涂
    const fresh = families.value.find((row) => row.id === familyId)
    flagEditorFlags.value = { ...((fresh && fresh.flags) || {}) }
    await refreshOwnFlags()
  } catch (err) {
    console.error('[Admin] 改家庭开关失败', err)
    errorText.value = (err && err.message) || '改开关失败'
    // 弹层盖住了页面底部的错误行，这里用 toast 才看得见
    uni.showToast({ title: '改开关失败', icon: 'none' })
  } finally {
    saving.value = false
  }
}

/**
 * 改完开关后刷一次本机的开关快照。
 * 只改了别家的话这次刷新是白跑（服务端算出来的值没变），但省掉了
 * 「改的正好是自己家、却要等 5 分钟才生效」这种最让人困惑的情况。
 */
async function refreshOwnFlags() {
  if (!store.currentFamilyId) return
  try {
    await ensureFlags({ familyId: store.currentFamilyId, force: true })
  } catch (err) {
    console.error('[Admin] 刷新本机开关快照失败', err)
  }
}

function openDeleter(item) {
  deleter.value = item
  deleteText.value = ''
}

function closeDeleter() {
  deleter.value = null
  deleteText.value = ''
}

/** 家庭名必须一字不差，按钮才可点（服务端也会再比一次） */
const canDelete = computed(() => {
  if (!deleter.value) return false
  return deleteText.value.trim() === String(deleter.value.name || '').trim()
})

async function onDeleteFamily() {
  if (deleting.value || !deleter.value || !canDelete.value) return
  const familyId = deleter.value.id
  const name = deleter.value.name
  deleting.value = true
  errorText.value = ''
  try {
    const result = await api.admin.deleteFamily({ familyId, confirmName: name })
    // 数据库已经清干净了，接着清云存储里的照片/头像（返回的是相对路径）
    const paths = (result && result.paths) || []
    if (paths.length) {
      try {
        await api.admin.deleteFiles(paths)
      } catch (err) {
        // 文件没删掉不影响使用，只留个日志（下次可以再手动清一次）
        console.error('[Admin] 删除家庭后清理文件失败', err)
      }
    }
    closeDeleter()
    uni.showToast({ title: '已删除', icon: 'success' })
    await loadFamilies()
  } catch (err) {
    console.error('[Admin] 删除家庭失败', err)
    errorText.value = (err && err.message) || '删除失败'
    // 弹层盖住了页面底部的错误行；这里要把服务端的话原样说给运维听
    //（比如「这是你自己唯一的家…」），所以用 modal 而不是一闪而过的 toast
    uni.showModal({
      title: '删除失败',
      content: (err && err.message) || '删除失败',
      showCancel: false,
    })
  } finally {
    deleting.value = false
  }
}

onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  if (!capabilities.admin || !api.admin) {
    blocked.value = '运维后台只在微信小程序端（云开发后端）提供。'
    return
  }
  await store.bootstrap()
  // 运维身份跟着权益快照走（服务端按写死的 openid 名单判定），先确保快照是最新的
  await ensureMembership({ familyId: store.currentFamilyId })
  if (!isSuperAdmin()) {
    blocked.value = '运维后台只有超级管理员能进。'
    return
  }
  blocked.value = ''
  await loadTab(tab.value)
})
</script>

<style scoped>
.page {
  padding: var(--space-lg);
  padding-bottom: calc(var(--space-xl) + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.app-card {
  margin-bottom: var(--space-md);
}

.blocked-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.blocked-desc {
  display: block;
  margin-top: var(--space-sm);
  font-size: 26rpx;
  color: var(--color-text-muted);
}

/* 页签 */
.tabs {
  display: flex;
  flex-direction: row;
  padding: 6rpx;
  margin-bottom: var(--space-md);
  background-color: var(--color-bg-card);
  border-radius: var(--radius-pill);
  box-sizing: border-box;
}

.tab {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  height: 72rpx;
  border-radius: var(--radius-pill);
}

.tab--on {
  background-color: var(--color-primary-soft);
}

.tab-text {
  font-size: 27rpx;
  color: var(--color-text-muted);
}

.tab-text--on {
  font-weight: 600;
  color: var(--color-primary-deep);
}

.section-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.card-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.card-head-value {
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.hint {
  display: block;
  margin-top: var(--space-sm);
  font-size: 23rpx;
  color: var(--color-text-muted);
}

.loading {
  text-align: center;
}

.error {
  display: block;
  margin-top: var(--space-md);
  font-size: 24rpx;
  color: var(--color-danger);
}

/* 窗口选择 */
.days {
  display: flex;
  flex-direction: row;
}

.day-chip {
  padding: 8rpx 22rpx;
  margin-left: var(--space-xs);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.day-chip--on {
  background-color: var(--color-primary-soft);
}

.day-chip-text {
  font-size: 24rpx;
  color: var(--color-text-sub);
}

.day-chip-text--on {
  font-weight: 600;
  color: var(--color-primary-deep);
}

/* 数字方块 */
.grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: var(--space-sm);
}

.grid-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 33.33%;
  padding: var(--space-sm) 0;
  box-sizing: border-box;
}

.grid-num {
  font-size: 36rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.grid-label {
  margin-top: 4rpx;
  font-size: 23rpx;
  color: var(--color-text-muted);
}

/* 按天柱状 */
.legend {
  display: flex;
  flex-direction: row;
  margin-top: var(--space-xs);
}

.legend-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-right: var(--space-md);
}

.dot {
  width: 16rpx;
  height: 16rpx;
  margin-right: 8rpx;
  border-radius: 50%;
}

.dot--record {
  background-color: var(--color-primary);
}

.dot--ai {
  background-color: #7aa7ff;
}

.chart {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  height: 220rpx;
  margin-top: var(--space-sm);
}

.chart-col {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.chart-bars {
  display: flex;
  flex: 1;
  flex-direction: row;
  align-items: flex-end;
  justify-content: center;
  width: 100%;
}

.bar {
  width: 8rpx;
  margin: 0 2rpx;
  border-radius: 4rpx 4rpx 0 0;
}

.bar--record {
  background-color: var(--color-primary);
}

.bar--ai {
  background-color: #7aa7ff;
}

.chart-label {
  height: 28rpx;
  margin-top: 6rpx;
  font-size: 18rpx;
  color: var(--color-text-muted);
}

/* 通用两列行 */
.line {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 64rpx;
}

.line-label {
  flex: 1;
  font-size: 26rpx;
  color: var(--color-text-sub);
}

.line-value {
  font-size: 26rpx;
  color: var(--color-text-main);
}

/* 报错 */
.error-item {
  padding: var(--space-sm) 0;
  border-top: 1rpx solid var(--color-border);
}

.sub-title {
  display: block;
  margin-top: var(--space-md);
  font-size: 24rpx;
  color: var(--color-text-muted);
}

.error-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.error-name {
  font-size: 25rpx;
  font-weight: 600;
  color: var(--color-danger);
}

.error-time {
  font-size: 22rpx;
  color: var(--color-text-muted);
}

.error-page {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--color-text-muted);
}

.error-msg {
  display: block;
  margin-top: 4rpx;
  font-size: 23rpx;
  color: var(--color-text-sub);
}

/* 家庭卡 */
.fam-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.fam-name {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.fam-tier {
  padding: 4rpx 16rpx;
  font-size: 22rpx;
  border-radius: var(--radius-pill);
}

.fam-tier--on {
  color: var(--color-success);
  background-color: rgba(18, 183, 106, 0.12);
}

.fam-tier--expired {
  color: var(--color-danger);
  background-color: rgba(240, 68, 56, 0.12);
}

.fam-tier--off {
  color: var(--color-text-muted);
  background-color: var(--color-bg-page);
}

/* 角色徽章（成员与管理员页签） */
.role-badge {
  padding: 4rpx 16rpx;
  font-size: 22rpx;
  border-radius: var(--radius-pill);
}

.role-badge--super {
  color: var(--color-primary-deep);
  background-color: var(--color-primary-soft);
}

.role-badge--admin {
  color: var(--color-success);
  background-color: rgba(18, 183, 106, 0.12);
}

.role-badge--none {
  color: var(--color-text-muted);
  background-color: var(--color-bg-page);
}

.flag-lock {
  font-size: 24rpx;
  color: var(--color-text-muted);
}

/* 叠在成员面板之上的那一层（成员操作 / 转移确认） */
.mask--top {
  z-index: 110;
}

/* 家庭成员列表 */
.member-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-sm) 0;
  border-top: 1rpx solid var(--color-border);
}

.member-main {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.member-name {
  font-size: 28rpx;
  color: var(--color-text-main);
}

.member-sub {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--color-text-muted);
}

.member-tag {
  padding: 4rpx 14rpx;
  font-size: 22rpx;
  color: var(--color-text-muted);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.member-op {
  padding: 8rpx 24rpx;
  background-color: var(--color-primary-soft);
  border-radius: var(--radius-pill);
}

.member-op-text {
  font-size: 24rpx;
  color: var(--color-primary-deep);
}

/* 单成员操作清单 */
.opt-list {
  margin-top: var(--space-md);
}

.opt-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--space-sm);
  margin-bottom: var(--space-xs);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
  box-sizing: border-box;
}

.opt-row--on {
  background-color: var(--color-primary-soft);
}

.opt-main {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.opt-text {
  font-size: 28rpx;
  color: var(--color-text-main);
}

.opt-text--danger {
  color: var(--color-danger);
}

.opt-desc {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--color-text-muted);
}

.opt-check {
  font-size: 23rpx;
  color: var(--color-primary-deep);
}

.line-value--warn {
  color: var(--color-warning);
}

/* 家庭卡底部的操作按钮 */
.fam-actions {
  display: flex;
  flex-direction: row;
  margin-top: var(--space-md);
}

.fam-btn {
  flex: 1;
  margin-left: var(--space-sm);
}

.fam-btn:first-child {
  margin-left: 0;
}

/* 删除家庭那一行：靠右、固定宽，不跟着上面三个按钮等分 */
.fam-actions--end {
  justify-content: flex-end;
  margin-top: var(--space-sm);
}

.fam-actions--end .fam-btn {
  flex: 0 0 auto;
  min-width: 220rpx;
  margin-left: 0;
}

.fam-btn--danger {
  background-color: rgba(240, 68, 56, 0.1);
}

.fam-btn-text {
  font-size: 26rpx;
  color: #ffffff;
}

.fam-btn-text--ghost {
  color: var(--color-primary);
}

.fam-btn-text--danger {
  color: var(--color-danger);
}

/* 功能开关行 */
.flag-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding-top: var(--space-md);
}

.flag-edit {
  padding-top: var(--space-md);
}

.flag-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  margin-right: var(--space-sm);
}

.flag-label {
  font-size: 28rpx;
  color: var(--color-text-main);
}

.flag-desc {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--color-text-muted);
}

.flag-state {
  display: block;
  margin-top: var(--space-xs);
  font-size: 22rpx;
  color: var(--color-text-muted);
}

/* 三选段（比改档位那个更紧凑：一行里要塞三个选项） */
.seg--tight {
  margin-top: var(--space-xs);
}

.seg-text--small {
  font-size: 24rpx;
}

/* 删除家庭 */
.danger-note {
  display: block;
  padding: var(--space-sm);
  margin-top: var(--space-md);
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--color-danger);
  background-color: rgba(240, 68, 56, 0.08);
  border-radius: var(--radius-md);
}

.code-input {
  height: 88rpx;
  padding: 0 var(--space-md);
  margin-top: var(--space-md);
  font-size: 28rpx;
  color: var(--color-text-main);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
  box-sizing: border-box;
}

.code-placeholder {
  font-size: 26rpx;
  color: var(--color-text-muted);
}

.sheet-btn--danger {
  background-color: var(--color-danger);
}

/* 改档位弹层 */
.mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background-color: rgba(0, 0, 0, 0.45);
}

.sheet {
  padding: var(--space-lg);
  padding-bottom: calc(var(--space-lg) + env(safe-area-inset-bottom));
  background-color: var(--color-bg-card);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  box-sizing: border-box;
}

.sheet-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--color-text-main);
}

.sheet-sub {
  display: block;
  margin-top: 4rpx;
  font-size: 25rpx;
  color: var(--color-text-muted);
}

.seg {
  display: flex;
  flex-direction: row;
  padding: 6rpx;
  margin-top: var(--space-md);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.seg-item {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  height: 72rpx;
  border-radius: var(--radius-pill);
}

.seg-item--on {
  background-color: var(--color-primary-soft);
}

.seg-text {
  font-size: 27rpx;
  color: var(--color-text-sub);
}

.seg-text--on {
  font-weight: 600;
  color: var(--color-primary-deep);
}

.until-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-top: var(--space-sm);
}

.until-input {
  padding: 0 var(--space-md);
  height: 88rpx;
  line-height: 88rpx;
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
  box-sizing: border-box;
}

.until-text {
  font-size: 28rpx;
  color: var(--color-text-main);
}

.clear-btn {
  width: 150rpx;
  margin-left: var(--space-sm);
}

.clear-text {
  font-size: 27rpx;
  color: var(--color-primary);
}

.quick {
  display: flex;
  flex-direction: row;
  margin-top: var(--space-sm);
}

.quick-chip {
  padding: 8rpx 24rpx;
  margin-right: var(--space-xs);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-pill);
}

.quick-text {
  font-size: 24rpx;
  color: var(--color-text-sub);
}

.sheet-actions {
  display: flex;
  flex-direction: row;
  margin-top: var(--space-lg);
}

.sheet-btn {
  flex: 1;
  margin-left: var(--space-sm);
}

.sheet-btn:first-child {
  margin-left: 0;
}

.sheet-btn-text {
  font-size: 29rpx;
  color: #ffffff;
}

.sheet-btn-text--ghost {
  color: var(--color-primary);
}

/* 待处理反馈那张卡：整张卡片描个边，扫一眼就能看见 */
.card--todo {
  border: 1rpx solid var(--color-primary);
}

.card-head-value--warn {
  color: var(--color-primary-deep);
  font-weight: 600;
}

/* 意见反馈 */
.fb-status {
  padding: 4rpx 18rpx;
  font-size: 22rpx;
  color: var(--color-warning);
  background-color: rgba(247, 144, 9, 0.12);
  border-radius: var(--radius-pill);
}

.fb-status--done {
  color: var(--color-success);
  background-color: rgba(18, 183, 106, 0.12);
}

.fb-content {
  display: block;
  margin-top: var(--space-sm);
  font-size: 27rpx;
  line-height: 1.7;
  color: var(--color-text-sub);
}

.fb-shots {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: var(--space-sm);
}

.fb-shot {
  width: 176rpx;
  height: 176rpx;
  margin-right: var(--space-sm);
  margin-bottom: var(--space-sm);
  border-radius: var(--radius-md);
}

/* 弹层里回显那条反馈的原文，跟输入框区分开 */
.quote {
  margin-top: var(--space-md);
  padding: var(--space-md);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
}

.quote-text {
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--color-text-sub);
}

.reply-input {
  width: 100%;
  height: 180rpx;
  padding: var(--space-md);
  margin-top: var(--space-sm);
  font-size: 28rpx;
  line-height: 1.6;
  color: var(--color-text-main);
  background-color: var(--color-bg-page);
  border-radius: var(--radius-md);
  box-sizing: border-box;
}

/* 开通码台账里的码值：等宽感 + 字距，方便一眼比对 */
.code-value {
  font-size: 32rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  color: var(--color-text-main);
}
</style>
