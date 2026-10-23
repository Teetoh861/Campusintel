-- supabase/migrations/20261022100000_early_access_merge_lock_order.sql — An operator member change locks every account
-- it can touch, without waiting for an auth row, before any member or grant lock (Phase H M5, M5b, M6).
--
-- Defects. M5: admin_change_early_access_member(..., 'mark-duplicate', ...) locked only the source email's accounts at
-- level 2 of the Early Access lock hierarchy (20261017100000_trial_entitlements.sql). resolve_early_access_duplicates
-- then locked the other identity's grants FOR UPDATE (level 6) and, through the audit row's user_id foreign key, took
-- KEY SHARE on those grant owners' auth.users rows after the grant locks. The account deletion worker takes an auth row
-- FOR UPDATE first and deletes it later, cascading to the account's grants: a merge in between and the worker waited on
-- each other (40P01). M5b: an account pass that waits for an auth row can still cycle with the worker, which purges a
-- batch in deadline order: the pass holds account A (lower id) and waits for B, the worker holds B, purges it and then
-- asks for A. M6: exclude, include and clear-duplicate locked the list email's accounts, took the member row and then
-- audited against the member's claimed account, which no longer carries the list email after an Auth email change: KEY
-- SHARE on that auth row after the member-row lock, against a deletion holding the row and cascading onto the member row.
--
-- Fix, no redesign: before the regroup, group, member and grant locks, every action locks every account it can touch in
-- one ascending pass that never waits for an auth row (FOR SHARE NOWAIT; a row that is not free at once, because a
-- deletion or an Auth update holds it, defers the whole change for the operator to run again). A merge locks the
-- accounts of both emails, the claimed accounts of both groups' members and the owners of both groups' unrevoked Early
-- Access grants; the other actions lock the accounts of the list email and the member's claimed account. Under the
-- regroup and group locks the set is read again: a merge that would touch an account it did not lock, or a change whose
-- member was claimed by an account it did not lock, changes nothing and returns state 'deferred'. An account with the
-- list email that appeared after the pass is, as before, not enrolled in this transaction (enrollment 'deferred'): it
-- is touched by nothing else. An account deleted meanwhile is simply gone, with its grants, and the change proceeds.
-- Every other path keeps its lock order, and the hierarchy itself is unchanged; the deletion worker is unchanged.
-- The functions keep their signatures; CREATE OR REPLACE keeps their grants.

-- Account rows, then account advisory locks, for the given accounts in ascending id, as the email variant does for one
-- address, except that a row held by another transaction raises lock_not_available at once instead of waiting.
-- Returns the accounts actually locked: one deleted before its row was reached is not in the result.
create or replace function private.lock_early_access_accounts(p_accounts uuid[]) returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_locked uuid[] := '{}';
begin
  for v_account in select id from auth.users where id = any (p_accounts) order by id for share nowait loop
    perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || v_account::text, 0));
    v_locked := v_locked || v_account;
  end loop;
  return v_locked;
end;
$$;
revoke all on function private.lock_early_access_accounts(uuid[]) from public, anon, authenticated, service_role;

create or replace function public.admin_change_early_access_member(p_email text, p_action text, p_other_email text,
  p_actor text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_other_email text := lower(btrim(p_other_email));
  v_merge boolean := p_action = 'mark-duplicate';
  v_member private.early_access_members;
  v_other private.early_access_members;
  v_account uuid;
  v_locked uuid[];
  v_affected uuid[];
  v_enrolled jsonb := null;
  v_revoked integer := 0;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_action is null or p_action not in ('exclude', 'include', 'mark-duplicate', 'clear-duplicate') then
    raise exception 'Invalid member change' using errcode = '22023';
  end if;
  if not exists (select 1 from private.early_access_members where email = v_email) then
    return jsonb_build_object('state', 'not-found');
  end if;
  -- Level 1: policy row.
  perform 1 from private.entitlement_policy for share;
  -- Level 2: every account this change can touch, in one ascending pass that never waits for an auth row. A merge
  -- revokes the other identity's grants (their audit rows reference the owners) and logs against this member's
  -- claimed account; the other actions log against the claimed account, which may no longer carry the list email,
  -- and enroll an account with that email. For them v_other_email is null, so only the list email's accounts match.
  v_affected := array(select distinct account from (
      select u.id as account from auth.users u where lower(btrim(u.email)) in (v_email, v_other_email)
      union all
      select m.claimed_by from private.early_access_members m
        where (v_merge and coalesce(m.duplicate_of, m.id) in (select coalesce(r.duplicate_of, r.id)
            from private.early_access_members r where r.email in (v_email, v_other_email)))
          or (not v_merge and m.email = v_email)
      union all
      select g.user_id from public.entitlement_grants g
        join private.early_access_members m on m.id::text = g.reference->>'member_id'
        where v_merge and g.source = 'early_access' and g.revoked_at is null
          and coalesce(m.duplicate_of, m.id) in (select coalesce(r.duplicate_of, r.id)
            from private.early_access_members r where r.email in (v_email, v_other_email))
    ) accounts where account is not null order by account);
  begin
    v_locked := private.lock_early_access_accounts(v_affected);
  exception when lock_not_available then
    -- An account of the pass is held (a deletion about to purge it, or an Auth update): the operator runs this again.
    return jsonb_build_object('state', 'deferred');
  end;
  -- Levels 4-5: regrouping takes the regroup lock exclusively, then every group involved in ascending order. Clearing
  -- makes the member its own root, so that group is locked too.
  if v_merge then
    perform private.lock_early_access_groups(array[v_email, v_other_email], '{}', true);
  else
    perform private.lock_early_access_groups(array[v_email],
      array[(select id from private.early_access_members where email = v_email)], p_action = 'clear-duplicate');
  end if;
  -- Nothing can join or leave these groups now, and no member of them can be claimed, so what the change touches is
  -- final. An account it would touch that was not locked above (a signup, a confirmation, an enrollment or a claim that
  -- landed after the pass) would be locked after the group locks: defer instead.
  if v_merge then
    v_affected := array(select distinct account from (
        select u.id as account from auth.users u where lower(btrim(u.email)) in (v_email, v_other_email)
        union all
        select m.claimed_by from private.early_access_members m
          where coalesce(m.duplicate_of, m.id) in (select coalesce(r.duplicate_of, r.id)
            from private.early_access_members r where r.email in (v_email, v_other_email))
        union all
        select g.user_id from public.entitlement_grants g
          join private.early_access_members m on m.id::text = g.reference->>'member_id'
          where g.source = 'early_access' and g.revoked_at is null
            and coalesce(m.duplicate_of, m.id) in (select coalesce(r.duplicate_of, r.id)
              from private.early_access_members r where r.email in (v_email, v_other_email))
      ) accounts where account is not null order by account);
    if not (v_affected <@ v_locked) then
      return jsonb_build_object('state', 'deferred');
    end if;
  elsif exists (select 1 from private.early_access_members where email = v_email and claimed_by is not null
      and not (claimed_by = any (v_locked))) then
    return jsonb_build_object('state', 'deferred');
  end if;
  -- Level 6: member rows.
  select * into strict v_member from private.early_access_members where email = v_email for update;
  if p_action = 'exclude' then
    update private.early_access_members set excluded_at = now(), excluded_reason = p_reason where id = v_member.id;
  elsif p_action = 'include' then
    update private.early_access_members set excluded_at = null, excluded_reason = null where id = v_member.id;
  elsif p_action = 'clear-duplicate' then
    -- Separating identities never restores a grant revoked by an earlier merge: that needs an explicit operator restore.
    update private.early_access_members set duplicate_of = null where id = v_member.id;
  else
    select * into v_other from private.early_access_members where email = v_other_email;
    if not found or v_other.id = v_member.id then return jsonb_build_object('state', 'not-found'); end if;
    -- Already one group (including marking a member as a duplicate of one of its own duplicates): nothing to change.
    if coalesce(v_other.duplicate_of, v_other.id) = coalesce(v_member.duplicate_of, v_member.id) then
      return jsonb_build_object('state', 'already-grouped');
    end if;
    -- Groups stay one level deep: everything points at a root.
    update private.early_access_members set duplicate_of = coalesce(v_other.duplicate_of, v_other.id)
      where id = v_member.id or duplicate_of = v_member.id;
    -- One identity, one Early Access month: in the same transaction, keep the canonical grant and end the others.
    v_revoked := private.resolve_early_access_duplicates(coalesce(v_other.duplicate_of, v_other.id),
      'operator:' || p_actor, p_reason);
  end if;
  perform private.log_entitlement_event(v_member.claimed_by, null, 'operator.early-access-' || p_action,
    'operator:' || p_actor, jsonb_build_object('member_id', v_member.id, 'reason', p_reason,
      'duplicate_grants_revoked', v_revoked));
  -- Excluding never removes a grant already made (revoke it explicitly); making a member eligible again enrolls their
  -- account at once, under the locks already held. As for imports, only an account locked above: one that became
  -- visible later would be locked after the group locks, so it is deferred to a fresh transaction (the operator tool's
  -- follow-up sweep, or the account's next plan read).
  if p_action in ('include', 'clear-duplicate') then
    select id into v_account from auth.users where lower(btrim(email)) = v_email and email_confirmed_at is not null;
    if v_account is not null and v_account = any (v_locked) then
      v_enrolled := private.reconcile_early_access(v_account, 'operator:' || p_actor);
    elsif v_account is not null then
      v_enrolled := jsonb_build_object('status', 'deferred');
    end if;
  end if;
  return jsonb_build_object('state', 'changed', 'enrollment', v_enrolled->>'status', 'duplicate_grants_revoked', v_revoked);
end;
$$;
