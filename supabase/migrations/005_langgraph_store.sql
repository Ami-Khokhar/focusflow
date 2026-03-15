-- Phase 4: Add memory_type column for tracking Store sync status
ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS memory_type TEXT
    DEFAULT 'legacy' CHECK (memory_type IN ('legacy', 'synced'));
CREATE INDEX IF NOT EXISTS memory_items_type_idx ON memory_items(memory_type);
