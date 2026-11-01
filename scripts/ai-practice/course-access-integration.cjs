// Real signed-URL regression. Uses only the explicit loopback AI_IT_* environment; never calls an AI provider.
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto'),{spawnSync}=require('node:child_process')
const root=require('node:path').resolve(__dirname,'../..'),cfg={API_URL:process.env.AI_IT_URL,ANON_KEY:process.env.AI_IT_PUBLISHABLE_KEY,SERVICE_ROLE_KEY:process.env.AI_IT_SECRET_KEY}
const container=process.env.AI_IT_DB_CONTAINER
if(!cfg.API_URL||!cfg.ANON_KEY||!cfg.SERVICE_ROLE_KEY||!/^supabase_db_ci-access-own-[a-z0-9-]+$/.test(container??''))throw Error('Set the local AI_IT connection variables and an isolated ci-access-own container')
const {createClient}=require(root+'/node_modules/@supabase/supabase-js')
assert.equal(new URL(cfg.API_URL).hostname,'127.0.0.1')
const admin=createClient(cfg.API_URL,cfg.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),bucket='ai-practice-uploads'
function sql(input){const r=spawnSync('docker',['exec','-i',container,'psql','-XAtq','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim()}
async function main(){
 let user;const results=[]
 const record=(name,ok,extra={})=>{results.push({name,ok,...extra});console.log(JSON.stringify(results.at(-1)))}
 try{
  const email='a2-storage-'+randomUUID()+'@example.test',password=randomBytes(24).toString('base64url')+'Aa4!'
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);user=created.data.user.id
  sql(`update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001' where id='${user}';insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,created_by)values('${user}','early_access',now()-interval '1 day',now()+interval '1 day','uncapped','a2-storage');`)
  const student=createClient(cfg.API_URL,cfg.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  const signed=await student.auth.signInWithPassword({email,password});assert.ifError(signed.error)
  const sid=JSON.parse(Buffer.from(signed.data.session.access_token.split('.')[1],'base64url')).session_id
  const course=sql("select id from public.institutional_courses where course_code='BUA201'")
  async function reserve(){const r=await admin.rpc('create_ai_practice_document',{p_session_id:sid,p_institutional_course_id:course,p_file_name:'notes.txt',p_media_type:'text/plain',p_declared_bytes:10,p_accepted_sources:['early_access']});assert.ifError(r.error);assert.equal(r.data.status,'created');return r.data}
  const first=await reserve(),second=await reserve()
  const urls=[]
  for(const doc of [first,second]){const r=await student.storage.from(bucket).createSignedUploadUrl(doc.storage_path);assert.ifError(r.error);urls.push(r.data.signedUrl)}
  let put=await fetch(urls[0],{method:'PUT',headers:{'Content-Type':'text/plain'},body:'own notes'});assert.equal(put.status,200);record('own-list signed upload',true,{status:put.status})
  assert.ifError((await student.storage.from(bucket).download(first.storage_path)).error)
  const revision=sql(`select revision from public.profiles where id='${user}'`)
  sql(`select public.admin_change_course_selection('${user}','accounting','100-level','first-semester',${revision},false,'Ops','storage check')`)
  const deniedSign=await student.storage.from(bucket).createSignedUploadUrl(second.storage_path)
  record('signing after list correction',!!deniedSign.error)
  const deniedRead=await student.storage.from(bucket).download(first.storage_path)
  record('download after list correction',!!deniedRead.error)
  put=await fetch(urls[1],{method:'PUT',headers:{'Content-Type':'text/plain'},body:'late notes'})
  record('previously signed upload after list correction',put.status>=400,{status:put.status})
  assert.ok(deniedSign.error);assert.ok(deniedRead.error);assert.ok(put.status>=400,'an outstanding signed URL must not write outside-list data')
 }finally{
  if(user){const list=await admin.storage.from(bucket).list(user);const paths=(list.data??[]).map(o=>user+'/'+o.name);if(paths.length)await admin.storage.from(bucket).remove(paths);await admin.auth.admin.deleteUser(user)}
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
