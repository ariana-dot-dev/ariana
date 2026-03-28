<h1 align="center">Ariana</h1>

<p align="center">
  Open-source agentic development platform powered by your Claude Code token or subscription.
</p>

https://github.com/user-attachments/assets/8ac5ad1e-678c-4187-b183-b5f4b416a1b9

Ariana was almost entirely built with Ariana.

We maintain it on a private repo and will occasionally drop progress here. Feel free to open PRs still.

## Try it

A cloud version is hosted at [ariana.dev](https://ariana.dev) — works on Desktop, Web, and Mobile Web.

## What is Ariana?

Ariana lets you spawn **parallel AI coding agents** that run on Hetzner VPS instances in the background. Each agent uses the Anthropic Claude Agent SDK and can:

- Edit code autonomously across your repositories
- Create branches, commit, and push to GitHub
- Set up dev environments and run your code
- Host services publicly with auto-generated HTTPS certificates
- Interact with desktop applications via computer use (gaming-grade streaming)
- Spawn and manage other agents

It's a self-hostable alternative to platforms like Cursor, Devin, or Ona — you bring your own Claude subscription.

## Features

- **Mobile-first**: ship on the go with the mobile web version
- **GitHub integration**: mention issues, auto branch creation/naming, auto-commit, auto-push (when a PR is open), and self-documentation
- **Automations**: run scripts when an agent starts, commits, or hits other lifecycle events
- **Public HTTPS**: agents run on VPSs with Docker support and auto-provisioned TLS certificates
- **Agent orchestration**: agents can spawn, manage, and communicate with other agents
- **Snapshots / forking**: fork disk state, Chrome login sessions, and conversation context across agents
- **Desktop streaming**: gaming-grade per-agent desktop streams via a Moonlight fork
- **Rich editor**: Markdown + Mermaid rendering, GitHub issue mentions, diff views (via [diffs.com](https://diffs.com))
- **Web previews**: test agent changes live in-browser or via desktop computer use

## Architecture

Ariana is a monorepo with three main components:

```
ariana/
├── backend/              # API server (Bun + Hono + Prisma + PostgreSQL)
│   ├── src/              # Routes, services, middleware
│   ├── agents-server/    # Per-agent control server (Claude Agent SDK)
│   ├── prisma/           # Schema & migrations
│   └── index.ts          # Entry point
├── frontend/             # React 18 + Vite + Tauri (web & desktop app)
├── dashboard/            # Analytics dashboard (React + Recharts)
├── moonlight-fork/       # Desktop streaming (forked from moonlight-stream)
└── public-docs/          # Mintlify documentation site
```

| Layer | Stack |
|---|---|
| Backend API | Bun, Hono, Prisma, PostgreSQL |
| Agent server | TypeScript, Anthropic Claude Agent SDK |
| Frontend | React 18, Vite, Tauri, Radix UI, Tailwind CSS, Zustand |
| Infrastructure | Hetzner VPS, Cloudflare R2 (snapshots) |
| Auth | GitHub OAuth + JWT |
| Payments | Stripe |

## Dev Installation

> **Note:** Self-hosting Ariana requires several third-party services (GitHub App, Stripe, Cloudflare R2, Hetzner, a cert gateway). The Docker Compose setup below gets the core services running locally, but a fully functional deployment needs the external services configured.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Bun](https://bun.sh) (for local development outside Docker)
- [Node.js](https://nodejs.org) 18+
- A GitHub App (for OAuth and repo access)

### 1. Clone and configure environment

```bash
git clone https://github.com/arianadev/ariana.git
cd ariana

cp backend/.env.example backend/.env
# Edit backend/.env — at minimum fill in:
#   GITHUB_APP_ID, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET
#   GITHUB_APP_PRIVATE_KEY
#   JWT_SECRET (any random string)
#   ADMIN_GITHUB_USERNAMES (your GitHub username)
```

### 2. Start core services (Docker Compose)

```bash
docker-compose up
```

This starts:
- **PostgreSQL** on port `5432`
- **Backend API** on port `3000` (with hot-reload via `--watch`)
- **Prisma Studio** on port `5555` (database browser)

The backend automatically runs `prisma migrate dev` on startup.

### 3. Start the frontend (separate terminal)

```bash
cd frontend
npm install
npm run dev        # Vite dev server on http://localhost:1420
```

The Docker Compose backend is pre-configured to proxy the Vite dev server at `http://host.docker.internal:1420`.

### 4. (Optional) Start the agents server locally

```bash
cd backend/agents-server
bun install
bun run start
```

### Environment variables

Key variables in `backend/.env`:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `GITHUB_APP_ID` / `CLIENT_ID` / `CLIENT_SECRET` | GitHub OAuth App credentials |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App RSA private key |
| `JWT_SECRET` | Secret for signing JWTs |
| `STRIPE_SECRET_KEY` | Stripe API key (optional for local dev) |
| `R2_*` | Cloudflare R2 credentials for snapshot storage |
| `SSH_PUBLIC_KEY` / `SSH_PRIVATE_KEY` | SSH keys for agent VPS access |
| `LUX_API_KEY` | Desktop computer-use API key |
| `AGENT_LIFETIME_UNIT_MINUTES` | How long each agent runs (default: `15`) |
| `CERT_GATEWAY_KEY` | Key for the HTTPS certificate gateway |

## Roadmap

We have a big V2 coming soon. Stay tuned.

- Join our Discord: [discord.com/invite/Y3TFTmE89g](https://discord.com/invite/Y3TFTmE89g)
- Follow on X: [@AniC_dev](https://x.com/AniC_dev)

## License

[AGPL-3.0](./LICENSE)
