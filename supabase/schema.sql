-- Wordo daily leaderboard. Run this in your Supabase project (SQL Editor).
-- Streaks live client-side (localStorage); only the shared daily board is stored here.

create table if not exists public.daily_scores (
  id         bigint generated always as identity primary key,
  lang       text        not null,
  day        date        not null,
  client_id  text        not null,
  name       text        not null default 'Anonymous',
  guesses    int         not null check (guesses >= 1),
  ms         int         not null default 0,
  gave_up    boolean     not null default false,
  created_at timestamptz not null default now(),
  unique (lang, day, client_id)
);

create index if not exists daily_scores_board_idx
  on public.daily_scores (lang, day, guesses, ms);

alter table public.daily_scores enable row level security;

-- Anyone may read the boards.
drop policy if exists "read boards" on public.daily_scores;
create policy "read boards" on public.daily_scores
  for select using (true);

-- Anyone may submit their own result (no login; MVP). Light sanity bounds.
drop policy if exists "insert score" on public.daily_scores;
create policy "insert score" on public.daily_scores
  for insert with check (
    length(name) <= 24 and guesses between 1 and 100000 and char_length(client_id) between 8 and 64
  );

-- NOTE: open insert means scores aren't verified server-side. Fine for an MVP.
-- To harden later, move submission behind a Supabase Edge Function that recomputes
-- the rank, and restrict this policy to the service role.
