// Simple script to demonstrate the correct route order
// In Express.js, more specific routes must come before parametric routes

console.log(`
The routes should be ordered like this:

// Specific backlog routes (MUST come first)
app.get("/api/backlog/stats", authenticate, async (c) => { ... });
app.get("/api/backlog/repository", authenticate, async (c) => { ... });
app.get("/api/backlog/repository-id", authenticate, async (c) => { ... });

// Parametric route (MUST come last)
app.get("/api/backlog/:id", authenticate, async (c) => { ... });

Current order is causing /api/backlog/repository to match /api/backlog/:id
`);