-- The render's caller-only snapshot. No client-supplied account or session identity is accepted.
create function public.read_student_context()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_lifecycle jsonb;
  v_profile jsonb;
  v_references jsonb;
begin
  begin
    -- Reuse the existing account lock and post-wait liveness/deletion rule, in the same order.
    v_user := private.require_live_account();
  exception when insufficient_privilege then
    -- The decision page already exposes this lifecycle to a live restricted session. No protected context is read.
    v_lifecycle := public.read_account_lifecycle();
    if v_lifecycle->>'status' not in ('scheduled', 'expired') then raise; end if;
    return jsonb_build_object('user_id', v_user, 'session_id', auth.jwt()->>'session_id', 'lifecycle', v_lifecycle,
      'profile', null, 'references', null);
  end;
  -- One statement snapshot for the profile, its confirmation and all labels/flags. No additional row locks.
  select case when p.id is null then null else jsonb_build_object(
      'department_id', p.department_id, 'academic_level_id', p.academic_level_id,
      'academic_period_id', p.academic_period_id, 'first_name', p.first_name, 'revision', p.revision,
      'selection_confirmed_at', p.selection_confirmed_at) end,
    jsonb_build_object('status', 'active', 'deletionAllowed', coalesce(p.role = 'student', false)),
    jsonb_build_object(
      'departments', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name,
        'is_active', is_active) order by sort_order) from public.departments), '[]'::jsonb),
      'academicLevels', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name,
        'is_active', is_active) order by sort_order) from public.academic_levels), '[]'::jsonb),
      'academicPeriods', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name,
        'is_active', is_active) order by sort_order) from public.academic_periods), '[]'::jsonb))
    into v_profile, v_lifecycle, v_references
    from (select v_user as id) caller left join public.profiles p on p.id = caller.id;
  return jsonb_build_object('user_id', v_user, 'session_id', auth.jwt()->>'session_id', 'lifecycle', v_lifecycle,
    'profile', v_profile, 'references', v_references);
end;
$$;
revoke all on function public.read_student_context() from public, anon, authenticated, service_role;
grant execute on function public.read_student_context() to authenticated;
comment on function public.read_student_context() is
  'Read-only render snapshot for this live JWT owner. Restricted accounts receive lifecycle only; protected reads still authorize independently.';
