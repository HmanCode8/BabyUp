/**
 * 云开发数据访问层（迁移计划 · 阶段 2）。
 *
 * 与 ../supabase/db.js 同形：select / selectOne / insert / insertSilent / upsert / remove / rpc / pickColumns，
 * 业务层（src/services/*.js）一行都不用改。差异全部收在本文件的翻译逻辑里：
 *
 *   1. PostgREST 的 filters 语法（'gte.xxx' / 'in.(a,b)' / 数组形式的 range）
 *      翻译成通用云函数 data 的 where 条件数组 [{ field, op, value }]。
 *      为什么不让客户端直连数据库：云开发安全规则只认 `_openid`，
 *      做不了「必须是某家庭 active 成员」这类跨集合校验，所以读写统一走云函数。
 *   2. order 字符串（'a.desc,b.asc'，可能带 nullslast / nullsfirst）翻译成 [{ field, direction }]；
 *      云开发的 orderBy 表达不了 null 排序，带 nulls 声明的排序在客户端补排（见 applyLocalOrder）。
 *   3. 主键差异：集合里是 `_id`，客户端看到的是 `id`，由云函数透明映射。
 *
 * 注意：本文件只在 mp-weixin 平台被调用（H5 由 ../api.js 强制回落 Supabase）。
 */
import { ApiError } from '../supabase/http'

/** 通用数据云函数名，与 src/cloudfunctions/data 对应 */
const DATA_FUNCTION = 'data'

/** PostgREST filters 支持的操作符，项目里实际用到的就这几个 */
const FILTER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']

// ---------------------------------------------------------------------------
// 调用云函数
// ---------------------------------------------------------------------------

/**
 * 调用 data 云函数。
 * 成功返回整个 { ok: true, data, total }；失败（业务错误或网络错误）抛 ApiError。
 * storage.js 的换链接/删文件也复用这里（云存储操作同样由该云函数代理）。
 */
export function callData(payload) {
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    if (typeof wx === 'undefined' || !wx.cloud) {
      reject(new ApiError('当前环境不支持微信云开发', 0, 'CLOUD_UNAVAILABLE'))
      return
    }
    wx.cloud.callFunction({
      name: DATA_FUNCTION,
      data: payload,
      success: (res) => {
        const result = res && res.result
        if (!result) {
          reject(new ApiError('数据服务返回异常', 0, 'BAD_RESPONSE', res))
          return
        }
        if (result.ok) {
          resolve(result)
          return
        }
        reject(new ApiError(result.message || '数据操作失败', 0, result.code || ''))
      },
      fail: (err) => {
        console.error('[Cloud] 调用 data 云函数失败', payload.action, payload.table || payload.fn, err)
        reject(new ApiError('网络连接失败，请检查网络后重试', 0, 'NETWORK_ERROR', err))
      },
    })
    // #endif

    // #ifndef MP-WEIXIN
    reject(new ApiError('云开发后端仅在微信小程序端可用', 0, 'CLOUD_UNAVAILABLE'))
    // #endif
  })
}

// ---------------------------------------------------------------------------
// 查询条件翻译
// ---------------------------------------------------------------------------

function asArray(value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/** 把一条 PostgREST 条件（'gte.2026-01-01'）翻译成 [{ field, op, value }] */
function parseFilter(field, raw) {
  const text = String(raw)
  const dot = text.indexOf('.')
  const op = dot < 0 ? '' : text.slice(0, dot)
  const value = dot < 0 ? '' : text.slice(dot + 1)

  if (op === 'in') {
    const inner = value.replace(/^\(/, '').replace(/\)$/, '')
    const list = inner
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '')
    return [{ field, op: 'in', value: list }]
  }
  if (FILTER_OPS.indexOf(op) < 0) {
    throw new ApiError(`无法识别的查询条件：${field}=${text}`, 0, 'BAD_FILTER')
  }
  return [{ field, op, value }]
}

/**
 * 合并 match（等值）与 filters（PostgREST 语法）成一个条件数组。
 * 与 supabase 版一致：match 优先，覆盖 filters 里同名字段。
 */
function buildConditions(match, filters) {
  const matchKeys = Object.keys(match || {}).filter(
    (key) => match[key] !== undefined && match[key] !== null,
  )
  const conditions = []
  Object.keys(filters || {}).forEach((field) => {
    if (matchKeys.indexOf(field) >= 0) return
    const raw = filters[field]
    if (raw === undefined || raw === null) return
    asArray(raw).forEach((item) => {
      parseFilter(field, item).forEach((condition) => conditions.push(condition))
    })
  })
  matchKeys.forEach((field) => {
    conditions.push({ field, op: 'eq', value: match[field] })
  })
  return conditions
}

// ---------------------------------------------------------------------------
// 排序翻译
// ---------------------------------------------------------------------------

/**
 * 解析 PostgREST 的 order 字符串。
 * 'achieved_date.desc,created_at.desc' -> [{field,direction,nulls}, ...]
 * nulls 只在显式写了 nullslast / nullsfirst 时才有值。
 */
function parseOrder(order) {
  if (!order) return []
  return String(order)
    .split(',')
    .map((chunk) => {
      const parts = chunk.trim().split('.')
      const field = parts[0]
      let nulls = null
      if (parts.indexOf('nullslast') >= 0) nulls = 'last'
      else if (parts.indexOf('nullsfirst') >= 0) nulls = 'first'
      return { field, direction: parts[1] === 'desc' ? 'desc' : 'asc', nulls }
    })
    .filter((item) => item.field)
}

function isNullValue(value) {
  return value === undefined || value === null
}

function compareRows(left, right, order) {
  for (let i = 0; i < order.length; i += 1) {
    const item = order[i]
    const leftValue = left[item.field]
    const rightValue = right[item.field]
    const leftNull = isNullValue(leftValue)
    const rightNull = isNullValue(rightValue)
    if (leftNull || rightNull) {
      if (leftNull && rightNull) continue
      // 没写 nulls 时按 Postgres 默认：升序 NULLS LAST、降序 NULLS FIRST
      const nulls = item.nulls || (item.direction === 'desc' ? 'first' : 'last')
      if (leftNull) return nulls === 'first' ? -1 : 1
      return nulls === 'first' ? 1 : -1
    }
    if (leftValue === rightValue) continue
    const result = leftValue > rightValue ? 1 : -1
    return item.direction === 'desc' ? -result : result
  }
  return 0
}

/**
 * 云开发的 orderBy 控制不了 null 的位置（它把缺失/null 当最小值），
 * 因此只要 order 里显式写了 nulls，就在客户端把这一页按完整排序规则补排一次。
 * 数据量大又带分页时应改成两次查询，当前唯一调用方（疫苗列表）取的是同一婴儿的全量记录，补排是准确的。
 */
function applyLocalOrder(rows, order) {
  const list = rows || []
  if (!order.length || !order.some((item) => item.nulls)) return list
  return list.slice().sort((left, right) => compareRows(left, right, order))
}

// ---------------------------------------------------------------------------
// 对外接口（与 supabase/db.js 同形）
// ---------------------------------------------------------------------------

/** 查询多行 */
export async function select(table, options = {}) {
  const { select: columns = '*', match, filters, order, limit, offset, count } = options
  const orderList = parseOrder(order)

  const payload = {
    action: 'select',
    table,
    where: buildConditions(match, filters),
  }
  if (orderList.length) {
    payload.order = orderList.map((item) => ({ field: item.field, direction: item.direction }))
  }
  if (limit) payload.limit = limit
  if (offset) payload.skip = offset
  if (count) payload.count = true
  if (columns && columns !== '*') {
    payload.columns = String(columns)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  const res = await callData(payload)
  return {
    data: applyLocalOrder(res.data, orderList),
    total: res.total === undefined ? null : res.total,
  }
}

/** 查询单行，查不到返回 null */
export async function selectOne(table, options = {}) {
  const { data } = await select(table, { ...options, limit: 1 })
  return data && data.length ? data[0] : null
}

/** 插入多行，返回插入后的完整数据 */
export async function insert(table, rows) {
  const res = await callData({ action: 'insert', table, rows })
  return res.data
}

/** 插入但不回读（app_logs 这类「只写不可读」的表专用） */
export async function insertSilent(table, rows) {
  await callData({ action: 'insertSilent', table, rows })
}

/** 插入或整行更新（云函数内先查存在再 update / add），返回更新后的完整数据 */
export async function upsert(table, rows) {
  const res = await callData({ action: 'upsert', table, rows })
  return res.data
}

/** 删除符合条件的行 */
export async function remove(table, match, filters) {
  await callData({ action: 'remove', table, where: buildConditions(match, filters) })
}

/** 调用数据库函数（已在云函数 data 内用 JS 重写） */
export async function rpc(fnName, args = {}) {
  const res = await callData({ action: 'rpc', fn: fnName, args })
  return res.data
}

/**
 * 只挑出数据库真实存在的列。
 * 整行写回（upsert）时必须先过滤：把前端派生字段（如照片的 url）带进去会写脏数据。
 */
export function pickColumns(row, columns) {
  const result = {}
  String(columns)
    .split(',')
    .forEach((key) => {
      if (row[key] !== undefined) result[key] = row[key]
    })
  return result
}

export const db = { select, selectOne, insert, insertSilent, upsert, remove, rpc, pickColumns }

export default db
