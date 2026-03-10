-- Flowy Migration: 001_enable_rls.sqlow does NOT use Supabase Auth — user IDs are app-managed UUIDs stored in localStorage.
-- Strategy: enable RLS on all tables, deny writes via anon key, allow SELECT for Realtime.
-- All write operations go through server-side API routes using the service_role key (bypasses RLS).

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Drop any existing auth.uid()-based policies (they don't work without Supabase Auth)
DROP POLICY IF EXISTS users_own ON users;
DROP POLICY IF EXISTS memory_own ON memory_items;
DROP POLICY IF EXISTS sessions_own ON sessions;
DROP POLICY IF EXISTS messages_own ON messages;
DROP POLICY IF EXISTS push_own ON push_subscriptions;

-- service_role key bypasses RLS entirely — no explicit policy needed for server-side API routes.

-- Allow anon SELECT on memory_items for Supabase Realtime subscriptions (client-side)
CREATE POLICY "Allow anon select memory_items" ON memory_items
  FOR SELECT USING (true);

-- Allow anon SELECT on messages for potential Realtime use
CREATE POLICY "Allow anon select messages" ON messages
  FOR SELECT USING (true);
