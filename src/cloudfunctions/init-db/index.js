/**
 * 一次性初始化云开发数据库（迁移计划 · 阶段 2）。
 *
 * 做两件事，均可重复执行：
 *   1. 建齐 17 个集合（对应 Supabase 侧的 17 张表）。已存在的集合跳过，不算失败。
 *   2. 给 vaccine_library 灌入疫苗字典种子（一类 22 条 + 二类 28 条）。
 *      只有集合为空时才写，重复执行不会产生重复数据。
 *
 * 种子数据来源：supabase/migrations/009_patch_phase1_2.sql（4.5 节）
 *              supabase/migrations/012_vaccine_library_paid.sql
 * 云开发从空库开始，没有 SQL 迁移，所以字典数据必须在这里补一次，
 * 否则「疫苗知识库」页面在云开发后端下是空的。
 *
 * 用法：微信开发者工具打开小程序产物目录 → 右键本云函数「上传并部署：云端安装依赖」
 *      → 在「云函数 → 本地调试/云端测试」里用空参数调用一次，看返回清单。
 *
 * ⚠️ 调用前必须先把本函数的超时时间调大（云开发控制台 → 云函数 → init-db → 配置 → 超时时间，
 *    默认 3 秒不够，改成 20 秒）。代码里已尽量并发，但首次初始化仍可能超过 3 秒。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

/** 全部集合，与 Supabase 的 17 张表一一对应 */
const COLLECTIONS = [
  'families',
  'family_members',
  'family_invitations',
  'babies',
  'baby_photos',
  'growth_records',
  'vaccinations',
  'feeding_records',
  'sleep_records',
  'diaper_records',
  'milestones',
  'profiles',
  'vaccine_library',
  'app_logs',
  // 第三期新增（对应迁移 014）
  'feedbacks',
  'illness_records',
  'checkup_records',
]

/**
 * 一类（免费）疫苗 26 条，来自迁移 009 的 4.5 节，另加 2021 版程序表里的乙脑灭活 4 剂。
 * 免责声明照旧：以下月龄为常见程序参考，实际以当地接种门诊与《预防接种证》为准。
 * 字段顺序：name, dose, min_age_month, max_age_month, note（category/sort_order 由下标推出）
 */
const VACCINE_FREE = [
  ['乙肝疫苗', '第1剂', 0, 0, '出生24小时内'],
  ['卡介苗', '1剂', 0, 0, '出生时'],
  ['乙肝疫苗', '第2剂', 1, 1, '1月龄'],
  ['脊灰疫苗', '第1剂', 2, 2, '2月龄'],
  ['脊灰疫苗', '第2剂', 3, 3, '3月龄'],
  ['百白破疫苗', '第1剂', 3, 3, '3月龄'],
  ['百白破疫苗', '第2剂', 4, 4, '4月龄'],
  ['脊灰疫苗', '第3剂', 4, 4, '4月龄'],
  ['百白破疫苗', '第3剂', 5, 5, '5月龄'],
  ['乙肝疫苗', '第3剂', 6, 6, '6月龄'],
  ['流脑A群疫苗', '第1剂', 6, 6, '6月龄'],
  ['麻腮风疫苗', '第1剂', 8, 8, '8月龄'],
  ['乙脑减毒活疫苗', '第1剂', 8, 8, '8月龄'],
  ['流脑A群疫苗', '第2剂', 9, 9, '9月龄'],
  ['甲肝减毒活疫苗', '1剂', 18, 18, '18月龄'],
  ['百白破疫苗', '第4剂', 18, 18, '18月龄'],
  ['麻腮风疫苗', '第2剂', 18, 18, '18月龄'],
  ['乙脑减毒活疫苗', '第2剂', 24, 24, '2岁'],
  ['流脑A+C群疫苗', '第1剂', 36, 36, '3岁'],
  ['脊灰疫苗', '第4剂', 48, 48, '4岁'],
  ['流脑A+C群疫苗', '第2剂', 72, 72, '6岁'],
  ['白破疫苗', '1剂', 72, 72, '6岁'],
  // 乙脑的另一条路线（灭活 4 剂）。排在末尾是为了和线上已灌的 22 条保持 sort_order 一致，
  // 不因为中间插入而把后面的条目整体挪位。
  ['乙脑灭活疫苗', '第1剂', 8, 8, '乙脑灭活方案：与第 2 剂间隔 7~10 天'],
  ['乙脑灭活疫苗', '第2剂', 8, 8, '与第 1 剂间隔 7~10 天，计划日期需手动改'],
  ['乙脑灭活疫苗', '第3剂', 24, 24, '2岁'],
  ['乙脑灭活疫苗', '第4剂', 72, 72, '6岁'],
]

/**
 * 二类（自费）疫苗 28 条，来自迁移 012，sort_order 从 101 起。
 * ⚠️ 同上免责声明；不同厂家剂次（尤其轮状病毒疫苗）与各地接种程序差异较大。
 */
const VACCINE_PAID = [
  ['13价肺炎球菌多糖结合疫苗', '第1剂', 2, 2, '2 月龄起'],
  ['13价肺炎球菌多糖结合疫苗', '第2剂', 4, 4, '与上一剂间隔约 1 个月'],
  ['13价肺炎球菌多糖结合疫苗', '第3剂', 6, 6, '6 月龄'],
  ['13价肺炎球菌多糖结合疫苗', '第4剂', 12, 15, '12~15 月龄加强'],
  ['五联疫苗', '第1剂', 2, 2, '可替代脊灰、百白破与 Hib'],
  ['五联疫苗', '第2剂', 3, 3, '与上一剂间隔约 1 个月'],
  ['五联疫苗', '第3剂', 4, 4, '与上一剂间隔约 1 个月'],
  ['五联疫苗', '第4剂', 18, 18, '18 月龄加强'],
  ['b型流感嗜血杆菌疫苗(Hib)', '第1剂', 2, 2, '2 月龄起'],
  ['b型流感嗜血杆菌疫苗(Hib)', '第2剂', 3, 3, '与上一剂间隔约 1 个月'],
  ['b型流感嗜血杆菌疫苗(Hib)', '第3剂', 4, 4, '与上一剂间隔约 1 个月'],
  ['b型流感嗜血杆菌疫苗(Hib)', '第4剂', 18, 18, '18 月龄加强'],
  ['轮状病毒疫苗', '第1剂', 2, 3, '口服，建议尽早接种'],
  ['轮状病毒疫苗', '第2剂', 4, 4, '剂次安排以所选厂家为准'],
  ['轮状病毒疫苗', '第3剂', 5, 5, '剂次安排以所选厂家为准'],
  ['EV71手足口病疫苗', '第1剂', 6, 6, '6 月龄起'],
  ['EV71手足口病疫苗', '第2剂', 7, 7, '与第 1 剂间隔 1 个月'],
  ['水痘减毒活疫苗', '第1剂', 12, 12, '12 月龄'],
  ['水痘减毒活疫苗', '第2剂', 48, 48, '4 岁'],
  ['流感疫苗', '第1剂', 6, 6, '6 月龄起，每年接种'],
  ['流感疫苗', '第2剂', 7, 7, '首次接种需 2 剂，间隔约 1 个月'],
  ['甲肝灭活疫苗', '第1剂', 18, 18, '18 月龄'],
  ['甲肝灭活疫苗', '第2剂', 24, 24, '与第 1 剂间隔约 6 个月'],
  ['23价肺炎球菌多糖疫苗', '1剂', 24, 24, '2 岁起，高风险儿童遵医嘱'],
  ['流脑AC结合疫苗', '第1剂', 6, 6, '可替代流脑 A 群疫苗'],
  ['流脑AC结合疫苗', '第2剂', 7, 7, '与第 1 剂间隔约 1 个月'],
  ['流脑ACYW135群多糖疫苗', '1剂', 36, 36, '3 岁起'],
  ['狂犬病疫苗', '1剂', 0, 0, '暴露后按门诊医嘱接种'],
]

/** 把紧凑数组展开成待写入的文档 */
function buildVaccineRows() {
  const rows = []
  VACCINE_FREE.forEach((item, index) => {
    rows.push({
      name: item[0],
      dose: item[1],
      min_age_month: item[2],
      max_age_month: item[3],
      category: 'free',
      note: item[4],
      sort_order: index + 1,
    })
  })
  VACCINE_PAID.forEach((item, index) => {
    rows.push({
      name: item[0],
      dose: item[1],
      min_age_month: item[2],
      max_age_month: item[3],
      category: 'paid',
      note: item[4],
      sort_order: 101 + index,
    })
  })
  return rows
}

/**
 * 分批并发执行，避免一次性把请求全打出去触发限流。
 * 云函数默认超时只有 3 秒，串行做 14 次建集合 + 50 次插入必然超时
 * （报 `Invoking task timed out after 3 seconds`），所以这里必须并发。
 */
async function inBatches(items, size, worker) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(worker))
  }
}

/**
 * 建集合：createCollection 对已存在的集合会报错。
 * 只有创建失败时才多花一次 count 去复核——能查通说明集合本来就在，算「已存在」。
 */
async function createCollections() {
  const created = []
  const existed = []
  const failed = []
  await inBatches(COLLECTIONS, 5, async (name) => {
    try {
      await db.createCollection(name)
      created.push(name)
      return
    } catch (err) {
      // 已存在是最常见的报错，不在这里判失败
    }
    try {
      await db.collection(name).count()
      existed.push(name)
    } catch (err) {
      failed.push({ name, message: (err && err.errMsg) || (err && err.message) || String(err) })
    }
  })
  return { created, existed, failed }
}

/** 灌种子：集合为空才写，重复执行安全 */
async function seedVaccineLibrary() {
  const { total } = await db.collection('vaccine_library').count()
  if (total > 0) return { skipped: true, existing: total }
  const rows = buildVaccineRows()
  await inBatches(rows, 10, (row) => db.collection('vaccine_library').add({ data: row }))
  return { skipped: false, inserted: rows.length }
}

exports.main = async () => {
  try {
    const collections = await createCollections()
    const vaccine = await seedVaccineLibrary()
    return {
      ok: collections.failed.length === 0,
      collections,
      vaccine,
    }
  } catch (err) {
    return {
      ok: false,
      message: (err && err.errMsg) || (err && err.message) || String(err),
    }
  }
}
