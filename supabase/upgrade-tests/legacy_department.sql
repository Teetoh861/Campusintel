-- A single non-null department in an otherwise all-null Phase A population.
update public.profiles
   set department = 'Legacy department sentinel'
 where id = '80000000-0000-4000-8000-000000000001';
