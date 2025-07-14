// Additional endpoints to add to index.js for repository ID support

// Get repository by URL endpoint
app.get('/api/repository/by-url', authenticateRequest, async (req, res) => {
  try {
    const { repo_url } = req.query;
    
    if (!repo_url) {
      return res.status(400).json({ error: 'repo_url parameter is required' });
    }

    console.log(`[GET /api/repository/by-url] User: ${req.user.id}, URL: ${repo_url}`);
    
    const repository = await db.getGitRepositoryByUrl(req.user.id, repo_url);
    
    if (!repository) {
      return res.status(404).json({ error: 'Repository not found' });
    }
    
    res.json({ repository });
  } catch (error) {
    console.error('Error fetching repository by URL:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get backlog by repository random ID endpoint
app.get('/api/backlog/repository-id', authenticateRequest, async (req, res) => {
  try {
    const { repository_id } = req.query;
    
    if (!repository_id) {
      return res.status(400).json({ error: 'repository_id parameter is required' });
    }

    console.log(`[GET /api/backlog/repository-id] User: ${req.user.id}, Repository ID: ${repository_id}`);
    
    // First verify the repository exists and belongs to the user
    const repository = await db.getGitRepositoryByRandomId(repository_id);
    if (!repository) {
      return res.status(404).json({ error: 'Repository not found' });
    }
    
    // Check if user has access to this repository
    if (repository.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied to this repository' });
    }
    
    const backlogItems = await db.getBacklogByRepositoryRandomId(repository_id);
    
    console.log(`[GET /api/backlog/repository-id] Found ${backlogItems.length} items for repository ${repository_id}`);
    res.json({ backlogItems });
  } catch (error) {
    console.error('Error fetching backlog by repository ID:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});