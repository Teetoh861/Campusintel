const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { randomBytes } = require('node:crypto')

test('one player or host poll makes exactly one database request and zero Auth requests', async () => {
  const original = Module._load, originalFetch = global.fetch
  const token = Array.from({ length: 3 },() => randomBytes(24).toString('base64url')).join('.')
  const cookie = 'sb-local-auth-token=base64-' + Buffer.from(JSON.stringify({ access_token: token })).toString('base64url')
  let raw = cookie
  Module._load = function(name,...args) {
    if (name === 'next/headers') return { headers: async () => new Headers({ cookie: raw }) }
    if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => true, getSupabaseConfig: () => ({ url:'http://local.invalid',key:'public-test-configuration' }) }
    return original.call(this,name,...args)
  }
  const file = require.resolve('./poll-server.ts'); delete require.cache[file]
  try {
    const { orientationPoll } = require(file)
    for (const host of [false,true]) {
      const calls = []
      global.fetch = async (url,init) => { calls.push({ url,init }); return Response.json({ status:'inactive' }) }
      const result = await orientationPoll(host,null)
      assert.equal(result.status,200); assert.equal(calls.length,1)
      assert.equal(new URL(calls[0].url).pathname,host ? '/rest/v1/rpc/orientation_host_state' : '/rest/v1/rpc/orientation_poll')
      assert.equal(calls[0].init.headers.Authorization,`Bearer ${token}`)
      assert.equal(calls[0].init.cache,'no-store')
      assert.deepEqual(JSON.parse(calls[0].init.body),{ p_event:null })
    }
    raw = 'ci-student-session-generation=invalid; ' + cookie
    global.fetch = async () => { assert.fail('malformed session must not call the database or Auth') }
    assert.equal((await orientationPoll(false,null)).status,401)
  } finally { Module._load = original; global.fetch = originalFetch; delete require.cache[file] }
})
