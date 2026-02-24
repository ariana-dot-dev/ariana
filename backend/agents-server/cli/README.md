# Ariana CLI

Command-line interface for managing the Ariana Agent Server.

## Development

### Building

Build the CLI for all platforms:

```bash
cd ..
./scripts/build-cli.sh
```

This creates binaries in `../dist-cli/`:
- `ariana-cli-linux-x64`
- `ariana-cli-linux-arm64`
- `ariana-cli-darwin-x64`
- `ariana-cli-darwin-arm64`

### Testing Locally

Run the CLI directly with Bun:

```bash
bun run cli.ts help
bun run cli.ts version
```

Or build and test a single platform:

```bash
bun build cli.ts --compile --outfile ariana
./ariana help
```

## Installation

### From GitHub Release

```bash
curl -fsSL https://cli.ariana.dev | sudo bash
```

### Manual Installation

1. Download the binary for your platform from [releases](https://github.com/ariana-dot-dev/agent-server/releases)
2. Make it executable: `chmod +x ariana-cli-*`
3. Move to PATH: `sudo mv ariana-cli-* /usr/local/bin/ariana`

## Usage

```bash
# Install and start agent server (first time)
ariana start --token <YOUR_TOKEN>

# Manage service
sudo ariana start
sudo ariana stop
sudo ariana restart

# Monitor
ariana health
ariana status
ariana logs -n 50
ariana follow-logs

# Help
ariana help
ariana version
```

## Commands

See the [CLI Reference documentation](../../../public-docs/agent-server/cli-reference.mdx) for complete command documentation.

## Release Process

The CLI is automatically built and released as part of the agent server release:

1. Create a new tag: `git tag agents-server-v1.0.0`
2. Push the tag: `git push origin agents-server-v1.0.0`
3. GitHub Actions builds and releases both agent server and CLI binaries

See [.github/workflows/release-agents-server.yml](../../../.github/workflows/release-agents-server.yml) for the release workflow.

## Architecture

- **Language**: TypeScript
- **Runtime**: Bun (compiled to standalone binary)
- **Platforms**: Linux (x64, ARM64), macOS (x64, ARM64)
- **Installation**: `/usr/local/bin/ariana`
- **Service Management**: systemd (Linux), launchd (macOS)

## Files

- `cli.ts` - Main CLI implementation
- `package.json` - Package metadata and scripts
- `install-cli.sh` - Installation script (hosted at cli.ariana.dev)
- `README.md` - This file
