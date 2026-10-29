// Uses the audit's preloaded fetch tracer and critical-path counter on real production-server page requests.
const fs = require('node:fs')
const { summarize } = require('./call-budget.cjs')
const options = Object.fromEntries(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.join('=')]
}))
const runs = Number(options.runs || 3)
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main(overrides = {}) {
  Object.assign(options, overrides)
  const base = options.base || 'http://localhost:3134'
  if (!options.trace || !options.users || !options.out || !options.course) throw new Error('Required: --trace --users --out --course')
  if (!Number.isInteger(runs) || runs < 3) throw new Error('At least three runs required')
  const users = JSON.parse(fs.readFileSync(options.users, 'utf8'))
  const slug = 'financial-accounting-1'
  const screens = [
    ['dashboard', 'ada', '/dashboard'], ['my-courses', 'ada', '/my-courses'],
    ['course-open', 'ada', `/courses/${slug}`], ['course-locked', 'bola', `/courses/${slug}`],
    ['quiz', 'ada', `/courses/${slug}/quiz`], ['access', 'ada', '/access'], ['account', 'ada', '/account'],
    ['courses', 'ada', '/courses'], ['bookmarks', 'ada', '/bookmarks'], ['materials', 'ada', '/materials'],
    ['profile-selection', 'ada', '/profile-selection'], ['course-materials', 'ada', `/courses/${slug}/materials`],
    ['theory', 'ada', `/courses/${slug}/theory`], ['preview', 'bola', `/courses/${slug}/preview/study-guide`],
    ['ai-practice', 'ada', `/courses/ai-practice/${options.course}`], ['account-deletion', 'ada', '/account/deletion'],
  ]
  const measured = options.only && fs.existsSync(options.out) ? JSON.parse(fs.readFileSync(options.out, 'utf8')) : {}
  async function one(user, path) {
    const offset = fs.existsSync(options.trace) ? fs.statSync(options.trace).size : 0
    const headers = { cookie: users[user].cookie, 'accept-encoding': 'gzip' }
    if (options.mode === 'rsc') {
      const navigation = JSON.parse(fs.readFileSync(options.navigationHeaders, 'utf8'))
      for (const key of ['rsc', 'next-router-state-tree', 'next-url']) if (navigation[key]) headers[key] = navigation[key]
      if (path === '/dashboard') {
        const tree = JSON.parse(decodeURIComponent(headers['next-router-state-tree']))
        tree[1].children[0] = 'my-courses'
        headers['next-router-state-tree'] = encodeURIComponent(JSON.stringify(tree)); headers['next-url'] = '/my-courses'
      }
    }
    const updateCookies = response => {
      const writes = response.headers.getSetCookie()
      if (writes.length) {
        const jar = new Map(users[user].cookie.split('; ').filter(Boolean).map(pair => {
          const separator = pair.indexOf('='); return [pair.slice(0, separator), pair.slice(separator + 1)]
        }))
        for (const cookie of writes) {
          const [pair] = cookie.split(';'); const separator = pair.indexOf('=')
          const name = pair.slice(0, separator), value = pair.slice(separator + 1)
          if (!value || /max-age=0(?:;|$)/i.test(cookie)) jar.delete(name)
          else jar.set(name, value)
        }
        users[user].cookie = [...jar].map(([key, value]) => `${key}=${value}`).join('; ')
        fs.writeFileSync(options.users, JSON.stringify(users, null, 2), { mode: 0o600 })
      }
    }
    let response = await fetch(base + path, { redirect: 'manual', headers })
    updateCookies(response)
    const canonical = response.headers.get('location')
    if (options.mode === 'rsc' && canonical) {
      const url = new URL(canonical, base)
      if (url.pathname === path && url.searchParams.has('_rsc')) {
        await response.arrayBuffer(); headers.cookie = users[user].cookie
        response = await fetch(url, { redirect: 'manual', headers }); updateCookies(response)
      }
    }
    await response.arrayBuffer()
    await wait(400) // Same clone-flush wait as the original audit.
    const records = fs.readFileSync(options.trace, 'utf8').slice(offset).trim().split('\n').filter(Boolean).map(JSON.parse)
    const request = records.filter(line => line.kind === 'req' && new URL(line.url, base).pathname === path).at(-1)
    if (!request) throw new Error('No linked request trace: ' + path)
    const calls = records.filter(line => line.kind === 'fetch' && line.req === request.id)
    return { status: response.status, location: response.headers.get('location'), totalMs: request.end - request.start,
      firstByteMs: request.firstByte - request.start, ...summarize(calls), calls }
  }
  for (const [name, user, path] of screens) {
    if (options.only && options.only !== name) continue
    await one(user, path)
    const samples = []
    for (let i = 0; i < runs; i++) samples.push(await one(user, path))
    measured[name] = { path, user, serverMs: median(samples.map(r => r.totalMs)),
      calls: median(samples.map(r => r.calls.length)), depth: median(samples.map(r => r.depth)),
      identityCalls: median(samples.map(r => r.identityCalls)), identityDepth: median(samples.map(r => r.identityDepth)),
      runs: samples }
    // Keep raw calls in each sample; summarize()'s numeric calls field must not overwrite them.
    fs.writeFileSync(options.out, JSON.stringify(measured, null, 2))
    const result = measured[name]
    console.log(`${name}: ${result.serverMs.toFixed(1)} ms, chain ${result.depth}, total ${result.calls}, identity ${result.identityDepth}/${result.identityCalls}`)
  }
  return measured
}

module.exports = { measurePages: main }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
