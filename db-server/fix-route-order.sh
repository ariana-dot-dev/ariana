#!/bin/bash

# This script fixes the route ordering issue in index.js
# Specific routes must come before parametric routes

echo "Fixing route order in index.js..."

# Create a temporary file
cat > route-fix.sed << 'EOF'
# Move /api/backlog/stats before /api/backlog/:id
/app.get("\/api\/backlog\/stats"/,/^});/{
  w stats_route.tmp
  d
}

# Move /api/backlog/repository before /api/backlog/:id  
/app.get("\/api\/backlog\/repository"/,/^});/{
  w repo_route.tmp
  d
}

# When we find /api/backlog/:id, insert the saved routes before it
/app.get("\/api\/backlog\/:id"/{
  r stats_route.tmp
  r repo_route.tmp
}
EOF

# Apply the sed script
sed -i.backup-route-order -f route-fix.sed index.js

# Clean up temporary files
rm -f route-fix.sed stats_route.tmp repo_route.tmp

echo "Route order fixed!"