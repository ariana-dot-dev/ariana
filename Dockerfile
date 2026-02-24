# Stage 1: Build the frontend
FROM node:20-slim AS frontend-build
WORKDIR /frontend

# Accept build arg for Vite mode (defaults to production)
ARG VITE_MODE=production

# Install Node.js dependencies
COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps

# Copy frontend source (Tauri parts excluded via .dockerignore)
COPY frontend/ ./

# Copy backend shared types and agents-server types for frontend imports
COPY backend/shared /backend/shared
COPY backend/agents-server/src/types /backend/agents-server/src/types

# Build the Vite app for web (no Tauri)
# Skip TypeScript checks - use Vite only
RUN npx vite build --mode ${VITE_MODE}

# Stage 2: Build the dashboard
FROM node:20-slim AS dashboard-build
WORKDIR /dashboard

# Accept build arg for Vite mode (defaults to production)
ARG VITE_MODE=production

# Install Node.js dependencies
COPY dashboard/package*.json ./
RUN npm install

# Copy dashboard source
COPY dashboard/ ./

# Build the dashboard Vite app
RUN npx vite build --mode ${VITE_MODE}

# Stage 3: Build the backend application
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# Install system dependencies needed by the backend
RUN apt-get update && apt-get install -y \
    # Basic system tools
    curl \
    wget \
    ca-certificates \
    # Git for repository operations
    git \
    # Archive tools for zip handling
    zip \
    unzip \
    tar \
    # SSH client for Hetzner deployments
    openssh-client \
    # Build tools for native modules (better-sqlite3)
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install hcloud CLI directly
RUN wget -q -O - https://github.com/hetznercloud/cli/releases/latest/download/hcloud-linux-amd64.tar.gz | tar xz && \
    mv hcloud /usr/local/bin/ && \
    chmod +x /usr/local/bin/hcloud

# Install Packer for Hetzner image building
RUN PACKER_VERSION="1.14.1" && \
    wget -q -O /tmp/packer.zip "https://releases.hashicorp.com/packer/${PACKER_VERSION}/packer_${PACKER_VERSION}_linux_amd64.zip" && \
    unzip /tmp/packer.zip -d /usr/local/bin/ && \
    chmod +x /usr/local/bin/packer && \
    rm /tmp/packer.zip

# Install dependencies
FROM base AS install
RUN mkdir -p /tmp/build
COPY backend/package.json backend/bun.lock* /tmp/build/
RUN cd /tmp/build && bun install # --frozen-lockfile

# Final stage
FROM base AS release
WORKDIR /usr/src/app

# Create non-root user with proper home directory first
RUN addgroup --system --gid 1001 bunjs && \
    adduser --system --uid 1001 --home /home/bunjs bunjs && \
    mkdir -p /home/bunjs/.ssh && \
    chown bunjs:bunjs /home/bunjs /home/bunjs/.ssh && \
    chmod 700 /home/bunjs/.ssh

# Create directories for logs, generated files, and agent temporary files with proper ownership
# /tmp/ide2-agents is used by both ClaudeAgentService and for temp files
RUN mkdir -p logs generated /tmp/ide2-agents && \
    chown bunjs:bunjs logs generated /tmp/ide2-agents

# Copy node_modules from install stage with proper ownership
COPY --from=install --chown=bunjs:bunjs /tmp/build/node_modules node_modules

# Copy application code with proper ownership
COPY --chown=bunjs:bunjs backend/package.json backend/bun.lock* backend/tsconfig.json ./
COPY --chown=bunjs:bunjs backend/index.ts backend/cluster.ts ./
COPY --chown=bunjs:bunjs backend/src ./src
COPY --chown=bunjs:bunjs backend/prisma ./prisma
COPY --chown=bunjs:bunjs backend/shared ./shared
COPY --chown=bunjs:bunjs backend/agents-server ./agents-server
COPY --chown=bunjs:bunjs backend/scripts ./scripts
COPY --chown=bunjs:bunjs backend/static ./static

# Copy built frontend from frontend-build stage
COPY --from=frontend-build --chown=bunjs:bunjs /frontend/dist ./static/app

# Copy built dashboard from dashboard-build stage
COPY --from=dashboard-build --chown=bunjs:bunjs /dashboard/dist ./static/dashboard

# Copy .env file if it exists with proper ownership
COPY --chown=bunjs:bunjs backend/.env* ./

# Switch to non-root user
USER bunjs

# Environment variables (runtime will set NODE_ENV via .env)
ENV HOME=/home/bunjs

CMD ["sh", "-c", "bunx prisma generate && bunx prisma migrate deploy && bun run start"]

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000