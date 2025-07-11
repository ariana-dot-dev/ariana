-- Ariana IDE Database Schema
-- This file contains the complete database schema for the Ariana IDE application

-- Users table (existing)
-- Note: The id column should be UUID, but keeping as SERIAL for backward compatibility
-- In production, consider migrating to UUID for better consistency
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    provider VARCHAR(50) NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    email_verified BOOLEAN DEFAULT FALSE,
    name VARCHAR(255),
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, provider_user_id)
);

-- Git repositories table (new)
CREATE TABLE IF NOT EXISTS git_repositories (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repo_url TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    access_status BOOLEAN DEFAULT TRUE,
    last_access_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, repo_url)
);

-- Backlog table
CREATE TABLE IF NOT EXISTS backlog (
    id SERIAL PRIMARY KEY,
    git_repository_url TEXT NOT NULL,
    task TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed')),
    owner UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 1 CHECK (priority >= 1 AND priority <= 7),
    due_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_provider_id ON users(provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_git_repositories_user_id ON git_repositories(user_id);
CREATE INDEX IF NOT EXISTS idx_git_repositories_access_status ON git_repositories(access_status);
CREATE INDEX IF NOT EXISTS idx_git_repositories_last_access ON git_repositories(last_access_check);
CREATE INDEX IF NOT EXISTS idx_backlog_owner ON backlog(owner);
CREATE INDEX IF NOT EXISTS idx_backlog_status ON backlog(status);
CREATE INDEX IF NOT EXISTS idx_backlog_git_repository_url ON backlog(git_repository_url);
CREATE INDEX IF NOT EXISTS idx_backlog_priority ON backlog(priority);
CREATE INDEX IF NOT EXISTS idx_backlog_due_date ON backlog(due_date);
CREATE INDEX IF NOT EXISTS idx_backlog_priority_due_date ON backlog(priority, due_date);

-- Function to calculate due date based on priority
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

-- Trigger function to automatically set due_date when priority changes
CREATE OR REPLACE FUNCTION set_due_date_on_priority_change() 
RETURNS TRIGGER AS $$
BEGIN
    -- Set due_date based on priority when inserting or updating
    NEW.due_date = calculate_due_date(NEW.priority, NEW.created_at);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically calculate due_date on insert/update
DROP TRIGGER IF EXISTS trigger_set_due_date ON backlog;
CREATE TRIGGER trigger_set_due_date
    BEFORE INSERT OR UPDATE OF priority
    ON backlog
    FOR EACH ROW
    EXECUTE FUNCTION set_due_date_on_priority_change();