<p align="center">
  <h1 align="center">yolo</h1>
  <img src="assets/screenshot.jpg" width="1024" alt="Ariana IDE screenshot" />
  <br />
  <p align="center"><i>The IDE of the future.</i></p>
  <div align="center">
    <a href="https://discord.gg/Y3TFTmE89g"><img src="https://img.shields.io/discord/1312017605955162133?style=for-the-badge&color=7289da&label=Discord&logo=discord&logoColor=ffffff&size=10" alt="Join our Discord" /></a>
    <a href="https://twitter.com/anic_dev"><img src="https://img.shields.io/badge/Follow-@anic_dev-black?style=for-the-badge&logo=x&logoColor=white&size=10" alt="Follow us on X" /></a>
  </div>
</p>

## Documentation

For detailed information, see the documentation in the `docs/` folder:

- [📋 **ROADMAP.md**](docs/ROADMAP.md) - Project roadmap and architecture
- [⚙️ **DEV_GUIDE.md**](docs/DEV_GUIDE.md) - Development environment setup
- [ **BUILD.md**](docs/BUILD.md) - Building and packaging guide

## Installation

Ariana IDE is not ready for usage yet. Come back in a few days/weeks!

## Quick Start

### Prerequisites

- Node.js (>= 24.2.0)
- Rust (latest)

**Note for nvm users:** If you use nvm to manage Node.js versions, you must set Node.js 24 as your default to ensure Ariana uses the correct version:

```bash
nvm alias default 24
```

### Install Just

```bash
# Install Just

npm install -g just
```

### Development
```bash
# Start backend
# Before first time: edit backend/.env
just dev-backend

# Start frontend (separate terminal)
just dev-frontend

# Start via CLI login (separate terminal)  
just dev-cli
```

### Building
```bash
# Build with custom config
just build example-configs/ariana-beta.json

# Install locally
cd dist && npm install -g .
```

## License

GNU Affero General Public License v3.0
