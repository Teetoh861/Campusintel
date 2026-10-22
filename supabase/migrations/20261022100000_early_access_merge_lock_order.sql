-- supabase/migrations/20261022100000_early_access_merge_lock_order.sql — A duplicate merge locks every account it can
-- touch before any grant lock (Phase H M5).
--
-- Defect: admin_change_early_access_member(..., 'mark-duplicate', ...) locked only the source email's accounts at level 2
-- of the Early Access lock hierarchy (20261017100000_trial_entitlements.sql). resolve_early_access_duplicates then locked
-- the other identity's grants FOR UPDATE (level 6) and, through the audit row's user_id foreign key, took KEY SHARE on
-- those grant owners' auth.users rows after the grant locks. The account deletion worker takes an auth row FOR UPDATE
-- first and deletes it later, cascading to the account's grants: a merge in between and the worker waited on each other
-- (40P01), and the merge or the deletion failed.
--
-- Fix, no redesign: before the regroup, group, member and grant locks, a merge locks every account it can touch in one
-- ascending pass (level 2): the accounts of both emails, the claimed accounts of both groups' members and the owners of
-- both groups' unrevoked Early Access grants. Under the regroup and group locks that set is read again; if an account the
-- merge would touch is not among those locked (it appeared after the pass), the merge changes nothing and returns
-- state 'deferred' for the operator to run it again. An account deleted meanwhile is simply gone, with its grants, and
-- the merge proceeds. Every other path keeps its lock order, and the hierarchy itself is unchanged.
-- The functions keep their signatures; CREATE OR REPLACE keeps their grants.

-- Account rows, then account advisory locks, for the given accounts in ascending id, as the email variant does for one
-- address. Returns the accounts actually locked: one deleted before its row was reached is not in the result.
create or replace function private.lock_early_access_accounts(p_accounts uuid[]) returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_locked uuid[] := '{}';
begin
  for v_account in select id from auth.users where id = any (p_accounts) order by id for share loop
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
  if p_action = 'mark-duplicate' then
    -- Level 2 for a merge: every account the merge can touch, in one ascending pass. The merge revokes the other
    -- identity's grants (its audit rows reference their owners) and logs against this member's claimed account.
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
    v_locked := private.lock_early_access_accounts(v_affected);
    -- Levels 4-5: the regroup lock exclusively, then every group involved in ascending order.
    perform private.lock_early_access_groups(array[v_email, v_other_email], '{}', true);
    -- Nothing can join or leave these groups now. An account the merge would touch that was not locked above (a signup,
    -- a confirmation or an enrollment that landed after the pass) would be locked after the group locks: defer instead.
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
  else
    -- Level 2: this member's accounts.
    v_locked := private.lock_early_access_accounts(v_email);
    -- Levels 4-5: clearing takes the regroup lock exclusively and makes the member its own root, so that group is
    -- locked too.
    perform private.lock_early_access_groups(array[v_email],
      array[(select id from private.early_access_members where email = v_email)], p_action = 'clear-duplicate');
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
