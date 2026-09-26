-- Deliberately remove one mapping lookup key after a real Phase B reset.
-- The Phase C migration then reaches its final 38-row guard after creating its
-- schema, data, grants and policies. This pre-migration sentinel must survive
-- the failed migration unchanged while every Phase C effect rolls back.
update public.academic_periods
   set key = 'first-semester-phase-c-failure'
 where key = 'first-semester';
