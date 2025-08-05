<p align="center">
  <h1 align="center">Ariana IDE</h1>
  <img src="assets/screenshot.jpg" width="1024" alt="Ariana IDE screenshot" />
  <br />
  <p align="center"><i>The IDE of the future.</i></p>
  <div align="center">
    <a href="https://discord.gg/Y3TFTmE89g"><img src="https://img.shields.io/discord/1312017605955162133?style=for-the-badge&color=7289da&label=Discord&logo=discord&logoColor=ffffff&size=10" alt="Join our Discord" /></a>
    <a href="https://twitter.com/anic_dev"><img src="https://img.shields.io/badge/Follow-@anic_dev-black?style=for-the-badge&logo=x&logoColor=white&size=10" alt="Follow us on X" /></a>
  </div>
</p>

## Features

- **Multi-language IDE** - Built on modern web technologies with Tauri
- **AI-Powered Development** - Integrated LLM support for code assistance
- **Configurable Builds** - Create custom branded versions with different configurations
- **Cross-Platform** - Works on Windows, macOS, and Linux
- **Extensible Architecture** - Plugin system and customizable UI

## Documentation

### 📚 Core Documentation
- [**Architecture Overview**](docs/ARCHITECTURE.md) - System design and components
- [**API Reference**](docs/API.md) - Complete API documentation
- [**Development Guide**](docs/DEV_GUIDE.md) - Setting up your development environment
- [**Build Guide**](docs/BUILD.md) - Building and packaging for distribution

### 🔧 Additional Resources
- [**Roadmap**](docs/ROADMAP.md) - Project roadmap and future plans
- [**Configuration Guide**](docs/CONFIGURATION.md) - Detailed configuration options
- [**Troubleshooting**](docs/TROUBLESHOOTING.md) - Common issues and solutions

## Installation

> **Note**: Ariana IDE is currently in active development. Production builds coming soon!

### For Developers
See the [Quick Start](#quick-start) section below to run in development mode.

### System Requirements
- **OS**: Windows 10+, macOS 10.15+, or Linux (Ubuntu 20.04+)
- **Memory**: 4GB RAM minimum (8GB recommended)
- **Storage**: 500MB available space
- **Node.js**: v24.2.0 or higher
- **Rust**: Latest stable version

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

## Project Structure

```
ariana/
├── docs/                  # Documentation
├── frontend/              # Main application
│   ├── src/              # CLI source code
│   ├── tauri-app/        # Desktop app (Tauri + React)
│   └── package.json      # CLI package configuration
├── db-server/            # Database server component
├── ios-ide/              # iOS IDE components
│   └── mock-backend/     # Development API server
└── example-configs/      # Build configuration examples
```

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Workflow
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Community

- **Discord**: [Join our community](https://discord.gg/Y3TFTmE89g)
- **Twitter**: [Follow @anic_dev](https://twitter.com/anic_dev)
- **Issues**: [Report bugs or request features](https://github.com/yourusername/ariana/issues)

## License

GNU Affero General Public License v3.0 - see [LICENSE](LICENSE) for details.
