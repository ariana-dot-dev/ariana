<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=50&pause=1000&color=F77234&center=true&vCenter=true&width=600&lines=Ariana+IDE;The+IDE+of+the+Future;Code+Smarter%2C+Not+Harder" alt="Ariana IDE" />
  <br />
  <br />
  <img src="assets/screenshot.jpg" width="1024" alt="Ariana IDE screenshot" />
  <br />
  <br />
  <p align="center">
    <strong>🚀 Next-generation IDE built for modern developers</strong>
  </p>
  <div align="center">
    <a href="https://discord.gg/Y3TFTmE89g"><img src="https://img.shields.io/discord/1312017605955162133?style=for-the-badge&color=7289da&label=Discord&logo=discord&logoColor=ffffff&size=10" alt="Join our Discord" /></a>
    <a href="https://twitter.com/anic_dev"><img src="https://img.shields.io/badge/Follow-@anic_dev-black?style=for-the-badge&logo=x&logoColor=white&size=10" alt="Follow us on X" /></a>
    <img src="https://img.shields.io/badge/Status-Pre--Release-orange?style=for-the-badge" alt="Status" />
    <img src="https://img.shields.io/badge/Built%20with-❤️-red?style=for-the-badge" alt="Built with love" />
  </div>
</p>

---

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-installation">Installation</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-documentation">Documentation</a> •
  <a href="#-contributing">Contributing</a> •
  <a href="#-license">License</a>
</p>

---

## ✨ Features

<table>
<tr>
<td>

### 🎯 Core Features
- **⚡ Lightning Fast** - Built with performance in mind
- **🧠 Smart IntelliSense** - Advanced code completion
- **🎨 Beautiful UI** - Modern and customizable interface
- **🔧 Extensible** - Plugin system for endless possibilities

</td>
<td>

### 🛠️ Developer Experience
- **🔍 Powerful Search** - Find anything, anywhere
- **📝 Multi-cursor Editing** - Edit multiple locations simultaneously
- **🔄 Git Integration** - Version control at your fingertips
- **🐛 Advanced Debugging** - Debug with ease

</td>
</tr>
</table>

## 📚 Documentation

<div align="center">

| Document | Description |
|----------|-------------|
| [📋 **ROADMAP.md**](docs/ROADMAP.md) | Project roadmap and architecture |
| [⚙️ **DEV_GUIDE.md**](docs/DEV_GUIDE.md) | Development environment setup |
| [🏗️ **BUILD.md**](docs/BUILD.md) | Building and packaging guide |

</div>

## 📦 Installation

> [!WARNING]
> 🚧 **Pre-Release Notice**: Ariana IDE is currently in active development. Check back soon for the stable release!

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
