-- supabase/migrations/20261105110000_early_access_claim_window.sql — Early Access can be claimed for 14 days after the
-- actual launch (the agreed policy; 20261017100000_trial_entitlements.sql seeded 28). Every reader takes the window from
-- private.entitlement_policy.early_access_enrollment_days, so this one value is the whole change.
update private.entitlement_policy set early_access_enrollment_days = 14;
do $$
begin
  if (select count(*) from private.entitlement_policy where early_access_enrollment_days = 14) <> 1
      or (select count(*) from private.entitlement_policy) <> 1 then
    raise exception 'Early Access claim window: expected the one policy row at 14 days';
  end if;
end;
$$;
