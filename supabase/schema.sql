-- Water Break: database schema for Supabase.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- One row of settings per user.
create table if not exists public.water_settings (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  interval_min integer not null default 45 check (interval_min between 5 and 480),
  goal         integer not null default 8  check (goal between 1 and 20),
  glass_ml     integer not null default 250 check (glass_ml between 100 and 1000),
  day_start    text    not null default '07:00',
  day_end      text    not null default '23:00',
  sound        boolean not null default true,
  updated_at   timestamptz not null default now()
);

-- Glasses drunk per user per day.
create table if not exists public.water_logs (
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null,
  glasses    integer not null default 0 check (glasses between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- Aquarium fish: one per day the goal was reached.
create table if not exists public.water_rewards (
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null,
  shape      text not null check (shape in ('fish', 'puffer', 'jelly')),
  color      text not null,
  name       text not null,
  gold       boolean not null default false,
  title      text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- Row level security: every user can only see and change their own rows.
alter table public.water_settings enable row level security;
alter table public.water_logs     enable row level security;
alter table public.water_rewards  enable row level security;

drop policy if exists "own settings" on public.water_settings;
create policy "own settings" on public.water_settings
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own logs" on public.water_logs;
create policy "own logs" on public.water_logs
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rewards" on public.water_rewards;
create policy "own rewards" on public.water_rewards
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Live updates between a user's devices.
alter publication supabase_realtime add table public.water_settings;
alter publication supabase_realtime add table public.water_logs;
alter publication supabase_realtime add table public.water_rewards;
