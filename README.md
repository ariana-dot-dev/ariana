<div align="center">

# 🚀 Ariana IDE

*The next-generation intelligent development environment*

<img src="assets/screenshot.jpg" width="900" alt="Ariana IDE in action" />

[![Discord](https://img.shields.io/discord/1312017605955162133?style=for-the-badge&color=7289da&label=Discord&logo=discord&logoColor=ffffff)](https://discord.gg/Y3TFTmE89g)
[![Follow on X](https://img.shields.io/badge/Follow-@anic_dev-black?style=for-the-badge&logo=x&logoColor=white)](https://twitter.com/anic_dev)
[![License](https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge)](LICENSE)

---

**✨ An AI-powered IDE that understands your code, your workflow, and your goals**

</div>

## 🌟 Features

- **🤖 AI-Powered Development** - Intelligent code completion and analysis
- **🎨 Modern Canvas Interface** - Intuitive visual development environment  
- **🔧 Multi-Platform Support** - Desktop, iOS, and web platforms
- **🌐 Real-time Collaboration** - Work together seamlessly
- **📊 Integrated Task Management** - Built-in project planning and tracking
- **🚀 Live Development Server** - Instant feedback and hot reloading

## 📚 Documentation

| Guide | Description |
|-------|-------------|
| [🗺️ **ROADMAP**](docs/ROADMAP.md) | Project vision and architecture |
| [⚙️ **DEV GUIDE**](docs/DEV_GUIDE.md) | Development environment setup |
| [🔨 **BUILD**](docs/BUILD.md) | Building and packaging guide |

## ⚡ Status

> 🚧 **Early Development** - Ariana IDE is actively being built. Star and watch for updates!

## 🚀 Quick Start

### 📋 Prerequisites

```bash
# Required versions
Node.js >= 24.2.0
Rust (latest stable)
```

> **💡 NVM Users**: Set Node.js 24 as default: `nvm alias default 24`

### 🛠️ Development Setup

```bash
# 1. Install Just task runner
npm install -g just

# 2. Start the development environment
just dev-backend    # Terminal 1: Backend server
just dev-frontend   # Terminal 2: Frontend dev server  
just dev-cli        # Terminal 3: CLI interface
```

### 📦 Building for Production

```bash
# Build with configuration
just build example-configs/ariana-beta.json

# Install globally
cd dist && npm install -g .
```

## 🏗️ Architecture

```
┌─────────────────┬─────────────────┬─────────────────┐
│   Frontend      │   Backend       │   Mobile        │
│   (Tauri/React) │   (Node.js)     │   (Swift/iOS)   │
├─────────────────┼─────────────────┼─────────────────┤
│ • Canvas UI     │ • Database      │ • Native UI     │
│ • Terminal      │ • Git Service   │ • Voice Input   │
│ • Agent Mgmt    │ • Task API      │ • Cloud Sync    │
└─────────────────┴─────────────────┴─────────────────┘
```

## 🤝 Contributing

We welcome contributions! Check out our [Development Guide](docs/DEV_GUIDE.md) to get started.

## 📄 License

This project is licensed under the **GNU Affero General Public License v3.0** - see [LICENSE](LICENSE) for details.
