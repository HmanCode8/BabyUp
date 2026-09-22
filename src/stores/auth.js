/**
 * 全局登录态与「当前家庭 / 当前宝宝」上下文。
 *
 * 二期加强后：一个用户可以同时属于多个家庭，一个家庭可以有多个宝宝，
 * 所以这里持有「我的全部成员关系 + 对应家庭行 + 当前家庭的宝宝列表」，
 * 由 currentFamilyId / currentBabyId 决定各页面看哪一份数据；
 * 选择结果持久化在本地，重启后回到用户上次看的那一家、那一个宝宝。
 *
 * 页面只读这里的状态，不直接查库：
 * session/user 来自 Supabase Auth，其余来自业务表（受 RLS 保护）。
 */
import { defineStore } from 'pinia'
import { api } from '@/services/api'
import { listMyMemberships, listFamiliesByIds, listMembers } from '@/services/family'
import { listBabies, resolveStorageUrl } from '@/services/baby'
import { SELECTION_STORAGE_KEY } from '@/config'

/** 读取本地保存的选择：当前家庭 + 每个家庭上次选中的宝宝 */
function readSelection() {
  try {
    const raw = uni.getStorageSync(SELECTION_STORAGE_KEY)
    const parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null
    return {
      familyId: (parsed && parsed.familyId) || '',
      babyByFamily: (parsed && parsed.babyByFamily) || {},
    }
  } catch (err) {
    console.error('[AuthStore] 读取本地家庭/宝宝选择失败', err)
    return { familyId: '', babyByFamily: {} }
  }
}

function writeSelection(selection) {
  try {
    uni.setStorageSync(SELECTION_STORAGE_KEY, JSON.stringify(selection))
  } catch (err) {
    console.error('[AuthStore] 保存本地家庭/宝宝选择失败', err)
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    /** 是否已完成启动恢复（未完成前路由守卫不做判断） */
    initialized: false,
    session: null,
    user: null,
    /** 我的全部在册成员关系（一个用户可属于多个家庭） */
    memberships: [],
    /** 上面这些成员关系对应的家庭行 */
    families: [],
    /** 当前家庭下的宝宝列表 */
    babies: [],
    /** 当前家庭的全部在册成员（记录人展示用：user_id → 昵称） */
    members: [],
    /** 当前选中的家庭 id / 宝宝 id */
    currentFamilyId: '',
    currentBabyId: '',
    /** 当前宝宝头像的临时可访问地址（私有桶，需要签名后才能给 image 用） */
    babyAvatarUrl: '',
    /**
     * 时光页的数据是否已被本地写操作改脏（新增/删除/修改照片）。
     * 时光页不再每次进入都重新请求，靠这个标记保证自己改完后能看到最新结果。
     */
    timelineDirty: false,
  }),

  getters: {
    isLoggedIn: (state) => Boolean(state.session && state.session.access_token),
    userId: (state) => (state.user ? state.user.id : ''),
    hasFamily: (state) => Boolean(state.currentFamilyId),
    /** 当前家庭里「我」的成员关系 */
    membership: (state) =>
      state.memberships.find((item) => item.family_id === state.currentFamilyId) || null,
    family: (state) => state.families.find((item) => item.id === state.currentFamilyId) || null,
    baby: (state) => state.babies.find((item) => item.id === state.currentBabyId) || null,
    /** 当前家庭里我的角色：owner / member / viewer */
    myRole() {
      const mine = this.membership
      return mine ? mine.role : ''
    },
    isOwner() {
      return this.myRole === 'owner'
    },
    /** 只读成员（viewer）不能新增/编辑/删除：UI 据此隐藏写入口，真正的拦截靠 RLS */
    canWrite() {
      return Boolean(this.myRole) && this.myRole !== 'viewer'
    },
    hasMultipleFamilies: (state) => state.memberships.length > 1,
    hasMultipleBabies: (state) => state.babies.length > 1,
    /** 家里不止一个人时，记录列表才需要标注「谁记的」 */
    hasMultipleMembers: (state) => state.members.length > 1,
    /** user_id → 成员显示名（规则与家庭页一致：无昵称时自己=「我」，别人=「家庭成员」） */
    memberNameMap: (state) => {
      const map = {}
      state.members.forEach((item) => {
        if (!item || !item.user_id) return
        const mine = state.user && item.user_id === state.user.id
        map[item.user_id] = item.nickname || (mine ? '我' : '家庭成员')
      })
      return map
    },
    /**
     * 单条记录的「记录人」显示名。
     * 单人家庭返回空串，页面据此不展示，避免每条记录都挂着「我」。
     */
    memberLabel() {
      if (!this.hasMultipleMembers) return () => ''
      return (userId) => (userId ? this.memberNameMap[userId] || '家庭成员' : '')
    },
    /** 列表副标题里的记录人后缀，例：「 · 妈妈」；不该展示时返回空串 */
    recorderSuffix() {
      return (record) => {
        const name = this.memberLabel(record && record.created_by)
        return name ? ` · ${name}` : ''
      }
    },
  },

  actions: {
    /** 启动时恢复登录态并拉取上下文 */
    async bootstrap() {
      if (this.initialized) return
      try {
        const session = api.session.get()
        this.session = session
        this.user = session ? session.user : null
        if (this.isLoggedIn) {
          await this.loadFamilyContext()
        }
      } catch (err) {
        console.error('[AuthStore] 启动恢复登录态失败', err)
      } finally {
        this.initialized = true
      }
    },

    /** 清空家庭/宝宝上下文（退出登录时用） */
    resetContext() {
      this.memberships = []
      this.families = []
      this.babies = []
      this.members = []
      this.currentFamilyId = ''
      this.currentBabyId = ''
      this.babyAvatarUrl = ''
    },

    /** 照片被新增/删除/修改后置脏，时光页下次显示时自动重新拉取 */
    markTimelineDirty() {
      this.timelineDirty = true
    },

    /** 时光页重新拉取成功后清除脏标记 */
    clearTimelineDirty() {
      this.timelineDirty = false
    },

    /**
     * 拉取「我的全部家庭 + 当前家庭的宝宝」，并恢复上次的选择。
     * 顺序：成员关系 -> 家庭行 -> 决定当前家庭 -> 该家庭的宝宝 -> 决定当前宝宝 -> 头像。
     * 本地保存的家庭/宝宝若已失效（被移除、已退出），自动回退到第一个。
     */
    async loadFamilyContext() {
      if (!this.user) {
        this.resetContext()
        return
      }

      const memberships = await listMyMemberships(this.user.id)
      this.memberships = memberships

      const families = await listFamiliesByIds(memberships.map((item) => item.family_id))
      this.families = families

      const saved = readSelection()
      const familyIds = memberships.map((item) => item.family_id)
      this.currentFamilyId = familyIds.includes(saved.familyId) ? saved.familyId : familyIds[0] || ''

      await this.loadBabies(saved.babyByFamily[this.currentFamilyId])
    },

    /** 载入当前家庭的宝宝列表；preferredBabyId 失效时退回第一个 */
    async loadBabies(preferredBabyId) {
      this.babies = []
      this.members = []
      this.currentBabyId = ''
      if (!this.currentFamilyId) {
        await this.loadBabyAvatar()
        return
      }
      this.babies = await listBabies(this.currentFamilyId)
      const ids = this.babies.map((item) => item.id)
      this.currentBabyId = ids.includes(preferredBabyId) ? preferredBabyId : ids[0] || ''
      this.persistSelection()
      await this.loadMembers()
      await this.loadBabyAvatar()
    },

    /** 载入当前家庭的全部在册成员（记录人展示用）；失败不阻断主流程 */
    async loadMembers() {
      if (!this.currentFamilyId) {
        this.members = []
        return
      }
      try {
        this.members = await listMembers(this.currentFamilyId)
      } catch (err) {
        console.error('[AuthStore] 加载家庭成员失败', err)
        this.members = []
      }
    },

    /** 把「当前家庭 + 该家庭上次选的宝宝」写到本地 */
    persistSelection() {
      const saved = readSelection()
      const babyByFamily = { ...saved.babyByFamily }
      if (this.currentFamilyId) babyByFamily[this.currentFamilyId] = this.currentBabyId
      writeSelection({ familyId: this.currentFamilyId, babyByFamily })
    },

    /** 切换当前家庭：连带把宝宝列表与头像换成这个家庭的 */
    async switchFamily(familyId) {
      if (!familyId || familyId === this.currentFamilyId) return
      if (!this.memberships.some((item) => item.family_id === familyId)) {
        console.warn('[AuthStore] 目标家庭不在我的成员关系里，忽略切换', familyId)
        return
      }
      const saved = readSelection()
      this.currentFamilyId = familyId
      await this.loadBabies(saved.babyByFamily[familyId])
      console.log('[AuthStore] 已切换家庭', familyId)
    },

    /** 切换当前宝宝（只影响展示，数据本来就在同一个家庭下） */
    async switchBaby(babyId) {
      if (!babyId || babyId === this.currentBabyId) return
      if (!this.babies.some((item) => item.id === babyId)) {
        console.warn('[AuthStore] 目标宝宝不在当前家庭的宝宝列表里，忽略切换', babyId)
        return
      }
      this.currentBabyId = babyId
      this.persistSelection()
      await this.loadBabyAvatar()
      console.log('[AuthStore] 已切换宝宝', babyId)
    },

    /** 切家庭后 / 改家庭信息后，本地同步这一条家庭数据（避免整块重查） */
    patchFamily(family) {
      const index = this.families.findIndex((item) => item.id === family.id)
      if (index >= 0) this.families.splice(index, 1, family)
    },

    /** 头像存在私有桶里，页面要的是临时地址；失败不阻断主流程 */
    async loadBabyAvatar() {
      this.babyAvatarUrl = ''
      const baby = this.baby
      if (!baby || !baby.avatar_url) return
      try {
        this.babyAvatarUrl = await resolveStorageUrl(baby.avatar_url)
      } catch (err) {
        console.error('[AuthStore] 获取宝宝头像地址失败', err)
      }
    },

    /** 登录后 / 建家庭后 / 建档案后 / 切家庭后，同步刷新上下文 */
    async refreshContext() {
      const session = api.session.get()
      this.session = session
      if (session && session.user) this.user = session.user
      await this.loadFamilyContext()
    },

    async signInWithAccount(account, password) {
      const { user } = await api.auth.signInWithAccount(account, password)
      this.session = api.session.get()
      this.user = user
      await this.loadFamilyContext()
      return user
    },

    async signUpWithPhone(phone, password) {
      const { user } = await api.auth.signUpWithPhone(phone, password)
      this.session = api.session.get()
      this.user = user
      await this.loadFamilyContext()
      await this.savePhone(phone)
      return user
    },

    /**
     * 记录「手机号 → 账号」映射（补丁 Step 2 追加）。
     *
     * 绑定真实邮箱后账号的登录邮箱会变成邮箱，届时客户端无法再由手机号推导出
     * 登录邮箱，只能靠服务端按 phone 反查（Edge Function phone-login）。
     * 这份映射是那条兜底路径的必需品，因此注册成功后就落库。
     * 写失败不影响注册主流程，静默降级（历史数据已由迁移 011 回填）。
     */
    async savePhone(phone) {
      const userId = this.userId
      const value = String(phone || '').trim()
      if (!userId || !value) return
      try {
        await api.db.upsert('profiles', { id: userId, phone: value })
      } catch (err) {
        console.error('[AuthStore] 记录手机号失败（不影响注册）', err)
      }
    },

    /**
     * 绑定真实邮箱（补丁 Step 2）。
     * 只提交申请，邮箱进入待确认状态；用户点完邮件里的确认链接再调 refreshUser()。
     */
    async bindEmail(email) {
      const { user, pendingEmail } = await api.auth.updateEmail(email)
      this.user = user
      return { user, pendingEmail }
    },

    /** 重新拉取服务端用户信息（邮箱确认完成后用它同步最新 email） */
    async refreshUser() {
      const user = await api.auth.fetchUser()
      this.user = user
      const session = api.session.get()
      if (session) api.session.set({ ...session, user })
      return user
    },

    /** 找回密码：向指定邮箱发送重置邮件（未登录状态下调用） */
    async requestPasswordReset(email) {
      return api.auth.requestPasswordReset(email)
    },

    /**
     * 微信一键登录（二期）：code 由页面用 uni.login 拿，
     * 服务端签发 Session 后这里同步刷新全局上下文。
     */
    async signInWithWechat(code) {
      const { user } = await api.auth.signInWithWechat(code)
      this.session = api.session.get()
      this.user = user
      await this.loadFamilyContext()
      return user
    },

    /** 退出登录：只清登录态与本地选择，家庭数据仍属于该家庭（RLS 决定可见性） */
    async signOut() {
      await api.auth.signOut()
      this.session = null
      this.user = null
      this.resetContext()
      writeSelection({ familyId: '', babyByFamily: {} })
    },
  },
})
