#!/bin/bash
set -e

SNAPSHOT_DIR=".dev-snapshot"
mkdir -p "$SNAPSHOT_DIR"

echo "Saving dev snapshot..."

# Find postgres container
PG_CONTAINER=$(docker ps --filter "ancestor=postgres" --format "{{.Names}}" | head -1)
if [ -z "$PG_CONTAINER" ]; then
  echo "No postgres container found"
  exit 1
fi

echo "Using postgres container: $PG_CONTAINER"
docker exec "$PG_CONTAINER" pg_dump -U postgres postgres > "$SNAPSHOT_DIR/db.sql"
echo "Database saved"

# Tauri store - detect platform
if [[ -d "/mnt/c/Users" ]]; then
  # WSL - Windows path
  WIN_USER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')
  TAURI_STORE="/mnt/c/Users/$WIN_USER/AppData/Roaming/com.ariana.ide.dev"
elif [[ "$OSTYPE" == "darwin"* ]]; then
  TAURI_STORE="$HOME/Library/Application Support/com.ariana.ide.dev"
else
  TAURI_STORE="$HOME/.local/share/com.ariana.ide.dev"
fi

echo "Looking for Tauri store at: $TAURI_STORE"
if [ -d "$TAURI_STORE" ]; then
  echo "Copying Tauri store..."
  rm -rf "$SNAPSHOT_DIR/tauri-store"
  cp -r "$TAURI_STORE" "$SNAPSHOT_DIR/tauri-store"
  echo "Tauri store saved"
else
  echo "No Tauri store found"
fi

echo "Done: $SNAPSHOT_DIR/"
ls -la "$SNAPSHOT_DIR/"
