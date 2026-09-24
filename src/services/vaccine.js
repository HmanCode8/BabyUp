/**
 * 疫苗记录的业务数据访问层。
 *
 * 状态不在数据库里冗余存储，而是按需求文档 4.6 的规则由 vaccinated_date / scheduled_date 推导，
 * 避免出现"日期与状态不一致"的脏数据。
 */
import { api } from './api'
import { todayString, diffDays } from '@/utils/date'
import { dateAtMonths } from '@/utils/age'
import { trackRecordCreated } from '@/utils/tracker'

const VACCINE_COLUMNS =
  'id,family_id,baby_id,name,dose,scheduled_date,vaccinated_date,hospital,note,created_by,created_at'

/** 计划日期距今 ≤ 7 天视为「即将接种」 */
const SOON_DAYS = 7

export const VACCINE_STATUS_LABEL = {
  vaccinated: '已接种',
  overdue: '已逾期',
  soon: '即将接种',
  pending: '待接种',
}

/**
 * 推导疫苗状态：
 * - 有实际接种日期 -> 已接种
 * - 没有计划日期 -> 待接种
 * - 计划日期已过 -> 已逾期
 * - 计划日期在 7 天内 -> 即将接种
 * - 其余 -> 待接种
 */
export function getVaccineStatus(record, today = todayString()) {
  if (!record) return 'pending'
  if (record.vaccinated_date) return 'vaccinated'
  if (!record.scheduled_date) return 'pending'
  const remain = diffDays(today, record.scheduled_date)
  if (remain < 0) return 'overdue'
  if (remain <= SOON_DAYS) return 'soon'
  return 'pending'
}

/** 给记录补上 status 字段，页面直接用 */
export function withStatus(record, today = todayString()) {
  return { ...record, status: getVaccineStatus(record, today) }
}

/**
 * 汇总待办数量，供「我的」页提醒区使用。
 * todo = 未接种的全部（已逾期 + 即将接种 + 待接种）
 */
export function summarizeVaccinations(list, today = todayString()) {
  const summary = { overdue: 0, soon: 0, pending: 0, vaccinated: 0, todo: 0 }
  ;(list || []).forEach((record) => {
    const status = getVaccineStatus(record, today)
    summary[status] += 1
  })
  summary.todo = summary.overdue + summary.soon + summary.pending
  return summary
}

/** 拉取全部疫苗记录（计划日期新的在前，未排期的排最后） */
export async function listVaccinations(familyId, babyId) {
  if (!familyId || !babyId) return []
  const { data } = await api.db.select('vaccinations', {
    select: VACCINE_COLUMNS,
    match: { family_id: familyId, baby_id: babyId },
    order: 'scheduled_date.desc.nullslast',
    limit: 200,
  })
  return data || []
}

/**
 * 添加一条疫苗记录。
 * vaccinatedDate 留空 = 未接种（只排了计划日期）；从疫苗名字典添加时，
 * 若用户顺手填了接种日期（补录已完成接种），这里一并落库。
 */
export async function createVaccination({
  familyId,
  babyId,
  name,
  dose,
  scheduledDate,
  vaccinatedDate,
}) {
  const createdBy = api.auth.currentUserId()
  if (!createdBy) throw new api.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const rows = await api.db.insert('vaccinations', {
    family_id: familyId,
    baby_id: babyId,
    name: String(name || '').trim(),
    dose: dose ? String(dose).trim() : null,
    scheduled_date: scheduledDate || null,
    vaccinated_date: vaccinatedDate || null,
    created_by: createdBy,
  })
  // 补丁 Step 7：疫苗也是一条「记录」，创建成功后统一上报
  if (rows && rows.length) trackRecordCreated('vaccine')
  return rows && rows.length ? rows[0] : null
}

/**
 * 同一种疾病有多套方案的疫苗：排期只按默认方案排，不能两套都排。
 *
 * 乙脑在官方程序表里有两条路线——减毒活疫苗 2 剂、灭活疫苗 4 剂，二选一。
 * 字典里两条都要留着（推荐库得能选到），但一键排期只排减毒；需要灭活的话，
 * 用「从推荐库添加」逐剂手动加（第 1、2 剂只隔 7~10 天，月龄粒度也表达不出来）。
 * 甲肝同理，但字典里的甲肝灭活疫苗归在二类，本来就不会被排期选中。
 */
const PLAN_ALTERNATIVES = {
  乙脑灭活疫苗: '乙脑减毒活疫苗',
}

/**
 * 按一类疫苗字典推算接种计划（纯函数，方便单独核对日期）。
 *
 * 计划日期 = 生日 + 字典里的起始月龄。这里复用 dateAtMonths（「满 X 月龄那一天」），
 * 与月龄展示、推荐库预填用的是同一套口径，不会出现两处算出来的日期不一样。
 * 起始月龄为 0 的（乙肝第 1 剂、卡介苗）就是生日当天。
 *
 * @param {object} params
 * @param {Array} params.libraryItems vaccine_library 的全部条目
 * @param {string} params.birthday 宝宝生日 'YYYY-MM-DD'
 * @param {string} params.today 今天 'YYYY-MM-DD'
 * @param {boolean} [params.includePast] false = 只排今天及以后的（默认）；
 *        true = 已过期的剂次也排上，用来对着接种证查漏补种
 * @param {Array} [params.existing] 已有记录，用来跳过同「名称 + 剂次」的条目
 * @returns {Array<{ name: string, dose: string, scheduledDate: string }>}
 */
export function buildImmunizationPlan({
  libraryItems,
  birthday,
  today,
  includePast = false,
  existing = [],
}) {
  if (!birthday) return []
  // 去重只看「名称 + 剂次」：字典里乙肝疫苗有三剂，剂次不同要各排各的
  const taken = new Set(
    (existing || []).map((item) => `${String(item.name || '').trim()}|${String(item.dose || '').trim()}`),
  )
  const plan = []
  ;(libraryItems || []).forEach((item) => {
    if (!item || item.category !== 'free') return
    const raw = item.min_age_month
    if (raw === null || raw === undefined || raw === '') return
    const months = Number(raw)
    if (!Number.isFinite(months)) return
    const name = String(item.name || '').trim()
    if (!name) return
    // 默认方案在库里时跳过它的替代方案，避免乙脑减毒和灭活被同时排上（见 PLAN_ALTERNATIVES）
    const defaultName = PLAN_ALTERNATIVES[name]
    if (defaultName && (libraryItems || []).some((row) => row && row.name === defaultName)) return
    const dose = String(item.dose || '').trim()
    if (taken.has(`${name}|${dose}`)) return
    const scheduledDate = dateAtMonths(birthday, months)
    if (!scheduledDate) return
    if (!includePast && scheduledDate < today) return
    plan.push({ name, dose, scheduledDate })
  })
  return plan
}

/**
 * 批量生成接种计划。
 *
 * 为什么要分批：云函数 data 的 actionInsert 是**逐行**处理的
 * （guardInsert → 内容安全检查 → 写入 → 回读，见 cloudfunctions/data/index.js），
 * 一次塞 22 行串行跑下来会超过云函数 3 秒超时，导致「写了一半就中断」。
 * 分成每批 5 条，每批一次云函数调用，稳在超时之内。
 *
 * 中途失败也不算灾难：返回前已经把成功的条数拼进错误信息，而且调用方
 * （vaccine 页的 buildImmunizationPlan）会按「名称 + 剂次」跳过已排过的，
 * 所以直接再点一次即可接着生成，不会重复。
 */
const PLAN_BATCH_SIZE = 5

export async function createVaccinations({ familyId, babyId, items }) {
  const createdBy = api.auth.currentUserId()
  if (!createdBy) throw new api.ApiError('登录态已失效，请重新登录', 401, 'NO_SESSION')
  const rows = (items || [])
    .filter((item) => item && item.name)
    .map((item) => ({
      family_id: familyId,
      baby_id: babyId,
      name: String(item.name).trim(),
      dose: item.dose ? String(item.dose).trim() : null,
      scheduled_date: item.scheduledDate || null,
      vaccinated_date: null,
      created_by: createdBy,
    }))
  if (!rows.length) return []

  const saved = []
  for (let index = 0; index < rows.length; index += PLAN_BATCH_SIZE) {
    const chunk = rows.slice(index, index + PLAN_BATCH_SIZE)
    try {
      const part = await api.db.insert('vaccinations', chunk)
      if (part && part.length) saved.push(...part)
    } catch (err) {
      if (saved.length) {
        throw new api.ApiError(
          `已生成 ${saved.length} 条，剩下的失败了（${err.message || '网络异常'}）。再点一次会接着生成，已排过的自动跳过`,
          0,
          'PARTIAL_INSERT',
        )
      }
      throw err
    }
  }
  // 一次生成多剂只上报一条，附带 batch 说明这次生成了几条
  if (saved.length) trackRecordCreated('vaccine', { batch: saved.length })
  return saved
}

/**
 * 标记已接种。
 * 微信小程序不支持 PATCH，统一走 upsert 提交整行（先过滤出数据库真实列）。
 */
export async function markVaccinated(record, vaccinatedDate) {
  const rows = await api.db.upsert('vaccinations', {
    ...api.db.pickColumns(record, VACCINE_COLUMNS),
    vaccinated_date: vaccinatedDate,
  })
  return rows && rows.length ? rows[0] : null
}

/** 修改一条疫苗记录（名称/剂次/计划日期填错了能改），同样走 upsert 提交整行 */
export async function updateVaccination(record) {
  const rows = await api.db.upsert(
    'vaccinations',
    api.db.pickColumns(record, VACCINE_COLUMNS),
  )
  return rows && rows.length ? rows[0] : null
}

/** 删除一条疫苗记录（添加错了能删掉） */
export async function removeVaccination(id) {
  await api.db.remove('vaccinations', { id })
}
