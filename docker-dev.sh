#!/bin/bash
set -e

SNAPSHOT_DIR=".dev-snapshot"
HAS_SNAPSHOT=false
[ -f "$SNAPSHOT_DIR/db.sql" ] && HAS_SNAPSHOT=true

CONTAINER_NAME="ide2-backend"
IMAGE_NAME="ide2-backend:v1"

if [[ "$OSTYPE" == "darwin"* ]]; then
    FRONTEND_HOST="host.docker.internal"
elif command -v ip &> /dev/null; then
    FRONTEND_HOST=$(ip route show | grep -i default | awk '{ print $3}')
else
    FRONTEND_HOST="localhost"
fi

# Start tunnel
source ./dev-tunnel.sh

cleanup() {
    echo "Cleaning up tunnel..."
    [ -n "$TUNNEL_PID" ] && kill $TUNNEL_PID 2>/dev/null || true
}
trap cleanup EXIT

docker build --build-arg VITE_MODE=development -t $IMAGE_NAME .

if [ "$(docker ps -aq -f name=$CONTAINER_NAME)" ]; then
    docker stop $CONTAINER_NAME 2>/dev/null || true
    docker rm $CONTAINER_NAME 2>/dev/null || true
fi

# Restore from snapshot if exists
if [ "$HAS_SNAPSHOT" = true ]; then
    echo "Restoring from snapshot..."
    ./dev-snapshot-restore.sh
    PRISMA_CMD="bunx prisma migrate dev --skip-seed"
else
    PRISMA_CMD="bunx prisma migrate reset --force"
fi

docker run -it --rm \
  --network bridge \
  --name $CONTAINER_NAME \
  -e NODE_ENV=development \
  -e DATABASE_URL="postgresql://postgres:password@host.docker.internal:5432/postgres" \
  -e VITE_DEV_SERVER=http://${FRONTEND_HOST}:1420 \
  -e API_URL=$TUNNEL_URL \
  -p 3000:3000 \
  --workdir /usr/src/app \
  $IMAGE_NAME \
  bash -c "$PRISMA_CMD && bun run start"
