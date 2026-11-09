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
const { APPROVED_ANSWER_KEY_CHANGES, EXAM_MINUTES, EXAM_QUESTIONS, OFFICIAL_COURSES } = require('./official-banks/decisions.cjs')

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
const COURSES_MODULE = path.join(ROOT, 'lib/data/official-bank-courses.ts')

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

/** The repository slug pattern: the official title in lower case, without short joining words, Roman numerals as digits. */
function slugFor(title) {
  const words = title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
    .filter(word => !['to', 'of', 'for', 'in', 'and', 'the'].includes(word))
  return words.map(word => ({ i: '1', ii: '2', iii: '3' })[word] ?? word).join('-')
}

/** A new course's registry identity, catalogue link, applicability and practice settings, from the owner's list. */
function newCourseShell(entry, manifest) {
  const official = OFFICIAL_COURSES[entry.code]
  assert.ok(official, `${entry.code}: not on the owner's official list`)
  assert.equal(entry.contentKey, slugFor(official.title), `${entry.code}: slug must follow the repository pattern`)
  assert.ok(!manifest.courses.some(row => row.contentKey === entry.contentKey || row.slug === entry.contentKey),
    `${entry.code}: slug already used`)
  assert.ok([30, 40].includes(EXAM_MINUTES[entry.code]), `${entry.code}: exam minutes`)
  return { courseId: uuidV5(`course:${entry.contentKey}`), slug: entry.contentKey,
    shell: { contentKey: entry.contentKey, titles: [...new Set([official.catalogue ?? official.title, official.title])],
      level: official.level, semesters: official.semesters },
    course: { code: entry.code, title: official.title, level: Number(official.level.slice(0, 3)),
      semester: official.semesters[0] === 'second-semester' ? 2 : 1, units: official.units,
      examQuestions: EXAM_QUESTIONS, examMinutes: EXAM_MINUTES[entry.code] } }
}

/** One course's import: the audited published set, what is kept (and revised), retired and added. */
function planImport(entry, manifest, banks, identity) {
  const bank = banks.get(entry.code)
  assert.ok(bank, `${entry.code}: no committed bank`)
  const created = entry.newCourse ? newCourseShell(entry, manifest) : null
  const course = created ?? manifest.courses.find(row => row.contentKey === entry.contentKey)
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
  // The owner's official title replaces a catalogue title that differs from it; the bank document's title is not used.
  const official = OFFICIAL_COURSES[entry.code]
  const title = official?.catalogue ? { catalogue: official.catalogue, bank: textField(official.title, 240, `${entry.code} title`) }
    : null
  return { ...entry, courseId: course.courseId, slug: course.slug, functionName, bank, audited: published,
    keep, retire, add, counts, title, changed: keep.filter(row => row.revise).length,
    shell: created?.shell ?? null, course: created?.course ?? null }
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

/** The bank's list parts, stored one element per row and reassembled in order by the import function. */
const BANK_PARTS = ['audited', 'keep', 'retire', 'add']
/** Largest INSERT the migration emits. The Supabase CLI splits a migration into statements in time that grows with the
 *  square of a statement's length (a 1.5 MB statement took over 10 minutes), so the bank goes in as small statements. */
const STATEMENT_CHARS = 8000

/** The bank's rows as INSERT statements of at most STATEMENT_CHARS (one oversized row stands alone). */
function bankRowStatements(functionName, rows) {
  const head = 'insert into private.official_bank_rows (bank, part, ordinal, value) values'
  const statements = []
  let values = []
  let length = head.length
  for (const [part, ordinal, value] of rows) {
    const tuple = `  ('${functionName}', '${part}', ${ordinal}, ${jsonLiteral(value, 'official_bank_source')})`
    if (values.length && length + tuple.length + 2 > STATEMENT_CHARS) {
      statements.push(`${head}\n${values.join(',\n')};`)
      values = []
      length = head.length
    }
    values.push(tuple)
    length += tuple.length + 2
  }
  if (values.length) statements.push(`${head}\n${values.join(',\n')};`)
  return statements.join('\n')
}

/** The generated forward migration for one course. */
function migrationSql(plan, seedActor) {
  const data = {
    code: plan.code, courseId: plan.courseId, seedActor, actor: BANK_ACTOR, bankCount: plan.counts.bank,
    ...(plan.title ? { title: plan.title } : {}),
    ...(plan.shell ? { shell: plan.shell } : {}),
    audited: plan.audited.map(item => item.itemId),
    keep: plan.keep.map(row => ({ itemId: row.itemId, revise: row.revise, payload: row.payload })),
    retire: plan.retire,
    add: plan.add.map(row => ({ itemId: row.itemId, questionId: row.questionId, sourceKey: row.sourceKey,
      payload: row.payload })),
  }
  const scalars = Object.fromEntries(Object.entries(data).filter(([key]) => !BANK_PARTS.includes(key)))
  const rows = [['bank', 0, scalars],
    ...BANK_PARTS.flatMap(part => data[part].map((value, index) => [part, index + 1, value]))]
  const parts = BANK_PARTS.map(part => `    '${part}', coalesce((select jsonb_agg(r.value order by r.ordinal)
      from private.official_bank_rows r where r.bank = '${plan.functionName}' and r.part = '${part}'), '[]')`)
  const fn = `private.${plan.functionName}`
  return `-- supabase/migrations/${plan.migration}
-- GENERATED by scripts/managed-content/generate.cjs from the official ${plan.code} bank
-- (scripts/managed-content/official-banks/${path.posix.join('source', plan.bank.file)}). Do not edit by hand.
-- ${plan.counts.published} published before: ${plan.counts.kept} kept (${plan.changed} with a new revision), ${plan.counts.retired} retired
-- (unpublished, never deleted); ${plan.counts.added} added; ${plan.counts.bank} published after.
-- ${fn}('apply') runs in one statement, so it applies everything or nothing. It refuses unless the course's published
-- questions are exactly the audited set, does nothing when they are already the bank set, and checks the final count.
-- ${fn}('rollback') republishes the audited set through the same publish history; nothing is deleted.

-- The bank's source, one list element per row, kept for ${fn}. Written in small statements: the
-- migration runner takes far longer over one very long statement.
create table if not exists private.official_bank_rows (
  bank text not null,
  part text not null check (part in ('bank', ${BANK_PARTS.map(part => `'${part}'`).join(', ')})),
  ordinal integer not null check (ordinal >= 0),
  value jsonb not null,
  primary key (bank, part, ordinal)
);
alter table private.official_bank_rows enable row level security;
revoke all on table private.official_bank_rows from public, anon, authenticated, service_role;

${bankRowStatements(plan.functionName, rows)}

create function ${fn}(p_action text)
returns text language plpgsql security invoker set search_path = '' as $official_bank$
declare
  -- The bank as one document: its scalars, then each list in its original order.
  v_bank jsonb := (select r.value from private.official_bank_rows r
    where r.bank = '${plan.functionName}' and r.part = 'bank' and r.ordinal = 0) || jsonb_build_object(
${parts.join(',\n')});
  v_course uuid := (v_bank->>'courseId')::uuid;
  v_actor uuid := (v_bank->>'actor')::uuid;
  v_seed_actor uuid := (v_bank->>'seedActor')::uuid;
  v_audited jsonb;
  v_final jsonb;
  v_live jsonb;
  v_row jsonb;
  v_id uuid;
  v_item public.managed_content_items%rowtype;
${plan.shell ? '  v_catalogue uuid;\n' : ''}begin
  if v_bank is null or v_bank->>'code' is distinct from '${plan.code}' then
    raise exception 'Official bank ${plan.code}: its source rows are missing';
  end if;
  if p_action is null or p_action not in ('apply', 'rollback') then
    raise exception 'Official bank %: unknown action %', v_bank->>'code', p_action;
  end if;
  -- Every CBT question of the course, locked in one order before anything is read or written.
  perform 1 from public.managed_content_items
    where course_id = v_course and kind = 'cbt_question' order by id for update;
${plan.shell ? `  -- A new course, once: its repository identity and the link from its catalogue course, which must already apply at the
  -- official level and semesters. A rerun finds them in place; anything else is refused.
  if p_action = 'apply' then
    insert into public.courses (id, content_key, is_shared)
      values (v_course, v_bank->'shell'->>'contentKey', null) on conflict do nothing;
    if not exists (select 1 from public.courses where id = v_course and content_key = v_bank->'shell'->>'contentKey') then
      raise exception 'Official bank %: the repository identity is not this course''s', v_bank->>'code';
    end if;
    update public.institutional_courses set repository_course_id = v_course
      where course_code = v_bank->>'code' and repository_course_id is null
        and display_title in (select jsonb_array_elements_text(v_bank->'shell'->'titles'));
    select id into v_catalogue from public.institutional_courses
      where course_code = v_bank->>'code' and repository_course_id = v_course;
    if v_catalogue is null or (select count(*) from public.institutional_courses where course_code = v_bank->>'code') <> 1 then
      raise exception 'Official bank %: the catalogue course is not linked exactly once', v_bank->>'code';
    end if;
    -- Which students see the course stays the catalogue's: the import never adds or removes applicability rows.
    -- It refuses a catalogue course that does not already apply at the official level in every official semester.
    if exists (select 1 from jsonb_array_elements_text(v_bank->'shell'->'semesters') s(key)
        where not exists (select 1 from public.course_applicability a
          join public.academic_levels l on l.id = a.academic_level_id
          join public.academic_periods p on p.id = a.academic_period_id
          where a.institutional_course_id = v_catalogue and l.key = v_bank->'shell'->>'level' and p.key = s.key)) then
      raise exception 'Official bank %: the catalogue course does not apply at the official level in every official semester',
        v_bank->>'code';
    end if;
  end if;
` : ''}${plan.title ? `  -- The owner's official title replaces the catalogue's (apply) or the catalogue's comes back (rollback), in this statement.
  if v_bank ? 'title' then
    update public.institutional_courses set display_title = case when p_action = 'apply'
        then v_bank->'title'->>'bank' else v_bank->'title'->>'catalogue' end
      where repository_course_id = v_course and course_code = v_bank->>'code'
        and display_title = case when p_action = 'apply' then v_bank->'title'->>'catalogue' else v_bank->'title'->>'bank' end;
    if not exists (select 1 from public.institutional_courses where repository_course_id = v_course
        and course_code = v_bank->>'code' and display_title = case when p_action = 'apply'
          then v_bank->'title'->>'bank' else v_bank->'title'->>'catalogue' end) then
      raise exception 'Official bank %: the catalogue title is not the audited one', v_bank->>'code';
    end if;
  end if;
` : ''}  select coalesce(jsonb_object_agg(value, 1), '{}') into v_audited from jsonb_array_elements_text(v_bank->'audited');
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
    'create temporary table bank_applicability_start on commit drop as select * from public.course_applicability;',
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
    if (plan.shell) {
      const official = `(select id from public.institutional_courses where course_code = '${plan.code}')`
      lines.push(`-- ${plan.code}: a new course`,
        `select is((select content_key from public.courses where id = '${plan.courseId}' and is_shared is null),`,
        `  '${plan.shell.contentKey}', ${label('the new repository identity is registered, its sharing unresolved')});`,
        `select is((select is_free from public.institutional_courses where course_code = '${plan.code}'), false,`,
        `  ${label('the course is not free')});`,
        `select is((select repository_course_id from public.institutional_courses where course_code = '${plan.code}'),`,
        `  '${plan.courseId}'::uuid, ${label('its catalogue course links to it')});`,
        `select is((select display_title from public.institutional_courses where course_code = '${plan.code}'),`,
        `  ${sqlText(plan.course.title)}, ${label('the catalogue shows the official title')});`,
        `select is((select array_agg(distinct p.key order by p.key) from public.course_applicability a`,
        `  join public.academic_levels l on l.id = a.academic_level_id join public.academic_periods p on p.id = a.academic_period_id`,
        `  where a.institutional_course_id = ${official} and l.key = '${plan.shell.level}'),`,
        `  array[${plan.shell.semesters.map(key => `'${key}'`).join(', ')}]::text[],`,
        `  ${label('it applies at the official level in every official semester')});`,
        `-- Apply refuses a catalogue course missing from an official semester; the removed rows are then put back.`,
        `create temporary table bank_applicability_${plan.functionName} on commit drop as`,
        `  select * from public.course_applicability where institutional_course_id = ${official};`,
        `delete from public.course_applicability where institutional_course_id = ${official}`,
        `  and academic_period_id = (select id from public.academic_periods where key = '${plan.shell.semesters[0]}');`,
        `select throws_ok($$select ${fn}('apply')$$, 'P0001',`,
        `  ${sqlText(`Official bank ${plan.code}: the catalogue course does not apply at the official level in every official semester`)},`,
        `  ${label('apply refuses a catalogue course missing from an official semester')});`,
        `insert into public.course_applicability select * from bank_applicability_${plan.functionName}`,
        `  where (institutional_course_id, department_id, academic_level_id, academic_period_id) not in`,
        `    (select institutional_course_id, department_id, academic_level_id, academic_period_id from public.course_applicability);`)
    }
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
      ...(plan.title ? [
        `select is((select display_title from public.institutional_courses where repository_course_id = '${plan.courseId}'),`,
        `  ${sqlText(plan.title.catalogue)}, ${label('rollback restores the catalogue title')});`] : []),
      `select is((select count(*)::int from public.managed_content_items where course_id = '${plan.courseId}'`,
      `  and kind = 'cbt_question'), ${plan.counts.published + plan.counts.added}, ${label('rollback deletes nothing')});`,
      `select is((select count(*)::int from public.managed_content_publications p join public.managed_content_items i`,
      `  on i.id = p.item_id where i.course_id = '${plan.courseId}' and p.acted_by = '${BANK_ACTOR}'`,
      `  and p.action = 'unpublish'), ${plan.counts.retired + plan.counts.added},`,
      `  ${label('every retirement and every rollback unpublish is in the publish history')});`,
      `select is(${fn}('rollback'), 'unchanged', ${label('a second rollback does nothing')});`,
      '',
      `-- A live set that is neither the audited nor the bank set is refused, and nothing changes.`,
      plan.audited.length ? `update public.managed_content_items set published_revision = null where id = '${plan.audited[0].itemId}';`
        : `update public.managed_content_items set published_revision = 1 where id = '${plan.add[0].itemId}';`,
      `select throws_ok($$select ${fn}('apply')$$, 'P0001',`,
      `  ${sqlText(`Official bank ${plan.code}: the published questions are not the audited set`)},`,
      `  ${label('apply refuses a published set other than the audited one')});`,
      plan.audited.length ? `update public.managed_content_items set published_revision = 1 where id = '${plan.audited[0].itemId}';`
        : `update public.managed_content_items set published_revision = null where id = '${plan.add[0].itemId}';`,
      '',
      `-- A failure on the last question rolls back everything written before it. After the rollback that question`,
      `-- exists unpublished; its stored text is changed so it is no longer the bank's, then restored.`,
      `create temporary table bank_conflict_${plan.functionName} on commit drop as select ${rows} counts,`,
      `  (select payload from public.managed_content_revisions where item_id = '${last.itemId}' and revision = 1) payload;`,
      `update public.managed_content_revisions set payload = jsonb_set(payload, '{prompt}', '"Not the bank text"')`,
      `  where item_id = '${last.itemId}' and revision = 1;`,
      `select throws_ok($$select ${fn}('apply')$$, 'P0001',`,
      `  ${sqlText(`Official bank ${plan.code}: ${last.itemId} is not the same migration-owned question`)},`,
      `  ${label('apply fails on a conflicting last question')});`,
      `select ok(${live(plan.courseId)} = ${jsonLiteral(audited, 'audited_set')},`,
      `  ${label('a failed apply leaves the audited set published')});`,
      `update public.managed_content_revisions set payload = (select payload from bank_conflict_${plan.functionName})`,
      `  where item_id = '${last.itemId}' and revision = 1;`,
      `select is(${rows}, (select counts from bank_conflict_${plan.functionName}),`,
      `  ${label('the failed apply wrote nothing')});`,
      '',
      `select is(${fn}('apply'), 'applied', ${label('apply after a rollback republishes the bank set')});`,
      ...(plan.title ? [
        `select is((select display_title from public.institutional_courses where repository_course_id = '${plan.courseId}'),`,
        `  ${sqlText(plan.title.bank)}, ${label('the catalogue shows the official title')});`] : []),
      `select ok(${live(plan.courseId)} = ${jsonLiteral(final, 'final_set')},`,
      `  ${label('the bank set is published again')});`,
      '')
  }
  lines.push('-- Every apply, rerun, refusal and rollback above leaves the course lists exactly as the migrations left them.',
    'select ok((select count(*) from bank_applicability_start) = (select count(*) from public.course_applicability)',
    '  and not exists (select * from bank_applicability_start except select * from public.course_applicability),',
    "  'the imports add and remove no applicability rows');",
    'select * from finish();', 'rollback;', '')
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

/** The new courses' shelf entries and practice settings (read by lib/data/courses.ts and lib/data/quizzes.ts). Only
 *  identity, the owner's list and exam settings: no overview, tagline or description is written. */
function coursesModule(plans) {
  const created = plans.filter(plan => plan.course)
  const courses = created.map(plan => `  { id: ${JSON.stringify(`bank-${plan.code}`)}, contentKey: ${JSON.stringify(plan.slug)}, `
    + `slug: ${JSON.stringify(plan.slug)}, code: ${JSON.stringify(plan.code)},\n    title: ${JSON.stringify(plan.course.title)}, `
    + `level: ${plan.course.level}, semester: ${plan.course.semester}, credits: ${plan.course.units}, `
    + `textbooks: [], topics: [], examFocus: [], resources: [] },`)
  const quizzes = created.map(plan => `  ${JSON.stringify(plan.slug)}: { courseSlug: ${JSON.stringify(plan.slug)}, `
    + `courseCode: ${JSON.stringify(plan.code)}, title: ${JSON.stringify(plan.course.title)},\n    `
    + `maxQuizQuestions: ${plan.course.examQuestions}, quizDurationMinutes: ${plan.course.examMinutes} },`)
  return [
    '// lib/data/official-bank-courses.ts — GENERATED by scripts/managed-content/generate.cjs; do not edit.',
    '// Courses created for an official bank: shelf identity from the owner\'s course list (title, level, first semester,',
    '// units) and exam settings. Which students see a course is decided by its catalogue applicability, not by these fields.',
    "import type { Course } from '@/lib/types'",
    '',
    'export const OFFICIAL_BANK_COURSES: Course[] = [',
    ...courses,
    ']',
    '',
    'export const OFFICIAL_BANK_QUIZZES: Readonly<Record<string, { courseSlug: string; courseCode: string; title: string;',
    '  maxQuizQuestions: number; quizDurationMinutes: number }>> = {',
    ...quizzes,
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
  outputs.push([SECTIONS_MODULE, sectionsModule(plans)], [COURSES_MODULE, coursesModule(plans)])
  if (plans.length) outputs.push([BEHAVIOUR_TEST, behaviourTestSql(plans)])
  return outputs
}

/** Bank artifacts that must not exist, such as the behaviour test before any import. */
function absentBankOutputs(plans) {
  return plans.length ? [] : [BEHAVIOUR_TEST]
}

module.exports = { BANK_ACTOR, absentBankOutputs, bankOutputs, buildImports, convertQuestion, loadBanks,
  loadIdentityMap, planImport, publishedCbt }
