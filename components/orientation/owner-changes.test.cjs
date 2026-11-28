const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const event = crypto.randomUUID(), other = crypto.randomUUID()

async function fixture(run) {
  const load = Module._load, extension = Module._extensions['.tsx'], cache = new Set(Object.keys(require.cache))
  const state = { status:'ready',events:[{ id:event,title:'Orientation quiz' }],calls:[],props:null,failure:false,mockStaff:false }
  try {
    Module._extensions['.tsx'] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
      compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true },
    }).outputText,file)
    Module._load = function(name,...args) {
      if (name === 'next/link') return { __esModule:true,default:({ children,...props }) => React.createElement('a',props,children) }
      if (name === '@/components/student/StudentPage') return { StudentPage:({ children }) => React.createElement('main',null,children) }
      if (name === '@/components/auth/AuthShell') return { AuthUnavailable:() => React.createElement('p',null,'Unavailable') }
      if (name === '@/components/auth/AuthFlowSync') return { AuthFlowSync:() => null }
      if (name === '@/lib/auth/account-continuity') return { issueAccountContinuityToken:() => 'rendered-session' }
      if (name === '@/lib/auth/mutation-context') return { getLiveSessionContext:async () => ({ status:state.status,context:{ user:{ id:crypto.randomUUID() },sessionId:crypto.randomUUID(),client:{ rpc:async (...input) => {
        state.calls.push(input); return { data:state.failure ? null : { events:state.events },error:state.failure }
      } } } }) }
      if (name === '@/components/orientation/StaffCollection' && state.mockStaff) return { StaffCollection:props => { state.props=props;return React.createElement('div',null,'Collection form') } }
      return load.call(this,name,...args)
    }
    await run(state)
  } finally {
    Module._load=load
    if (extension) Module._extensions['.tsx']=extension;else delete Module._extensions['.tsx']
    for (const name of Object.keys(require.cache)) if (!cache.has(name)) delete require.cache[name]
  }
}

test('winner phone presents awarded position, full name, prize and then a large code; collection keeps the name and prize',async () => fixture(async () => {
  const { Claim } = require('./parts.tsx')
  const me={ name:'Amara Okafor',score:8,position:1,prizePosition:1,prize:'Book voucher',claimCode:'0123456789ABCDEF',collected:false }
  const html=renderToStaticMarkup(React.createElement(Claim,{ me }))
  assert.match(html,/Position 1/);assert.match(html,/Amara Okafor/);assert.match(html,/Book voucher/)
  assert.ok(html.indexOf('Book voucher')<html.indexOf('0123 4567 89AB CDEF'))
  assert.match(html,/text-2xl/)
  const collected=renderToStaticMarkup(React.createElement(Claim,{ me:{ ...me,collected:true } }))
  for (const text of ['Position 1','Amara Okafor','Book voucher','Collected']) assert.ok(collected.includes(text))
  assert.ok(!collected.includes('0123 4567'))
}))
test('single-event staff form shows only its assigned event and code task',async () => fixture(async () => {
  const { StaffCollection } = require('./StaffCollection.tsx')
  const html=renderToStaticMarkup(React.createElement(StaffCollection,{ events:[{ id:event,title:'Orientation quiz' }],initialEvent:event,token:'rendered-session' }))
  for (const text of ['Prize collection','Orientation quiz','Claim code','Check code']) assert.ok(html.includes(text))
  assert.doesNotMatch(html,/<select|Start quiz|Question preview|Staff account email|Book voucher/)
}))
test('staff page authorizes from the session through its event RPC and refuses accounts with no event membership',async () => fixture(async state => {
  state.mockStaff=true;state.events=[]
  const page=require('../../app/orientation/collect/page.tsx').default
  const html=renderToStaticMarkup(await page({ searchParams:Promise.resolve({ event:other }) }))
  assert.match(html,/Staff access required/);assert.ok(!html.includes('Collection form'))
  assert.deepEqual(state.calls,[['orientation_staff_events']])
}))
test('staff page never selects an unassigned event from a URL, and signed-out or unavailable accounts get no codes',async () => fixture(async state => {
  state.mockStaff=true
  const page=require('../../app/orientation/collect/page.tsx').default
  renderToStaticMarkup(await page({ searchParams:Promise.resolve({ event:other }) }))
  assert.equal(state.props.initialEvent,event);assert.deepEqual(state.props.events,[{ id:event,title:'Orientation quiz' }])
  state.calls=[];state.status='signed-out'
  assert.match(renderToStaticMarkup(await page({ searchParams:Promise.resolve({}) })),/Sign in to continue/)
  assert.deepEqual(state.calls,[])
  state.status='ready';state.failure=true
  assert.match(renderToStaticMarkup(await page({ searchParams:Promise.resolve({}) })),/Unavailable/)
}))

test('prize names can be edited before End; ended and off events show the frozen names without edit controls',async () => fixture(async () => {
  const { HostPrizes } = require('./HostPrizes.tsx')
  for (const phase of ['draft','lobby','live','ended','off']) {
    const html=renderToStaticMarkup(React.createElement(HostPrizes,{ state:{ phase,prizes:['Book voucher','Notebook'] },pending:false,onDirty() {},save:async()=>true }))
    for (const text of ['Book voucher','Notebook','2 winners']) assert.ok(html.includes(text),phase)
    if (phase==='ended'||phase==='off') assert.doesNotMatch(html,/<input|Save prizes|Add prize/)
    else { assert.match(html,/<input/);assert.match(html,/Save prizes/);assert.match(html,/Add prize/) }
  }
}))


test('host shows each prize-affecting tie with optional prize details and one recorded draw action',async () => fixture(async () => {
  const { HostResults }=require('./HostResults.tsx')
  const groups=[{ position:1,candidates:[event,other],places:2,prizes:['Backpack','Notebook'] },
    { position:3,candidates:[crypto.randomUUID(),crypto.randomUUID()],places:1,prizes:['Voucher',null] }]
  const render=state=>renderToStaticMarkup(React.createElement(HostResults,{ state,pending:false,command(){} }))
  const html=render({ phase:'ended',ties:{ needed:true,groups },players:[],winners:[] })
  for(const text of ['positions 1–2','positions 3–4','Backpack','Notebook','Voucher','No prize'])assert.ok(html.includes(text),text)
  assert.equal((html.match(/>Start draw<\/button>/g)||[]).length,1)
  assert.equal((html.match(/<details class="group">/g)||[]).length,2,'secondary prize lists stay collapsed')
  assert.ok(!render({ phase:'ended',ties:null,players:[],winners:[] }).includes('Start draw'))
  const complete=render({ phase:'ended',ties:null,draw:{ startedAt:'2026-12-07T12:00:00Z',groups:[] },players:[],winners:[] })
  assert.ok(complete.includes('Draw completed once at 12:00:00 UTC.'));assert.ok(!complete.includes('Start draw'))
}))
