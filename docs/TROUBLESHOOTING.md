# Troubleshooting Guide

This guide helps you resolve common issues with Ariana IDE. If you can't find a solution here, please [open an issue](https://github.com/yourusername/ariana/issues) or ask in our [Discord community](https://discord.gg/Y3TFTmE89g).

## Table of Contents
- [Installation Issues](#installation-issues)
- [Build Problems](#build-problems)
- [Runtime Errors](#runtime-errors)
- [Authentication Issues](#authentication-issues)
- [Performance Problems](#performance-problems)
- [Development Environment](#development-environment)
- [Common Error Messages](#common-error-messages)
- [Debugging Tips](#debugging-tips)

## Installation Issues

### Node.js Version Mismatch

**Problem**: "Node.js version 24.2.0 or higher is required"

**Solution**:
```bash
# Check your Node.js version
node --version

# If using nvm, install and set correct version
nvm install 24.2.0
nvm use 24.2.0
nvm alias default 24.2.0

# Verify the change
node --version
```

### Permission Denied During Global Install

**Problem**: "EACCES: permission denied" when running `npm install -g`

**Solution**:
```bash
# Option 1: Use a Node version manager (recommended)
# Already using nvm? Just ensure proper setup

# Option 2: Change npm's default directory
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Option 3: Use npx instead of global install
npx ariana
```

### Just Command Not Found

**Problem**: "just: command not found"

**Solution**:
```bash
# Install Just globally
npm install -g just

# Or use npx
npx just dev-frontend
```

## Build Problems

### Rust Compilation Errors

**Problem**: "error: linker `cc` not found" or similar Rust build errors

**Solution**:
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install build-essential

# macOS
xcode-select --install

# Windows
# Install Visual Studio Build Tools
```

### Missing System Dependencies (Linux)

**Problem**: "Package webkit2gtk-4.0 was not found"

**Solution**:
```bash
# Ubuntu/Debian
sudo apt install \
  pkg-config \
  libdbus-1-dev \
  libgtk-3-dev \
  libsoup2.4-dev \
  libjavascriptcoregtk-4.1-dev \
  libwebkit2gtk-4.1-dev

# Fedora
sudo dnf install \
  gtk3-devel \
  webkit2gtk3-devel \
  libsoup-devel
```

### Build Configuration Not Found

**Problem**: "Configuration file not found" when building

**Solution**:
```bash
# Ensure config file exists
ls example-configs/

# Use correct path
just build example-configs/ariana-beta.json

# Or create your own
echo '{
  "buildParams": {
    "executableName": "ariana"
  },
  "runtimeParams": {
    "serverUrl": "https://api.ariana.dev"
  }
}' > my-config.json

just build my-config.json
```

### Out of Memory During Build

**Problem**: "JavaScript heap out of memory"

**Solution**:
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=8192"

# Then rebuild
just build example-configs/ariana-beta.json
```

## Runtime Errors

### Application Won't Start

**Problem**: Ariana IDE crashes on startup

**Solutions**:
1. **Check logs**:
   ```bash
   # Windows
   %APPDATA%\Ariana\logs\

   # macOS
   ~/Library/Logs/Ariana/

   # Linux
   ~/.config/ariana/logs/
   ```

2. **Reset configuration**:
   ```bash
   # Backup current config
   cp ~/.config/ariana/config.json ~/.config/ariana/config.backup.json

   # Reset to defaults
   rm ~/.config/ariana/config.json
   ```

3. **Clear cache**:
   ```bash
   # Remove cache directory
   rm -rf ~/.cache/ariana
   ```

### White Screen on Launch

**Problem**: Application window is blank

**Solutions**:
1. **Disable hardware acceleration**:
   ```bash
   ARIANA_DISABLE_GPU=1 ariana
   ```

2. **Check WebView2 (Windows)**:
   - Install [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

3. **Clear application data**:
   ```bash
   # Warning: This will reset all settings
   rm -rf ~/.config/ariana
   rm -rf ~/.cache/ariana
   ```

### Terminal Not Working

**Problem**: Integrated terminal shows errors or doesn't open

**Solutions**:
1. **Check shell configuration**:
   ```json
   // In settings.json
   {
     "terminal": {
       "integrated": {
         "shell": {
           "windows": "C:\\Windows\\System32\\cmd.exe",
           "osx": "/bin/zsh",
           "linux": "/bin/bash"
         }
       }
     }
   }
   ```

2. **Verify shell exists**:
   ```bash
   which bash  # or zsh, fish, etc.
   ```

3. **Reset terminal settings**:
   ```bash
   ariana config set terminal.integrated.shell "auto"
   ```

## Authentication Issues

### Email Not Receiving Code

**Problem**: Authentication code not arriving

**Solutions**:
1. **Check spam folder**
2. **Verify email address**:
   ```bash
   ariana auth status
   ```
3. **Try alternative email**
4. **Check server status**:
   ```bash
   curl https://api.ariana.dev/ping
   ```

### Invalid Authentication Token

**Problem**: "401 Unauthorized" errors

**Solutions**:
1. **Re-authenticate**:
   ```bash
   ariana auth logout
   ariana auth login
   ```

2. **Check token expiry**:
   ```bash
   ariana auth status --verbose
   ```

3. **Clear stored credentials**:
   ```bash
   rm ~/.config/ariana/credentials.json
   ```

### Cannot Connect to Backend

**Problem**: "Failed to connect to server"

**Solutions**:
1. **Check network**:
   ```bash
   ping api.ariana.dev
   curl https://api.ariana.dev/ping
   ```

2. **Check proxy settings**:
   ```bash
   # Bypass proxy
   unset HTTP_PROXY HTTPS_PROXY

   # Or configure proxy
   export HTTPS_PROXY=http://proxy.company.com:8080
   ```

3. **Use local backend**:
   ```bash
   ARIANA_BACKEND_URL=http://localhost:8080 ariana
   ```

## Performance Problems

### High CPU Usage

**Problem**: Ariana IDE using excessive CPU

**Solutions**:
1. **Disable unnecessary features**:
   ```json
   {
     "editor": {
       "minimap": false,
       "renderWhitespace": "none"
     },
     "files": {
       "autoSave": "off"
     }
   }
   ```

2. **Limit file watchers**:
   ```json
   {
     "files": {
       "watcherExclude": {
         "**/node_modules/**": true,
         "**/.git/objects/**": true,
         "**/dist/**": true
       }
     }
   }
   ```

3. **Check extensions**: Disable unused extensions

### High Memory Usage

**Problem**: Application using too much RAM

**Solutions**:
1. **Increase memory limit**:
   ```bash
   ARIANA_MAX_MEMORY=4096 ariana
   ```

2. **Close unused tabs and windows**

3. **Disable memory-intensive features**:
   ```json
   {
     "search": {
       "followSymlinks": false
     },
     "editor": {
       "largeFileOptimizations": true
     }
   }
   ```

### Slow File Operations

**Problem**: Opening or saving files is slow

**Solutions**:
1. **Exclude large directories**:
   ```json
   {
     "files": {
       "exclude": {
         "**/node_modules": true,
         "**/dist": true,
         "**/*.log": true
       }
     }
   }
   ```

2. **Disable auto-save**:
   ```json
   {
     "files": {
       "autoSave": "off"
     }
   }
   ```

## Development Environment

### Backend Won't Start

**Problem**: "Error: Cannot find module" when running backend

**Solutions**:
1. **Install dependencies**:
   ```bash
   cd backend
   npm install  # or cargo build for Rust backend
   ```

2. **Check .env file**:
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Check port availability**:
   ```bash
   lsof -i :8080  # Check if port is in use
   ```

### Frontend Build Errors

**Problem**: TypeScript or build errors in frontend

**Solutions**:
1. **Clean and rebuild**:
   ```bash
   cd frontend
   rm -rf node_modules package-lock.json
   npm install
   npm run build
   ```

2. **Check Node version**:
   ```bash
   node --version  # Should be >= 24.2.0
   ```

3. **Update dependencies**:
   ```bash
   npm update
   ```

### Hot Reload Not Working

**Problem**: Changes not reflecting in development

**Solutions**:
1. **Check file watchers**:
   ```bash
   # Linux: Increase watchers limit
   echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
   sudo sysctl -p
   ```

2. **Restart dev server**:
   ```bash
   # Stop with Ctrl+C, then:
   just dev-frontend
   ```

## Common Error Messages

### "ENOSPC: System limit for number of file watchers reached"

**Solution**:
```bash
# Linux only
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

### "Error: spawn EACCES"

**Solution**:
```bash
# Make scripts executable
chmod +x scripts/*.sh
```

### "Module not found: Error: Can't resolve..."

**Solution**:
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

### "Tauri error: failed to bundle project"

**Solution**:
1. Check all dependencies are installed
2. Verify Rust toolchain:
   ```bash
   rustup update
   rustup default stable
   ```
3. Clean and rebuild:
   ```bash
   cd frontend/tauri-app
   cargo clean
   npm run tauri build
   ```

## Debugging Tips

### Enable Debug Logging

```bash
# CLI debugging
ARIANA_LOG_LEVEL=debug ariana

# Tauri debugging
RUST_LOG=debug npm run tauri dev

# Full debugging
ARIANA_DEBUG=* RUST_LOG=debug TAURI_DEBUG=1 just dev-frontend
```

### Inspect Developer Tools

1. In Tauri app: Right-click and select "Inspect Element"
2. Check Console for JavaScript errors
3. Check Network tab for failed requests

### Generate Diagnostic Report

```bash
ariana diagnose > diagnostic-report.txt
```

This creates a report with:
- System information
- Configuration details
- Error logs
- Network connectivity

### Reset Everything

If all else fails, completely reset Ariana:

```bash
# Backup important data first!

# Remove all Ariana data
rm -rf ~/.config/ariana
rm -rf ~/.cache/ariana
rm -rf ~/.local/share/ariana

# Uninstall
npm uninstall -g ariana

# Reinstall
cd dist && npm install -g .
```

## Getting Help

If you're still having issues:

1. **Search existing issues**: [GitHub Issues](https://github.com/yourusername/ariana/issues)
2. **Ask on Discord**: [Join our community](https://discord.gg/Y3TFTmE89g)
3. **Create a bug report** with:
   - Error messages
   - Steps to reproduce
   - System information (`ariana --version --verbose`)
   - Diagnostic report (`ariana diagnose`)