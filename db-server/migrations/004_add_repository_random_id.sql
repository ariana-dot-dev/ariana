-- Migration: Add random ID to git repositories and update backlog to use repository IDs
-- Date: 2025-07-11
-- Description: Add a random ID field to git_repositories table and migrate backlog table to use repository IDs instead of URLs

-- Add random_id column to git_repositories table
ALTER TABLE git_repositories 
ADD COLUMN IF NOT EXISTS random_id VARCHAR(32) UNIQUE;

-- Create function to generate random alphanumeric string
CREATE OR REPLACE FUNCTION generate_random_id(length INTEGER DEFAULT 16) 
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    result TEXT := '';
    i INTEGER := 0;
BEGIN
    FOR i IN 1..length LOOP
        result := result || substr(chars, floor(random() * length(chars))::integer + 1, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Update existing git_repositories records with random IDs
UPDATE git_repositories 
SET random_id = generate_random_id(16) 
WHERE random_id IS NULL;

-- Make random_id NOT NULL after updating existing records
ALTER TABLE git_repositories 
ALTER COLUMN random_id SET NOT NULL;

-- Add repository_id column to backlog table (references git_repositories.id)
ALTER TABLE backlog 
ADD COLUMN IF NOT EXISTS repository_id INTEGER REFERENCES git_repositories(id) ON DELETE CASCADE;

-- Create a temporary function to populate repository_id based on git_repository_url
CREATE OR REPLACE FUNCTION migrate_backlog_repository_ids() 
RETURNS VOID AS $$
DECLARE
    backlog_record RECORD;
    repo_id INTEGER;
BEGIN
    -- For each backlog item, find the corresponding repository ID
    FOR backlog_record IN SELECT id, git_repository_url, owner FROM backlog WHERE repository_id IS NULL LOOP
        -- Try to find existing repository
        SELECT gr.id INTO repo_id 
        FROM git_repositories gr 
        WHERE gr.repo_url = backlog_record.git_repository_url 
        AND gr.user_id = backlog_record.owner;
        
        -- If repository doesn't exist, create it
        IF repo_id IS NULL THEN
            INSERT INTO git_repositories (user_id, repo_url, random_id) 
            VALUES (backlog_record.owner, backlog_record.git_repository_url, generate_random_id(16))
            RETURNING id INTO repo_id;
        END IF;
        
        -- Update backlog item with repository_id
        UPDATE backlog 
        SET repository_id = repo_id 
        WHERE id = backlog_record.id;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Run the migration function
SELECT migrate_backlog_repository_ids();

-- Drop the temporary migration function
DROP FUNCTION migrate_backlog_repository_ids();

-- Make repository_id NOT NULL after migration
ALTER TABLE backlog 
ALTER COLUMN repository_id SET NOT NULL;

-- Create index for the new repository_id column
CREATE INDEX IF NOT EXISTS idx_backlog_repository_id ON backlog(repository_id);

-- Add comments for documentation
COMMENT ON COLUMN git_repositories.random_id IS 'Random alphanumeric ID for repository identification (16 characters)';
COMMENT ON COLUMN backlog.repository_id IS 'Foreign key to git_repositories table - replaces git_repository_url';

-- Note: We keep git_repository_url for now for backward compatibility
-- It can be removed in a future migration after confirming everything works
COMMENT ON COLUMN backlog.git_repository_url IS 'DEPRECATED: Use repository_id instead. Kept for backward compatibility.';