-- Link users table to Supabase Auth
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users(id);

-- Add missing columns that db.js uses but schema doesn't define
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_step integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS main_focus text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS biggest_struggle text;

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_briefings ENABLE ROW LEVEL SECURITY;

-- Service role bypass policies (API routes use service role key which bypasses RLS)
-- Security comes from middleware validating the session before API routes are reached
CREATE POLICY "service_role_bypass_users" ON users TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_sessions" ON sessions TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_messages" ON messages TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_memory_items" ON memory_items TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_daily_briefings" ON daily_briefings TO service_role USING (true) WITH CHECK (true);
