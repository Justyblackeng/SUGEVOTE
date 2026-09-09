-- SUMAS E-VOTE — database schema
-- Run this once in your Supabase project's SQL editor (or any Postgres instance).

create table if not exists positions (
  id text primary key,
  title text not null,
  sort_order int not null
);

create table if not exists candidates (
  id text primary key,
  position_id text not null references positions(id) on delete cascade,
  name text not null,
  tag text
);

-- Optional voter roll. Leave empty to allow any matric number through
-- verification (useful for testing); populate it to restrict voting
-- to a known list of students.
create table if not exists voter_roll (
  matric text primary key,
  full_name text,
  faculty text,
  email text
);

-- One row per student who has voted. The primary key constraint is
-- what actually prevents double voting — the submit-vote function
-- relies on the insert failing here for a repeat matric number.
create table if not exists voted_log (
  matric text primary key,
  voted_at timestamptz not null default now()
);

-- Anonymous vote rows. Deliberately has no matric/voter id column,
-- so an individual ballot can never be traced back to a student.
create table if not exists votes (
  id bigserial primary key,
  position_id text not null references positions(id),
  candidate_id text not null references candidates(id),
  cast_at timestamptz not null default now()
);

-- Simple key/value settings table, e.g. to hide results until polls close.
create table if not exists election_settings (
  key text primary key,
  value text
);

insert into election_settings (key, value) values
  ('results_public', 'true')
on conflict (key) do nothing;

-- One-time codes sent to a student's email to confirm it's really them
-- before they can vote. Deliberately keyed by matric so only one live
-- code exists per student at a time.
create table if not exists otp_codes (
  matric text primary key,
  code text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

-- Short-lived "cleared to vote" ticket, created only after a correct
-- OTP is entered. submit-vote requires one of these to exist (and be
-- unexpired) before it will record a ballot, and deletes it right
-- after — so a ticket can only ever be used once.
create table if not exists vote_authorizations (
  matric text primary key,
  expires_at timestamptz not null
);

-- ── Poll window + results lock ──────────────────────────────────
-- poll_open_at / poll_close_at are optional ISO timestamps, set from
-- the admin dashboard (or directly here). Leave both null (the
-- default) to run with no automatic time boundary — voting stays
-- open and results follow results_public only, same as before.
-- Once poll_close_at is set and passes: request-otp and submit-vote
-- both start rejecting with "poll_closed", and get-results reveals
-- results automatically even if results_public is still 'false'.
insert into election_settings (key, value) values
  ('poll_open_at', null),
  ('poll_close_at', null)
on conflict (key) do nothing;

-- ── OTP request rate limiting ───────────────────────────────────
-- Tracks a fixed-window request count and last-sent time per matric,
-- so request-otp can enforce both a short resend cooldown and a cap
-- on codes requested within a rolling window (see request-otp.js).
alter table otp_codes add column if not exists window_start timestamptz;
alter table otp_codes add column if not exists window_count int not null default 0;
alter table otp_codes add column if not exists last_sent_at timestamptz;

-- Per-IP window, independent of matric, so one connection can't dodge
-- the per-matric limit by cycling through many matric numbers.
create table if not exists otp_ip_limit (
  ip text primary key,
  window_start timestamptz not null,
  window_count int not null default 0
);

-- Lock every table down from Supabase's public/anon API key.
-- The Netlify functions use the service role key (server-side only,
-- set as an environment variable in Netlify — never shipped to the
-- browser), which bypasses RLS. No policies are defined here on
-- purpose, so the anon key has zero access.
alter table positions enable row level security;
alter table candidates enable row level security;
alter table voter_roll enable row level security;
alter table voted_log enable row level security;
alter table votes enable row level security;
alter table election_settings enable row level security;
alter table otp_codes enable row level security;
alter table vote_authorizations enable row level security;
alter table otp_ip_limit enable row level security;

-- ── Seed: positions ──────────────────────────────────────────────
insert into positions (id, title, sort_order) values
  ('president', 'President', 1),
  ('vp', 'Vice President', 2),
  ('gensec', 'Secretary General', 3),
  ('assecgen', 'Assistant Secretary General', 4),
  ('finsec', 'Financial Secretary', 5),
  ('treasurer', 'Treasurer', 6),
  ('dict', 'Director of ICT', 7),
  ('dgames', 'Director of Games', 8),
  ('dsocials', 'Director of Socials', 9),
  ('dwelfare', 'Director of Welfare', 10),
  ('pro', 'Public Relations Officer', 11)
on conflict (id) do nothing;

-- ── Seed: candidates (placeholders — replace with real names) ───
insert into candidates (id, position_id, name, tag) values
  ('p1', 'president', 'Chidera Nwafor', 'Independent'),
  ('p2', 'president', 'Tunde Bakare', 'Progressive Bloc'),
  ('vp1', 'vp', 'Amara Obi', 'Independent'),
  ('vp2', 'vp', 'Feyisayo Adekunle', 'Progressive Bloc'),
  ('gs1', 'gensec', 'Ikenna Eze', 'Independent'),
  ('gs2', 'gensec', 'Blessing Umeh', 'Progressive Bloc'),
  ('asg1', 'assecgen', 'Musa Aliyu', 'Independent'),
  ('asg2', 'assecgen', 'Grace Effiong', 'Progressive Bloc'),
  ('fs1', 'finsec', 'Chiamaka Eze', 'Independent'),
  ('fs2', 'finsec', 'David Okon', 'Progressive Bloc'),
  ('tr1', 'treasurer', 'Ngozi Onwuka', 'Independent'),
  ('tr2', 'treasurer', 'Kelechi Nwosu', 'Progressive Bloc'),
  ('dict1', 'dict', 'Samuel Nnaji', 'Independent'),
  ('dict2', 'dict', 'Halima Bello', 'Progressive Bloc'),
  ('dg1', 'dgames', 'Victor Osazuwa', 'Independent'),
  ('dg2', 'dgames', 'Chukwuemeka Okafor', 'Progressive Bloc'),
  ('ds1', 'dsocials', 'Ifeoma Chukwu', 'Independent'),
  ('ds2', 'dsocials', 'Ridwan Lawal', 'Progressive Bloc'),
  ('dw1', 'dwelfare', 'Precious Etim', 'Independent'),
  ('dw2', 'dwelfare', 'Abubakar Sani', 'Progressive Bloc'),
  ('pro1', 'pro', 'Zainab Yusuf', 'Independent'),
  ('pro2', 'pro', 'Emeka Chukwu', 'Progressive Bloc')
on conflict (id) do nothing;
