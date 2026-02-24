# Agents Server Scripts

This directory contains scripts for managing Hetzner cloud machines that run the agents-server.

## Prerequisites

1. **Hetzner Cloud Account**: You need a Hetzner Cloud account and API token
2. **hcloud CLI**: Install the Hetzner Cloud CLI tool
3. **Packer**: Install HashiCorp Packer for building machine images
4. **SSH Keys**: You need SSH keys configured for accessing machines

## Configuration (.env file)

Create a `.env` file in the `agents-server/` directory (NOT in the scripts/ directory) with:

```bash
# Required for all operations
HCLOUD_TOKEN=your_hetzner_api_token
MACHINE_CREATOR_ID=... # put something unique to you there, for instance name-lastname

# SSH keys for machine access
SSH_PUBLIC_KEY="ssh-ed25519 AAAA... your@email"
SSH_PRIVATE_KEY="-----BEGIN OPENSSH PRIVATE KEY-----
...your private key content...
-----END OPENSSH PRIVATE KEY-----"

# After building the image, add:
SNAPSHOT_ID=12345678 # this is not a real one, ask team about last snapshot ID or build it yourself
```

## Building the Image

The base image contains all dependencies (all dev tools, GNOME desktop, Google Chrome, moonlight-web binaries, etc.).

```bash
./scripts/build-base.sh
```

This runs Packer with `base-image.pkr.hcl`, which:
1. Runs `install-all-deps.sh` on a fresh Ubuntu 24.04 machine
2. Copies the `moonlight-fork` source and builds it (streamer + web-server + frontend)
3. Creates a snapshot

Takes ~30-45 minutes but only needs to be done once or when dependencies change.

After completion, add the displayed `SNAPSHOT_ID` to your `.env` file.

## Scripts

| Script | Purpose |
|--------|---------|
| `build-base.sh` | Build base machine image via Packer |
| `install-all-deps.sh` | Install all dependencies (run by Packer) |
| `delete-all.sh` | Delete all your agents-server machines |
| `utilities/create.sh` | Create a new machine from snapshot |
| `utilities/delete-machine.sh` | Delete a specific machine |
| `utilities/ensure-ssh-key.sh` | Ensure SSH key exists in Hetzner |
| `utilities/get-creator-id.sh` | Get unique creator ID for machine naming |

## How It Works

1. **Creator ID**: Each developer has a unique creator ID (based on git config) that prefixes all their machines
2. **Machine Naming**: Machines are named `agents-server-{creator-id}-{timestamp}-{random}`
3. **SSH Access**: Machines are accessed using the SSH keys from your `.env` file
4. **Machine provisioning**: `machineSDK.ts` handles all machine setup (coturn, moonlight-web config, streaming services) via SSH after `create.sh` spawns the machine

## When to Rebuild the Image

Rebuild the image when:
- Upgrading Node.js, Bun, or other system dependencies
- Changing moonlight-fork source code (streamer, web-server, frontend)
- Adding new system packages
- Changing `install-all-deps.sh`

## Troubleshooting

### SSH Key Issues
- Ensure `SSH_PUBLIC_KEY` and `SSH_PRIVATE_KEY` are set in `.env`
- Keys must be in the correct format (ed25519 preferred)
- The private key needs proper line breaks

### Build Failures
- Check `HCLOUD_TOKEN` is valid
- Ensure you have sufficient Hetzner Cloud quota
- Verify network connectivity to Hetzner API

### Machine Creation Issues
- Run `hcloud server list` to see all machines
- Check Hetzner Cloud console for error messages
- Ensure the snapshot ID in `.env` is correct
