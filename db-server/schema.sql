-- Ariana IDE Database Schema
-- This file contains the complete database schema for the Ariana IDE application

-- Users table (existing)
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