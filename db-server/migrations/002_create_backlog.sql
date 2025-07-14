-- Migration: Create backlog table
-- Date: 2025-07-11
-- Description: Add backlog table to track tasks associated with git repositories and users

-- Create backlog table
CREATE TABLE IF NOT EXISTS backlog (
    id SERIAL PRIMARY KEY,
    git_repository_url TEXT NOT NULL,
    task TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed')),
    owner UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_backlog_owner ON backlog(owner);
CREATE INDEX IF NOT EXISTS idx_backlog_status ON backlog(status);
CREATE INDEX IF NOT EXISTS idx_backlog_git_repository_url ON backlog(git_repository_url);

-- Add comments for documentation
COMMENT ON TABLE backlog IS 'Task backlog items associated with git repositories and users';
COMMENT ON COLUMN backlog.git_repository_url IS 'Git repository URL this task is associated with';
COMMENT ON COLUMN backlog.task IS 'Description of the task';
COMMENT ON COLUMN backlog.status IS 'Task status: open, in_progress, or completed';
COMMENT ON COLUMN backlog.owner IS 'Foreign key to users table - task owner';