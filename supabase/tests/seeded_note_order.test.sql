-- supabase/tests/seeded_note_order.test.sql — The seeded notes in the order the seed lists them (20261112130000): each
-- course's topic notes by number, then its calculator tricks by number. A rerun changes nothing, and an order set
-- since the seed is kept.
begin;
select no_plan();

-- The seed's own order: topic notes, then calculator tricks, each by number.
create temporary table seeded on commit drop as
  select i.id, i.course_id, i.position, row_number() over (partition by i.course_id
    order by split_part(i.source_key, ':', 1) <> 'topic-note', split_part(i.source_key, ':', 2)::integer)::integer expected
  from public.managed_content_items i
  where i.kind = 'note' and i.created_by = '00000000-0000-4000-8000-000000000042';

select is((select count(*)::integer from seeded), 77, 'the 77 seeded notes are there');
select is((select count(*)::integer from seeded where position is distinct from expected), 0,
  'every seeded note is numbered in seed order');
select is((select count(*)::integer from (select course_id from seeded group by course_id
    having count(distinct position) <> count(*) or max(position) <> count(*)) s), 0, 'with no gap or repeat in any course');

create function pg_temp.migration() returns text language sql as $$
  select array_to_string(statements, E'\n') from supabase_migrations.schema_migrations where version = '20261112130000' $$;
select ok(pg_temp.migration() is not null, 'the migration is recorded');

-- A rerun changes nothing; an order an operator set since is kept.
update public.managed_content_items set position = 1000 where id = (select id from seeded where expected = 2 limit 1);
create temporary table before_rerun on commit drop as
  select id, position from public.managed_content_items where kind = 'note';
do $$ begin execute pg_temp.migration(); end $$;
select is((select count(*)::integer from public.managed_content_items i join before_rerun b using (id)
    where i.position is distinct from b.position), 0, 'a rerun changes nothing and keeps the order set since');

-- Students read the notes in that order.
select is((select array_agg(i.source_key order by i.position) from public.managed_content_items i
    join public.courses c on c.id = i.course_id where c.content_key = 'financial-accounting-1' and i.kind = 'note'
      and i.published_revision is not null),
  (select array_agg(n order by k) from (select 'topic-note:' || g n, g k from generate_series(1, 10) g
    union all select 'calculator-trick:' || g, 10 + g from generate_series(1, 10) g) s),
  'ACC 101: its ten topic notes, then its ten calculator tricks');

select * from finish();
rollback;
