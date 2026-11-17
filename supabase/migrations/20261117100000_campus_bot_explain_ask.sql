-- supabase/migrations/20261117100000_campus_bot_explain_ask.sql — Campus Bot Explain and Ask Campus Bot (owner decisions
-- of 16 November 2026). Builds on the Campus Bot limits (20261103100000, 20261103140000, 20261103160000) and changes
-- one earlier function, private.campus_bot_window_use, so the two new features share the session and week windows.
--
-- Explain. For a question in one of the student's own server-run attempts: one they have answered in topic practice, or
-- any question (answered or left out) of an exam that is already graded. Never while an exam is open in that course,
-- practice or free pass, and never a free pass exam question: those live in private.discovery_previews, which nothing
-- here reads as a source of questions. The explanation is written from the course's published notes, found by the
-- question's own topic and Postgres full-text search, plus the official explanation.
--
-- Shared explanations. An explanation holds no personal data, so it is saved once for everyone, keyed by the question's
-- revision and the option chosen (-1 for a question left out). A later student with Campus Bot gets the saved one with
-- no provider call and no charge. A corrected question is a new revision, so it starts again; republishing a notes topic
-- removes the explanations written from it. On a calculation course the checking model reads an explanation once,
-- before it is saved; a failed check is saved as "no explanation", so the student is shown the notes topic instead.
--
-- Ask Campus Bot. A chat about one notes topic: a published note of a course the student can read, or the topic their
-- free pass pinned (private.campus_bot_topic_context, the rule "Practise this topic" shares). The context is that topic's
-- notes only; no function here returns a question bank or an answer key to it. Refused in a course while an exam is open there. Chat text is never stored, except that a delivered reply is
-- kept chat_reply_keep_seconds (10 minutes) so a retry of the same message is free, then deleted.
--
-- Funding and charges. A paid plan or the free month: the existing windows, charged
-- (read + written_token_weight x written) x the writing model's price_weight from the provider's own report. The check
-- on a calculation course is charged at the writer's weight, not the checker's (owner decision). A free pass:
-- pass_explanations (5) and pass_chat_messages (10) per pass. Reserved before the provider is called, settled after;
-- only a delivered explanation or reply is charged. No funding: 'not-entitled'.
--
-- Usage lives in private.campus_bot_replies, not public.ai_usage_events: every row of that table counts towards a
-- pass's one set (private.ai_units_used) and the sets' platform day.
--
-- Lock order. The account write prefix of every course-access write (private.open_course_session_write), the student's
-- Campus Bot lock (ai-practice-generation:<user>, the one sets take, so windows open and reserve one request at a
-- time), pending grant binding, the student's window rows, then for Explain the lock of the explanation's key, then
-- reply rows before explanation rows. Finishing takes the account prefix, the student's Campus Bot lock, its reply
-- row, then its explanation row. Every time decision reads clock_timestamp() once those locks are held.

-- ---------------------------------------------------------------------------
-- Settings. Both features are off until the team turns them on after the human review.
-- ---------------------------------------------------------------------------
alter table private.campus_bot_settings
  add column explain_enabled boolean not null default false,
  add column ask_enabled boolean not null default false,
  -- "Quiz me on this topic": sets written from one notes topic. The switch lives here with the other two; the feature
  -- itself is a later change and reads it through the same functions.
  add column topic_sets_enabled boolean not null default false,
  -- The model that checks an explanation on a calculation course. The sets' own check step (check_model) is separate.
  add column explain_check_model text references private.campus_bot_models (model) on delete restrict,
  add column pass_explanations integer not null default 5 check (pass_explanations between 0 and 1000),
  add column pass_chat_messages integer not null default 10 check (pass_chat_messages between 0 and 1000),
  -- Platform ceilings per UTC day: requests admitted to the provider, delivered or not. 0 stops the feature's new work.
  add column daily_explanations integer not null default 3000 check (daily_explanations between 0 and 10000000),
  add column daily_chat_messages integer not null default 10000 check (daily_chat_messages between 0 and 10000000),
  -- Undelivered tries (failures, timeouts, "not covered", failed checks) one student may have per UTC day.
  add column reply_undelivered_per_day integer not null default 20 check (reply_undelivered_per_day between 0 and 1000),
  -- A reservation outlasts admission (15 s), the writing call (25 s), the check (35 s) and settlement (30 s).
  add column reply_reservation_seconds integer not null default 180 check (reply_reservation_seconds between 120 and 3600),
  add column chat_reply_keep_seconds integer not null default 600 check (chat_reply_keep_seconds between 60 and 3600);
update private.campus_bot_settings set explain_check_model = 'sonnet';
alter table private.campus_bot_settings alter column explain_check_model set not null;

-- Per-request caps for the new steps. The step names are shared with lib/campus-bot/steps.ts.
alter table private.campus_bot_request_caps drop constraint campus_bot_request_caps_step_check;
alter table private.campus_bot_request_caps add constraint campus_bot_request_caps_step_check
  check (step in ('writing', 'check', 'explain', 'explain-check', 'chat'));
insert into private.campus_bot_request_caps (step, read_tokens_max, written_tokens_max, updated_at, updated_by) values
  ('explain', 8000, 800, now(), 'migration:20261117100000'),
  ('explain-check', 4000, 2000, now(), 'migration:20261117100000'),
  ('chat', 14000, 800, now(), 'migration:20261117100000');

-- Calculation courses: an explanation is checked before anyone sees it. The first list is every course whose exam
-- runs 40 minutes in the exam configuration (lib/data/quizzes.ts and lib/data/official-bank-courses.ts on the day of
-- this migration; lib/campus-bot/calculation-courses.test.cjs holds the two together). The team changes it afterwards.
create table private.campus_bot_courses (
  course_id uuid primary key references public.courses (id) on delete cascade,
  calculation boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null check (char_length(updated_by) between 1 and 120)
);
insert into private.campus_bot_courses (course_id, calculation, updated_by)
  select c.id, true, 'migration:20261117100000' from public.courses c
  where c.content_key in ('business-statistics', 'business-statistics-1', 'business-taxation-2', 'elements-banking',
    'fundamentals-deposit-insurance', 'introduction-actuarial-science', 'introduction-computer', 'introduction-finance',
    'introduction-financial-accounting-1', 'introduction-insurance', 'introduction-microeconomics',
    'leadership-governance', 'managerial-economics', 'mathematics-business', 'principles-economics-1',
    'principles-marketing');

-- ---------------------------------------------------------------------------
-- Notes as plain-text passages. One row per passage of each published note: a guide topic's "What you must know", each
-- lesson and its recap; any other note as one passage. Kept by a trigger whenever a note's published revision changes.
-- Access is not decided here: every caller checks it before it reads a passage.
-- ---------------------------------------------------------------------------
create function private.guide_inline_text(p_spans jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce(string_agg(coalesce(spans.span ->> 'text', ''), '' order by spans.position), '')
  from jsonb_array_elements(case when jsonb_typeof(p_spans) = 'array' then p_spans else '[]'::jsonb end)
    with ordinality as spans(span, position);
$$;

-- Paragraphs, lists, tables and preformatted text as lines of plain text. Anything it does not know is left out.
create function private.guide_blocks_text(p_blocks jsonb, p_depth integer default 0) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_block jsonb;
  v_item jsonb;
  v_row jsonb;
  v_line text;
  v_number integer;
  v_out text := '';
  v_indent text := repeat('  ', least(greatest(p_depth, 0), 6));
begin
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' or p_depth > 6 then return ''; end if;
  for v_block in select value from jsonb_array_elements(p_blocks) loop
    if jsonb_typeof(v_block) <> 'object' then continue; end if;
    if v_block ->> 'type' = 'paragraph' then
      v_out := v_out || v_indent || private.guide_inline_text(v_block -> 'text') || E'\n';
    elsif v_block ->> 'type' = 'preformatted' then
      v_out := v_out || coalesce(v_block ->> 'text', '') || E'\n';
    elsif v_block ->> 'type' = 'list' and jsonb_typeof(v_block -> 'items') = 'array' then
      v_number := case when (v_block ->> 'start') ~ '^[0-9]{1,4}$' then (v_block ->> 'start')::integer else 1 end;
      for v_item in select value from jsonb_array_elements(v_block -> 'items') loop
        v_out := v_out || v_indent
          || case when v_block -> 'ordered' = 'true'::jsonb then v_number::text || '. ' else '- ' end
          || private.guide_inline_text(v_item -> 'text') || E'\n'
          || private.guide_blocks_text(v_item -> 'blocks', p_depth + 1);
        v_number := v_number + 1;
      end loop;
    elsif v_block ->> 'type' = 'table' and jsonb_typeof(v_block -> 'header') = 'array'
        and jsonb_typeof(v_block -> 'rows') = 'array' then
      for v_row in select t.cells from (
          select v_block -> 'header' as cells, 0::bigint as place
          union all
          select r.value, r.ordinality from jsonb_array_elements(v_block -> 'rows') with ordinality as r(value, ordinality)
        ) t order by t.place loop
        if jsonb_typeof(v_row) <> 'array' then continue; end if;
        select string_agg(private.guide_inline_text(c.cell), ' | ' order by c.position) into v_line
          from jsonb_array_elements(v_row) with ordinality as c(cell, position);
        v_out := v_out || v_indent || coalesce(v_line, '') || E'\n';
      end loop;
    end if;
  end loop;
  return v_out;
end;
$$;

-- A note's passages, in reading order. It reads any payload without raising: a shape it does not know gives nothing.
create function private.note_passages_of(p_payload jsonb)
returns table (ordinal integer, heading text, body text)
language plpgsql immutable set search_path = '' as $$
declare
  v_lesson jsonb;
  v_next integer := 0;
  v_text text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return; end if;
  if p_payload ->> 'noteType' = 'guide_topic' then
    v_text := btrim(private.guide_inline_text(p_payload -> 'mustKnow') || E'\n'
      || private.guide_blocks_text(p_payload -> 'introMore'), E' \n');
    if v_text <> '' then
      ordinal := v_next; heading := 'What you must know'; body := v_text; return next; v_next := v_next + 1;
    end if;
    if jsonb_typeof(p_payload -> 'lessons') = 'array' then
      for v_lesson in select value from jsonb_array_elements(p_payload -> 'lessons') loop
        v_text := btrim(private.guide_blocks_text(v_lesson -> 'mustKnow')
          || private.guide_blocks_text(v_lesson -> 'explainMore'), E' \n');
        if v_text <> '' then
          ordinal := v_next;
          heading := btrim(coalesce(v_lesson ->> 'number', '') || ' ' || coalesce(v_lesson ->> 'title', ''));
          body := v_text; return next; v_next := v_next + 1;
        end if;
      end loop;
    end if;
    v_text := btrim(private.guide_blocks_text(p_payload -> 'recap'), E' \n');
    if v_text <> '' then
      ordinal := v_next; heading := 'Recap'; body := v_text; return next; v_next := v_next + 1;
    end if;
    return;
  end if;
  v_text := btrim(concat_ws(E'\n', nullif(btrim(p_payload ->> 'body'), ''),
    (select string_agg('- ' || k.point, E'\n' order by k.position)
      from jsonb_array_elements_text(case when jsonb_typeof(p_payload -> 'keyPoints') = 'array'
        then p_payload -> 'keyPoints' else '[]'::jsonb end) with ordinality as k(point, position)),
    nullif(btrim(p_payload ->> 'examTip'), ''), nullif(btrim(p_payload ->> 'example'), ''),
    nullif(btrim(p_payload ->> 'formula'), '')), E' \n');
  if v_text <> '' then
    ordinal := 0; heading := coalesce(nullif(btrim(p_payload ->> 'title'), ''), 'Notes'); body := v_text; return next;
  end if;
end;
$$;

create table private.note_passages (
  item_id uuid not null references public.managed_content_items (id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  revision integer not null check (revision > 0),
  course_id uuid not null references public.courses (id) on delete cascade,
  heading text not null check (char_length(heading) between 1 and 300),
  body text not null check (char_length(body) >= 1),
  search tsvector generated always as (
    setweight(to_tsvector('english'::regconfig, heading), 'A') || setweight(to_tsvector('english'::regconfig, body), 'B')
  ) stored,
  primary key (item_id, ordinal)
);
create index note_passages_course_idx on private.note_passages (course_id);
create index note_passages_search_idx on private.note_passages using gin (search);

-- OR over text-search queries: any word of a question may match a passage.
create aggregate private.tsquery_or(tsquery) (sfunc = pg_catalog.tsquery_or, stype = tsquery);

-- ---------------------------------------------------------------------------
-- Usage. One row per request admitted to the provider; a free pass's rows carry no tokens.
-- ---------------------------------------------------------------------------
create table private.campus_bot_replies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null check (feature in ('explain', 'chat')),
  -- Chat: the browser's id for the message, so a retry is the same request.
  request_id uuid,
  course_id uuid not null references public.courses (id) on delete restrict,
  state text not null default 'reserved' check (state in ('reserved', 'consumed', 'released')),
  outcome text check (char_length(outcome) between 1 and 40),
  funding_source text not null check (funding_source in ('paid', 'early_access', 'trial')),
  funding_grant_id uuid references public.entitlement_grants (id) on delete set null,
  session_window_id uuid references private.campus_bot_windows (id) on delete set null,
  week_window_id uuid references private.campus_bot_windows (id) on delete set null,
  reserved_tokens bigint check (reserved_tokens >= 0),
  charged_tokens bigint check (charged_tokens >= 0),
  -- The model, weights and caps the request was admitted at: the server uses exactly these and is charged at them.
  model text not null,
  provider_model text not null,
  price_weight integer not null check (price_weight between 1 and 1000),
  written_token_weight integer not null check (written_token_weight between 1 and 100),
  read_tokens_max integer not null check (read_tokens_max > 0),
  written_tokens_max integer not null check (written_tokens_max > 0),
  read_tokens bigint check (read_tokens >= 0),
  written_tokens bigint check (written_tokens >= 0),
  -- Explain on a calculation course: the checking model and its own report.
  check_provider_model text,
  check_read_tokens bigint check (check_read_tokens >= 0),
  check_written_tokens bigint check (check_written_tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  duration_ms integer check (duration_ms >= 0),
  reserved_at timestamptz not null,
  settled_at timestamptz,
  -- Chat: the delivered reply ({"text", "in_notes"}), kept until reply_expires_at so a retry is free, then deleted.
  reply jsonb check (reply is null or jsonb_typeof(reply) = 'object'),
  reply_expires_at timestamptz,
  constraint campus_bot_replies_settled_check check ((state = 'reserved') = (settled_at is null)),
  constraint campus_bot_replies_request_check check ((feature = 'chat') = (request_id is not null)),
  constraint campus_bot_replies_tokens_check check ((funding_source = 'trial') = (reserved_tokens is null)),
  constraint campus_bot_replies_kept_check check (reply is null or (feature = 'chat' and reply_expires_at is not null))
);
create unique index campus_bot_replies_request_idx on private.campus_bot_replies (user_id, request_id)
  where request_id is not null and state <> 'released';
create index campus_bot_replies_user_idx on private.campus_bot_replies (user_id, reserved_at);
create index campus_bot_replies_grant_idx on private.campus_bot_replies (funding_grant_id, feature)
  where funding_grant_id is not null;
create index campus_bot_replies_session_window_idx on private.campus_bot_replies (session_window_id)
  where session_window_id is not null;
create index campus_bot_replies_week_window_idx on private.campus_bot_replies (week_window_id)
  where week_window_id is not null;
create index campus_bot_replies_kept_idx on private.campus_bot_replies (reply_expires_at) where reply is not null;

-- Requests admitted per UTC day, for the platform ceilings.
create table private.campus_bot_reply_days (
  day date not null,
  feature text not null check (feature in ('explain', 'chat')),
  admitted integer not null default 0 check (admitted >= 0),
  primary key (day, feature)
);

-- Explanations, saved once for everyone. No student is named on a row.
create table private.campus_bot_explanations (
  item_id uuid not null,
  revision integer not null,
  -- The option chosen; -1 for a question left out of a graded exam.
  chosen_option integer not null check (chosen_option between -1 and 7),
  course_id uuid not null references public.courses (id) on delete cascade,
  state text not null check (state in ('running', 'done')),
  outcome text check (outcome in ('explained', 'not-covered', 'check-failed')),
  body text check (char_length(body) between 1 and 4000),
  -- The notes topic it was written from (explained), or the one to read instead (check-failed).
  topic_item_id uuid references public.managed_content_items (id) on delete cascade,
  -- The checking model passed it (calculation courses).
  checked boolean not null default false,
  -- The request writing it. Null once that request's row is gone, and on a "not covered" answer found without a call.
  reply_id uuid references private.campus_bot_replies (id) on delete set null,
  started_at timestamptz not null,
  finished_at timestamptz,
  primary key (item_id, revision, chosen_option),
  foreign key (item_id, revision) references public.managed_content_revisions (item_id, revision)
    on update restrict on delete cascade,
  constraint campus_bot_explanations_done_check check ((state = 'done') = (outcome is not null)
    and (state = 'done') = (finished_at is not null)),
  constraint campus_bot_explanations_body_outcome_check check ((outcome is not distinct from 'explained') = (body is not null)),
  constraint campus_bot_explanations_topic_outcome_check check (
    outcome is null or (outcome = 'not-covered') = (topic_item_id is null))
);
create index campus_bot_explanations_reply_idx on private.campus_bot_explanations (reply_id) where reply_id is not null;
create index campus_bot_explanations_topic_idx on private.campus_bot_explanations (topic_item_id)
  where topic_item_id is not null;
create index campus_bot_explanations_course_idx on private.campus_bot_explanations (course_id, outcome);

alter table private.campus_bot_courses enable row level security;
alter table private.note_passages enable row level security;
alter table private.campus_bot_replies enable row level security;
alter table private.campus_bot_reply_days enable row level security;
alter table private.campus_bot_explanations enable row level security;
revoke all on table private.campus_bot_courses, private.note_passages, private.campus_bot_replies,
  private.campus_bot_reply_days, private.campus_bot_explanations from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Keeping the passages. Publishing never fails on a note this cannot read: such a note simply has no passages.
-- Republishing or withdrawing a topic removes the explanations written from it, and gives the course's "not covered"
-- answers another try.
-- ---------------------------------------------------------------------------
create function private.refresh_note_passages() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind <> 'note' then return new; end if;
  if tg_op = 'INSERT' and new.published_revision is null then return new; end if;
  if tg_op = 'UPDATE' and new.published_revision is not distinct from old.published_revision then return new; end if;
  delete from private.note_passages where item_id = new.id;
  delete from private.campus_bot_explanations e
    where e.topic_item_id = new.id or (e.course_id = new.course_id and e.outcome = 'not-covered');
  if new.published_revision is not null then
    begin
      insert into private.note_passages (item_id, ordinal, revision, course_id, heading, body)
        select new.id, p.ordinal, new.published_revision, new.course_id,
          left(coalesce(nullif(btrim(p.heading), ''), 'Notes'), 300), p.body
        from public.managed_content_revisions r
        cross join lateral private.note_passages_of(r.payload) p
        where r.item_id = new.id and r.revision = new.published_revision;
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$$;
create trigger managed_content_items_note_passages
  after insert or update of published_revision on public.managed_content_items
  for each row execute function private.refresh_note_passages();

-- Every note already published.
insert into private.note_passages (item_id, ordinal, revision, course_id, heading, body)
  select i.id, p.ordinal, i.published_revision, i.course_id,
    left(coalesce(nullif(btrim(p.heading), ''), 'Notes'), 300), p.body
  from public.managed_content_items i
  join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
  cross join lateral private.note_passages_of(r.payload) p
  where i.kind = 'note' and i.published_revision is not null;

-- ---------------------------------------------------------------------------
-- Reading notes for a prompt (the notes-context helper, lib/campus-bot/notes-context.ts). Neither decides access.
-- ---------------------------------------------------------------------------
-- A published notes topic as students know it: its place on the notes page and its title. Null when not published.
create function private.note_topic_view(p_course uuid, p_item uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('item_id', n.id, 'number', n.topic_number, 'title', n.topic_title)
  from (
    select i.id, (row_number() over (order by i.position nulls last, i.created_at, i.id))::integer as topic_number,
      r.payload ->> 'title' as topic_title
    from public.managed_content_items i
    join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
    where i.course_id = p_course and i.kind = 'note' and i.published_revision is not null
  ) n
  where n.id = p_item;
$$;

-- One topic's passages in reading order, within a character budget (the first passage always).
create function private.note_topic_passages(p_item uuid, p_max_chars integer)
returns table (place integer, heading text, body text)
language sql stable security definer set search_path = '' as $$
  select t.place, t.heading, t.body
  from (
    select (row_number() over (order by p.ordinal))::integer as place, p.heading, p.body,
      sum(char_length(p.body)) over (order by p.ordinal) as running
    from private.note_passages p where p.item_id = p_item
  ) t
  where t.place = 1 or t.running <= p_max_chars
  order by t.place;
$$;

-- The best passages of a course for a question: first the topic whose practice topics name the question's section,
-- then full-text rank over the question's words (any word may match). Nothing matched: no rows.
create function private.note_search(p_course uuid, p_query text, p_section text, p_limit integer, p_max_chars integer)
returns table (place integer, item_id uuid, topic_number integer, topic_title text, heading text, body text)
language sql stable security definer set search_path = '' as $$
  with notes as (
    select i.id, (row_number() over (order by i.position nulls last, i.created_at, i.id))::integer as topic_number,
      r.payload ->> 'title' as topic_title,
      (p_section is not null and exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(r.payload -> 'practice') = 'array'
          then r.payload -> 'practice' else '[]'::jsonb end) link
        where lower(btrim(link.value ->> 'topic')) = lower(btrim(p_section)))) as linked
    from public.managed_content_items i
    join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
    where i.course_id = p_course and i.kind = 'note' and i.published_revision is not null
  ), query as (
    select private.tsquery_or(plainto_tsquery('simple'::regconfig, l.lexeme)) as q
    from (
      select w.lexeme from unnest(to_tsvector('english'::regconfig, left(coalesce(p_query, ''), 6000))) w
      order by w.lexeme limit 120
    ) l
  ), ranked as (
    select n.id as item_id, n.topic_number, n.topic_title, n.linked, p.ordinal, p.heading, p.body,
      coalesce(ts_rank_cd(p.search, query.q, 32), 0) as rank
    from private.note_passages p
    join notes n on n.id = p.item_id
    cross join query
  ), chosen as (
    select ranked.*,
      (row_number() over (order by ranked.linked desc, ranked.rank desc, ranked.topic_number, ranked.ordinal))::integer
        as place,
      sum(char_length(ranked.body)) over (order by ranked.linked desc, ranked.rank desc, ranked.topic_number,
        ranked.ordinal) as running
    from ranked
    where ranked.linked or ranked.rank > 0
  )
  select chosen.place, chosen.item_id, chosen.topic_number, chosen.topic_title, chosen.heading, chosen.body
  from chosen
  where chosen.place <= greatest(p_limit, 1) and (chosen.place = 1 or chosen.running <= p_max_chars)
  order by chosen.place;
$$;

-- ---------------------------------------------------------------------------
-- The windows count both kinds of use. Replaces 20261103100000's function; its signature and its sets are unchanged.
-- ---------------------------------------------------------------------------
create or replace function private.campus_bot_window_use(p_window uuid, out used bigint, out in_flight bigint)
language sql stable security definer set search_path = '' as $$
  with sets as (
    select coalesce(sum(e.charged_tokens) filter (where e.state = 'consumed'), 0)::bigint as used,
      coalesce(sum(e.reserved_tokens) filter (where e.state = 'reserved'
        and e.reserved_at > clock_timestamp() - make_interval(mins => p.reservation_minutes)), 0)::bigint as in_flight
    from public.ai_usage_events e cross join private.ai_practice_policy p
    where p_window is not null and (e.session_window_id = p_window or e.week_window_id = p_window)
  ), replies as (
    select coalesce(sum(r.charged_tokens) filter (where r.state = 'consumed'), 0)::bigint as used,
      coalesce(sum(r.reserved_tokens) filter (where r.state = 'reserved'
        and r.reserved_at > clock_timestamp() - make_interval(secs => s.reply_reservation_seconds)), 0)::bigint as in_flight
    from private.campus_bot_replies r cross join private.campus_bot_settings s
    where p_window is not null and (r.session_window_id = p_window or r.week_window_id = p_window)
  )
  select sets.used + replies.used, sets.in_flight + replies.in_flight from sets cross join replies;
$$;

-- ---------------------------------------------------------------------------
-- Funding for a reply: the token plan sets use (paid, or the free month), else a current free pass (or the seven-day
-- trial from before it), which is counted, not metered. No row: not entitled.
-- ---------------------------------------------------------------------------
create function private.campus_bot_reply_funding(p_user uuid, p_at timestamptz)
returns table (mode text, source text, grant_id uuid, session_hours integer, session_tokens integer, week_days integer,
  week_tokens integer, written_token_weight integer)
language sql stable security definer set search_path = '' as $$
  with plan as (
    select * from private.campus_bot_plan(p_user, p_at, array['paid', 'early_access'])
  ), pass as (
    select g.id from public.entitlement_grants g
    where g.user_id = p_user and g.source = 'trial' and g.ai_terms <> 'none' and g.revoked_at is null
      and g.starts_at <= p_at and g.ends_at > p_at
  )
  select 'tokens'::text, plan.source, plan.grant_id, plan.session_hours, plan.session_tokens, plan.week_days,
    plan.week_tokens, plan.written_token_weight
  from plan
  union all
  select 'count'::text, 'trial'::text, pass.id, null::integer, null::integer, null::integer, null::integer,
    (select t.written_token_weight from private.campus_bot_tiers t where t.tier = 'standard')
  from pass
  where not exists (select 1 from plan)
  limit 1;
$$;

-- Reservations the server never settled (a crash, a lost connection): released, charged nothing, and the explanation
-- they were writing is free for the next request.
create function private.release_abandoned_campus_bot_replies(p_user uuid, p_at timestamptz) returns void
language sql security definer set search_path = '' as $$
  with stale as (
    update private.campus_bot_replies r
      set state = 'released', outcome = 'abandoned', settled_at = p_at,
        charged_tokens = case when r.reserved_tokens is null then null else 0 end
      from private.campus_bot_settings s
      where r.user_id = p_user and r.state = 'reserved'
        and r.reserved_at <= p_at - make_interval(secs => s.reply_reservation_seconds)
      returning r.id
  )
  delete from private.campus_bot_explanations e using stale where e.reply_id = stale.id and e.state = 'running';
$$;

-- An exam is open in this course for this student: a practice exam, or the free pass exam. Campus Bot explains and
-- answers nothing in a course while one is.
create function private.campus_bot_exam_open(p_user uuid, p_course uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.quiz_attempts a where a.user_id = p_user and a.course_id = p_course
      and a.status = 'in_progress' and a.mode = 'exam' and a.deadline_at > p_at)
    or exists (select 1 from private.discovery_previews p where p.user_id = p_user and p.course_id = p_course
      and p.kind = 'cbt' and p.submitted_at is null and p.deadline_at > p_at);
$$;

-- The one rule for "may this student use Campus Bot on this notes topic, and what does it say": shared by Ask Campus
-- Bot and "Practise this topic". A published note of a course the student can read now (the notes read's own rule,
-- private.can_read_course_content), or the topic their current free pass pinned, exactly as it was pinned.
--   state 'ready': the topic's title, its place on the notes page (number; null for a pinned topic, which is not on
--     that page), the note revision the passages come from, and the passages ([{"heading", "body"}] in reading order,
--     within p_max_chars; the first passage always);
--   state 'locked': the topic exists but this student may not read it; state 'not-found': no such notes topic.
-- The caller holds the account prefix (private.open_course_session_write) and passes its one reading of the clock.
create function private.campus_bot_topic_context(p_user uuid, p_course uuid, p_item uuid, p_at timestamptz,
  p_max_chars integer, out state text, out title text, out number integer, out revision integer, out passages jsonb,
  out pinned boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.managed_content_items;
  v_pinned jsonb;
begin
  select * into v_item from public.managed_content_items i
    where i.id = p_item and i.course_id = p_course and i.kind = 'note';
  if v_item.id is not null and v_item.published_revision is not null
      and private.can_read_course_content(p_user, p_course) then
    pinned := false;
    revision := v_item.published_revision;
    title := (select r.payload ->> 'title' from public.managed_content_revisions r
      where r.item_id = v_item.id and r.revision = v_item.published_revision);
    number := (private.note_topic_view(p_course, p_item) ->> 'number')::integer;
    passages := (select coalesce(jsonb_agg(jsonb_build_object('heading', t.heading, 'body', t.body) order by t.place),
        '[]'::jsonb) from private.note_topic_passages(p_item, p_max_chars) t);
  else
    v_pinned := (select e.value
      from private.discovery_previews p
      join public.entitlement_grants g on g.id = p.grant_id
      cross join lateral jsonb_array_elements(p.content) e
      where p.user_id = p_user and p.course_id = p_course and p.kind = 'study_guide'
        and g.user_id = p_user and g.source = 'trial' and g.trial_policy = 'discovery' and g.revoked_at is null
        and g.starts_at <= p_at and g.ends_at > p_at and e.value ->> 'item_id' = p_item::text
      limit 1);
    if v_pinned is null then
      state := case when v_item.id is null then 'not-found' else 'locked' end;
      return;
    end if;
    pinned := true;
    revision := case when (v_pinned ->> 'revision') ~ '^[0-9]{1,9}$' then (v_pinned ->> 'revision')::integer end;
    title := v_pinned -> 'note' ->> 'title';
    passages := (select coalesce(jsonb_agg(jsonb_build_object('heading', t.heading, 'body', t.body) order by t.ordinal),
        '[]'::jsonb)
      from (
        select n.ordinal, n.heading, n.body, sum(char_length(n.body)) over (order by n.ordinal) as running
        from private.note_passages_of(v_pinned -> 'note') n
      ) t
      where t.ordinal = 0 or t.running <= p_max_chars);
  end if;
  state := case when title is null or btrim(title) = '' or jsonb_array_length(passages) = 0 then 'not-found'
    else 'ready' end;
end;
$$;

-- A saved explanation as the student is shown it.
create function private.campus_bot_explanation_view(p_saved private.campus_bot_explanations) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('outcome', p_saved.outcome, 'body', p_saved.body,
    'topic', case when p_saved.topic_item_id is not null
      then private.note_topic_view(p_saved.course_id, p_saved.topic_item_id) end);
$$;

-- The reference a delivered explanation is recorded under as plan use.
create function private.campus_bot_explanation_ref(p_item uuid, p_revision integer, p_chosen integer) returns text
language sql immutable set search_path = '' as $$
  select 'explain:' || p_item::text || ':' || p_revision::text || ':' || p_chosen::text;
$$;

-- ---------------------------------------------------------------------------
-- Explain: admission. Service role only; the student comes from the session.
-- ---------------------------------------------------------------------------
create function public.begin_campus_bot_explanation(p_session_id uuid, p_attempt_id uuid, p_question_id uuid,
  p_generate boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_settings private.campus_bot_settings;
  v_attempt public.quiz_attempts;
  v_question public.quiz_attempt_questions;
  v_answer public.quiz_attempt_answers;
  v_saved private.campus_bot_explanations;
  v_session private.campus_bot_windows;
  v_week private.campus_bot_windows;
  v_payload jsonb;
  v_passages jsonb;
  v_chosen integer;
  v_now timestamptz;
  v_refill_at timestamptz;
  v_mode text;
  v_source text;
  v_grant uuid;
  v_session_hours integer;
  v_session_tokens integer;
  v_week_days integer;
  v_week_tokens integer;
  v_weight integer;
  v_model text;
  v_provider_model text;
  v_price_weight integer;
  v_read_max integer;
  v_written_max integer;
  v_calculation boolean;
  v_check_provider text;
  v_check_read_max integer;
  v_check_written_max integer;
  v_reserved bigint;
  v_left bigint;
  v_used integer;
  v_rows integer;
  v_reply uuid;
  v_course_code text;
  v_course_title text;
begin
  if p_session_id is null or p_attempt_id is null or p_question_id is null or p_generate is null then
    raise exception 'Invalid explanation request' using errcode = '22023';
  end if;
  v_user := private.open_course_session_write(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || v_user::text, 0));
  perform private.bind_pending_course_grants(v_user);
  perform 1 from private.campus_bot_windows where user_id = v_user order by id for update;
  select * into strict v_settings from private.campus_bot_settings;
  -- The locks may have waited past logout or expiry.
  if private.course_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  if not v_settings.explain_enabled then return jsonb_build_object('state', 'disabled'); end if;

  -- The attempt check. Only the student's own server-run attempt and a question pinned in it.
  select * into v_attempt from public.quiz_attempts
    where id = p_attempt_id and user_id = v_user and deadline_at is not null;
  select * into v_question from public.quiz_attempt_questions
    where attempt_id = p_attempt_id and question_id = p_question_id;
  if v_attempt.id is null or v_question.attempt_id is null then return jsonb_build_object('state', 'not-found'); end if;
  select * into v_answer from public.quiz_attempt_answers
    where attempt_id = p_attempt_id and question_id = p_question_id;
  -- Topic practice: only a question already answered (its answer row is written when it is picked). An exam: only
  -- once it is graded, and then any of its questions, answered or left out.
  if (v_attempt.mode = 'instant' and v_answer.attempt_id is null)
      or (v_attempt.mode is distinct from 'instant' and v_attempt.status = 'in_progress') then
    return jsonb_build_object('state', 'not-answered');
  end if;
  v_chosen := coalesce(v_answer.option_index, -1);

  -- One refill epoch and one reading of the clock for everything below.
  select coalesce(max(r.at), '-infinity'::timestamptz) into v_refill_at
    from private.campus_bot_refills r where r.user_id = v_user or r.user_id is null;
  v_now := greatest(clock_timestamp(), v_refill_at + interval '1 microsecond');

  -- Never while an exam is open in this course: a practice exam or the free pass exam.
  if private.campus_bot_exam_open(v_user, v_attempt.course_id, v_now) then
    return jsonb_build_object('state', 'exam-open');
  end if;
  -- The rule that shows or withholds an attempt's answers (private.practice_view).
  if not private.attempt_material_allowed(v_attempt) then return jsonb_build_object('state', 'locked'); end if;

  select f.mode, f.source, f.grant_id, f.session_hours, f.session_tokens, f.week_days, f.week_tokens,
      f.written_token_weight
    into v_mode, v_source, v_grant, v_session_hours, v_session_tokens, v_week_days, v_week_tokens, v_weight
    from private.campus_bot_reply_funding(v_user, v_now) f;
  if v_mode is null then return jsonb_build_object('state', 'not-entitled'); end if;

  -- The explanation for this revision and choice, saved once for everyone.
  perform pg_advisory_xact_lock(hashtextextended('campus-bot-explanation:' || v_question.item_id::text || ':'
    || v_question.content_revision::text || ':' || v_chosen::text, 0));
  select * into v_saved from private.campus_bot_explanations
    where item_id = v_question.item_id and revision = v_question.content_revision and chosen_option = v_chosen;
  if v_saved.item_id is not null and v_saved.state = 'running'
      and v_saved.started_at <= v_now - make_interval(secs => v_settings.reply_reservation_seconds) then
    -- Its writer never settled. The reply row first, then the explanation row, as finishing does.
    update private.campus_bot_replies
      set state = 'released', outcome = 'abandoned', settled_at = v_now,
        charged_tokens = case when reserved_tokens is null then null else 0 end
      where id = v_saved.reply_id and state = 'reserved';
    delete from private.campus_bot_explanations
      where item_id = v_question.item_id and revision = v_question.content_revision and chosen_option = v_chosen
        and state = 'running';
    select * into v_saved from private.campus_bot_explanations
      where item_id = v_question.item_id and revision = v_question.content_revision and chosen_option = v_chosen;
  end if;
  if v_saved.item_id is not null and v_saved.state = 'running' then return jsonb_build_object('state', 'busy'); end if;
  if v_saved.item_id is not null then
    -- No provider call and no charge. Reading an explanation is still Campus Bot use on a paid course.
    if v_saved.outcome = 'explained' then
      perform private.mark_plan_use(v_user, 'campus-bot-message', v_attempt.course_id,
        private.campus_bot_explanation_ref(v_question.item_id, v_question.content_revision, v_chosen), v_now);
    end if;
    return jsonb_build_object('state', 'saved') || private.campus_bot_explanation_view(v_saved);
  end if;
  -- Nothing saved and the server cannot write one now.
  if not p_generate then return jsonb_build_object('state', 'disabled'); end if;

  perform private.release_abandoned_campus_bot_replies(v_user, v_now);
  if exists (select 1 from private.campus_bot_replies
      where user_id = v_user and feature = 'explain' and state = 'reserved') then
    return jsonb_build_object('state', 'busy');
  end if;
  if (select count(*) from private.campus_bot_replies where user_id = v_user and state = 'released'
        and reserved_at >= date_trunc('day', v_now at time zone 'utc') at time zone 'utc')
      >= v_settings.reply_undelivered_per_day then
    return jsonb_build_object('state', 'undelivered-limit');
  end if;

  -- The notes this question is explained from.
  select r.payload into v_payload from public.managed_content_revisions r
    where r.item_id = v_question.item_id and r.revision = v_question.content_revision;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', s.item_id, 'topic_number', s.topic_number,
      'topic_title', s.topic_title, 'heading', s.heading, 'body', s.body) order by s.place), '[]'::jsonb)
    into v_passages
    from private.note_search(v_attempt.course_id,
      concat_ws(' ', v_payload ->> 'prompt', v_payload -> 'options' ->> ((v_payload ->> 'correctOption')::integer),
        case when v_chosen >= 0 then v_payload -> 'options' ->> v_chosen end),
      private.practice_topic_of(v_payload), 3, 9000) s;
  if jsonb_array_length(v_passages) = 0 then
    -- The notes do not cover it: saved without a provider call, and nothing is charged.
    insert into private.campus_bot_explanations (item_id, revision, chosen_option, course_id, state, outcome,
        started_at, finished_at)
      values (v_question.item_id, v_question.content_revision, v_chosen, v_attempt.course_id, 'done', 'not-covered',
        v_now, v_now);
    return jsonb_build_object('state', 'saved', 'outcome', 'not-covered', 'body', null, 'topic', null);
  end if;

  -- The writing model and this step's caps; on a calculation course the checking model and its caps too.
  select m.model, m.provider_model, m.price_weight into v_model, v_provider_model, v_price_weight
    from private.campus_bot_models m where m.model = v_settings.writing_model;
  select c.read_tokens_max, c.written_tokens_max into v_read_max, v_written_max
    from private.campus_bot_request_caps c where c.step = 'explain';
  v_calculation := exists (select 1 from private.campus_bot_courses c
    where c.course_id = v_attempt.course_id and c.calculation);
  if v_calculation then
    select m.provider_model into v_check_provider
      from private.campus_bot_models m where m.model = v_settings.explain_check_model;
    select c.read_tokens_max, c.written_tokens_max into v_check_read_max, v_check_written_max
      from private.campus_bot_request_caps c where c.step = 'explain-check';
  end if;
  if v_provider_model is null or v_read_max is null
      or (v_calculation and (v_check_provider is null or v_check_read_max is null)) then
    return jsonb_build_object('state', 'capacity');
  end if;

  if v_mode = 'tokens' then
    -- The worst case of the request: the writing call and, on a calculation course, the check at the writer's weight.
    v_reserved := (v_read_max + v_weight::bigint * v_written_max
      + case when v_calculation then v_check_read_max + v_weight::bigint * v_check_written_max else 0 end) * v_price_weight;
    select * into v_session from private.campus_bot_open_window(v_user, 'session', v_now, v_refill_at);
    select * into v_week from private.campus_bot_open_window(v_user, 'week', v_now, v_refill_at);
    select v_session_tokens - u.used - u.in_flight into v_left from private.campus_bot_window_use(v_session.id) u;
    if v_left < v_reserved then
      return jsonb_build_object('state', 'session-limit', 'resets_at', v_session.ends_at);
    end if;
    select v_week_tokens - u.used - u.in_flight into v_left from private.campus_bot_window_use(v_week.id) u;
    if v_left < v_reserved then
      return jsonb_build_object('state', 'week-limit', 'resets_at', v_week.ends_at);
    end if;
  else
    select count(*) into v_used from private.campus_bot_replies r
      where r.funding_grant_id = v_grant and r.feature = 'explain' and (r.state = 'consumed' or (r.state = 'reserved'
        and r.reserved_at > v_now - make_interval(secs => v_settings.reply_reservation_seconds)));
    if v_used >= v_settings.pass_explanations then return jsonb_build_object('state', 'pass-limit'); end if;
  end if;

  -- The platform's day. The row lock makes the count exact without a lock every student queues on.
  insert into private.campus_bot_reply_days as d (day, feature, admitted)
    select (v_now at time zone 'utc')::date, 'explain', 1 where v_settings.daily_explanations > 0
    on conflict (day, feature) do update set admitted = d.admitted + 1
      where d.admitted < v_settings.daily_explanations;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('state', 'capacity'); end if;

  if v_mode = 'tokens' then
    -- Each window's end is fixed when it opens.
    if v_session.id is null then
      insert into private.campus_bot_windows (user_id, kind, starts_at, ends_at)
        values (v_user, 'session', v_now, v_now + make_interval(hours => v_session_hours)) returning * into v_session;
    end if;
    if v_week.id is null then
      insert into private.campus_bot_windows (user_id, kind, starts_at, ends_at)
        values (v_user, 'week', v_now, v_now + make_interval(days => v_week_days)) returning * into v_week;
    end if;
  end if;
  insert into private.campus_bot_replies (user_id, feature, course_id, funding_source, funding_grant_id,
      session_window_id, week_window_id, reserved_tokens, model, provider_model, price_weight, written_token_weight,
      read_tokens_max, written_tokens_max, check_provider_model, reserved_at)
    values (v_user, 'explain', v_attempt.course_id, v_source, v_grant, v_session.id, v_week.id, v_reserved, v_model,
      v_provider_model, v_price_weight, v_weight, v_read_max, v_written_max, v_check_provider, v_now)
    returning id into v_reply;
  insert into private.campus_bot_explanations (item_id, revision, chosen_option, course_id, state, reply_id, started_at)
    values (v_question.item_id, v_question.content_revision, v_chosen, v_attempt.course_id, 'running', v_reply, v_now);

  select c.course_code, c.display_title into v_course_code, v_course_title
    from public.institutional_courses c where c.repository_course_id = v_attempt.course_id;
  -- The server must use exactly these models and written-token caps: the reply is charged at the weights recorded here.
  return jsonb_build_object('state', 'started', 'reply_id', v_reply, 'model', v_provider_model,
    'max_output_tokens', v_written_max, 'reservation_seconds', v_settings.reply_reservation_seconds,
    'check', case when v_calculation
      then jsonb_build_object('model', v_check_provider, 'max_output_tokens', v_check_written_max) end,
    'course', jsonb_build_object('code', v_course_code, 'title', v_course_title),
    'question', jsonb_build_object('prompt', v_payload -> 'prompt', 'options', v_payload -> 'options',
      'correct_option', v_payload -> 'correctOption', 'chosen_option', case when v_chosen >= 0 then v_chosen end,
      'explanation', private.practice_explanation(v_payload)),
    'passages', v_passages);
end;
$$;

-- ---------------------------------------------------------------------------
-- Explain: settlement. Only an explanation that is saved is charged; everything else releases the reservation.
-- ---------------------------------------------------------------------------
create function public.finish_campus_bot_explanation(p_user_id uuid, p_reply_id uuid, p_outcome text, p_body text,
  p_topic_item_id uuid, p_usage jsonb, p_check_usage jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reply private.campus_bot_replies;
  v_saved private.campus_bot_explanations;
  v_outcome text := p_outcome;
  v_now timestamptz;
  v_read bigint;
  v_written bigint;
  v_check_read bigint;
  v_check_written bigint;
begin
  if p_user_id is null or p_reply_id is null or p_outcome is null
      or p_outcome not in ('explained', 'not-covered', 'check-failed', 'failed')
      or (p_outcome = 'explained') <> (p_body is not null)
      or (p_body is not null and char_length(btrim(p_body)) not between 1 and 4000)
      or (p_outcome in ('explained', 'check-failed') and p_topic_item_id is null)
      or (p_usage is not null and jsonb_typeof(p_usage) <> 'object')
      or (p_check_usage is not null and jsonb_typeof(p_check_usage) <> 'object') then
    raise exception 'Invalid explanation result' using errcode = '22023';
  end if;
  -- Account row first, in the same order as scheduling and the deletion worker.
  perform private.lock_course_access_scope(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || p_user_id::text, 0));
  perform private.bind_pending_course_grants(p_user_id);
  select * into v_reply from private.campus_bot_replies
    where id = p_reply_id and user_id = p_user_id and feature = 'explain' for update;
  if v_reply.id is null then return jsonb_build_object('state', 'not-found'); end if;
  if v_reply.state <> 'reserved' then return jsonb_build_object('state', 'already-finished'); end if;
  select * into v_saved from private.campus_bot_explanations where reply_id = p_reply_id for update;
  v_now := clock_timestamp();

  if v_outcome <> 'failed' and (
      -- The explanation was withdrawn meanwhile (its notes were republished), or the account is being deleted.
      v_saved.item_id is null or v_saved.state <> 'running'
      or exists (select 1 from private.account_deletion_jobs where user_id = p_user_id)
      -- On a calculation course nothing is saved as explained without the checking model's own report.
      or (v_outcome = 'explained' and v_reply.check_provider_model is not null and p_check_usage is null)
      or (v_outcome = 'check-failed' and v_reply.check_provider_model is null)
      -- The topic named must be one of the course's published notes.
      or (v_outcome in ('explained', 'check-failed')
        and private.note_topic_view(v_reply.course_id, p_topic_item_id) is null)) then
    v_outcome := 'failed';
  end if;

  v_read := coalesce((p_usage ->> 'inputTokens')::bigint, 0) + coalesce((p_usage ->> 'cacheReadInputTokens')::bigint, 0)
    + coalesce((p_usage ->> 'cacheCreationInputTokens')::bigint, 0);
  v_written := coalesce((p_usage ->> 'outputTokens')::bigint, 0);
  v_check_read := coalesce((p_check_usage ->> 'inputTokens')::bigint, 0)
    + coalesce((p_check_usage ->> 'cacheReadInputTokens')::bigint, 0)
    + coalesce((p_check_usage ->> 'cacheCreationInputTokens')::bigint, 0);
  v_check_written := coalesce((p_check_usage ->> 'outputTokens')::bigint, 0);
  update private.campus_bot_replies
    set state = case when v_outcome = 'explained' then 'consumed' else 'released' end, outcome = v_outcome,
      settled_at = v_now, read_tokens = v_read, written_tokens = v_written,
      check_read_tokens = case when p_check_usage is not null then v_check_read end,
      check_written_tokens = case when p_check_usage is not null then v_check_written end,
      -- The check is charged at the writer's weight: the student never pays the checking model's price.
      charged_tokens = case when reserved_tokens is null then null when v_outcome = 'explained'
        then (v_read + written_token_weight * v_written + v_check_read + written_token_weight * v_check_written)
          * price_weight else 0 end,
      cost_usd = case when p_usage is null and p_check_usage is null then null
        else coalesce((p_usage ->> 'estimatedCostUsd')::numeric, 0)
          + coalesce((p_check_usage ->> 'estimatedCostUsd')::numeric, 0) end,
      duration_ms = case when p_usage is null and p_check_usage is null then null
        else coalesce((p_usage ->> 'durationMs')::integer, 0) + coalesce((p_check_usage ->> 'durationMs')::integer, 0) end
    where id = p_reply_id;

  if v_outcome = 'failed' then
    delete from private.campus_bot_explanations where reply_id = p_reply_id and state = 'running';
    return jsonb_build_object('state', 'finished', 'outcome', 'failed');
  end if;
  update private.campus_bot_explanations
    set state = 'done', outcome = v_outcome, body = case when v_outcome = 'explained' then btrim(p_body) end,
      topic_item_id = case when v_outcome in ('explained', 'check-failed') then p_topic_item_id end,
      checked = (v_outcome = 'explained' and p_check_usage is not null), finished_at = v_now
    where reply_id = p_reply_id
    returning * into v_saved;
  if v_outcome = 'explained' then
    -- A delivered explanation is plan use for refunds, at the time it was admitted. Free courses are never recorded.
    perform private.mark_plan_use(p_user_id, 'campus-bot-message', v_reply.course_id,
      private.campus_bot_explanation_ref(v_saved.item_id, v_saved.revision, v_saved.chosen_option), v_reply.reserved_at);
  end if;
  return jsonb_build_object('state', 'finished') || private.campus_bot_explanation_view(v_saved);
end;
$$;

-- ---------------------------------------------------------------------------
-- Ask Campus Bot: admission. The context returned is the one topic's notes and nothing else.
-- ---------------------------------------------------------------------------
create function public.begin_campus_bot_chat(p_session_id uuid, p_request_id uuid, p_course_id uuid, p_item_id uuid,
  p_generate boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_settings private.campus_bot_settings;
  v_existing private.campus_bot_replies;
  v_session private.campus_bot_windows;
  v_week private.campus_bot_windows;
  v_topic_state text;
  v_passages jsonb;
  v_title text;
  v_now timestamptz;
  v_refill_at timestamptz;
  v_mode text;
  v_source text;
  v_grant uuid;
  v_session_hours integer;
  v_session_tokens integer;
  v_week_days integer;
  v_week_tokens integer;
  v_weight integer;
  v_model text;
  v_provider_model text;
  v_price_weight integer;
  v_read_max integer;
  v_written_max integer;
  v_reserved bigint;
  v_left bigint;
  v_used integer;
  v_rows integer;
  v_reply uuid;
  v_course_code text;
  v_course_title text;
begin
  if p_session_id is null or p_request_id is null or p_course_id is null or p_item_id is null or p_generate is null then
    raise exception 'Invalid chat request' using errcode = '22023';
  end if;
  v_user := private.open_course_session_write(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || v_user::text, 0));
  perform private.bind_pending_course_grants(v_user);
  perform 1 from private.campus_bot_windows where user_id = v_user order by id for update;
  select * into strict v_settings from private.campus_bot_settings;
  if private.course_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  if not v_settings.ask_enabled then return jsonb_build_object('state', 'disabled'); end if;

  select coalesce(max(r.at), '-infinity'::timestamptz) into v_refill_at
    from private.campus_bot_refills r where r.user_id = v_user or r.user_id is null;
  v_now := greatest(clock_timestamp(), v_refill_at + interval '1 microsecond');
  perform private.release_abandoned_campus_bot_replies(v_user, v_now);
  update private.campus_bot_replies set reply = null
    where user_id = v_user and reply is not null and reply_expires_at <= v_now;

  -- The same message again. Still being answered: wait. Answered: the kept reply, free, while it is kept.
  select * into v_existing from private.campus_bot_replies
    where user_id = v_user and request_id = p_request_id and state <> 'released';
  if v_existing.id is not null and v_existing.state = 'reserved' then return jsonb_build_object('state', 'busy'); end if;
  if v_existing.id is not null then
    return jsonb_build_object('state', 'answered', 'reply', v_existing.reply);
  end if;

  -- The topic, by the rule "Practise this topic" shares (private.campus_bot_topic_context).
  select t.state, t.title, t.passages into v_topic_state, v_title, v_passages
    from private.campus_bot_topic_context(v_user, p_course_id, p_item_id, v_now, 36000) t;
  if v_topic_state <> 'ready' then return jsonb_build_object('state', v_topic_state); end if;

  -- Not while an exam is open in this course.
  if private.campus_bot_exam_open(v_user, p_course_id, v_now) then
    return jsonb_build_object('state', 'exam-open');
  end if;

  select f.mode, f.source, f.grant_id, f.session_hours, f.session_tokens, f.week_days, f.week_tokens,
      f.written_token_weight
    into v_mode, v_source, v_grant, v_session_hours, v_session_tokens, v_week_days, v_week_tokens, v_weight
    from private.campus_bot_reply_funding(v_user, v_now) f;
  if v_mode is null then return jsonb_build_object('state', 'not-entitled'); end if;
  if not p_generate then return jsonb_build_object('state', 'disabled'); end if;

  if exists (select 1 from private.campus_bot_replies
      where user_id = v_user and feature = 'chat' and state = 'reserved') then
    return jsonb_build_object('state', 'busy');
  end if;
  if (select count(*) from private.campus_bot_replies where user_id = v_user and state = 'released'
        and reserved_at >= date_trunc('day', v_now at time zone 'utc') at time zone 'utc')
      >= v_settings.reply_undelivered_per_day then
    return jsonb_build_object('state', 'undelivered-limit');
  end if;

  select m.model, m.provider_model, m.price_weight into v_model, v_provider_model, v_price_weight
    from private.campus_bot_models m where m.model = v_settings.writing_model;
  select c.read_tokens_max, c.written_tokens_max into v_read_max, v_written_max
    from private.campus_bot_request_caps c where c.step = 'chat';
  if v_provider_model is null or v_read_max is null then return jsonb_build_object('state', 'capacity'); end if;

  if v_mode = 'tokens' then
    v_reserved := (v_read_max + v_weight::bigint * v_written_max) * v_price_weight;
    select * into v_session from private.campus_bot_open_window(v_user, 'session', v_now, v_refill_at);
    select * into v_week from private.campus_bot_open_window(v_user, 'week', v_now, v_refill_at);
    select v_session_tokens - u.used - u.in_flight into v_left from private.campus_bot_window_use(v_session.id) u;
    if v_left < v_reserved then
      return jsonb_build_object('state', 'session-limit', 'resets_at', v_session.ends_at);
    end if;
    select v_week_tokens - u.used - u.in_flight into v_left from private.campus_bot_window_use(v_week.id) u;
    if v_left < v_reserved then
      return jsonb_build_object('state', 'week-limit', 'resets_at', v_week.ends_at);
    end if;
  else
    select count(*) into v_used from private.campus_bot_replies r
      where r.funding_grant_id = v_grant and r.feature = 'chat' and (r.state = 'consumed' or (r.state = 'reserved'
        and r.reserved_at > v_now - make_interval(secs => v_settings.reply_reservation_seconds)));
    if v_used >= v_settings.pass_chat_messages then return jsonb_build_object('state', 'pass-limit'); end if;
  end if;

  insert into private.campus_bot_reply_days as d (day, feature, admitted)
    select (v_now at time zone 'utc')::date, 'chat', 1 where v_settings.daily_chat_messages > 0
    on conflict (day, feature) do update set admitted = d.admitted + 1
      where d.admitted < v_settings.daily_chat_messages;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('state', 'capacity'); end if;

  if v_mode = 'tokens' then
    if v_session.id is null then
      insert into private.campus_bot_windows (user_id, kind, starts_at, ends_at)
        values (v_user, 'session', v_now, v_now + make_interval(hours => v_session_hours)) returning * into v_session;
    end if;
    if v_week.id is null then
      insert into private.campus_bot_windows (user_id, kind, starts_at, ends_at)
        values (v_user, 'week', v_now, v_now + make_interval(days => v_week_days)) returning * into v_week;
    end if;
  end if;
  insert into private.campus_bot_replies (user_id, feature, request_id, course_id, funding_source, funding_grant_id,
      session_window_id, week_window_id, reserved_tokens, model, provider_model, price_weight, written_token_weight,
      read_tokens_max, written_tokens_max, reserved_at)
    values (v_user, 'chat', p_request_id, p_course_id, v_source, v_grant, v_session.id, v_week.id, v_reserved, v_model,
      v_provider_model, v_price_weight, v_weight, v_read_max, v_written_max, v_now)
    returning id into v_reply;

  select c.course_code, c.display_title into v_course_code, v_course_title
    from public.institutional_courses c where c.repository_course_id = p_course_id;
  return jsonb_build_object('state', 'started', 'reply_id', v_reply, 'model', v_provider_model,
    'max_output_tokens', v_written_max, 'reservation_seconds', v_settings.reply_reservation_seconds,
    'course', jsonb_build_object('code', v_course_code, 'title', v_course_title),
    'topic', jsonb_build_object('title', v_title), 'passages', v_passages);
end;
$$;

-- Ask Campus Bot: settlement. A delivered reply is charged and kept for a short while; a failure is charged nothing.
create function public.finish_campus_bot_chat(p_user_id uuid, p_reply_id uuid, p_outcome text, p_reply jsonb,
  p_usage jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reply private.campus_bot_replies;
  v_outcome text := p_outcome;
  v_now timestamptz;
  v_keep integer;
  v_read bigint;
  v_written bigint;
begin
  if p_user_id is null or p_reply_id is null or p_outcome is null or p_outcome not in ('answered', 'failed')
      or (p_outcome = 'answered') <> (p_reply is not null)
      or (p_reply is not null and jsonb_typeof(p_reply) <> 'object')
      or (p_usage is not null and jsonb_typeof(p_usage) <> 'object') then
    raise exception 'Invalid chat result' using errcode = '22023';
  end if;
  -- The kept reply is plain text and one flag, nothing else.
  if p_reply is not null and (jsonb_typeof(p_reply -> 'text') is distinct from 'string'
      or char_length(btrim(p_reply ->> 'text')) not between 1 and 4000
      or jsonb_typeof(p_reply -> 'in_notes') is distinct from 'boolean'
      or p_reply - 'text' - 'in_notes' <> '{}'::jsonb) then
    raise exception 'Invalid chat result' using errcode = '22023';
  end if;
  perform private.lock_course_access_scope(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || p_user_id::text, 0));
  perform private.bind_pending_course_grants(p_user_id);
  select * into v_reply from private.campus_bot_replies
    where id = p_reply_id and user_id = p_user_id and feature = 'chat' for update;
  if v_reply.id is null then return jsonb_build_object('state', 'not-found'); end if;
  if v_reply.state <> 'reserved' then return jsonb_build_object('state', 'already-finished'); end if;
  select chat_reply_keep_seconds into strict v_keep from private.campus_bot_settings;
  v_now := clock_timestamp();
  -- A reply finished after deletion was scheduled can never be shown, so it is neither kept nor charged.
  if v_outcome = 'answered' and exists (select 1 from private.account_deletion_jobs where user_id = p_user_id) then
    v_outcome := 'failed';
  end if;
  v_read := coalesce((p_usage ->> 'inputTokens')::bigint, 0) + coalesce((p_usage ->> 'cacheReadInputTokens')::bigint, 0)
    + coalesce((p_usage ->> 'cacheCreationInputTokens')::bigint, 0);
  v_written := coalesce((p_usage ->> 'outputTokens')::bigint, 0);
  update private.campus_bot_replies
    set state = case when v_outcome = 'answered' then 'consumed' else 'released' end, outcome = v_outcome,
      settled_at = v_now, read_tokens = v_read, written_tokens = v_written,
      charged_tokens = case when reserved_tokens is null then null when v_outcome = 'answered'
        then (v_read + written_token_weight * v_written) * price_weight else 0 end,
      cost_usd = (p_usage ->> 'estimatedCostUsd')::numeric, duration_ms = (p_usage ->> 'durationMs')::integer,
      reply = case when v_outcome = 'answered' then p_reply end,
      reply_expires_at = case when v_outcome = 'answered' then v_now + make_interval(secs => v_keep) end
    where id = p_reply_id;
  if v_outcome = 'answered' then
    -- One reply per request: a retry of the same request never counts twice.
    perform private.mark_plan_use(p_user_id, 'campus-bot-message', v_reply.course_id,
      'chat:' || v_reply.request_id::text, v_reply.reserved_at);
  end if;
  return jsonb_build_object('state', 'finished', 'outcome', v_outcome);
end;
$$;

-- Kept chat replies are deleted when their time is up: every minute here, and at the student's own next message.
create function public.purge_campus_bot_chat_replies() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update private.campus_bot_replies set reply = null
    where reply is not null and reply_expires_at <= clock_timestamp();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
select cron.schedule('campusintell-campus-bot-reply-purge', '* * * * *',
  'select public.purge_campus_bot_chat_replies()');

-- ---------------------------------------------------------------------------
-- What a page needs to know: whether each feature is switched on (Explain, Ask Campus Bot, and topic sets).
-- ---------------------------------------------------------------------------
create function public.get_campus_bot_features() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('explain', s.explain_enabled, 'ask', s.ask_enabled, 'topic_sets', s.topic_sets_enabled)
  from private.campus_bot_settings s;
$$;

-- ---------------------------------------------------------------------------
-- Operator settings (service role), audited with the actor and reason.
-- ---------------------------------------------------------------------------
create function public.admin_set_campus_bot_feature(p_feature text, p_enabled boolean, p_actor text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before boolean;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_feature is null or p_feature not in ('explain', 'ask', 'topic-sets') or p_enabled is null then
    raise exception 'Name the feature (explain, ask or topic-sets) and its state' using errcode = '22023';
  end if;
  select case p_feature when 'explain' then explain_enabled when 'ask' then ask_enabled else topic_sets_enabled end
    into strict v_before from private.campus_bot_settings for update;
  if v_before = p_enabled then
    return jsonb_build_object('state', 'unchanged', 'feature', p_feature, 'enabled', p_enabled);
  end if;
  update private.campus_bot_settings
    set explain_enabled = case when p_feature = 'explain' then p_enabled else explain_enabled end,
      ask_enabled = case when p_feature = 'ask' then p_enabled else ask_enabled end,
      topic_sets_enabled = case when p_feature = 'topic-sets' then p_enabled else topic_sets_enabled end,
      updated_at = now(), updated_by = left('operator:' || btrim(p_actor), 120)
    where singleton;
  perform private.log_entitlement_event(null, null, 'campus-bot.feature-changed',
    left('operator:' || btrim(p_actor), 120),
    jsonb_build_object('reason', btrim(p_reason), 'feature', p_feature, 'enabled', p_enabled));
  return jsonb_build_object('state', 'changed', 'feature', p_feature, 'enabled', p_enabled);
end;
$$;

-- The free pass's explanations and messages, the platform's day, and undelivered tries per student per day.
create function public.admin_set_campus_bot_reply_limits(p_pass_explanations integer, p_pass_chat_messages integer,
  p_daily_explanations integer, p_daily_chat_messages integer, p_undelivered_per_day integer, p_actor text,
  p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before private.campus_bot_settings;
  v_after private.campus_bot_settings;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if num_nonnulls(p_pass_explanations, p_pass_chat_messages, p_daily_explanations, p_daily_chat_messages,
      p_undelivered_per_day) = 0 then
    raise exception 'Name at least one limit' using errcode = '22023';
  end if;
  select * into strict v_before from private.campus_bot_settings for update;
  update private.campus_bot_settings
    set pass_explanations = coalesce(p_pass_explanations, pass_explanations),
      pass_chat_messages = coalesce(p_pass_chat_messages, pass_chat_messages),
      daily_explanations = coalesce(p_daily_explanations, daily_explanations),
      daily_chat_messages = coalesce(p_daily_chat_messages, daily_chat_messages),
      reply_undelivered_per_day = coalesce(p_undelivered_per_day, reply_undelivered_per_day),
      updated_at = now(), updated_by = left('operator:' || btrim(p_actor), 120)
    where singleton
    returning * into v_after;
  perform private.log_entitlement_event(null, null, 'campus-bot.reply-limits-changed',
    left('operator:' || btrim(p_actor), 120),
    jsonb_build_object('reason', btrim(p_reason),
      'before', jsonb_build_object('pass_explanations', v_before.pass_explanations,
        'pass_chat_messages', v_before.pass_chat_messages, 'daily_explanations', v_before.daily_explanations,
        'daily_chat_messages', v_before.daily_chat_messages, 'undelivered_per_day', v_before.reply_undelivered_per_day),
      'after', jsonb_build_object('pass_explanations', v_after.pass_explanations,
        'pass_chat_messages', v_after.pass_chat_messages, 'daily_explanations', v_after.daily_explanations,
        'daily_chat_messages', v_after.daily_chat_messages, 'undelivered_per_day', v_after.reply_undelivered_per_day)));
  return jsonb_build_object('state', 'changed', 'pass_explanations', v_after.pass_explanations,
    'pass_chat_messages', v_after.pass_chat_messages, 'daily_explanations', v_after.daily_explanations,
    'daily_chat_messages', v_after.daily_chat_messages, 'undelivered_per_day', v_after.reply_undelivered_per_day);
end;
$$;

-- The model that checks explanations on calculation courses.
create function public.admin_set_campus_bot_checker(p_model text, p_actor text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before text;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_model is null or not exists (select 1 from private.campus_bot_models
      where model = p_model and provider_model is not null) then
    raise exception 'Unknown model' using errcode = '22023';
  end if;
  select explain_check_model into strict v_before from private.campus_bot_settings for update;
  if v_before = p_model then return jsonb_build_object('state', 'unchanged', 'checker', p_model); end if;
  update private.campus_bot_settings set explain_check_model = p_model, updated_at = now(),
      updated_by = left('operator:' || btrim(p_actor), 120)
    where singleton;
  perform private.log_entitlement_event(null, null, 'campus-bot.checker-changed',
    left('operator:' || btrim(p_actor), 120), jsonb_build_object('reason', btrim(p_reason), 'from', v_before, 'to', p_model));
  return jsonb_build_object('state', 'changed', 'checker', p_model);
end;
$$;

-- Whether a course's explanations are checked. A course is named by its content key (its address on the site).
create function public.admin_set_campus_bot_course(p_content_key text, p_calculation boolean, p_actor text,
  p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_course uuid;
  v_before boolean;
  v_removed integer := 0;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_content_key is null or p_calculation is null then
    raise exception 'Name the course and whether it is a calculation course' using errcode = '22023';
  end if;
  select id into v_course from public.courses where content_key = p_content_key;
  if v_course is null then return jsonb_build_object('state', 'not-found'); end if;
  select calculation into v_before from private.campus_bot_courses where course_id = v_course for update;
  if coalesce(v_before, false) = p_calculation then
    return jsonb_build_object('state', 'unchanged', 'course', p_content_key, 'calculation', p_calculation);
  end if;
  insert into private.campus_bot_courses (course_id, calculation, updated_by)
    values (v_course, p_calculation, left('operator:' || btrim(p_actor), 120))
    on conflict (course_id) do update set calculation = excluded.calculation, updated_at = now(),
      updated_by = excluded.updated_by;
  -- A course that becomes a calculation course keeps no explanation that was never checked.
  if p_calculation then
    delete from private.campus_bot_explanations
      where course_id = v_course and state = 'done' and outcome = 'explained' and not checked;
    get diagnostics v_removed = row_count;
  end if;
  perform private.log_entitlement_event(null, null, 'campus-bot.course-changed',
    left('operator:' || btrim(p_actor), 120), jsonb_build_object('reason', btrim(p_reason), 'course', p_content_key,
      'calculation', p_calculation, 'explanations_removed', v_removed));
  return jsonb_build_object('state', 'changed', 'course', p_content_key, 'calculation', p_calculation,
    'explanations_removed', v_removed);
end;
$$;

-- Remove a course's saved explanations (after a review finds one wrong); each is written again when next asked for.
create function public.admin_clear_campus_bot_explanations(p_content_key text, p_actor text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_course uuid;
  v_removed integer;
begin
  perform private.require_operator_note(p_actor, p_reason);
  select id into v_course from public.courses where content_key = p_content_key;
  if v_course is null then return jsonb_build_object('state', 'not-found'); end if;
  delete from private.campus_bot_explanations where course_id = v_course and state = 'done';
  get diagnostics v_removed = row_count;
  perform private.log_entitlement_event(null, null, 'campus-bot.explanations-cleared',
    left('operator:' || btrim(p_actor), 120),
    jsonb_build_object('reason', btrim(p_reason), 'course', p_content_key, 'removed', v_removed));
  return jsonb_build_object('state', 'cleared', 'course', p_content_key, 'removed', v_removed);
end;
$$;

-- The settings, today's counts and what is saved, for the team.
create function public.admin_campus_bot_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'singleton' - 'updated_by' from private.campus_bot_settings s),
    'caps', (select jsonb_agg(jsonb_build_object('step', c.step, 'read', c.read_tokens_max,
      'written', c.written_tokens_max) order by c.step) from private.campus_bot_request_caps c),
    'models', (select jsonb_object_agg(m.model, m.provider_model) from private.campus_bot_models m),
    'calculation_courses', coalesce((select jsonb_agg(k.content_key order by k.content_key)
      from private.campus_bot_courses b join public.courses k on k.id = b.course_id where b.calculation), '[]'::jsonb),
    'today', coalesce((select jsonb_object_agg(d.feature, d.admitted) from private.campus_bot_reply_days d
      where d.day = (clock_timestamp() at time zone 'utc')::date), '{}'::jsonb),
    'saved_explanations', coalesce((select jsonb_object_agg(t.outcome, t.total) from (
      select e.outcome, count(*) as total from private.campus_bot_explanations e
      where e.state = 'done' group by e.outcome) t), '{}'::jsonb));
$$;

-- Saved explanations of one course with their questions, newest first, for the human review.
create function public.admin_campus_bot_explanations(p_content_key text, p_limit integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_id', t.item_id, 'revision', t.revision,
      'chosen_option', case when t.chosen_option >= 0 then t.chosen_option end, 'outcome', t.outcome,
      'checked', t.checked, 'body', t.body, 'topic', t.topic, 'finished_at', t.finished_at,
      'prompt', t.payload -> 'prompt', 'options', t.payload -> 'options',
      'correct_option', t.payload -> 'correctOption', 'official_explanation', t.payload -> 'explanation')
    order by t.finished_at desc), '[]'::jsonb)
  from (
    select e.*, r.payload, private.note_topic_view(e.course_id, e.topic_item_id) -> 'title' as topic
    from private.campus_bot_explanations e
    join public.courses k on k.id = e.course_id
    join public.managed_content_revisions r on r.item_id = e.item_id and r.revision = e.revision
    where k.content_key = p_content_key and e.state = 'done'
    order by e.finished_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 500)
  ) t;
$$;

-- A fixed sample for the human review before launch (scripts/campus-bot/review-samples.cjs): up to p_questions of a
-- course's practice questions, spread over its topics and always the same ones, each with a wrong choice and the
-- passages Explain would be given for it; and the course's first p_topics notes topics with the passages Ask would be
-- given. It reads the question bank, so it is the service role's alone; it writes nothing.
create function public.admin_campus_bot_review_sample(p_content_key text, p_questions integer, p_topics integer)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with course as (
    select k.id, c.course_code, c.display_title,
      exists (select 1 from private.campus_bot_courses b where b.course_id = k.id and b.calculation) as calculation
    from public.courses k left join public.institutional_courses c on c.repository_course_id = k.id
    where k.content_key = p_content_key
  ), questions as (
    select pool.item_id, pool.revision, pool.payload,
      ((pool.payload ->> 'correctOption')::integer + 1) % jsonb_array_length(pool.payload -> 'options') as chosen
    from course cross join lateral private.practice_pool(course.id) pool
    order by md5(pool.item_id::text)
    limit least(greatest(coalesce(p_questions, 10), 0), 50)
  ), topics as (
    select i.id, (row_number() over (order by i.position nulls last, i.created_at, i.id))::integer as number,
      r.payload ->> 'title' as title
    from course join public.managed_content_items i on i.course_id = course.id and i.kind = 'note'
      and i.published_revision is not null
    join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
  )
  select jsonb_build_object(
    'course', (select jsonb_build_object('key', p_content_key, 'code', course_code, 'title', display_title,
      'calculation', calculation) from course),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('item_id', q.item_id, 'revision', q.revision,
        'prompt', q.payload -> 'prompt', 'options', q.payload -> 'options', 'correct_option', q.payload -> 'correctOption',
        'chosen_option', q.chosen, 'section', private.practice_topic_of(q.payload),
        'explanation', private.practice_explanation(q.payload),
        'passages', (select coalesce(jsonb_agg(jsonb_build_object('item_id', s.item_id, 'topic_number', s.topic_number,
            'topic_title', s.topic_title, 'heading', s.heading, 'body', s.body) order by s.place), '[]'::jsonb)
          from course cross join lateral private.note_search(course.id,
            concat_ws(' ', q.payload ->> 'prompt', q.payload -> 'options' ->> ((q.payload ->> 'correctOption')::integer),
              q.payload -> 'options' ->> q.chosen), private.practice_topic_of(q.payload), 3, 9000) s))
      order by md5(q.item_id::text)) from questions q), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(jsonb_build_object('item_id', t.id, 'number', t.number, 'title', t.title,
        'passages', (select coalesce(jsonb_agg(jsonb_build_object('heading', p.heading, 'body', p.body) order by p.place),
          '[]'::jsonb) from private.note_topic_passages(t.id, 36000) p)) order by t.number)
      from topics t where t.number <= least(greatest(coalesce(p_topics, 2), 0), 20)), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Refunds (owner decision of 17 Nov 2026). A delivered Explain or notes-chat reply on a paid course is plan use of its
-- own kind, 'campus-bot-message', with its own allowance: a standard refund ends once a student has more than 10. A
-- delivered set stays 'campus-bot-reply', whose allowance stays 0. Additive: no kind or column is renamed and no row
-- changes. A reply is recorded at the time it was asked for, once per order, course and reference (a chat message by
-- its request id, an explanation by the explanation shown), so a retry, a reread or a replay never counts twice, and a
-- reply asked for before a payment never counts toward it.
-- ---------------------------------------------------------------------------
alter table private.plan_use_events drop constraint plan_use_events_kind_check,
  add constraint plan_use_events_kind_check
    check (kind in ('notes-topic', 'theory-reveal', 'campus-bot-reply', 'campus-bot-message'));
alter table private.payment_policy add column refund_campus_bot_messages_allowed integer not null default 10
  check (refund_campus_bot_messages_allowed between 0 and 1000);

-- Part 1's mark_plan_use, with one change: the new kind.
create or replace function private.mark_plan_use(p_user uuid, p_kind text, p_course_id uuid, p_ref text,
  p_at timestamptz default clock_timestamp()) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_user is null or p_kind is null
      or p_kind not in ('notes-topic', 'theory-reveal', 'campus-bot-reply', 'campus-bot-message')
      or p_ref is null or char_length(p_ref) not between 1 and 200 or p_at is null then
    raise exception 'Invalid plan use' using errcode = '22023';
  end if;
  if private.payment_course_is_free(p_course_id) then return 0; end if;
  insert into private.plan_use_events (order_id, user_id, kind, course_id, ref, occurred_at)
    select distinct g.order_id, p_user, p_kind, p_course_id, p_ref, p_at from public.entitlement_grants g
    where g.user_id = p_user and g.order_id is not null and g.revoked_at is null and g.starts_at <= p_at
      and coalesce(private.grant_effective_end(g), g.starts_at) > p_at
    on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- The refund assessment of 20261102200000, with Campus Bot sets and replies counted apart: sets ('campus-bot-reply')
-- against refund_campus_bot_replies_allowed (reason 'campus-bot'), replies ('campus-bot-message') against
-- refund_campus_bot_messages_allowed (reason 'campus-bot-messages'). Its counts and allowances name them
-- campus_bot_sets and campus_bot_messages, so a set is never read as a reply.
create or replace function private.refund_assessment(p_order private.payment_orders, p_payment private.payment_fulfilments,
  p_identity_hashes text[], p_requested_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_policy private.payment_policy;
  v_paid timestamptz := p_order.paid_at;
  v_now timestamptz := clock_timestamp();
  v_excess bigint := case when p_payment.outcome = 'fulfilled' and p_payment.currency = p_order.currency
    and p_payment.amount_kobo > p_order.amount_kobo then p_payment.amount_kobo - p_order.amount_kobo else 0 end;
  v_sets integer := 0; v_messages integer := 0; v_exams integer := 0; v_answers integer := 0; v_reveals integer := 0;
  v_topics integer := 0;
  v_used integer;
  v_reasons text[] := '{}';
  v_classes text[];
begin
  select * into strict v_policy from private.payment_policy;
  if p_payment.outcome = 'fulfilled' then
    -- Card excess goes through Bachs support, so only a bank-transfer excess is offered here.
    v_classes := array['standard', 'our-fault']
      || case when v_excess > 0 and p_payment.method <> 'card' then array['excess'] else '{}'::text[] end;
    select count(*) filter (where kind = 'campus-bot-reply'), count(*) filter (where kind = 'campus-bot-message'),
        count(*) filter (where kind = 'theory-reveal'),
        count(distinct coalesce(course_id::text, '') || ':' || ref) filter (where kind = 'notes-topic')
      into v_sets, v_messages, v_reveals, v_topics
      from private.plan_use_events u
      where u.order_id = p_order.id and u.occurred_at >= v_paid and u.occurred_at <= v_now
        and not private.payment_course_is_free(u.course_id);
    select count(*) into v_exams from public.quiz_attempts q
      where q.user_id = p_order.user_id and q.mode = 'exam' and q.created_at >= v_paid
        and q.created_at <= v_now and not private.payment_course_is_free(q.course_id);
    select count(*) into v_answers from public.quiz_attempt_answers a join public.quiz_attempts q on q.id = a.attempt_id
      where q.user_id = p_order.user_id and q.mode is distinct from 'exam' and a.answered_at >= v_paid
        and a.answered_at <= v_now and not private.payment_course_is_free(q.course_id);
    v_answers := v_answers + v_reveals;
    if p_requested_at > v_paid + make_interval(hours => v_policy.refund_window_hours) then
      v_reasons := v_reasons || 'window'::text;
    end if;
    if v_sets > v_policy.refund_campus_bot_replies_allowed then v_reasons := v_reasons || 'campus-bot'::text; end if;
    if v_messages > v_policy.refund_campus_bot_messages_allowed then
      v_reasons := v_reasons || 'campus-bot-messages'::text;
    end if;
    if v_exams > v_policy.refund_exams_allowed then v_reasons := v_reasons || 'exam'::text; end if;
    if v_answers > v_policy.refund_practice_answers_allowed then v_reasons := v_reasons || 'practice'::text; end if;
    if v_topics > v_policy.refund_notes_topics_allowed then v_reasons := v_reasons || 'notes'::text; end if;
  else
    v_classes := array['our-fault', 'duplicate'];
    v_reasons := array['no-plan'];
  end if;
  select count(*) into v_used from private.payment_refunds r
    where r.refund_class = 'standard' and r.status <> 'failed'
      and ((p_order.user_id is not null and r.user_id = p_order.user_id) or r.identity_hashes && p_identity_hashes);
  if p_payment.outcome = 'fulfilled' and v_used >= v_policy.refunds_per_student then
    v_reasons := v_reasons || 'limit'::text;
  end if;
  return jsonb_build_object('classes_allowed', to_jsonb(v_classes),
    'standard_allowed', cardinality(v_reasons) = 0, 'standard_refused', to_jsonb(v_reasons),
    'requested_at', p_requested_at, 'window_ends_at', v_paid + make_interval(hours => v_policy.refund_window_hours),
    'use_counted_until', v_now, 'excess_kobo', v_excess,
    'counts', jsonb_build_object('campus_bot_sets', v_sets, 'campus_bot_messages', v_messages,
      'exams_started', v_exams, 'practice_answers', v_answers, 'notes_topics', v_topics),
    'allowed', jsonb_build_object('campus_bot_sets', v_policy.refund_campus_bot_replies_allowed,
      'campus_bot_messages', v_policy.refund_campus_bot_messages_allowed,
      'exams_started', v_policy.refund_exams_allowed, 'practice_answers', v_policy.refund_practice_answers_allowed,
      'notes_topics', v_policy.refund_notes_topics_allowed),
    'refunds_used', v_used, 'refund_limit', v_policy.refunds_per_student,
    'amount_kobo', p_payment.amount_kobo, 'currency', p_payment.currency, 'method', p_payment.method);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. New functions are locked down here; CREATE OR REPLACE kept campus_bot_window_use's grants (none).
-- ---------------------------------------------------------------------------
revoke all on function private.guide_inline_text(jsonb), private.guide_blocks_text(jsonb, integer),
  private.note_passages_of(jsonb), private.tsquery_or(tsquery), private.refresh_note_passages(),
  private.note_topic_view(uuid, uuid), private.note_topic_passages(uuid, integer),
  private.note_search(uuid, text, text, integer, integer), private.campus_bot_window_use(uuid),
  private.campus_bot_reply_funding(uuid, timestamptz), private.release_abandoned_campus_bot_replies(uuid, timestamptz),
  private.campus_bot_exam_open(uuid, uuid, timestamptz),
  private.campus_bot_topic_context(uuid, uuid, uuid, timestamptz, integer),
  private.campus_bot_explanation_view(private.campus_bot_explanations),
  private.campus_bot_explanation_ref(uuid, integer, integer),
  public.begin_campus_bot_explanation(uuid, uuid, uuid, boolean),
  public.finish_campus_bot_explanation(uuid, uuid, text, text, uuid, jsonb, jsonb),
  public.begin_campus_bot_chat(uuid, uuid, uuid, uuid, boolean),
  public.finish_campus_bot_chat(uuid, uuid, text, jsonb, jsonb), public.purge_campus_bot_chat_replies(),
  public.get_campus_bot_features(), public.admin_set_campus_bot_feature(text, boolean, text, text),
  public.admin_set_campus_bot_reply_limits(integer, integer, integer, integer, integer, text, text),
  public.admin_set_campus_bot_checker(text, text, text), public.admin_set_campus_bot_course(text, boolean, text, text),
  public.admin_clear_campus_bot_explanations(text, text, text), public.admin_campus_bot_status(),
  public.admin_campus_bot_explanations(text, integer), public.admin_campus_bot_review_sample(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_campus_bot_features() to authenticated, service_role;
grant execute on function public.begin_campus_bot_explanation(uuid, uuid, uuid, boolean),
  public.finish_campus_bot_explanation(uuid, uuid, text, text, uuid, jsonb, jsonb),
  public.begin_campus_bot_chat(uuid, uuid, uuid, uuid, boolean),
  public.finish_campus_bot_chat(uuid, uuid, text, jsonb, jsonb),
  public.admin_set_campus_bot_feature(text, boolean, text, text),
  public.admin_set_campus_bot_reply_limits(integer, integer, integer, integer, integer, text, text),
  public.admin_set_campus_bot_checker(text, text, text), public.admin_set_campus_bot_course(text, boolean, text, text),
  public.admin_clear_campus_bot_explanations(text, text, text), public.admin_campus_bot_status(),
  public.admin_campus_bot_explanations(text, integer), public.admin_campus_bot_review_sample(text, integer, integer)
  to service_role;
