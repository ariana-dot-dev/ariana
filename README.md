<div align="center">
  
# 🎩 Ariana IDE

*The IDE that thinks with you*

<img src="assets/screenshot.jpg" width="800" alt="Ariana IDE - Where code meets intelligence" />

[![Discord](https://img.shields.io/discord/1312017605955162133?style=for-the-badge&color=7289da&label=Discord&logo=discord&logoColor=ffffff)](https://discord.gg/Y3TFTmE89g)
[![X Follow](https://img.shields.io/badge/Follow-@anic_dev-black?style=for-the-badge&logo=x&logoColor=white)](https://twitter.com/anic_dev)
[![License](https://img.shields.io/badge/License-AGPL%20v3-blue?style=for-the-badge)](LICENSE)

---

**🚀 Status:** *In active development - Coming soon!*

</div>

## ✨ What is Ariana IDE?

Ariana IDE is a **next-generation development environment** that combines the power of AI with intuitive visual coding. Built with modern technologies and designed for developers who want to think differently about code.

### 🌟 Key Features

- 🧠 **AI-Powered Assistance** - Multiple LLM providers (Anthropic, OpenAI, Google, Groq, OpenRouter)
- 🎨 **Visual Canvas Interface** - Think visually, code efficiently
- ⚡ **TypeScript Scripting Engine** - Extensible and powerful automation
- 🖥️ **Integrated Terminal** - Built-in terminal with smart features  
- 📱 **Cross-Platform** - Desktop app with mobile companion
- 🔧 **Environment Management** - Automated setup with [mise](https://mise.jdx.dev/)

### 🏗️ Architecture

| Component | Technology Stack |
|-----------|------------------|
| **Backend** | Rust + Actix Web + SQLite |
| **Desktop** | Tauri + React + Vite |
| **CLI** | Node.js with email auth |
| **Mobile** | Swift (iOS) |

---

## 📚 Documentation

<div align="center">

| Document | Description |
|----------|-------------|
| [📋 **ROADMAP**](docs/ROADMAP.md) | Project vision and architecture |
| [⚙️ **DEV GUIDE**](docs/DEV_GUIDE.md) | Development environment setup |
| [🔨 **BUILD**](docs/BUILD.md) | Building and packaging guide |

</div>

## 🚀 Quick Start

> **Note:** Ariana IDE is currently in active development. These instructions are for contributors and early testers.

### Prerequisites

<div align="center">

| Requirement | Version | Purpose |
|-------------|---------|---------|
| **Node.js** | `>= 24.2.0` | Frontend & CLI |
| **Rust** | `latest` | Backend server |
| **Just** | `latest` | Task runner |

</div>

**🔧 NVM Users:** Set Node.js 24 as default:
```bash
nvm alias default 24
```

### ⚡ One-Command Setup

```bash
# Install Just task runner
npm install -g just

# Start the full development environment
just dev-all
```

### 🧪 Development Commands

```bash
# Backend server (Terminal 1)
just dev-backend

# Frontend app (Terminal 2) 
just dev-frontend

# CLI interface (Terminal 3)
just dev-cli
```

### 📦 Building for Production

```bash
# Build with configuration
just build example-configs/ariana-beta.json

# Install locally
cd dist && npm install -g .
```

### 🎯 Platform-Specific Builds

| Platform | Command |
|----------|---------|
| **Linux** | `cd frontend && npm run build:linux` |
| **macOS** | `cd frontend && npm run build:macos` |
| **Windows** | `cd frontend && npm run build:windows` |

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

- 🐛 **Report bugs** via [GitHub Issues](https://github.com/your-org/ariana-ide/issues)
- 💡 **Suggest features** on our [Discord](https://discord.gg/Y3TFTmE89g)
- 📖 **Improve docs** by submitting PRs
- 🧪 **Test early builds** and provide feedback

### Development Workflow

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/your-username/ariana-ide`
3. **Install** dependencies: `just setup`
4. **Create** a feature branch: `git checkout -b feature/amazing-feature`
5. **Make** your changes and test thoroughly
6. **Submit** a pull request

---

## 📊 Project Status

<div align="center">

### Current Focus Areas

| Feature | Status | Progress |
|---------|--------|----------|
| 🧠 **LLM Integration** | ✅ **Complete** | Multi-provider support |
| 🎨 **Canvas Interface** | 🚧 **In Progress** | Auto-layout system |
| 🖥️ **Terminal UI** | ⚠️ **Beta** | Working but buggy |
| 🔧 **Environment Setup** | 📋 **Planned** | Integration with mise |
| ✏️ **Text Editor** | 📋 **Planned** | Core editing features |

### Milestones

- **v0.1.0** - Core IDE functionality
- **v0.2.0** - AI assistant integration
- **v0.3.0** - Mobile companion app
- **v1.0.0** - Public release

</div>

---

## 💬 Community

<div align="center">

**Join our growing community of developers!**

[![Discord Banner](https://discord.com/api/guilds/1312017605955162133/widget.png?style=banner2)](https://discord.gg/Y3TFTmE89g)

</div>

- 💬 **Discord**: Real-time discussions and support
- 🐦 **X/Twitter**: Updates and announcements [@anic_dev](https://twitter.com/anic_dev)
- 📧 **Email**: Direct feedback and collaboration

---

## 📄 License

**GNU Affero General Public License v3.0**

This project is open-source and welcomes contributions from the community. See [LICENSE](LICENSE) for full terms.

---

<div align="center">

**Built with ❤️ by the Ariana IDE team**

*The future of coding is here. Are you ready?*

</div>
