-- Add 'Done' to memory_items status constraint
-- Drop old constraint and add new one
ALTER TABLE memory_items DROP CONSTRAINT IF EXISTS memory_items_status_check;
ALTER TABLE memory_items ADD CONSTRAINT memory_items_status_check
  CHECK (status IN ('Active', 'Done', 'Archived'));
