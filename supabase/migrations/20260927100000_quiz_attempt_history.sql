-- Authenticated quiz history: storage and owner-only reads. Writes remain
-- unavailable until a later migration adds narrowly scoped write RPCs.

create table public.quiz_attempts (
  -- Supplied by the application so retries retain one logical attempt ID.
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete restrict,
  question_count integer not null,
  status text not null default 'in_progress',
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,

  constraint quiz_attempts_question_count_check check (question_count > 0),
  constraint quiz_attempts_status_check
    check (status in ('in_progress', 'submitted', 'timed_out')),
  constraint quiz_attempts_revision_check check (revision >= 0),
  constraint quiz_attempts_finished_at_status_check check (
    (status = 'in_progress' and finished_at is null)
    or (status in ('submitted', 'timed_out') and finished_at is not null)
  ),
  constraint quiz_attempts_finished_at_order_check
    check (finished_at is null or finished_at >= created_at)
);

create table public.quiz_attempt_answers (
  attempt_id uuid not null references public.quiz_attempts (id) on delete cascade,
  question_id uuid not null,
  ordinal integer not null,
  option_index integer not null,
  is_correct boolean not null,
  section_label text not null,
  answered_at timestamptz not null default now(),

  constraint quiz_attempt_answers_pkey primary key (attempt_id, question_id),
  constraint quiz_attempt_answers_attempt_ordinal_unique unique (attempt_id, ordinal),
  constraint quiz_attempt_answers_ordinal_check check (ordinal >= 0),
  constraint quiz_attempt_answers_option_index_check check (option_index >= 0)
);

-- RLS and explicit ACLs are established in the same migration as storage.
-- service_role's RLS bypass must not provide direct table access either.
alter table public.quiz_attempts enable row level security;
alter table public.quiz_attempt_answers enable row level security;

revoke all on table public.quiz_attempts
  from public, anon, authenticated, service_role;
revoke all on table public.quiz_attempt_answers
  from public, anon, authenticated, service_role;

grant select on table public.quiz_attempts to authenticated;
grant select on table public.quiz_attempt_answers to authenticated;

create policy "Quiz attempts are selectable by their owner"
  on public.quiz_attempts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Quiz answers are selectable by their attempt owner"
  on public.quiz_attempt_answers
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.quiz_attempts
      where quiz_attempts.id = quiz_attempt_answers.attempt_id
        and quiz_attempts.user_id = (select auth.uid())
    )
  );

create index quiz_attempts_user_created_idx
  on public.quiz_attempts (user_id, created_at desc, id);
create index quiz_attempts_user_course_created_idx
  on public.quiz_attempts (user_id, course_id, created_at desc, id);
create index quiz_attempts_course_id_idx
  on public.quiz_attempts (course_id);

-- Reuse the existing internal timestamp helper; this is not a write RPC.
create trigger quiz_attempts_set_updated_at
  before update on public.quiz_attempts
  for each row
  execute function private.set_updated_at();
