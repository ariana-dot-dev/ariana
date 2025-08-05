<p align="center">
  <h1 align="center">Ariana IDE</h1>
  <img src="assets/screenshot.jpg" width="1024" alt="Ariana IDE screenshot" />
  <br />
  <p align="center"><i>An AI-powered development environment with visual canvas interface and multi-platform support</i></p>
  <div align="center">
    <a href="https://discord.gg/Y3TFTmE89g"><img src="https://img.shields.io/discord/1312017605955162133?style=for-the-badge&color=7289da&label=Discord&logo=discord&logoColor=ffffff&size=10" alt="Join our Discord" /></a>
    <a href="https://twitter.com/anic_dev"><img src="https://img.shields.io/badge/Follow-@anic_dev-black?style=for-the-badge&logo=x&logoColor=white&size=10" alt="Follow us on X" /></a>
  </div>
</p>

## Overview

Ariana IDE is a modern, AI-powered development environment that combines the power of traditional IDEs with innovative visual canvas interfaces and intelligent automation. Built with Rust backend, TypeScript frontend, and React/Tauri for cross-platform desktop applications.

### Key Features

- **Visual Canvas Interface**: Interactive development workspace with customizable layouts
- **AI-Powered Code Agent**: Integrated Claude and other LLM providers for intelligent code assistance
- **Multi-Platform Support**: Desktop (Windows, macOS, Linux), iOS mobile app, and CLI tools
- **Real-time Collaboration**: Shared project backlogs and task management
- **Terminal Integration**: Embedded terminal with custom commands and scripting
- **Git Integration**: Built-in version control with repository management

### Architecture

- **Backend**: Rust + Actix Web + SQLite with LLM API integration
- **Frontend**: React + TypeScript + Tauri for desktop applications
- **CLI**: Node.js with email-based authentication
- **Mobile**: Swift iOS application with FastAPI backend
- **Database**: PostgreSQL for production, SQLite for development

## Documentation

For detailed information, see the documentation in the `docs/` folder:

- [🏗️ **ARCHITECTURE.md**](docs/ARCHITECTURE.md) - System architecture and design decisions
- [📋 **ROADMAP.md**](docs/ROADMAP.md) - Project roadmap and planned features
- [⚙️ **DEV_GUIDE.md**](docs/DEV_GUIDE.md) - Development environment setup and tips
- [🔧 **BUILD.md**](docs/BUILD.md) - Building and packaging guide
- [🌐 **API.md**](docs/API.md) - REST API documentation and examples

## Installation

> **⚠️ Development Status**: Ariana IDE is currently in active development. Some features may be incomplete or unstable.

### Prerequisites

- Node.js (>= 24.2.0)
- Rust (latest stable)
- Git

### Quick Install

```bash
# Install from npm (when available)
npm install -g ariana-ide

# Or build from source
git clone https://github.com/your-org/ariana-ide.git
cd ariana-ide
just build example-configs/ariana-beta.json
cd dist && npm install -g .
```

## Quick Start

### Development Setup

1. **Install Just** (task runner):
   ```bash
   npm install -g just
   ```

2. **Start Backend** (first terminal):
   ```bash
   just dev-backend
   ```

3. **Start Frontend** (second terminal):
   ```bash
   # Option A: Direct Tauri app (no auth required)
   just dev-frontend
   
   # Option B: CLI with authentication
   just dev-cli
   ```

### Usage

```bash
# Launch Ariana IDE
ariana-ide

# Check status
ariana-ide status

# Login/logout
ariana-ide login
ariana-ide logout

# Configure backend URL
ariana-ide config --backend-url https://your-api.example.com
```

### Building for Distribution

```bash
# Build with custom configuration
just build example-configs/ariana-beta.json

# Platform-specific builds
just build-windows  # Windows
just build-macos    # macOS  
just build-linux    # Linux

# Install built package locally
cd dist && npm install -g .
```

## Project Structure

```
ariana-ide/
├── backend/              # Rust backend server (planned)
├── db-server/           # Database server and API endpoints
├── frontend/            # CLI and Tauri desktop application
│   ├── src/            # CLI source code
│   └── tauri-app/      # Desktop app (React + Tauri)
├── ios-ide/            # iOS mobile application
│   ├── ide-mobile/     # Swift iOS app
│   └── mock-backend/   # FastAPI backend for mobile
├── docs/               # Documentation
└── example-configs/    # Build configuration examples
```

## Contributing

We welcome contributions! Please read our comprehensive contributing guide:

- [📝 **CONTRIBUTING.md**](docs/CONTRIBUTING.md) - Complete contribution guide with workflows and standards
- [⚙️ **DEV_GUIDE.md**](docs/DEV_GUIDE.md) - Development environment setup and tips
- [🔧 **BUILD.md**](docs/BUILD.md) - Building and packaging instructions
- [📋 **ROADMAP.md**](docs/ROADMAP.md) - Project roadmap and planned features

### Quick Development Setup

```bash
# Install task runner
npm install -g just

# Start backend (terminal 1)
just dev-backend

# Start frontend (terminal 2)  
just dev-frontend

# Format code before committing
just format
```

## Troubleshooting

### Common Issues

**Build Failures:**
- Ensure Node.js >= 24.2.0 and Rust are installed
- Run `npm ci` in both `frontend/` and `frontend/tauri-app/` directories
- Check that all system dependencies are installed (see [DEV_GUIDE.md](docs/DEV_GUIDE.md))

**Runtime Issues:**
- Verify backend is running on correct port
- Check configuration files in `example-configs/`
- Ensure environment variables are set correctly

**Platform-Specific:**
- **Linux/WSL**: Install required system packages (see DEV_GUIDE.md)
- **macOS**: Ensure Xcode command line tools are installed
- **Windows**: Use PowerShell with execution policy enabled

### Getting Help

- Join our [Discord](https://discord.gg/Y3TFTmE89g) for community support
- Check existing [issues](https://github.com/your-org/ariana-ide/issues) or create a new one
- Follow [@anic_dev](https://twitter.com/anic_dev) for updates

## License

GNU Affero General Public License v3.0

---

*Ariana IDE - Building the future of AI-powered development environments*
