<div align="center">

# 🚀 Ariana IDE

*The IDE of the future, built for developers who demand excellence*

<img src="assets/screenshot.jpg" width="900" alt="Ariana IDE - Modern Development Environment" style="border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);" />

---

[![Discord](https://img.shields.io/discord/1312017605955162133?style=for-the-badge&color=5865F2&label=Discord&logo=discord&logoColor=white)](https://discord.gg/Y3TFTmE89g)
[![Twitter Follow](https://img.shields.io/badge/Follow-@anic_dev-1DA1F2?style=for-the-badge&logo=x&logoColor=white)](https://twitter.com/anic_dev)
[![License](https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-green?style=for-the-badge&logo=node.js)](https://nodejs.org/)

</div>

## ✨ What Makes Ariana Special

**Ariana IDE** isn't just another code editor — it's a complete development ecosystem designed for the modern developer. Built with cutting-edge technology and an obsession for developer experience.

### 🎯 Key Features

- **🔥 Lightning Fast** - Built with Rust and TypeScript for maximum performance
- **🎨 Beautiful UI** - Modern, clean interface that adapts to your workflow  
- **🔧 Tauri-Powered** - Native desktop performance with web technology flexibility
- **⚡ Hot Reload** - Instant feedback loop for rapid development
- **🌐 Cross-Platform** - Linux, macOS, and Windows support out of the box
- **🧠 Smart Intelligence** - Advanced code completion and AI-powered features

### 🛠️ Tech Stack

- **Frontend**: TypeScript, Tauri
- **Backend**: Rust, Node.js
- **Database**: Custom DB server
- **Build System**: Just, Biome, SWC

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
