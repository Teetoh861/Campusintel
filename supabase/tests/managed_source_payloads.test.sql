-- supabase/tests/managed_source_payloads.test.sql — Structured source fields remain validated at the SQL write boundary.
begin;
select no_plan();

select lives_ok($sql$ select private.assert_managed_payload('course_overview',
  '{"title":"Course","body":"Overview","topics":[{"chapter":"1","description":"Intro"}],
    "examFocus":["Definitions"],"keyTakeaways":[{"title":"Rule","description":"Meaning"}],
    "formulaSheet":[{"name":"Ratio","formula":"A / B","explanation":"Meaning","example":"4 / 2"}]}'::jsonb)
$sql$, 'structured overview study fields are valid');
select lives_ok($sql$ select private.assert_managed_payload('note',
  '{"title":"Topic","body":"Summary","noteType":"topic_note",
    "keyPoints":["A key point"],"examTip":"Review this"}'::jsonb)
$sql$, 'topic-note key points and tip remain structured');
select lives_ok($sql$ select private.assert_managed_payload('note',
  '{"title":"Calculator","body":"Method","noteType":"calculator_trick",
    "example":"2 + 2 = 4","formula":"x + y"}'::jsonb)
$sql$, 'calculator example and formula remain structured');
select throws_ok($sql$ select private.assert_managed_payload('note',
  '{"title":"Topic","body":"Summary","noteType":"topic_note","keyPoints":[]}'::jsonb)
$sql$, '22023', null, 'empty source key points are rejected');
select throws_ok($sql$ select private.assert_managed_payload('note',
  '{"title":"Calculator","body":"Method","noteType":"calculator_trick",
    "example":"2 + 2 = 4","keyPoints":["Wrong subtype"]}'::jsonb)
$sql$, '22023', null, 'cross-subtype fields are rejected');
select throws_ok($sql$ select private.assert_managed_payload('course_overview',
  '{"title":"Course","body":"Overview","resources":[]}'::jsonb)
$sql$, '22023', null, 'catalogue or presentation metadata is not accepted as learning content');

select * from finish();
rollback;
