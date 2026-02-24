#!/bin/bash

# Make all shell scripts in the repository executable

echo "Finding and making all .sh scripts executable..."

# Find all .sh files excluding node_modules and build artifacts
find . -type f -name "*.sh" \
  -not -path "*/node_modules/*" \
  -not -path "*/target/*" \
  -not -path "*/.git/*" \
  -exec chmod +x {} \; \
  -exec echo "Made executable: {}" \;

echo "Done! All scripts are now executable."
