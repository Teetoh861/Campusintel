-- supabase/migrations/20261027100000_home_practice_progress.sql — The student's own practice summary for home (launch
-- sprint item 2): the open attempt to resume, the course last graded, and per course the questions practised in graded
-- attempts and the last score. Runs after 20261025100000_server_run_practice.sql and changes nothing in it.
--   * One call for every course, service role only, keyed by the verified session like the other practice_* functions,
--     so the database derives the student and nothing else's attempts can be asked for.
--   * Only server-run attempts count (deadline_at set); legacy browser-run attempts and Discovery exams are ignored.
--   * Overdue attempts are graded first, under the student's practice lock, so home never offers to resume an attempt
--     whose time is up and every score shown is the one the database graded.
--   * No question, option or answer leaves the database: counts, the course identity and the score only.

-- ---------------------------------------------------------------------------
-- The summary
-- ---------------------------------------------------------------------------
-- Only graded (marked) attempts count: an open attempt adds nothing until it is graded, and a course with no graded
-- attempt has no entry. practised: distinct questions of those attempts still in the course's practice pool, so the
-- figure is a part of the same total published_cbt_summary reports. score/total: the latest graded attempt.
create function public.practice_progress(p_session_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  v_user := private.ai_practice_session_user(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
  perform private.close_overdue_practice(v_user);
  return jsonb_build_object('state', 'ok', 'now', clock_timestamp(),
    -- The open attempt closest to its deadline (one per course at most).
    'open', (select jsonb_build_object('course_id', a.course_id, 'content_key', c.content_key,
        'deadline_at', a.deadline_at)
      from public.quiz_attempts a join public.courses c on c.id = a.course_id
      where a.user_id = v_user and a.status = 'in_progress' and a.deadline_at is not null
      order by a.deadline_at, a.id limit 1),
    'latest', (select jsonb_build_object('course_id', a.course_id, 'content_key', c.content_key)
      from public.quiz_attempts a join public.courses c on c.id = a.course_id
      where a.user_id = v_user and a.status <> 'in_progress' and a.deadline_at is not null
      order by a.finished_at desc, a.id desc limit 1),
    'courses', coalesce((select jsonb_agg(jsonb_build_object('course_id', marked.course_id,
        'practised', (select count(distinct q.question_id)::integer
          from public.quiz_attempt_questions q join public.quiz_attempts a on a.id = q.attempt_id
          where a.user_id = v_user and a.course_id = marked.course_id and a.deadline_at is not null
            and a.status <> 'in_progress'
            and q.question_id in (select pool.question_id from private.practice_pool(marked.course_id) pool)),
        'score', graded.score, 'total', graded.question_count) order by marked.course_id)
      from (select distinct a.course_id from public.quiz_attempts a
        where a.user_id = v_user and a.deadline_at is not null and a.status <> 'in_progress') marked
      join lateral (select g.score, g.question_count from public.quiz_attempts g
        where g.user_id = v_user and g.course_id = marked.course_id and g.deadline_at is not null
          and g.status <> 'in_progress'
        order by g.finished_at desc, g.id desc limit 1) graded on true), '[]'::jsonb));
end;
$$;

comment on function public.practice_progress(uuid) is
  'Home''s practice summary for the verified session: the open attempt closest to its deadline, the course last '
  'graded, and per course the questions practised in graded attempts (still in the pool) and the last score. '
  'Server-run attempts only; '
  'grades overdue attempts first. Counts and scores only. Service role only.';

revoke all on function public.practice_progress(uuid) from public, anon, authenticated, service_role;
grant execute on function public.practice_progress(uuid) to service_role;
