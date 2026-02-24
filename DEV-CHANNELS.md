# Agent Server Dev Channels

## Release

```bash
./release-agent-server.sh              # prod (patch bump)
./release-agent-server.sh minor        # prod (minor bump)
./release-agent-server.sh -c john      # dev channel "john"
```

Dev tags: `agent-server-v0.0.35-john1`, `agent-server-v0.0.35-john2`, etc.

## Use Dev Version

Set in backend `.env`:
```bash
AGENTS_SERVER_CHANNEL=john
```

Restart backend. New Hetzner machines auto-fetch latest `john` release.

## Promote to Prod

```bash
./release-agent-server.sh
```

Remove `AGENTS_SERVER_CHANNEL` from `.env`.

## Summary

| Action | Command |
|--------|---------|
| Release dev | `./release-agent-server.sh -c john` |
| Use dev | `AGENTS_SERVER_CHANNEL=john` in .env |
| Release prod | `./release-agent-server.sh` |
| Use prod | remove AGENTS_SERVER_CHANNEL |
