#!/bin/bash
set -e

CHANNEL=""
BUMP_TYPE="patch"

while [[ $# -gt 0 ]]; do
  case $1 in
    -c|--channel) CHANNEL="$2"; shift 2 ;;
    major|minor|patch) BUMP_TYPE="$1"; shift ;;
    *) shift ;;
  esac
done

get_latest_prod_version() {
  git fetch --tags -q 2>/dev/null || true
  git tag -l "agent-server-v*" | grep -E "^agent-server-v[0-9]+\.[0-9]+\.[0-9]+$" | sort -V | tail -n1 | sed 's/agent-server-v//' || echo "0.0.0"
}

increment_version() {
  local version="$1" part="$2"
  IFS='.' read -r major minor patch <<< "$version"
  case "$part" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "$major.$((minor + 1)).0" ;;
    *) echo "$major.$minor.$((patch + 1))" ;;
  esac
}

LATEST=$(get_latest_prod_version)

if [ -n "$CHANNEL" ]; then
  LAST_NUM=$(git tag -l "agent-server-v${LATEST}-${CHANNEL}*" | grep -oE "${CHANNEL}[0-9]+" | sed "s/${CHANNEL}//" | sort -n | tail -n1 || echo "0")
  NUM=$((${LAST_NUM:-0} + 1))
  TAG="agent-server-v${LATEST}-${CHANNEL}${NUM}"
  echo "Dev release: $TAG"
else
  VERSION=$(increment_version "$LATEST" "$BUMP_TYPE")
  TAG="agent-server-v${VERSION}"
  echo "Prod release: $TAG (was: $LATEST)"
fi

git tag "$TAG"
git push origin "$TAG"

echo "Done: $TAG"
echo "https://github.com/ariana-dot-dev/ariana-ide-private/actions"
