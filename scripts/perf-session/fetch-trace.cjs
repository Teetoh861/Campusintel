// Preloaded into `next start` (NODE_OPTIONS=--require). Writes one JSON line per incoming request (start, first
// byte, finish) and per outgoing fetch (start, end, status, bytes, endpoint), tied together by an AsyncLocalStorage
// request id. Measurement only: it never changes a request or a response.
'use strict'
const fs = require('node:fs')
const http = require('node:http')
const { AsyncLocalStorage } = require('node:async_hooks')
const { performance } = require('node:perf_hooks')

const out = process.env.FETCH_TRACE_FILE
if (!out) return
const als = new AsyncLocalStorage()
let seq = 0
const now = () => +(performance.timeOrigin + performance.now()).toFixed(2)
const write = line => fs.appendFileSync(out, JSON.stringify(line) + '\n')

const emit = http.Server.prototype.emit
http.Server.prototype.emit = function (event, req, res) {
  if (event !== 'request') return emit.apply(this, arguments)
  const id = ++seq
  const rec = { kind: 'req', id, method: req.method, url: req.url, rsc: req.headers.rsc === '1',
    prefetch: req.headers['next-router-prefetch'] === '1', start: now() }
  let first = null
  let bytes = 0
  const w = res.write
  res.write = function (chunk) {
    if (first === null) first = now()
    if (chunk) bytes += Buffer.byteLength(chunk)
    return w.apply(this, arguments)
  }
  const e = res.end
  res.end = function (chunk) {
    if (first === null) first = now()
    if (chunk && typeof chunk !== 'function') bytes += Buffer.byteLength(chunk)
    return e.apply(this, arguments)
  }
  res.on('finish', () => write({ ...rec, status: res.statusCode, firstByte: first, end: now(), bytes,
    location: res.getHeader('location') || null }))
  return als.run({ id }, () => emit.apply(this, arguments))
}

const origFetch = globalThis.fetch
globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = (init && init.method) || (typeof input === 'object' && input.method) || 'GET'
  let columns = null
  try { columns = new URL(url).searchParams.get('select') } catch {}
  let endpoint = url
  try { const u = new URL(url); endpoint = u.pathname + (u.pathname.startsWith('/rest/v1/') && !u.pathname.includes('/rpc/') ? '?' + [...u.searchParams.keys()].join(',') : '') } catch {}
  let auth = 'none'
  const h = new Headers((init && init.headers) || (typeof input === 'object' && input.headers) || {})
  const bearer = h.get('authorization') || ''
  if (bearer.startsWith('Bearer sb_secret') || h.get('apikey')?.startsWith('sb_secret')) auth = 'secret'
  else if (bearer.startsWith('Bearer ey')) auth = 'user-jwt'
  else if (h.get('apikey')) auth = 'publishable'
  const stack = (new Error().stack || '').split('\n').filter(l => l.includes('.next/server')).slice(0, 4)
    .map(l => l.replace(/^.*\.next\/server\//, '').replace(/\)$/, ''))
  const ctx = als.getStore()
  const start = now()
  try {
    const res = await origFetch.apply(this, arguments)
    const end = now()
    res.clone().arrayBuffer().then(buf => write({ kind: 'fetch', columns, req: ctx ? ctx.id : null, method, endpoint, auth,
      status: res.status, start, end, bytes: buf.byteLength, stack }), () => {})
    return res
  } catch (error) {
    write({ kind: 'fetch', columns, req: ctx ? ctx.id : null, method, endpoint, auth, error: String(error), start, end: now(), stack })
    throw error
  }
}
