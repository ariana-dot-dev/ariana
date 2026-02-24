#!/bin/bash
set -e

SNAPSHOT_DIR=".dev-snapshot"

if [ ! -d "$SNAPSHOT_DIR" ]; then
  exit 0
fi

echo "Restoring dev snapshot..."

# Database
if [ -f "$SNAPSHOT_DIR/db.sql" ]; then
  PG_CONTAINER=$(docker ps --filter "ancestor=postgres" --format "{{.Names}}" | head -1)
  if [ -n "$PG_CONTAINER" ]; then
    echo "Restoring database to $PG_CONTAINER..."
    docker exec -i "$PG_CONTAINER" psql -U postgres -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>/dev/null || true
    docker exec -i "$PG_CONTAINER" psql -U postgres postgres < "$SNAPSHOT_DIR/db.sql" 2>/dev/null
    echo "Database restored"
  fi
fi

# Tauri store
if [ -d "$SNAPSHOT_DIR/tauri-store" ]; then
  if [[ -d "/mnt/c/Users" ]]; then
    WIN_USER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')
    TAURI_STORE="/mnt/c/Users/$WIN_USER/AppData/Roaming/com.ariana.ide.dev"
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    TAURI_STORE="$HOME/Library/Application Support/com.ariana.ide.dev"
  else
    TAURI_STORE="$HOME/.local/share/com.ariana.ide.dev"
  fi
  echo "Restoring Tauri store to $TAURI_STORE..."
  rm -rf "$TAURI_STORE"
  cp -r "$SNAPSHOT_DIR/tauri-store" "$TAURI_STORE"
  echo "Tauri store restored"
fi

echo "Done"
