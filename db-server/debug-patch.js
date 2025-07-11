// Debug patch for repository by URL endpoint

app.get('/api/repository/by-url', authenticate, async (req, res) => {
  try {
    const { repo_url } = req.query;
    
    console.log(`[DEBUG] Full request query:`, req.query);
    console.log(`[DEBUG] User object:`, req.user);
    console.log(`[DEBUG] Repo URL:`, repo_url);
    
    if (!repo_url) {
      return res.status(400).json({ error: 'repo_url parameter is required' });
    }

    console.log(`[GET /api/repository/by-url] User: ${req.user.id}, URL: ${repo_url}`);
    
    try {
      const repository = await db.getGitRepositoryByUrl(req.user.id, repo_url);
      console.log(`[DEBUG] Repository query result:`, repository);
      
      if (!repository) {
        return res.status(404).json({ error: 'Repository not found' });
      }
      
      res.json({ repository });
    } catch (dbError) {
      console.error('[DEBUG] Database error:', dbError);
      throw dbError;
    }
  } catch (error) {
    console.error('Error fetching repository by URL:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});