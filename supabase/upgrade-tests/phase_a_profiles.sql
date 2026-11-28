-- Seeded after a local reset stopped at the last Phase A migration.
-- Confirmed synthetic accounts exercise the original profile trigger.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000',
   '80000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'upgrade-a@example.test', 'x',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '80000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'upgrade-b@example.test', 'x',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '80000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'upgrade-c@example.test', 'x',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '80000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'upgrade-d@example.test', 'x',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
