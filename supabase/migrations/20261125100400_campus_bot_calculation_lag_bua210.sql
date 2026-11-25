-- supabase/migrations/20261125100400_campus_bot_calculation_lag_bua210.sql
-- LAG-BUA210 Business Mathematics publishes the LAG-ACS213 bank (20261125100100), and its exam now runs 40 minutes, the
-- owner's length for a bank with calculation questions (owner, 25 Nov 2026). Campus Bot checks a calculation course's
-- explanations before anyone sees them, as it does LAG-ACS213's, so LAG-BUA210 becomes one, exactly as
-- public.admin_set_campus_bot_course makes a course one: the flag, and no explanation kept that was never checked.
-- The team can change the flag afterwards with `campus-bot-course`.
insert into private.campus_bot_courses (course_id, calculation, updated_by)
  select id, true, 'migration:20261125100400' from public.courses where content_key = 'business-mathematics'
  on conflict (course_id) do update set calculation = true, updated_at = now(), updated_by = excluded.updated_by;

delete from private.campus_bot_explanations
  where course_id = (select id from public.courses where content_key = 'business-mathematics')
    and state = 'done' and outcome = 'explained' and not checked;

do $$
begin
  if not exists (select 1 from private.campus_bot_courses b join public.courses c on c.id = b.course_id
      where c.content_key = 'business-mathematics' and b.calculation) then
    raise exception 'LAG-BUA210 (business-mathematics) is not a calculation course';
  end if;
end
$$;
