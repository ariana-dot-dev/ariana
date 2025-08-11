<p align="center">
  <h1 align="center">Ariana IDE</h1>
  <img src="assets/screenshot.jpg" width="1024" alt="Ariana IDE screenshot" />
  <br />
  <p align="center"><i>A next-generation AI-powered integrated development environment</i></p>
  <div align="center">
    <a href="https://discord.gg/Y3TFTmE89g"><img src="https://img.shields.io/discord/1312017605955162133?style=for-the-badge&color=7289da&label=Discord&logo=discord&logoColor=ffffff&size=10" alt="Join our Discord" /></a>
    <a href="https://twitter.com/anic_dev"><img src="https://img.shields.io/badge/Follow-@anic_dev-black?style=for-the-badge&logo=x&logoColor=white&size=10" alt="Follow us on X" /></a>
  </div>
</p>

## About Ariana IDE

Ariana IDE is a modern development environment that reimagines how developers interact with code through AI-powered assistance and innovative UI paradigms. Built with cutting-edge technologies, it provides a seamless development experience across desktop and mobile platforms.

### Key Features

- **AI-Powered Development**: Integrated LLM support for multiple providers (Anthropic, OpenAI, Google, Groq, OpenRouter)
- **Cross-Platform**: Desktop application built with Tauri and React, with iOS mobile support
- **Modern Terminal Integration**: Custom terminal with advanced rendering and controls
- **Canvas-Based UI**: Innovative canvas system for flexible workspace organization
- **Git Integration**: Deep Git repository management and workflow automation
- **Task Management**: Built-in backlog and task tracking system
- **TypeScript Scripting Engine**: Extensible through custom scripts
- **Real-time Collaboration**: Database-backed project synchronization

## Documentation

For detailed information, see the documentation in the `docs/` folder:

- [📋 **ROADMAP.md**](docs/ROADMAP.md) - Project roadmap and architecture
- [⚙️ **DEV_GUIDE.md**](docs/DEV_GUIDE.md) - Development environment setup
- [🔨 **BUILD.md**](docs/BUILD.md) - Building and packaging guide

## Installation

> **Note**: Ariana IDE is currently in active development. Full release coming soon!

### For Early Adopters

While we're still in development, you can explore the codebase and contribute to the project. See the [Development Setup](#development-setup) section below.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** >= 24.2.0 ([Download](https://nodejs.org/))
- **Rust** (latest stable) ([Install](https://rustup.rs/))
- **Just** (command runner) - Install via: `npm install -g just`

### Platform-Specific Requirements

**macOS:**
- Xcode Command Line Tools
- macOS 10.15 or later

**Linux:**
- Development libraries: `sudo apt-get install libgtk-3-dev libwebkit2gtk-4.0-dev libssl-dev`
- GCC or Clang

**Windows:**
- Visual Studio 2019 or later with C++ tools
- Windows 10 or later

### Node Version Management

If using **nvm**, set Node.js 24 as default:
```bash
nvm install 24
nvm alias default 24
nvm use 24
```

## Development Setup

### 1. Clone and Setup

```bash
# Clone the repository
git clone https://github.com/your-org/ariana-ide.git
cd ariana-ide

# Install dependencies
npm install
```

### 2. Configure Environment

Create a `.env` file in the backend directory:
```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your configuration
```

### 3. Start Development Servers

Open three terminal windows and run:

```bash
# Terminal 1: Start backend server
just dev-backend

# Terminal 2: Start frontend application
just dev-frontend

# Terminal 3: Start CLI with authentication
just dev-cli
```

The IDE will be available at:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8080`

## Building from Source

### Quick Build

```bash
# Build with default configuration
just build

# Build with custom configuration
just build example-configs/ariana-beta.json
```

### Platform-Specific Builds

```bash
# Linux
npm run build:linux

# macOS
npm run build:macos

# Windows
npm run build:windows

# All platforms
npm run build:all
```

### Local Installation

After building:
```bash
cd dist
npm install -g .

# Run the IDE
ariana-ide
```

## Project Structure

```
ariana-ide/
├── frontend/          # CLI and Tauri desktop application
│   ├── src/          # CLI source code
│   └── tauri-app/    # Desktop application (React + Vite)
├── db-server/        # Database server and API endpoints
├── ios-ide/          # iOS mobile application
├── docs/             # Project documentation
└── example-configs/  # Configuration examples
```

## Contributing

We welcome contributions from the community! Here's how you can help:

### How to Contribute

1. **Fork the Repository**: Create your own fork of the project
2. **Create a Feature Branch**: `git checkout -b feature/amazing-feature`
3. **Commit Your Changes**: `git commit -m 'Add amazing feature'`
4. **Push to Branch**: `git push origin feature/amazing-feature`
5. **Open a Pull Request**: Submit a PR with a clear description

### Development Guidelines

- Follow the existing code style and conventions
- Write clear, descriptive commit messages
- Add tests for new features when applicable
- Update documentation as needed
- Ensure all tests pass before submitting PR

### Reporting Issues

Found a bug or have a feature request? Please open an issue on GitHub with:
- Clear description of the problem or feature
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- System information (OS, Node version, etc.)

## Community & Support

### Get Help

- 💬 [Join our Discord](https://discord.gg/Y3TFTmE89g) - Chat with the community
- 🐦 [Follow on X](https://twitter.com/anic_dev) - Get updates and announcements
- 📖 Check the [Documentation](docs/) - Detailed guides and references
- 🐛 [GitHub Issues](https://github.com/your-org/ariana-ide/issues) - Report bugs or request features

### Resources

- [Roadmap](docs/ROADMAP.md) - See what's planned
- [Development Guide](docs/DEV_GUIDE.md) - Set up your dev environment
- [Build Guide](docs/BUILD.md) - Learn about the build process

## License

This project is licensed under the GNU Affero General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

Built with:
- [Tauri](https://tauri.app/) - Desktop application framework
- [React](https://reactjs.org/) - UI library
- [Rust](https://www.rust-lang.org/) - Backend development
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript

---

<p align="center">
  Made with ❤️ by the Ariana IDE Team
</p>
