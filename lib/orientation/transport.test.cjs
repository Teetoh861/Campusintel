const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { orientationAccessToken } = require('./poll-session.ts')
const { quizRemaining } = require('./clock.ts')
const { quizQrPath } = require('./qr.ts')
const { quizJson } = require('./response.ts')
const { mutationSchema, prizeSchema, staffRequestSchema, hostStateSchema, playerPollInterval, START_COUNTDOWN_MS, GET_READY_MS, ANSWERING_MS, ORIENTATION_BODY_MAX_BYTES } = require('./contract.ts')
const token = Array.from({ length: 3 },() => randomBytes(16).toString('base64url')).join('.')
const session = 'base64-' + Buffer.from(JSON.stringify({ access_token: token })).toString('base64url')
const origin = 'http://127.0.0.1:54321'
const generation = randomBytes(16).toString('hex')

test('cookie transport accepts the exact legacy or selected generation and contiguous chunks',() => {
  assert.equal(orientationAccessToken(`sb-127-auth-token=${session}`,origin),token)
  assert.equal(orientationAccessToken(`ci-student-session-generation=${generation}; ci-student-auth-${generation}=${session}`,origin),token)
  const half = Math.floor(session.length / 2)
  assert.equal(orientationAccessToken(`sb-127-auth-token.0=${session.slice(0,half)}; sb-127-auth-token.1=${session.slice(half)}`,origin),token)
})
test('malformed, duplicate, obsolete and partial cookie generations never recover another session',() => {
  for (const raw of [null,`ci-student-session-generation=invalid; sb-127-auth-token=${session}`,
    `ci-student-session-generation=${generation}; sb-127-auth-token=${session}`,
    `sb-127-auth-token=${session}; sb-127-auth-token=${session}`,
    `sb-127-auth-token=${session}; sb-127-auth-token.0=${session}`,
    `sb-127-auth-token.1=${session}`,`sb-127-auth-token=base64-corrupt`]) assert.equal(orientationAccessToken(raw,origin),null)
})
test('phone countdown includes request transit and ignores wall-clock changes',() => {
  assert.equal(quizRemaining('2026-12-07T10:00:00Z','2026-12-07T10:00:15Z',100,600),14_500)
  assert.equal(quizRemaining('2026-12-07T10:00:00Z','2026-12-07T10:00:15Z',100,15_100),0)
})
test('get-ready uses receipt time so outbound polling delay cannot open options early',() => {
  const server = '2026-12-07T10:00:00Z', opens = '2026-12-07T10:00:04Z'
  const sentAt = 100, receivedAt = 600, now = 4_100
  assert.equal(quizRemaining(server,opens,receivedAt,now),500)
  assert.equal(quizRemaining(server,opens,sentAt,now),0)
  assert.equal(quizRemaining(server,opens,receivedAt,4_600),0)
})
test('responses are private and uncacheable, including failure responses',() => {
  for (const status of [200,400,401,503]) assert.match(quizJson({},status).headers.get('cache-control'),/private, no-store/)
})
test('commands require bounded options and cannot submit identities, scores or accepted timestamps',() => {
  assert.equal(mutationSchema.safeParse({ action:'answer',eventId:crypto.randomUUID(),questionId:crypto.randomUUID(),option:0,userId:crypto.randomUUID() }).success,false)
  assert.equal(mutationSchema.safeParse({ action:'join',pin:'000123',firstName:'Ọlá',surname:'Anne-Marie' }).success,true)
})
test('QR has a quiet zone, finder/data modules and a bounded byte payload',() => {
  const path = quizQrPath('https://campusintell.com/orientation#pin=123456')
  assert.ok(path.startsWith('M4,4h1v1h-1z'))
  assert.ok(path.split('M').length > 500)
  assert.equal(quizQrPath('x'.repeat(107)),null)
})

test('prize and staff requests are bounded and cannot supply a collection actor or timestamp',() => {
  assert.equal(prizeSchema.safeParse('Book voucher').success,true)
  for (const text of ['', 'x'.repeat(161), 'bad\ntext']) assert.equal(prizeSchema.safeParse(text).success,false)
  const input = { eventId:crypto.randomUUID(),code:'not a valid code',collect:false }
  assert.equal(staffRequestSchema.safeParse(input).success,true)
  assert.equal(staffRequestSchema.safeParse({ ...input,collectedBy:crypto.randomUUID() }).success,false)
  assert.equal(staffRequestSchema.safeParse({ ...input,collectedAt:new Date().toISOString() }).success,false)
  assert.equal(mutationSchema.safeParse({ action:'prizes',eventId:crypto.randomUUID(),questionId:null,prizes:['Voucher'] }).success,true)
  assert.equal(mutationSchema.safeParse({ action:'staff-add',eventId:crypto.randomUUID(),questionId:null,email:'helper@example.test' }).success,true)
})
test('the lobby polling budget fits before question 1 opens, and countdown uses monotonic server time',() => {
  assert.equal(START_COUNTDOWN_MS,10_000); assert.equal(GET_READY_MS,4_000); assert.equal(ANSWERING_MS,15_000)
  assert.ok(START_COUNTDOWN_MS > 5_000 * 1.1)
  assert.equal(quizRemaining('2026-12-07T10:00:00Z','2026-12-07T10:00:10Z',500,5_500),5_000)
})

test('the largest Unicode prize list fits this endpoint without changing the shared auth body limit',() => {
  const input={action:'prizes',eventId:crypto.randomUUID(),questionId:null,prizes:Array(300).fill('賞'.repeat(160))}
  assert.equal(mutationSchema.safeParse(input).success,true)
  assert.ok(Buffer.byteLength(JSON.stringify(input))<ORIENTATION_BODY_MAX_BYTES)
})

// Staff collection remains available after Switch off, so an open winner phone must receive its receipt.
test('only uncollected winners keep polling after play is switched off',() => {
  const off = { status:'ok',phase:'off',drawPending:false,me:{ claimCode:'local-test-code',collected:false } }
  assert.equal(playerPollInterval(off),5_000)
  assert.equal(playerPollInterval({ ...off,me:{ ...off.me,collected:true } }),null)
  assert.equal(playerPollInterval({ ...off,me:{ claimCode:null,collected:null } }),null)
  assert.equal(playerPollInterval({ status:'inactive' }),null)
  assert.equal(playerPollInterval({ ...off,phase:'live' }),2_000)
  assert.equal(playerPollInterval({ ...off,phase:'ended',drawPending:true }),2_000)
  assert.equal(playerPollInterval({ ...off,phase:'lobby' }),5_000)
})


test('host contract carries multiple recorded tie orders with no-prize outcomes',() => {
  const a=crypto.randomUUID(),b=crypto.randomUUID(),c=crypto.randomUUID(),d=crypto.randomUUID()
  const groups=[{ position:1,candidates:[a,b],places:2,prizes:['Voucher','Notebook'] },
    { position:3,candidates:[c,d],places:1,prizes:['Notebook',null] }]
  const state={ status:'ok',events:[],ties:{ needed:true,groups },draw:null }
  assert.equal(hostStateSchema.safeParse(state).success,true)
  const drawn={ ...state,ties:null,draw:{ startedBy:crypto.randomUUID(),startedAt:'2026-12-07T12:00:00Z',groups:groups.map(group=>({ ...group,order:[...group.candidates].reverse() })) } }
  assert.equal(hostStateSchema.safeParse(drawn).success,true)
  assert.equal(hostStateSchema.safeParse({ ...drawn,draw:{ ...drawn.draw,groups } }).success,false,'a recorded group needs its complete result order')
})
