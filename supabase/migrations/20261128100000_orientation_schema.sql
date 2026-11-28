-- One-day orientation game. Existing account, profile and practice tables are read only.
create function private.orientation_valid_prizes(p_prizes jsonb) returns boolean
language sql immutable security definer set search_path = '' as $$
  select case when jsonb_typeof(p_prizes) is distinct from 'array' then false else
    jsonb_array_length(p_prizes) <= 300 and not exists (
      select 1 from jsonb_array_elements(p_prizes) x where jsonb_typeof(x) <> 'string'
        or char_length(btrim(x #>> '{}')) not between 1 and 160 or (x #>> '{}') ~ '[[:cntrl:]]') end;
$$;
revoke all on function private.orientation_valid_prizes(jsonb) from public, anon, authenticated, service_role;
create table private.orientation_events (
  id uuid primary key,
  title text not null check (char_length(title) between 1 and 100),
  kind text not null check (kind in ('official', 'practice')),
  phase text not null default 'draft' check (phase in ('draft', 'lobby', 'live', 'ended', 'off')),
  import_hash text not null,
  pin text unique check (pin ~ '^[0-9]{6}$'),
  prizes jsonb not null default '[]'::jsonb check (private.orientation_valid_prizes(prizes)),
  winner_count integer generated always as (jsonb_array_length(prizes)) stored,
  frozen_prizes jsonb check (frozen_prizes is null or private.orientation_valid_prizes(frozen_prizes)),
  started_at timestamptz,
  starts_at timestamptz,
  current_round uuid,
  ended_at timestamptz,
  winners_finalized boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create table private.orientation_questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references private.orientation_events on delete cascade,
  ordinal integer not null check (ordinal > 0),
  category text not null check (category in ('orientation', 'general', 'campusintell')),
  spare boolean not null,
  prompt text not null check (char_length(prompt) between 1 and 240),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4),
  correct integer not null check (correct >= 0 and correct < jsonb_array_length(options)),
  unique (event_id, ordinal), unique (event_id, id)
);
create table private.orientation_rounds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references private.orientation_events on delete cascade,
  question_id uuid not null,
  number integer not null check (number between 1 and 15),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  voided boolean not null default false,
  foreign key (event_id, question_id) references private.orientation_questions(event_id, id),
  check (closes_at = opens_at + interval '15 seconds'),
  unique (event_id, question_id), unique (event_id, id)
);
create unique index orientation_counted_round on private.orientation_rounds(event_id, number) where not voided;
alter table private.orientation_events add foreign key (id, current_round)
  references private.orientation_rounds(event_id, id) deferrable initially deferred;
create table private.orientation_players (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references private.orientation_events on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 80),
  surname text not null check (char_length(btrim(surname)) between 1 and 80),
  hidden boolean not null default false,
  joined_at timestamptz not null default clock_timestamp(),
  unique (event_id, user_id), unique (event_id, id)
);
create table private.orientation_answers (
  event_id uuid not null,
  round_id uuid not null,
  player_id uuid not null,
  option integer not null check (option between 0 and 3),
  accepted_at timestamptz not null,
  elapsed_us bigint not null check (elapsed_us >= 0 and elapsed_us < 15000000),
  primary key (round_id, player_id),
  foreign key (event_id, round_id) references private.orientation_rounds(event_id, id) on delete cascade,
  foreign key (event_id, player_id) references private.orientation_players(event_id, id) on delete cascade
);
create index orientation_answers_player on private.orientation_answers(event_id, player_id);
create table private.orientation_final_scores (
  event_id uuid not null,
  player_id uuid not null,
  score integer not null,
  time_us bigint not null,
  position integer not null,
  primary key (event_id, player_id),
  foreign key (event_id, player_id) references private.orientation_players(event_id, id) on delete cascade
);
create table private.orientation_draws (
  event_id uuid primary key references private.orientation_events on delete cascade,
  started_by uuid not null,
  started_at timestamptz not null default clock_timestamp(),
  groups jsonb not null check (jsonb_typeof(groups) = 'array' and jsonb_array_length(groups) > 0)
);
create table private.orientation_winners (
  event_id uuid not null,
  player_id uuid not null,
  prize integer not null,
  prize_name text not null,
  claim_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''),1,16)),
  collected_at timestamptz,
  collected_by uuid,
  primary key (event_id, player_id), unique (event_id, prize),
  foreign key (event_id, player_id) references private.orientation_players(event_id, id) on delete cascade
);
create table private.orientation_staff (
  event_id uuid not null references private.orientation_events on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  added_by uuid not null,
  added_at timestamptz not null default clock_timestamp(),
  primary key (event_id, user_id)
);
create table private.orientation_pin_attempts (
  user_id uuid primary key references auth.users on delete cascade,
  window_start timestamptz not null,
  attempts integer not null
);
-- No API role, including service_role, receives direct access to game data or keys.
do $$ declare t text; begin
  foreach t in array array['events','questions','rounds','players','answers','final_scores','draws','winners','staff','pin_attempts'] loop
    execute format('alter table private.orientation_%I enable row level security', t);
    execute format('revoke all on table private.orientation_%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;
