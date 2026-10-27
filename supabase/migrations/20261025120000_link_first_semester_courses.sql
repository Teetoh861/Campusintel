-- Owner-confirmed aliases: reuse the existing content without changing its identity or access policy.
do $$
declare
  v_link record;
  v_course public.institutional_courses%rowtype;
begin
  for v_link in
    select * from (values
      ('50000000-0000-4000-8000-000000000016'::uuid, 'ACC-CM201', 'Financial Accounting I',
       'financial-accounting-1', '40000000-0000-4000-8000-000000000007'::uuid),
      ('50000000-0000-4000-8000-000000000075'::uuid, 'LAG-BUA210', 'Business Mathematics',
       'business-mathematics', '40000000-0000-4000-8000-000000000005'::uuid),
      ('50000000-0000-4000-8000-000000000076'::uuid, 'LAG-BUA221', 'Consumer Behaviour',
       'consumer-behaviour', '40000000-0000-4000-8000-000000000006'::uuid)
    ) expected(institutional_id, code, title, content_key, repository_id)
    order by institutional_id
  loop
    select * into v_course from public.institutional_courses
      where id = v_link.institutional_id for update;
    if not found or v_course.course_code is distinct from v_link.code
        or v_course.display_title is distinct from v_link.title
        or v_course.repository_course_id is not null then
      raise exception 'Expected exact, unlinked catalogue identity: %', v_link.code;
    end if;
    if not exists (select 1 from public.courses
        where id = v_link.repository_id and content_key = v_link.content_key) then
      raise exception 'Expected existing repository identity: %', v_link.content_key;
    end if;
    if exists (select 1 from public.institutional_courses where repository_course_id = v_link.repository_id) then
      raise exception 'Repository identity already belongs to a catalogue course: %', v_link.content_key;
    end if;
    update public.institutional_courses set repository_course_id = v_link.repository_id
      where id = v_link.institutional_id and course_code = v_link.code and repository_course_id is null;
  end loop;
end;
$$;
