// SECURITY: Secure-only endpoints for repository ID support
// REMOVED: Vulnerable /api/repository/by-url endpoint for security

// Get or create repository by URL - returns repository ID for authenticated user
app.post('/api/repository/initialize', authenticate, async (c) => {
  try {
    const { repo_url } = await c.req.json();
    
    if (!repo_url) {
      return c.json({ error: 'repo_url parameter is required' }, 400);
    }

    console.log(`[POST /api/repository/initialize] User: ${c.get('user').id}, URL: ${repo_url}`);
    
    // Get or create repository for authenticated user
    const repository = await db.getOrCreateGitRepository(c.get('user').id, repo_url);
    
    console.log(`[POST /api/repository/initialize] Repository ID: ${repository.random_id}`);
    return c.json({ repository: { id: repository.id, random_id: repository.random_id } });
  } catch (error) {
    console.error('Error initializing repository:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Get backlog by repository random ID endpoint - SECURE
app.get('/api/repository/backlog-id', authenticate, async (c) => {
  try {
    const { repository_id } = c.req.query();
    
    if (!repository_id) {
      return c.json({ error: 'repository_id parameter is required' }, 400);
    }

    console.log(`[GET /api/repository/backlog-id] User: ${c.get('user').id}, Repository ID: ${repository_id}`);
    
    // First verify the repository exists and belongs to the user
    const repository = await db.getGitRepositoryByRandomId(repository_id);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }
    
    // Check if user has access to this repository
    if (repository.user_id !== c.get('user').id) {
      return c.json({ error: 'Access denied to this repository' }, 403);
    }
    
    const backlogItems = await db.getBacklogByRepositoryRandomId(repository_id);
    
    console.log(`[GET /api/repository/backlog-id] Found ${backlogItems.length} items for repository ${repository_id}`);
    return c.json({ backlogItems });
  } catch (error) {
    console.error('Error fetching backlog by repository ID:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// SECURITY NOTE: 
// - Only secure ID-based endpoints are exposed
// - No URL-based repository access allowed
// - All access requires authentication and authorization