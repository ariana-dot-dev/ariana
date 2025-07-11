// New endpoint for getting backlog by repository URL (avoids routing conflict)
app.get('/api/repository/backlog', authenticate, async (req, res) => {
  try {
    const { git_repository_url } = req.query;
    
    if (!git_repository_url) {
      return res.status(400).json({ error: 'git_repository_url parameter is required' });
    }

    console.log(`[GET /api/repository/backlog] User: ${req.user.id}, Repository URL: ${git_repository_url}`);
    
    const backlogItems = await db.getBacklogByRepository(git_repository_url);
    
    console.log(`[GET /api/repository/backlog] Found ${backlogItems.length} items`);
    res.json({ backlogItems });
  } catch (error) {
    console.error('Error fetching repository backlog:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});