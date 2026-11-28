-- Both insert orders work: a published item may precede its revision in one transaction, as content migrations do.
-- Normal publication still refreshes immediately. The revision trigger only fills a missing passage set and never
-- removes a saved explanation. Every maintenance failure stays internal and cannot fail publishing.
create or replace function private.refresh_note_passages() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_item public.managed_content_items;
begin
  if tg_table_name = 'managed_content_revisions' then
    select * into v_item from public.managed_content_items
      where id = new.item_id and kind = 'note' and published_revision = new.revision;
    if not found or exists (select 1 from private.note_passages where item_id = v_item.id) then return new; end if;
  else
    if new.kind <> 'note' then return new; end if;
    if tg_op = 'INSERT' and new.published_revision is null then return new; end if;
    if tg_op = 'UPDATE' and new.published_revision is not distinct from old.published_revision then return new; end if;
    v_item := new;
    delete from private.note_passages where item_id = v_item.id;
    delete from private.campus_bot_explanations e
      where e.topic_item_id = v_item.id or (e.course_id = v_item.course_id and e.outcome = 'not-covered');
  end if;
  if v_item.published_revision is not null then
    insert into private.note_passages (item_id, ordinal, revision, course_id, heading, body)
      select v_item.id, p.ordinal, v_item.published_revision, v_item.course_id,
        left(coalesce(nullif(btrim(p.heading), ''), 'Notes'), 300), p.body
      from public.managed_content_revisions r
      cross join lateral private.note_passages_of(r.payload) p
      where r.item_id = v_item.id and r.revision = v_item.published_revision;
  end if;
  return new;
exception when others then
  raise log 'Campus Bot passages unavailable for item % (%)', v_item.id, sqlstate;
  return new;
end;
$$;

drop trigger if exists managed_content_revisions_note_passages on public.managed_content_revisions;
create trigger managed_content_revisions_note_passages after insert on public.managed_content_revisions
  for each row execute function private.refresh_note_passages();

-- Only absent sets are backfilled. Each note is isolated, so one unsupported note cannot stop the migration.
do $$
declare v_item public.managed_content_items;
begin
  for v_item in select i.* from public.managed_content_items i
      where i.kind = 'note' and i.published_revision is not null
        and not exists (select 1 from private.note_passages p where p.item_id = i.id)
      order by i.id for update of i loop
    begin
      -- A publication that committed while the row lock waited owns its new passages.
      if exists (select 1 from private.note_passages p where p.item_id = v_item.id) then continue; end if;
      insert into private.note_passages (item_id, ordinal, revision, course_id, heading, body)
        select v_item.id, p.ordinal, v_item.published_revision, v_item.course_id,
          left(coalesce(nullif(btrim(p.heading), ''), 'Notes'), 300), p.body
        from public.managed_content_revisions r
        cross join lateral private.note_passages_of(r.payload) p
        where r.item_id = v_item.id and r.revision = v_item.published_revision;
    exception when others then
      raise log 'Campus Bot backfill unavailable for item % (%)', v_item.id, sqlstate;
    end;
  end loop;
end;
$$;
