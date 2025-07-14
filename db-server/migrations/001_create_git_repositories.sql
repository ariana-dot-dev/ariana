-- Migration: Create git_repositories table
-- Date: 2025-07-11
-- Description: Add git repositories table to map users to their git repositories

-- Create git repositories table
CREATE TABLE IF NOT EXISTS git_repositories (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repo_url TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    access_status BOOLEAN DEFAULT TRUE,
    last_access_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, repo_url)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_git_repositories_user_id ON git_repositories(user_id);
CREATE INDEX IF NOT EXISTS idx_git_repositories_access_status ON git_repositories(access_status);
CREATE INDEX IF NOT EXISTS idx_git_repositories_last_access ON git_repositories(last_access_check);

-- Add comment for documentation
COMMENT ON TABLE git_repositories IS 'Maps users to their git repositories with access tracking';
COMMENT ON COLUMN git_repositories.user_id IS 'Foreign key to users table';
COMMENT ON COLUMN git_repositories.repo_url IS 'Git repository URL';
COMMENT ON COLUMN git_repositories.access_status IS 'Whether the repository is accessible (default: true)';
COMMENT ON COLUMN git_repositories.last_access_check IS 'When the repository access was last checked';