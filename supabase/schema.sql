-- FocusFlow MVP — Supabase Schema
-- Run this in the Supabase SQL editor when ready to move off demo mode

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ───── USERS ─────
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       TEXT UNIQUE NOT NULL,
  display_name TEXT,
  timezone    TEXT DEFAULT 'UTC',
  created_at  TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ DEFAULT now(),
  onboarding_step INT DEFAULT 0,
  main_focus  TEXT,
  biggest_struggle TEXT
);

-- ───── MEMORY ITEMS ─────
CREATE TABLE IF NOT EXISTS memory_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  category    TEXT CHECK (category IN ('Task','Reminder','Note','Idea','Link')) DEFAULT 'Note',
  status      TEXT CHECK (status IN ('Active','Done','Archived')) DEFAULT 'Active',
  captured_at TIMESTAMPTZ DEFAULT now(),
  surfaced_at TIMESTAMPTZ
);

-- ───── SESSIONS ─────
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ DEFAULT now(),
  briefing_delivered BOOLEAN DEFAULT false,
  active_task_id  UUID,
  check_in_due_at TIMESTAMPTZ
);

-- ───── MESSAGES ─────
CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT CHECK (role IN ('user','assistant')) NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ───── ROW LEVEL SECURITY ─────
-- FocusFlow does NOT use Supabase Auth — user IDs are app-managed UUIDs.
-- All server-side writes use the service_role key which bypasses RLS.
-- Anon key (client-side) is restricted to SELECT only for Realtime subscriptions.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Allow anon SELECT on memory_items for Supabase Realtime subscriptions
CREATE POLICY "Allow anon select memory_items" ON memory_items
  FOR SELECT USING (true);

-- Allow anon SELECT on messages for Realtime
CREATE POLICY "Allow anon select messages" ON messages
  FOR SELECT USING (true);

-- ───── PUSH SUBSCRIPTIONS ─────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
-- push_subscriptions: no anon access needed (all ops via service_role API routes)

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- ───── INDEXES ─────
CREATE INDEX IF NOT EXISTS idx_memory_user_status ON memory_items(user_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
