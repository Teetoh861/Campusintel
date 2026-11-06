// scripts/managed-content/official-banks.cjs — Official question banks: verified source, import plans and the
// generated migration, behaviour test and practice topic list for each imported course.
// Plan: Campusintel-worktrees/bank-audit-evidence/REPORT.md section G. Nothing here edits question text: a bank question
// becomes a CBT payload by turning its lettered options into an options array and its answer letter into an index.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { uuidV5 } = require('./source-manifest.cjs')
const { IMPORTS } = require('./official-banks/imports.cjs')
const { APPROVED_ANSWER_KEY_CHANGES } = require('./official-banks/decisions.cjs')

const ROOT = path.resolve(__dirname, '../..')
const BANK_DIR = path.join(__dirname, 'official-banks')
const SOURCE_DIR = path.join(BANK_DIR, 'source')
const IDENTITY_MAP = path.join(BANK_DIR, 'identity-map.csv')
/** Provenance marker for every revision, review and publication the bank migrations write; never an Auth account. */
const BANK_ACTOR = '00000000-0000-4000-8000-000000000043'
const SOURCE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

const BEHAVIOUR_TEST = path.join(ROOT, 'supabase/tests/official_banks.test.sql')
const SECTIONS_MODULE = path.join(ROOT, 'lib/data/official-bank-sections.ts')

/** Minimal CSV reader for the committed manifest and identity map (quoted fields, CRLF or LF). */
function readCsv(filename) {
  const text = fs.readFileSync(filename, 'utf8')
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1 }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '' }
    else field += char
  }
  if (field !== '' || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row) }
  const [header, ...body] = rows
  return body.map(values => {
    assert.equal(values.length, header.length, `${path.basename(filename)}: malformed row`)
    return Object.fromEntries(header.map((name, index) => [name, values[index]]))
  })
}

function textField(value, max, label) {
  assert.equal(typeof value, 'string', `${label} must be text`)
  const length = value.trim().length
  assert.ok(length >= 1 && length <= max, `${label} must hold 1 to ${max} characters`)
  return value
}

/** One bank question as a CBT payload. Only the option letters become positions; no text is changed. */
function convertQuestion(question, label) {
  const letters = Object.keys(question.options)
  assert.ok(letters.length >= 2 && letters.length <= 8, `${label}: 2 to 8 options`)
  assert.deepEqual(letters, LETTERS.slice(0, letters.length), `${label}: options must be lettered a, b, c... in order`)
  const correctOption = letters.indexOf(question.answer)
  assert.ok(correctOption >= 0, `${label}: the answer letter must be one of the options`)
  return {
    prompt: textField(question.question, 10000, `${label} question`),
    options: letters.map(letter => textField(question.options[letter], 2000, `${label} option ${letter}`)),
    correctOption,
    section: textField(question.topic, 240, `${label} topic`),
    explanation: textField(question.explanation, 10000, `${label} explanation`),
  }
}

/** Every committed bank, checked byte for byte against MANIFEST.csv before any of it is read. */
function loadBanks(sourceDir = SOURCE_DIR) {
  const manifest = readCsv(path.join(sourceDir, 'MANIFEST.csv')).filter(row => row.file.endsWith('_Platform.json'))
  const committed = []
  for (const entry of fs.readdirSync(sourceDir, { recursive: true })) {
    if (String(entry).endsWith('.json')) committed.push(String(entry).split(path.sep).join('/'))
  }
  assert.deepEqual(committed.sort(), manifest.map(row => row.file).sort(), 'committed banks must be exactly the manifest\'s')
  const banks = new Map()
  for (const row of manifest) {
    const bytes = fs.readFileSync(path.join(sourceDir, row.file))
    assert.equal(bytes.length, Number(row.bytes), `${row.file}: size differs from MANIFEST.csv`)
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.sha256,
      `${row.file}: SHA-256 differs from MANIFEST.csv`)
    const bank = JSON.parse(bytes.toString('utf8'))
    assert.equal(bank.course, row.course, `${row.file}: course`)
    assert.ok(!banks.has(bank.course), `duplicate bank ${bank.course}`)
    assert.equal(bank.questions.length, Number(row.questions), `${row.file}: question count`)
    assert.equal(bank.count, bank.questions.length, `${row.file}: declared count`)
    const ids = new Set()
    const topics = []
    const questions = bank.questions.map((question, index) => {
      const label = `${bank.course} ${question.id}`
      assert.equal(question.number, index + 1, `${label}: numbers run 1..N`)
      assert.ok(typeof question.id === 'string' && !ids.has(question.id), `${label}: unique bank id`)
      ids.add(question.id)
      const sourceKey = `bank:${bank.course}:${question.id}`
      assert.ok(sourceKey.length <= 120 && SOURCE_KEY.test(sourceKey), `${label}: source key format`)
      if (!topics.includes(question.topic)) topics.push(question.topic)
      return { id: question.id, sourceKey, payload: convertQuestion(question, label) }
    })
    assert.equal(topics.length, Number(row.topics), `${row.file}: topic count`)
    banks.set(bank.course, { code: bank.course, title: bank.title, file: row.file, questions, topics })
  }
  return banks
}

/** The committed audit identity map: published question to bank question, for matched and changed questions. */
function loadIdentityMap(filename = IDENTITY_MAP, approved = APPROVED_ANSWER_KEY_CHANGES) {
  return readCsv(filename).map(row => {
    assert.ok(row.match === 'matched' || row.match === 'changed', `identity map: match ${row.match}`)
    if (row.change.includes('answer-key')) {
      assert.ok(approved.includes(`${row.course}:${row.bank_id}`),
        `${row.course} ${row.bank_id}: answer-key change is not approved`)
    }
    return row
  })
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** One course's import: the audited published set, what is kept (and revised), retired and added. */
function planImport(entry, manifest, banks, identity) {
  const bank = banks.get(entry.code)
  assert.ok(bank, `${entry.code}: no committed bank`)
  const course = manifest.courses.find(row => row.contentKey === entry.contentKey)
  assert.ok(course, `${entry.code}: unknown repository course ${entry.contentKey}`)
  const published = manifest.items.filter(item => item.courseId === course.courseId && item.kind === 'cbt_question')
  const bySourceKey = new Map(published.map(item => [item.sourceKey, item]))
  const byBankId = new Map(bank.questions.map(question => [question.id, question]))
  const used = new Set()
  const kept = new Map()
  const keep = identity.filter(row => row.course === entry.code).map(row => {
    const item = bySourceKey.get(row.published_source_key)
    assert.ok(item, `${entry.code} ${row.published_source_key}: not a published question`)
    assert.equal(item.questionId, row.published_question_id, `${entry.code} ${row.published_source_key}: question id`)
    const question = byBankId.get(row.bank_id)
    assert.ok(question, `${entry.code} ${row.bank_id}: not in the bank`)
    assert.ok(!used.has(row.bank_id) && !kept.has(item.itemId), `${entry.code} ${row.bank_id}: mapped twice`)
    used.add(row.bank_id)
    kept.set(item.itemId, question.id)
    const revise = !jsonEqual(item.payload, question.payload)
    return { itemId: item.itemId, questionId: item.questionId, sourceKey: item.sourceKey, bankId: question.id,
      revise, revision: revise ? 2 : 1, payload: question.payload }
  })
  const retire = published.filter(item => !kept.has(item.itemId)).map(item => item.itemId)
  const add = bank.questions.filter(question => !used.has(question.id)).map(question => {
    const name = `${course.courseId}|cbt_question|${question.sourceKey}`
    return { itemId: uuidV5(name), questionId: uuidV5(`question:${name}`), sourceKey: question.sourceKey,
      payload: question.payload }
  })
  const counts = { published: published.length, kept: keep.length, retired: retire.length, added: add.length,
    bank: bank.questions.length }
  assert.deepEqual(counts, entry.expected, `${entry.code}: counts differ from the audit`)
  assert.equal(counts.kept + counts.added, counts.bank)
  const functionName = `official_bank_${entry.code.toLowerCase().replaceAll('-', '_')}`
  return { ...entry, courseId: course.courseId, slug: course.slug, functionName, bank, audited: published,
    keep, retire, add, counts, changed: keep.filter(row => row.revise).length }
}

/** Every configured import, checked for identity collisions with the seed and with each other. */
function buildImports(manifest) {
  const banks = loadBanks()
  const identity = loadIdentityMap()
  const plans = IMPORTS.map(entry => planImport(entry, manifest, banks, identity))
  const migrations = new Set(plans.map(plan => plan.migration))
  assert.equal(migrations.size, plans.length, 'one migration per course')
  const later = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(name => !migrations.has(name))
  for (const plan of plans) {
    assert.match(plan.migration, /^\d{14}_official_bank_[a-z0-9_]+\.sql$/)
    assert.ok(later.every(name => name < plan.migration), `${plan.migration} must sort after every other migration`)
  }
  const itemIds = new Set(manifest.items.map(item => item.itemId))
  const questionIds = new Set(manifest.items.map(item => item.questionId).filter(Boolean))
  for (const plan of plans) {
    for (const row of plan.add) {
      assert.ok(!itemIds.has(row.itemId) && !questionIds.has(row.questionId), `${row.sourceKey}: identity collision`)
      itemIds.add(row.itemId)
      questionIds.add(row.questionId)
    }
  }
  return { banks, plans }
}

function jsonLiteral(value, tag) {
  const serialized = JSON.stringify(value)
  assert.ok(!serialized.includes(`$${tag}$`), `bank content contains SQL delimiter ${tag}`)
  return `$${tag}$${serialized}$${tag}$::jsonb`
}

/** The generated forward migration for one course. */
function migrationSql(plan, seedActor) {
  const data = {
    code: plan.code, courseId: plan.courseId, seedActor, actor: BANK_ACTOR, bankCount: plan.counts.bank,
    audited: plan.audited.map(item => item.itemId),
    keep: plan.keep.map(row => ({ itemId: row.itemId, revise: row.revise, payload: row.payload })),
    retire: plan.retire,
    add: plan.add.map(row => ({ itemId: row.itemId, questionId: row.questionId, sourceKey: row.sourceKey,
      payload: row.payload })),
  }
  const fn = `private.${plan.functionName}`
  return `-- supabase/migrations/${plan.migration}
-- GENERATED by scripts/managed-content/generate.cjs from the official ${plan.code} bank
-- (scripts/managed-content/official-banks/${path.posix.join('source', plan.bank.file)}). Do not edit by hand.
-- ${plan.counts.published} published before: ${plan.counts.kept} kept (${plan.changed} with a new revision), ${plan.counts.retired} retired
-- (unpublished, never deleted); ${plan.counts.added} added; ${plan.counts.bank} published after.
-- ${fn}('apply') runs in one statement, so it applies everything or nothing. It refuses unless the course's published
-- questions are exactly the audited set, does nothing when they are already the bank set, and checks the final count.
-- ${fn}('rollback') republishes the audited set through the same publish history; nothing is deleted.

create function ${fn}(p_action text)
returns text language plpgsql security invoker set search_path = '' as $official_bank$
declare
  v_bank jsonb := ${jsonLiteral(data, 'official_bank_source')};
  v_course uuid := (v_bank->>'courseId')::uuid;
  v_actor uuid := (v_bank->>'actor')::uuid;
  v_seed_actor uuid := (v_bank->>'seedActor')::uuid;
  v_audited jsonb;
  v_final jsonb;
  v_live jsonb;
  v_row jsonb;
  v_id uuid;
  v_item public.managed_content_items%rowtype;
begin
  if p_action is null or p_action not in ('apply', 'rollback') then
    raise exception 'Official bank %: unknown action %', v_bank->>'code', p_action;
  end if;
  -- Every CBT question of the course, locked in one order before anything is read or written.
  perform 1 from public.managed_content_items
    where course_id = v_course and kind = 'cbt_question' order by id for update;
  select coalesce(jsonb_object_agg(value, 1), '{}') into v_audited from jsonb_array_elements_text(v_bank->'audited');
  select coalesce(jsonb_object_agg(k.value->>'itemId', case when (k.value->>'revise')::boolean then 2 else 1 end), '{}')
    || coalesce((select jsonb_object_agg(a.value->>'itemId', 1) from jsonb_array_elements(v_bank->'add') a), '{}')
    into v_final from jsonb_array_elements(v_bank->'keep') k;
  select coalesce(jsonb_object_agg(id::text, published_revision), '{}') into v_live from public.managed_content_items
    where course_id = v_course and kind = 'cbt_question' and published_revision is not null;

  if p_action = 'apply' then
    if v_live = v_final then
      return 'unchanged';
    end if;
    if v_live <> v_audited then
      raise exception 'Official bank %: the published questions are not the audited set', v_bank->>'code';
    end if;

    -- Kept questions keep their item and question id; a different bank payload becomes the next revision.
    for v_row in select value from jsonb_array_elements(v_bank->'keep') where (value->>'revise')::boolean loop
      select * into v_item from public.managed_content_items where id = (v_row->>'itemId')::uuid;
      if v_item.created_by is distinct from v_seed_actor then
        raise exception 'Official bank %: % is not a migration-owned question', v_bank->>'code', v_item.id;
      end if;
      if exists (select 1 from public.managed_content_revisions where item_id = v_item.id and revision = 2) then
        if not exists (select 1 from public.managed_content_revisions where item_id = v_item.id and revision = 2
            and payload = v_row->'payload' and authored_by = v_actor) or v_item.current_revision <> 2 then
          raise exception 'Official bank %: % has another revision two', v_bank->>'code', v_item.id;
        end if;
      else
        if v_item.current_revision <> 1 then
          raise exception 'Official bank %: % has an unpublished edit', v_bank->>'code', v_item.id;
        end if;
        perform private.assert_managed_payload('cbt_question', v_row->'payload');
        insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
          values (v_item.id, 2, v_row->'payload', v_actor);
        update public.managed_content_items set current_revision = 2, lock_version = lock_version + 1,
          updated_at = now() where id = v_item.id returning * into v_item;
      end if;
      if v_item.approved_revision is distinct from 2 then
        insert into public.managed_content_reviews (item_id, revision, parent_revision, decision, reviewed_by, lock_version)
          values (v_item.id, 2, null, 'approved', v_actor, v_item.lock_version + 1);
        update public.managed_content_items set approved_revision = 2, lock_version = lock_version + 1,
          updated_at = now() where id = v_item.id returning * into v_item;
      end if;
      insert into public.managed_content_publications (item_id, lock_version, action, revision, parent_revision,
          previous_revision, previous_parent_revision, acted_by)
        values (v_item.id, v_item.lock_version + 1, 'publish', 2, null, v_item.published_revision, null, v_actor);
      update public.managed_content_items set published_revision = 2, lock_version = lock_version + 1,
        updated_at = now() where id = v_item.id;
    end loop;

    -- Retired questions are unpublished, never deleted: past attempts and reports keep their pinned revision.
    for v_id in select value::uuid from jsonb_array_elements_text(v_bank->'retire') loop
      select * into v_item from public.managed_content_items where id = v_id;
      insert into public.managed_content_publications (item_id, lock_version, action, previous_revision, acted_by)
        values (v_id, v_item.lock_version + 1, 'unpublish', v_item.published_revision, v_actor);
      update public.managed_content_items set published_revision = null, lock_version = lock_version + 1,
        updated_at = now() where id = v_id;
    end loop;

    -- New questions: created, approved and published at revision one, or republished after a rollback.
    for v_row in select value from jsonb_array_elements(v_bank->'add') loop
      select * into v_item from public.managed_content_items where id = (v_row->>'itemId')::uuid for update;
      if found then
        if v_item.created_by is distinct from v_actor or v_item.course_id is distinct from v_course or
           v_item.kind is distinct from 'cbt_question' or v_item.question_id is distinct from (v_row->>'questionId')::uuid or
           v_item.source_key is distinct from v_row->>'sourceKey' or v_item.approved_revision is distinct from 1 or
           not exists (select 1 from public.managed_content_revisions r where r.item_id = v_item.id and r.revision = 1
             and r.payload = v_row->'payload' and r.authored_by = v_actor) then
          raise exception 'Official bank %: % is not the same migration-owned question', v_bank->>'code', v_item.id;
        end if;
        insert into public.managed_content_publications (item_id, lock_version, action, revision,
            previous_revision, acted_by)
          values (v_item.id, v_item.lock_version + 1, 'publish', 1, v_item.published_revision, v_actor);
        update public.managed_content_items set published_revision = 1, lock_version = lock_version + 1,
          updated_at = now() where id = v_item.id;
        continue;
      end if;
      perform private.assert_managed_payload('cbt_question', v_row->'payload');
      insert into public.managed_content_items (id, course_id, kind, question_id, source_key, parent_item_id,
          current_revision, approved_revision, published_revision, published_parent_revision, lock_version, created_by)
        values ((v_row->>'itemId')::uuid, v_course, 'cbt_question', (v_row->>'questionId')::uuid,
          v_row->>'sourceKey', null, 1, 1, 1, null, 3, v_actor);
      insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
        values ((v_row->>'itemId')::uuid, 1, v_row->'payload', v_actor);
      insert into public.managed_content_reviews (item_id, revision, parent_revision, decision, reviewed_by, lock_version)
        values ((v_row->>'itemId')::uuid, 1, null, 'approved', v_actor, 2);
      insert into public.managed_content_publications (item_id, lock_version, action, revision, parent_revision, acted_by)
        values ((v_row->>'itemId')::uuid, 3, 'publish', 1, null, v_actor);
    end loop;

    select coalesce(jsonb_object_agg(id::text, published_revision), '{}') into v_live from public.managed_content_items
      where course_id = v_course and kind = 'cbt_question' and published_revision is not null;
    if v_live <> v_final or (select count(*) from jsonb_object_keys(v_live)) <> (v_bank->>'bankCount')::integer then
      raise exception 'Official bank %: the final published count is not the bank count', v_bank->>'code';
    end if;
    return 'applied';
  end if;

  -- Rollback: publication is a pointer, so the audited set is republished through the same history.
  if v_live = v_audited then
    return 'unchanged';
  end if;
  if v_live <> v_final then
    raise exception 'Official bank %: the published questions are not the imported set', v_bank->>'code';
  end if;
  for v_row in select value from jsonb_array_elements(v_bank->'keep') where (value->>'revise')::boolean loop
    select * into v_item from public.managed_content_items where id = (v_row->>'itemId')::uuid;
    insert into public.managed_content_reviews (item_id, revision, parent_revision, decision, reviewed_by, lock_version)
      values (v_item.id, 1, null, 'approved', v_actor, v_item.lock_version + 1);
    insert into public.managed_content_publications (item_id, lock_version, action, revision, parent_revision,
        previous_revision, previous_parent_revision, acted_by)
      values (v_item.id, v_item.lock_version + 2, 'publish', 1, null, v_item.published_revision, null, v_actor);
    update public.managed_content_items set approved_revision = 1, published_revision = 1,
      lock_version = lock_version + 2, updated_at = now() where id = v_item.id;
  end loop;
  for v_id in select value::uuid from jsonb_array_elements_text(v_bank->'retire') loop
    select * into v_item from public.managed_content_items where id = v_id;
    if v_item.approved_revision is distinct from 1 then
      raise exception 'Official bank %: % is no longer approved at revision one', v_bank->>'code', v_id;
    end if;
    insert into public.managed_content_publications (item_id, lock_version, action, revision, acted_by)
      values (v_id, v_item.lock_version + 1, 'publish', 1, v_actor);
    update public.managed_content_items set published_revision = 1, lock_version = lock_version + 1,
      updated_at = now() where id = v_id;
  end loop;
  for v_row in select value from jsonb_array_elements(v_bank->'add') loop
    select * into v_item from public.managed_content_items where id = (v_row->>'itemId')::uuid;
    insert into public.managed_content_publications (item_id, lock_version, action, previous_revision, acted_by)
      values (v_item.id, v_item.lock_version + 1, 'unpublish', v_item.published_revision, v_actor);
    update public.managed_content_items set published_revision = null, lock_version = lock_version + 1,
      updated_at = now() where id = v_item.id;
  end loop;
  select coalesce(jsonb_object_agg(id::text, published_revision), '{}') into v_live from public.managed_content_items
    where course_id = v_course and kind = 'cbt_question' and published_revision is not null;
  if v_live <> v_audited then
    raise exception 'Official bank %: rollback did not restore the audited set', v_bank->>'code';
  end if;
  return 'rolled-back';
end;
$official_bank$;

revoke all on function ${fn}(text) from public, anon, authenticated, service_role;
select ${fn}('apply');
`
}

function sqlText(value) {
  return `'${value.replaceAll("'", "''")}'`
}

/** Generated pgTAP for every imported course: all-or-nothing, refusal, final count, rerun and rollback. */
function behaviourTestSql(plans) {
  const lines = [
    '-- supabase/tests/official_banks.test.sql — Official bank import behaviour, per imported course.',
    '-- GENERATED by scripts/managed-content/generate.cjs; do not hand-maintain.',
    'begin;',
    'select no_plan();',
    '',
    'create temporary table bank_rows on commit drop as',
    '  select (select count(*) from public.managed_content_items) items,',
    '    (select count(*) from public.managed_content_revisions) revisions,',
    '    (select count(*) from public.managed_content_reviews) reviews,',
    '    (select count(*) from public.managed_content_publications) publications;',
    '',
  ]
  const live = course => `(select coalesce(jsonb_object_agg(id::text, published_revision), '{}') from public.managed_content_items
  where course_id = '${course}' and kind = 'cbt_question' and published_revision is not null)`
  const rows = '(select row(count(*), (select count(*) from public.managed_content_revisions),' +
    ' (select count(*) from public.managed_content_reviews), (select count(*) from public.managed_content_publications))::text' +
    ' from public.managed_content_items)'
  for (const plan of plans) {
    const fn = `private.${plan.functionName}`
    const audited = Object.fromEntries(plan.audited.map(item => [item.itemId, 1]))
    const final = Object.fromEntries([...plan.keep.map(row => [row.itemId, row.revision]),
      ...plan.add.map(row => [row.itemId, 1])])
    const last = plan.add.at(-1)
    const label = text => sqlText(`${plan.code}: ${text}`)
    lines.push(`-- ${plan.code} (${plan.contentKey})`,
      `select is((select count(*)::int from public.managed_content_items where course_id = '${plan.courseId}'`,
      `  and kind = 'cbt_question' and published_revision is not null), ${plan.counts.bank},`,
      `  ${label('the final published count equals the bank count')});`,
      `select ok(${live(plan.courseId)} = ${jsonLiteral(final, 'final_set')},`,
      `  ${label('the published questions are exactly the bank set')});`,
      `select is((select count(*)::int from public.managed_content_items where course_id = '${plan.courseId}'`,
      `  and kind = 'cbt_question'), ${plan.counts.published + plan.counts.added},`,
      `  ${label('retired questions are kept, unpublished')});`,
      '',
      `create temporary table bank_before_${plan.functionName} on commit drop as select ${rows} counts;`,
      `select is(${fn}('apply'), 'unchanged', ${label('a rerun reports nothing to do')});`,
      `select is(${rows}, (select counts from bank_before_${plan.functionName}), ${label('a rerun writes nothing')});`,
      '',
      `select is(${fn}('rollback'), 'rolled-back', ${label('rollback runs')});`,
      `select ok(${live(plan.courseId)} = ${jsonLiteral(audited, 'audited_set')},`,
      `  ${label('rollback republishes exactly the audited set at revision one')});`,
      `select is((select count(*)::int from public.managed_content_items where course_id = '${plan.courseId}'`,
      `  and kind = 'cbt_question'), ${plan.counts.published + plan.counts.added}, ${label('rollback deletes nothing')});`,
      `select is((select count(*)::int from public.managed_content_publications p join public.managed_content_items i`,
      `  on i.id = p.item_id where i.course_id = '${plan.courseId}' and p.acted_by = '${BANK_ACTOR}'`,
      `  and p.action = 'unpublish'), ${plan.counts.retired + plan.counts.added},`,
      `  ${label('every retirement and every rollback unpublish is in the publish history')});`,
      `select is(${fn}('rollback'), 'unchanged', ${label('a second rollback does nothing')});`,
      '',
      `-- A live set that is neither the audited nor the bank set is refused, and nothing changes.`,
      `update public.managed_content_items set published_revision = null where id = '${plan.audited[0].itemId}';`,
      `select throws_ok($$select ${fn}('apply')$$, 'P0001',`,
      `  ${sqlText(`Official bank ${plan.code}: the published questions are not the audited set`)},`,
      `  ${label('apply refuses a published set other than the audited one')});`,
      `update public.managed_content_items set published_revision = 1 where id = '${plan.audited[0].itemId}';`,
      '',
      `-- A failure on the last question rolls back everything written before it.`,
      `create temporary table bank_conflict_${plan.functionName} on commit drop as select ${rows} counts;`,
      'insert into public.managed_content_items (id, course_id, kind, question_id, source_key, current_revision,',
      '  approved_revision, lock_version, created_by)',
      `  values ('${last.itemId}', '${plan.courseId}', 'cbt_question', '${last.questionId}', '${last.sourceKey}', 1, 1, 3,`,
      `  '${BANK_ACTOR}');`,
      'insert into public.managed_content_revisions (item_id, revision, payload, authored_by)',
      `  values ('${last.itemId}', 1, '{"prompt":"Not the bank text","options":["A","B"],"correctOption":0}', '${BANK_ACTOR}');`,
      `select throws_ok($$select ${fn}('apply')$$, 'P0001', null, ${label('apply fails on a conflicting question')});`,
      `select ok(${live(plan.courseId)} = ${jsonLiteral(audited, 'audited_set')},`,
      `  ${label('a failed apply leaves the audited set published')});`,
      `delete from public.managed_content_revisions where item_id = '${last.itemId}' and authored_by = '${BANK_ACTOR}'`,
      `  and payload ->> 'prompt' = 'Not the bank text';`,
      `delete from public.managed_content_items where id = '${last.itemId}'`,
      `  and not exists (select 1 from public.managed_content_revisions where item_id = '${last.itemId}');`,
      `select is(${rows}, (select counts from bank_conflict_${plan.functionName}),`,
      `  ${label('the failed apply wrote nothing')});`,
      '',
      `select is(${fn}('apply'), 'applied', ${label('apply after a rollback republishes the bank set')});`,
      `select ok(${live(plan.courseId)} = ${jsonLiteral(final, 'final_set')},`,
      `  ${label('the bank set is published again')});`,
      '')
  }
  lines.push('select * from finish();', 'rollback;', '')
  return lines.join('\n')
}

/** Practice topics, in order of first appearance, for each imported course (read by lib/data/quizzes.ts). */
function sectionsModule(plans) {
  const entries = plans.map(plan => `  ${JSON.stringify(plan.slug)}: ${JSON.stringify(plan.bank.topics)},`)
  return [
    '// lib/data/official-bank-sections.ts — GENERATED by scripts/managed-content/generate.cjs; do not edit.',
    '// Practice topics for courses whose questions come from an official bank, in order of first appearance.',
    'export const OFFICIAL_BANK_SECTIONS: Readonly<Record<string, readonly string[]>> = {',
    ...entries,
    '}',
    '',
  ].join('\n')
}

/** The CBT records a course publishes after its import, as the parity test compares them. */
function publishedCbt(plan) {
  return [
    ...plan.keep.map(row => ({ itemId: row.itemId, courseId: plan.courseId, kind: 'cbt_question',
      questionId: row.questionId, sourceKey: row.sourceKey, parentItemId: null, revision: row.revision,
      payload: row.payload })),
    ...plan.add.map(row => ({ itemId: row.itemId, courseId: plan.courseId, kind: 'cbt_question',
      questionId: row.questionId, sourceKey: row.sourceKey, parentItemId: null, revision: 1, payload: row.payload })),
  ]
}

/** Every generated bank artifact as [filename, contents]. */
function bankOutputs(manifest, plans) {
  const outputs = plans.map(plan =>
    [path.join(ROOT, 'supabase/migrations', plan.migration), migrationSql(plan, manifest.actor)])
  outputs.push([SECTIONS_MODULE, sectionsModule(plans)])
  if (plans.length) outputs.push([BEHAVIOUR_TEST, behaviourTestSql(plans)])
  return outputs
}

/** Bank artifacts that must not exist, such as the behaviour test before any import. */
function absentBankOutputs(plans) {
  return plans.length ? [] : [BEHAVIOUR_TEST]
}

module.exports = { BANK_ACTOR, absentBankOutputs, bankOutputs, buildImports, convertQuestion, loadBanks,
  loadIdentityMap, planImport, publishedCbt }
