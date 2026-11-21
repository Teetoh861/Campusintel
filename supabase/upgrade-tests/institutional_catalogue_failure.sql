-- Applied after resetting through the committed Phase C Slice 1 migration.
-- The correction reaches its final 196-row guard with Finance's 27 non-GST
-- source rows unresolved, proving that every correction effect rolls back.
update public.departments
set key = 'finance-phase-c-catalogue-failure'
where key = 'finance';
