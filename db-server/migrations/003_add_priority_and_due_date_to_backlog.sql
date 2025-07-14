-- Migration: Add priority and due_date columns to backlog table
-- Date: 2025-07-11
-- Description: Add priority (1-7) and due_date columns with automatic due date calculation

-- Add priority column
ALTER TABLE backlog ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 1 CHECK (priority >= 1 AND priority <= 7);

-- Add due_date column
ALTER TABLE backlog ADD COLUMN IF NOT EXISTS due_date TIMESTAMP;

-- Create function to calculate due date based on priority
CREATE OR REPLACE FUNCTION calculate_due_date(priority_level INTEGER, base_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP) 
RETURNS TIMESTAMP AS $$
BEGIN
    CASE priority_level
        WHEN 1 THEN RETURN base_date + INTERVAL '1 day';
        WHEN 2 THEN RETURN base_date + INTERVAL '2 days';
        WHEN 3 THEN RETURN base_date + INTERVAL '3 days';
        WHEN 4 THEN RETURN base_date + INTERVAL '1 week';
        WHEN 5 THEN RETURN base_date + INTERVAL '2 weeks';
        WHEN 6 THEN RETURN base_date + INTERVAL '1 month';
        WHEN 7 THEN RETURN base_date + INTERVAL '1 year';
        ELSE RETURN base_date + INTERVAL '1 day'; -- Default fallback
    END CASE;
END;
$$ LANGUAGE plpgsql;

-- Create trigger function to automatically set due_date when priority changes
CREATE OR REPLACE FUNCTION set_due_date_on_priority_change() 
RETURNS TRIGGER AS $$
BEGIN
    -- Set due_date based on priority when inserting or updating
    NEW.due_date = calculate_due_date(NEW.priority, NEW.created_at);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically calculate due_date on insert/update
DROP TRIGGER IF EXISTS trigger_set_due_date ON backlog;
CREATE TRIGGER trigger_set_due_date
    BEFORE INSERT OR UPDATE OF priority
    ON backlog
    FOR EACH ROW
    EXECUTE FUNCTION set_due_date_on_priority_change();

-- Update existing rows to set due_date based on their priority (default priority 1)
UPDATE backlog 
SET due_date = calculate_due_date(priority, created_at)
WHERE due_date IS NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_backlog_priority ON backlog(priority);
CREATE INDEX IF NOT EXISTS idx_backlog_due_date ON backlog(due_date);
CREATE INDEX IF NOT EXISTS idx_backlog_priority_due_date ON backlog(priority, due_date);

-- Add comments for documentation
COMMENT ON COLUMN backlog.priority IS 'Task priority: 1-7 (1=1day, 2=2days, 3=3days, 4=1week, 5=2weeks, 6=1month, 7=1year)';
COMMENT ON COLUMN backlog.due_date IS 'Automatically calculated due date based on priority and creation date';
COMMENT ON FUNCTION calculate_due_date(INTEGER, TIMESTAMP) IS 'Calculate due date based on priority level and base date';
COMMENT ON FUNCTION set_due_date_on_priority_change() IS 'Trigger function to automatically set due_date when priority changes';