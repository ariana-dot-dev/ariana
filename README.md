<div align="center">

```
 ▄████████    ▄████████  ▄█     ▄████████  ███▄▄▄▄      ▄████████       ▄█ ████████▄     ▄████████ 
███    ███   ███    ███ ███    ███    ███ ███▀▀▀██▄   ███    ███      ███ ███   ▀███   ███    ███ 
███    ███   ███    ███ ███▌   ███    ███ ███   ███   ███    ███      ███ ███    ███   ███    █▀  
███    ███  ▄███▄▄▄▄██▀ ███▌   ███    ███ ███   ███   ███    ███      ███ ███    ███  ▄███▄▄▄     
▀███████████ ▀▀███▀▀▀▀▀  ███▌ ▀███████████ ███   ███ ▀███████████      ███ ███    ███ ▀▀███▀▀▀     
███    ███ ▀███████████ ███    ███    ███ ███   ███   ███    ███      ███ ███    ███   ███    █▄  
███    ███   ███    ███ ███    ███    ███ ███   ███   ███    ███      ███ ███   ▄███   ███    ███ 
███    █▀    ███    ███ █▀     ███    █▀   ▀█   █▀    ███    █▀       █▀  ████████▀    ██████████ 
              ███    ███                                                                           
```

<h3 align="center">🚀 The Next-Generation IDE</h3>
<p align="center">
  <strong>AI-powered development environment with canvas-based workflow</strong><br>
  <em>Built with Tauri, React, and Rust for ultimate performance</em>
</p>

<img src="assets/screenshot.jpg" width="1024" alt="Ariana IDE screenshot" style="border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);" />

<p align="center">
  <a href="https://discord.gg/Y3TFTmE89g">
    <img src="https://img.shields.io/discord/1312017605955162133?style=for-the-badge&color=7289da&label=Discord&logo=discord&logoColor=ffffff" alt="Join our Discord" />
  </a>
  <a href="https://twitter.com/anic_dev">
    <img src="https://img.shields.io/badge/Follow-@anic_dev-black?style=for-the-badge&logo=x&logoColor=white" alt="Follow us on X" />
  </a>
  <img src="https://img.shields.io/badge/License-AGPL--3.0-blue?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/Status-In%20Development-orange?style=for-the-badge" alt="Status" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri" />
  <img src="https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
</p>

</div>

## ✨ Features

<table>
<tr>
<td width="50%">

### 🎨 **Canvas-Based Workflow**
- Visual project management on infinite canvas
- Drag-and-drop file organization
- Mind-map style code exploration

### 🤖 **AI-Powered Assistant**
- Integrated Claude Code agent
- Context-aware code suggestions
- Intelligent refactoring assistance

### 📱 **Cross-Platform**
- Native desktop performance with Tauri
- macOS, Windows, and Linux support
- Mobile companion app (iOS)

</td>
<td width="50%">

### ⚡ **Lightning Fast**
- Rust-powered backend for speed
- Minimal resource usage
- Instant file operations

### 🧠 **Smart Terminal**
- Custom terminal integration
- Multi-session management
- Background process monitoring

### 🔗 **Git Integration**
- Visual diff management
- Branch visualization
- Collaborative workflows

</td>
</tr>
</table>

---

## 📋 Documentation

For detailed information, see the documentation in the `docs/` folder:

- [📋 **ROADMAP.md**](docs/ROADMAP.md) - Project roadmap and architecture
- [⚙️ **DEV_GUIDE.md**](docs/DEV_GUIDE.md) - Development environment setup
- [ **BUILD.md**](docs/BUILD.md) - Building and packaging guide

## 🚧 Installation Status

> **⚠️ Early Development:** Ariana IDE is currently in active development and not ready for production use. 
> 
> **🔔 Stay Updated:** Follow our [Discord](https://discord.gg/Y3TFTmE89g) for the latest updates and early access opportunities!

## 🚀 Quick Start

<details>
<summary><strong>📋 Prerequisites</strong></summary>

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | `≥ 24.2.0` | Frontend development & build system |
| **Rust** | `latest` | Native backend performance |
| **Just** | `latest` | Task runner for development |

<blockquote>
<details>
<summary><strong>🔧 Setup for nvm users</strong></summary>

If you use nvm to manage Node.js versions, set Node.js 24 as your default:

```bash
nvm alias default 24
```
</details>
</blockquote>

</details>

### 🛠️ Development Setup

<details open>
<summary><strong>1️⃣ Install Dependencies</strong></summary>

```bash
# Install Just task runner globally
npm install -g just
```

</details>

<details open>
<summary><strong>2️⃣ Start Development Servers</strong></summary>

Open **3 separate terminals** and run:

```bash
# Terminal 1: Backend API
# ⚠️ First time: edit backend/.env with your config
just dev-backend
```

```bash
# Terminal 2: Frontend UI
just dev-frontend
```

```bash
# Terminal 3: CLI Interface (optional)
just dev-cli
```

</details>

<details>
<summary><strong>3️⃣ Build for Production</strong></summary>

```bash
# Build with configuration
just build example-configs/ariana-beta.json

# Install locally for testing
cd dist && npm install -g .
```

</details>

## 🏗️ Architecture & Tech Stack

<table>
<tr>
<td width="50%">

### 🖥️ **Frontend**
- **Framework:** React 19 with TypeScript
- **Styling:** Tailwind CSS 4
- **Desktop:** Tauri 2.0 (Rust-based)
- **Terminal:** xterm.js with custom addons
- **Animation:** Framer Motion
- **State:** Context API + Custom hooks

</td>
<td width="50%">

### ⚙️ **Backend**
- **Core:** Rust for native performance
- **Database:** SQLite with custom migrations
- **File System:** Native Tauri APIs
- **Process Management:** Custom terminal service
- **Git Integration:** Native git operations
- **Mobile:** Swift (iOS companion app)

</td>
</tr>
</table>

### 📱 **Multi-Platform Support**
- 🖥️ **Desktop:** macOS, Windows, Linux (via Tauri)
- 📱 **Mobile:** iOS app with voice input and project sync
- 🌐 **Web:** Future web-based version planned

---

## 🤝 Contributing

We welcome contributions! Please check out our:
- [Development Guide](docs/DEV_GUIDE.md) for setup instructions
- [Roadmap](docs/ROADMAP.md) for planned features
- [Discord](https://discord.gg/Y3TFTmE89g) for discussions

---

## 📄 License

GNU Affero General Public License v3.0
