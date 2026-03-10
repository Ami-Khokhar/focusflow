-- Flowy — Supabase Schema
-- Run this in your Supabase project → SQL Editor → New query

-- ─── Users ───────────────────────────────────────────────────────────────────
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null default 'Friend',
  timezone      text,
  created_at    timestamptz not null default now()
);

-- ─── Sessions (one per user per day) ─────────────────────────────────────────
create table if not exists sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  started_at        timestamptz not null default now(),
  briefing_delivered boolean not null default false,
  active_task_id    uuid,
  check_in_due_at   timestamptz
);

create index if not exists sessions_user_id_idx on sessions(user_id);

-- ─── Messages ─────────────────────────────────────────────────────────────────
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists messages_session_id_idx on messages(session_id);

-- ─── Memory Items ─────────────────────────────────────────────────────────────
create table if not exists memory_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  content      text not null,
  category     text not null check (category in ('Note', 'Task', 'Reminder', 'Link', 'Idea')),
  status       text not null default 'Active' check (status in ('Active', 'Done', 'Archived')),
  captured_at  timestamptz not null default now(),
  surfaced_at  timestamptz,
  remind_at    timestamptz
);

create index if not exists memory_items_user_id_idx on memory_items(user_id);
create index if not exists memory_items_remind_at_idx on memory_items(remind_at) where remind_at is not null;

-- ─── Daily Briefings (cached — one per user per day) ─────────────────────────
create table if not exists daily_briefings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  briefing_date  date not null default current_date,
  content        text not null,
  created_at     timestamptz not null default now(),
  unique (user_id, briefing_date)
);

create index if not exists daily_briefings_user_date_idx on daily_briefings(user_id, briefing_date);
