-- Migration 003: eval_events table for tool call logging + latency on messages

CREATE TABLE IF NOT EXISTS eval_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('tool_call', 'tool_result', 'fallback', 'rate_limit', 'hallucination_blocked')),
  tool_name TEXT,
  tool_args JSONB,
  tool_result TEXT,
  llm_iteration INT DEFAULT 1,
  latency_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient querying by session
CREATE INDEX IF NOT EXISTS eval_events_session_idx ON eval_events(session_id);
CREATE INDEX IF NOT EXISTS eval_events_user_idx ON eval_events(user_id);
CREATE INDEX IF NOT EXISTS eval_events_created_at_idx ON eval_events(created_at DESC);

-- Allow anon select for Realtime (same pattern as memory_items)
ALTER TABLE eval_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon select eval_events" ON eval_events FOR SELECT USING (true);

-- Add latency_ms to messages table if it doesn't exist
ALTER TABLE messages ADD COLUMN IF NOT EXISTS latency_ms INT;
