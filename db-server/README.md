# Ariana IDE Database Server

This directory contains the database configuration, schema, and management scripts for the Ariana IDE application.

## Structure

```
db-server/
├── README.md                 # This file
├── package.json             # Node.js dependencies
├── database.js              # Main database connection and utilities
├── schema.sql               # Complete database schema
├── setup.js                 # Database setup and migration script
├── test.js                  # Test script for database functions
├── connect.sh               # SSH connection script to OVH server
└── migrations/              # Database migrations
    └── 001_create_git_repositories.sql
```

## Database Schema

### Users Table
- `id` (SERIAL PRIMARY KEY)
- `provider` (VARCHAR) - OAuth provider (google, github)
- `provider_user_id` (VARCHAR) - User ID from OAuth provider
- `email` (VARCHAR) - User email
- `email_verified` (BOOLEAN) - Whether email is verified
- `name` (VARCHAR) - User display name
- `avatar_url` (TEXT) - Profile picture URL
- `created_at` (TIMESTAMP) - Account creation time
- `last_login` (TIMESTAMP) - Last login time

### Git Repositories Table
- `id` (SERIAL PRIMARY KEY)
- `user_id` (UUID) - Foreign key to users table
- `repo_url` (TEXT) - Git repository URL
- `created_at` (TIMESTAMP) - When repository was added
- `access_status` (BOOLEAN) - Whether repository is accessible (default: true)
- `last_access_check` (TIMESTAMP) - When access was last checked (default: creation time)

### Backlog Table
- `id` (SERIAL PRIMARY KEY)
- `git_repository_url` (TEXT) - Git repository URL this task is associated with
- `task` (TEXT) - Description of the task
- `status` (VARCHAR) - Task status: 'open', 'in_progress', or 'completed' (default: 'open')
- `owner` (UUID) - Foreign key to users table - task owner
- `created_at` (TIMESTAMP) - When task was created

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables (create `.env` file):
   ```env
   DATABASE_URL=postgresql://username:password@localhost:5432/ariana_ide
   SSH_HOST=your-server-host
   SSH_PORT=22
   SSH_USER=your-username
   ```

3. Run database setup:
   ```bash
   npm run setup
   ```

4. Test the database functions:
   ```bash
   npm test
   ```

## Available Functions

### User Management
- `createOrUpdateUser(provider, providerUserId, userData)` - Create or update user
- `getUserByProviderAndId(provider, providerUserId)` - Get user by OAuth provider
- `getUserById(id)` - Get user by ID
- `updateLastLogin(id)` - Update user's last login
- `getAllUsers()` - Get all users
- `getUserStats()` - Get user statistics

### Git Repository Management
- `createGitRepository(userId, repoUrl)` - Add repository for user
- `getGitRepositoriesByUserId(userId)` - Get all repositories for user
- `getGitRepositoryById(id)` - Get repository by ID
- `updateGitRepositoryAccess(id, accessStatus)` - Update repository access status
- `deleteGitRepository(id)` - Delete repository
- `getGitRepositoryStats()` - Get repository statistics
- `getUsersWithRepositories()` - Get users with their repository counts

### Backlog Management
- `createBacklogItem(gitRepositoryUrl, task, ownerId, status)` - Create new backlog item
- `getBacklogItems(filters)` - Get backlog items with optional filters (owner, status, gitRepositoryUrl)
- `getBacklogItemById(id)` - Get backlog item by ID
- `updateBacklogItem(id, updates)` - Update backlog item (task, status, git_repository_url)
- `deleteBacklogItem(id)` - Delete backlog item
- `getBacklogStats()` - Get backlog statistics
- `getBacklogByRepository(gitRepositoryUrl)` - Get all backlog items for a repository
- `getUserBacklogSummary(userId)` - Get user's backlog summary statistics

## Migration Strategy

Migrations are stored in the `migrations/` directory and are numbered sequentially:
- `001_create_git_repositories.sql` - Initial git repositories table

To add a new migration:
1. Create a new file with the next number: `002_your_migration_name.sql`
2. Update `setup.js` to include the new migration
3. Run `npm run setup` to apply changes

## API Endpoints

### Backlog Management APIs
All backlog endpoints require authentication via JWT token.

- `POST /api/backlog` - Create new backlog item
  ```json
  {
    "git_repository_url": "https://github.com/user/repo.git",
    "task": "Implement user authentication",
    "status": "open" // optional: "open", "in_progress", "completed"
  }
  ```

- `GET /api/backlog` - Get user's backlog items with optional filters
  - Query params: `status`, `git_repository_url`, `owner`

- `GET /api/admin/backlog` - Get all backlog items (admin only)
  - Query params: `status`, `git_repository_url`, `owner`

- `GET /api/backlog/:id` - Get specific backlog item by ID

- `PUT /api/backlog/:id` - Update backlog item
  ```json
  {
    "task": "Updated task description",
    "status": "in_progress",
    "git_repository_url": "https://github.com/user/repo.git"
  }
  ```

- `DELETE /api/backlog/:id` - Delete backlog item

- `GET /api/backlog/stats` - Get backlog statistics

- `GET /api/backlog/repository?git_repository_url=...` - Get backlog items for specific repository

## Usage Examples

### Database Functions
```javascript
import { db } from './database.js';

// Create a git repository for a user
const repo = await db.createGitRepository(userId, 'https://github.com/user/repo.git');

// Create a backlog item
const item = await db.createBacklogItem(
  'https://github.com/user/repo.git',
  'Implement user authentication',
  userId,
  'open'
);

// Get user's backlog items
const items = await db.getBacklogItems({ owner: userId, status: 'open' });

// Update backlog item status
await db.updateBacklogItem(item.id, { status: 'completed' });
```

### API Usage
```bash
# Create backlog item
curl -X POST https://api2.ariana.dev/api/backlog \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "git_repository_url": "https://github.com/user/repo.git",
    "task": "Implement user authentication"
  }'

# Get user's backlog items
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://api2.ariana.dev/api/backlog

# Update backlog item
curl -X PUT https://api2.ariana.dev/api/backlog/1 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

## Security Notes

- All database queries use parameterized queries to prevent SQL injection
- User input is validated and sanitized
- Foreign key constraints ensure data integrity
- Indexes are created for performance optimization