import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false, // Local PostgreSQL does not need SSL
});

// Test connection
pool.on("connect", () => {
  console.log("Connected to PostgreSQL database");
});

pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err);
});

// Database utility functions
export const db = {
  query: async (text, params) => {
    const start = Date.now();
    try {
      const res = await pool.query(text, params);
      const duration = Date.now() - start;
      console.log("Executed query", { text, duration, rows: res.rowCount });
      return res;
    } catch (error) {
      console.error("Database query error:", error);
      throw error;
    }
  },

  // User management functions
  async createOrUpdateUser(provider, providerUserId, userData) {
    const query = `
      INSERT INTO users (provider, provider_user_id, email, email_verified, name, avatar_url, last_login)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (provider, provider_user_id)
      DO UPDATE SET
        email = EXCLUDED.email,
        email_verified = EXCLUDED.email_verified,
        name = EXCLUDED.name,
        avatar_url = EXCLUDED.avatar_url,
        last_login = now()
      RETURNING *;
    `;

    const values = [
      provider,
      providerUserId,
      userData.email || null,
      userData.email_verified || null,
      userData.name || null,
      userData.avatar_url || userData.avatar || null
    ];

    const result = await this.query(query, values);
    return result.rows[0];
  },

  async getUserByProviderAndId(provider, providerUserId) {
    const query = "SELECT * FROM users WHERE provider = $1 AND provider_user_id = $2";
    const result = await this.query(query, [provider, providerUserId]);
    return result.rows[0] || null;
  },

  async getUserById(id) {
    const query = "SELECT * FROM users WHERE id = $1";
    const result = await this.query(query, [id]);
    return result.rows[0] || null;
  },

  async updateLastLogin(id) {
    const query = "UPDATE users SET last_login = now() WHERE id = $1 RETURNING *";
    const result = await this.query(query, [id]);
    return result.rows[0];
  },

  async getAllUsers() {
    const query = "SELECT id, provider, email, name, avatar_url, created_at, last_login FROM users ORDER BY created_at DESC";
    const result = await this.query(query);
    return result.rows;
  },

  async getUserStats() {
    const queries = [
      "SELECT COUNT(*) as total_users FROM users",
      "SELECT provider, COUNT(*) as count FROM users GROUP BY provider",
      "SELECT COUNT(*) as active_users FROM users WHERE last_login >= NOW() - INTERVAL '7 days'"
    ];

    const [totalResult, providerResult, activeResult] = await Promise.all(
      queries.map(query => this.query(query))
    );

    return {
      totalUsers: parseInt(totalResult.rows[0].total_users),
      usersByProvider: providerResult.rows.reduce((acc, row) => {
        acc[row.provider] = parseInt(row.count);
        return acc;
      }, {}),
      activeUsers: parseInt(activeResult.rows[0].active_users)
    };
  },

  // Git repository management functions
  async createGitRepository(userId, repoUrl) {
    const query = `
      INSERT INTO git_repositories (user_id, repo_url, created_at, access_status, last_access_check)
      VALUES ($1, $2, now(), true, now())
      ON CONFLICT (user_id, repo_url)
      DO UPDATE SET
        last_access_check = now()
      RETURNING *;
    `;

    const result = await this.query(query, [userId, repoUrl]);
    return result.rows[0];
  },

  async getGitRepositoriesByUserId(userId) {
    const query = `
      SELECT * FROM git_repositories 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `;
    const result = await this.query(query, [userId]);
    return result.rows;
  },

  async getGitRepositoryById(id) {
    const query = "SELECT * FROM git_repositories WHERE id = $1";
    const result = await this.query(query, [id]);
    return result.rows[0] || null;
  },

  async updateGitRepositoryAccess(id, accessStatus) {
    const query = `
      UPDATE git_repositories 
      SET access_status = $2, last_access_check = now() 
      WHERE id = $1 
      RETURNING *
    `;
    const result = await this.query(query, [id, accessStatus]);
    return result.rows[0];
  },

  async deleteGitRepository(id) {
    const query = "DELETE FROM git_repositories WHERE id = $1 RETURNING *";
    const result = await this.query(query, [id]);
    return result.rows[0];
  },

  async getGitRepositoryStats() {
    const queries = [
      "SELECT COUNT(*) as total_repositories FROM git_repositories",
      "SELECT COUNT(*) as accessible_repositories FROM git_repositories WHERE access_status = true",
      "SELECT COUNT(*) as inaccessible_repositories FROM git_repositories WHERE access_status = false",
      "SELECT COUNT(*) as recently_checked FROM git_repositories WHERE last_access_check >= NOW() - INTERVAL '24 hours'"
    ];

    const [totalResult, accessibleResult, inaccessibleResult, recentResult] = await Promise.all(
      queries.map(query => this.query(query))
    );

    return {
      totalRepositories: parseInt(totalResult.rows[0].total_repositories),
      accessibleRepositories: parseInt(accessibleResult.rows[0].accessible_repositories),
      inaccessibleRepositories: parseInt(inaccessibleResult.rows[0].inaccessible_repositories),
      recentlyChecked: parseInt(recentResult.rows[0].recently_checked)
    };
  },

  async getUsersWithRepositories() {
    const query = `
      SELECT u.id, u.name, u.email, u.provider, 
             COUNT(gr.id) as repository_count,
             MAX(gr.last_access_check) as last_repository_check
      FROM users u
      LEFT JOIN git_repositories gr ON u.id = gr.user_id
      GROUP BY u.id, u.name, u.email, u.provider
      ORDER BY repository_count DESC, u.created_at DESC
    `;
    const result = await this.query(query);
    return result.rows;
  },

  // Backlog management functions
  async createBacklogItem(gitRepositoryUrl, task, ownerId, status = 'open') {
    const query = `
      INSERT INTO backlog (git_repository_url, task, status, owner, created_at)
      VALUES ($1, $2, $3, $4, now())
      RETURNING *;
    `;

    const result = await this.query(query, [gitRepositoryUrl, task, status, ownerId]);
    return result.rows[0];
  },

  async getBacklogItems(filters = {}) {
    let query = `
      SELECT b.*, u.name as owner_name, u.email as owner_email
      FROM backlog b
      JOIN users u ON b.owner = u.id
    `;
    const params = [];
    const conditions = [];

    if (filters.owner) {
      conditions.push(`b.owner = $${params.length + 1}`);
      params.push(filters.owner);
    }

    if (filters.status) {
      conditions.push(`b.status = $${params.length + 1}`);
      params.push(filters.status);
    }

    if (filters.gitRepositoryUrl) {
      conditions.push(`b.git_repository_url = $${params.length + 1}`);
      params.push(filters.gitRepositoryUrl);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY b.created_at DESC`;

    const result = await this.query(query, params);
    return result.rows;
  },

  async getBacklogItemById(id) {
    const query = `
      SELECT b.*, u.name as owner_name, u.email as owner_email
      FROM backlog b
      JOIN users u ON b.owner = u.id
      WHERE b.id = $1
    `;
    const result = await this.query(query, [id]);
    return result.rows[0] || null;
  },

  async updateBacklogItem(id, updates) {
    const allowedFields = ['task', 'status', 'git_repository_url'];
    const setClause = [];
    const params = [];

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key) && updates[key] !== undefined) {
        setClause.push(`${key} = $${params.length + 1}`);
        params.push(updates[key]);
      }
    });

    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }

    params.push(id);
    const query = `
      UPDATE backlog 
      SET ${setClause.join(', ')}
      WHERE id = $${params.length}
      RETURNING *
    `;

    const result = await this.query(query, params);
    return result.rows[0];
  },

  async deleteBacklogItem(id) {
    const query = "DELETE FROM backlog WHERE id = $1 RETURNING *";
    const result = await this.query(query, [id]);
    return result.rows[0];
  },

  async getBacklogStats() {
    const queries = [
      "SELECT COUNT(*) as total_items FROM backlog",
      "SELECT status, COUNT(*) as count FROM backlog GROUP BY status",
      "SELECT COUNT(*) as recent_items FROM backlog WHERE created_at >= NOW() - INTERVAL '7 days'"
    ];

    const [totalResult, statusResult, recentResult] = await Promise.all(
      queries.map(query => this.query(query))
    );

    return {
      totalItems: parseInt(totalResult.rows[0].total_items),
      itemsByStatus: statusResult.rows.reduce((acc, row) => {
        acc[row.status] = parseInt(row.count);
        return acc;
      }, {}),
      recentItems: parseInt(recentResult.rows[0].recent_items)
    };
  },

  async getBacklogByRepository(gitRepositoryUrl) {
    const query = `
      SELECT b.*, u.name as owner_name, u.email as owner_email
      FROM backlog b
      JOIN users u ON b.owner = u.id
      WHERE b.git_repository_url = $1
      ORDER BY b.created_at DESC
    `;
    const result = await this.query(query, [gitRepositoryUrl]);
    return result.rows;
  },

  async getUserBacklogSummary(userId) {
    const query = `
      SELECT 
        COUNT(*) as total_tasks,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_tasks,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_tasks,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
        COUNT(DISTINCT git_repository_url) as repositories_with_tasks
      FROM backlog 
      WHERE owner = $1
    `;
    const result = await this.query(query, [userId]);
    return result.rows[0];
  }
};

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down database connections...");
  await pool.end();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down database connections...");
  await pool.end();
  process.exit(0);
});

export default db;