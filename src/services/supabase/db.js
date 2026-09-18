/**
 * PostgREST 数据访问层。
 *
 * 关于「更新」的重要约定（微信小程序限制）：
 * wx.request / uni.request 支持的 method 只有 OPTIONS/GET/HEAD/POST/PUT/DELETE/TRACE/CONNECT，
 * 没有 PATCH，而 PostgREST 的部分更新走的正是 PATCH。
 * 因此本层不提供 update()，所有更新一律走 upsert()（POST + Prefer: resolution=merge-duplicates），
 * 由调用方提交完整行；这样 H5 与微信小程序行为一致，且 RLS 策略照常生效。
 */
import { request } from './http'

/** 把 { family_id: 'x' } 这类等值条件转成 PostgREST 的 filters 写法 */
function buildFilters(match, filters) {
  const result = { ...(filters || {}) }
  Object.keys(match || {}).forEach((key) => {
    const value = match[key]
    if (value === undefined || value === null) return
    result[key] = `eq.${value}`
  })
  return result
}

/** 从 content-range 头里解析总数，例如 "0-19/123" -> 123 */
function parseTotal(header) {
  const contentRange = header && (header['content-range'] || header['Content-Range'])
  if (!contentRange || !contentRange.includes('/')) return null
  const total = Number(contentRange.split('/')[1])
  return Number.isFinite(total) ? total : null
}

/** 查询多行。filters 直接用 PostgREST 语法，如 { taken_at: 'lt.2026-01-01' } */
export async function select(table, options = {}) {
  const { select: columns = '*', match, filters, order, limit, offset, count } = options
  const query = {
    select: columns,
    ...buildFilters(match, filters),
  }
  if (order) query.order = order
  if (limit) query.limit = limit
  if (offset) query.offset = offset
  const headers = count ? { Prefer: 'count=exact' } : {}
  const res = await request({ path: `/rest/v1/${table}`, method: 'GET', query, headers })
  return { data: res.data || [], total: parseTotal(res.header) }
}

/** 查询单行，查不到返回 null */
export async function selectOne(table, options = {}) {
  const { data } = await select(table, { ...options, limit: 1 })
  return data && data.length ? data[0] : null
}

/** 插入多行，返回插入后的完整数据 */
export async function insert(table, rows, options = {}) {
  const res = await request({
    path: `/rest/v1/${table}`,
    method: 'POST',
    query: { select: options.select || '*' },
    headers: { Prefer: 'return=representation' },
    data: rows,
  })
  return res.data
}

/**
 * 插入但不回读（用于 app_logs 这类「只写不可读」的表）。
 *
 * 不能用上面的 insert()：它带 Prefer: return=representation，PostgREST 会加
 * RETURNING 把整行读回来，而 app_logs 故意没有 select 策略，
 * 于是整条请求会被 RLS 判 403（实测报 new row violates row-level security policy），
 * 连写入都会失败。这里只发裸 POST，不带任何回读。
 */
export async function insertSilent(table, rows) {
  await request({
    path: `/rest/v1/${table}`,
    method: 'POST',
    data: rows,
  })
}

/** 插入或整行更新（冲突时按 onConflict 指定的列合并），返回受影响后的完整数据 */
export async function upsert(table, rows, options = {}) {
  const res = await request({
    path: `/rest/v1/${table}`,
    method: 'POST',
    query: { select: options.select || '*', on_conflict: options.onConflict || 'id' },
    headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
    data: rows,
  })
  return res.data
}

/** 删除符合条件的行 */
export async function remove(table, match, filters) {
  await request({
    path: `/rest/v1/${table}`,
    method: 'DELETE',
    query: buildFilters(match, filters),
  })
}

/** 调用数据库函数（Postgres function） */
export async function rpc(fnName, args = {}) {
  const res = await request({
    path: `/rest/v1/rpc/${fnName}`,
    method: 'POST',
    data: args,
  })
  return res.data
}

/**
 * 只挑出数据库真实存在的列。
 * 整行写回（upsert）时必须先过滤：把前端派生字段（如照片的 url）带进去，
 * PostgREST 会以 PGRST204 拒绝。
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
