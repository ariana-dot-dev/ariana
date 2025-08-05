# Configuration Guide

This guide covers all configuration options for Ariana IDE, including build-time configuration, runtime settings, and environment variables.

## Table of Contents
- [Build Configuration](#build-configuration)
- [Runtime Configuration](#runtime-configuration)
- [Environment Variables](#environment-variables)
- [User Settings](#user-settings)
- [Project Configuration](#project-configuration)
- [LLM Provider Configuration](#llm-provider-configuration)

## Build Configuration

Build configurations allow you to create custom versions of Ariana IDE with different branding and server endpoints.

### Configuration File Structure

Create a JSON file with the following structure:

```json
{
  "buildParams": {
    "executableName": "ariana-custom",
    "productName": "Ariana Custom IDE",
    "identifier": "com.yourcompany.ariana-custom"
  },
  "runtimeParams": {
    "serverUrl": "https://your-api.example.com",
    "telemetryEnabled": false,
    "defaultTheme": "dark"
  }
}
```

### Build Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `executableName` | string | Name of the executable file | `ariana` |
| `productName` | string | Display name in OS | `Ariana IDE` |
| `identifier` | string | App bundle identifier | `com.ariana.ide` |

### Runtime Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `serverUrl` | string | Backend API endpoint | `https://api.ariana.dev` |
| `telemetryEnabled` | boolean | Enable usage analytics | `true` |
| `defaultTheme` | string | Default color theme | `"system"` |
| `autoUpdate` | boolean | Enable auto-updates | `true` |
| `debugMode` | boolean | Enable debug features | `false` |

### Using Build Configuration

```bash
# Build with custom configuration
just build my-config.json

# The configuration is embedded in:
# - dist/dist/config.json (for runtime)
# - Binary metadata (for OS integration)
```

## Runtime Configuration

Runtime configuration can be modified after installation through various methods.

### Configuration Priority

Configuration is loaded in the following order (later overrides earlier):

1. Embedded build configuration
2. System-wide configuration file
3. User configuration file
4. Project configuration file
5. Environment variables
6. Command-line arguments

### Configuration File Locations

#### Windows
- System: `C:\ProgramData\Ariana\config.json`
- User: `%APPDATA%\Ariana\config.json`

#### macOS
- System: `/Library/Application Support/Ariana/config.json`
- User: `~/Library/Application Support/Ariana/config.json`

#### Linux
- System: `/etc/ariana/config.json`
- User: `~/.config/ariana/config.json`

### Runtime Configuration Options

```json
{
  "server": {
    "url": "https://api.ariana.dev",
    "timeout": 30000,
    "retryAttempts": 3
  },
  "editor": {
    "fontSize": 14,
    "fontFamily": "JetBrains Mono",
    "tabSize": 2,
    "wordWrap": "on",
    "minimap": true
  },
  "terminal": {
    "shell": "auto",
    "fontSize": 13,
    "cursorStyle": "block"
  },
  "ui": {
    "theme": "dark",
    "layout": "default",
    "sidebarPosition": "left",
    "activityBarPosition": "left"
  }
}
```

## Environment Variables

Environment variables override configuration files and are useful for CI/CD and containerized deployments.

### Core Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `ARIANA_BACKEND_URL` | Override backend URL | `http://localhost:8080` |
| `ARIANA_CONFIG_PATH` | Custom config file path | `/custom/config.json` |
| `ARIANA_DATA_DIR` | Data storage directory | `/var/lib/ariana` |
| `ARIANA_LOG_LEVEL` | Logging verbosity | `debug`, `info`, `warn`, `error` |
| `ARIANA_PROXY` | HTTP proxy settings | `http://proxy:8080` |

### Authentication Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `ARIANA_AUTH_TOKEN` | Pre-configured auth token | `eyJhbGc...` |
| `ARIANA_API_KEY` | API key for automation | `ak-xxxxx` |
| `ARIANA_EMAIL` | Default email for auth | `user@example.com` |

### LLM Provider Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key | `sk-ant-xxxxx` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-xxxxx` |
| `GOOGLE_API_KEY` | Google AI API key | `AIza-xxxxx` |
| `GROQ_API_KEY` | Groq API key | `gsk-xxxxx` |

### Development Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Node environment | `development`, `production` |
| `RUST_LOG` | Rust logging config | `ariana=debug,actix=info` |
| `TAURI_DEBUG` | Enable Tauri debugging | `1` |

## User Settings

User preferences are stored in the settings file and can be modified through the UI or directly.

### Settings Schema

```typescript
interface UserSettings {
  // Editor Settings
  editor: {
    fontSize: number;
    fontFamily: string;
    fontLigatures: boolean;
    tabSize: number;
    insertSpaces: boolean;
    wordWrap: "off" | "on" | "wordWrapColumn";
    wordWrapColumn: number;
    lineNumbers: "on" | "off" | "relative";
    minimap: {
      enabled: boolean;
      side: "left" | "right";
    };
    rulers: number[];
    renderWhitespace: "none" | "all" | "selection";
  };

  // Terminal Settings
  terminal: {
    integrated: {
      shell: {
        windows: string;
        osx: string;
        linux: string;
      };
      fontSize: number;
      fontFamily: string;
      cursorStyle: "block" | "line" | "underline";
      cursorBlinking: boolean;
    };
  };

  // UI Settings
  workbench: {
    colorTheme: string;
    iconTheme: string;
    sideBar: {
      location: "left" | "right";
      visible: boolean;
    };
    activityBar: {
      visible: boolean;
    };
    statusBar: {
      visible: boolean;
    };
  };

  // File Settings
  files: {
    autoSave: "off" | "afterDelay" | "onFocusChange";
    autoSaveDelay: number;
    exclude: Record<string, boolean>;
    watcherExclude: Record<string, boolean>;
  };

  // Search Settings
  search: {
    exclude: Record<string, boolean>;
    useIgnoreFiles: boolean;
    followSymlinks: boolean;
  };

  // Git Settings
  git: {
    enabled: boolean;
    path: string;
    autoFetch: boolean;
    confirmSync: boolean;
  };
}
```

### Modifying Settings

#### Via UI
1. Open Command Palette (Ctrl/Cmd + Shift + P)
2. Type "Settings" and select "Open Settings"
3. Modify settings through the UI

#### Via Settings File
1. Open Command Palette
2. Type "Settings" and select "Open Settings (JSON)"
3. Edit the JSON file directly

#### Via CLI
```bash
# Set a specific setting
ariana config set editor.fontSize 16

# Get a setting value
ariana config get editor.fontSize

# List all settings
ariana config list
```

## Project Configuration

Project-specific settings override user settings for that project.

### Project Settings File

Create `.ariana/settings.json` in your project root:

```json
{
  "editor": {
    "tabSize": 4,
    "insertSpaces": true
  },
  "files": {
    "exclude": {
      "**/node_modules": true,
      "**/dist": true
    }
  },
  "search": {
    "exclude": {
      "**/build": true,
      "**/*.min.js": true
    }
  }
}
```

### Launch Configuration

Create `.ariana/launch.json` for debug configurations:

```json
{
  "version": "1.0.0",
  "configurations": [
    {
      "name": "Debug Node.js",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/index.js",
      "env": {
        "NODE_ENV": "development"
      }
    }
  ]
}
```

### Tasks Configuration

Create `.ariana/tasks.json` for custom tasks:

```json
{
  "version": "1.0.0",
  "tasks": [
    {
      "label": "Build",
      "type": "shell",
      "command": "npm run build",
      "group": {
        "kind": "build",
        "isDefault": true
      }
    }
  ]
}
```

## LLM Provider Configuration

Configure different LLM providers for AI assistance.

### Provider Settings

```json
{
  "llm": {
    "defaultProvider": "anthropic",
    "providers": {
      "anthropic": {
        "apiKey": "${env:ANTHROPIC_API_KEY}",
        "model": "claude-3-sonnet",
        "maxTokens": 4096,
        "temperature": 0.7
      },
      "openai": {
        "apiKey": "${env:OPENAI_API_KEY}",
        "model": "gpt-4",
        "maxTokens": 4096,
        "temperature": 0.7,
        "endpoint": "https://api.openai.com/v1"
      },
      "local": {
        "endpoint": "http://localhost:11434",
        "model": "llama2"
      }
    }
  }
}
```

### Model Selection

Models can be selected per-task:

```json
{
  "llm": {
    "tasks": {
      "codeGeneration": {
        "provider": "anthropic",
        "model": "claude-3-opus"
      },
      "codeReview": {
        "provider": "openai",
        "model": "gpt-4"
      },
      "documentation": {
        "provider": "anthropic",
        "model": "claude-3-sonnet"
      }
    }
  }
}
```

## Advanced Configuration

### Custom Themes

Create custom themes in `.ariana/themes/`:

```json
{
  "name": "My Custom Theme",
  "type": "dark",
  "colors": {
    "editor.background": "#1e1e1e",
    "editor.foreground": "#d4d4d4",
    "editorLineNumber.foreground": "#858585",
    "editorCursor.foreground": "#aeafad"
  },
  "tokenColors": [
    {
      "scope": "keyword",
      "settings": {
        "foreground": "#569cd6"
      }
    }
  ]
}
```

### Extension Configuration

Configure installed extensions:

```json
{
  "extensions": {
    "python.linting.enabled": true,
    "python.linting.pylintEnabled": true,
    "prettier.singleQuote": true,
    "eslint.autoFixOnSave": true
  }
}
```

### Keyboard Shortcuts

Customize keyboard shortcuts in `keybindings.json`:

```json
[
  {
    "key": "ctrl+shift+t",
    "command": "workbench.action.terminal.new"
  },
  {
    "key": "ctrl+k ctrl+c",
    "command": "editor.action.commentLine",
    "when": "editorTextFocus"
  }
]
```

## Troubleshooting Configuration

### Debug Configuration Loading

```bash
# Show loaded configuration
ariana config show --verbose

# Validate configuration
ariana config validate

# Reset to defaults
ariana config reset
```

### Common Issues

1. **Configuration not loading**
   - Check file permissions
   - Validate JSON syntax
   - Check file locations

2. **Environment variables not working**
   - Ensure variables are exported
   - Check variable names (case-sensitive)
   - Restart the application

3. **Settings not persisting**
   - Check write permissions
   - Verify settings file location
   - Check for syntax errors

### Configuration Logs

Enable configuration debugging:

```bash
ARIANA_LOG_LEVEL=debug ariana --config-debug
```

This will show:
- Configuration file paths checked
- Values loaded from each source
- Final merged configuration
- Any errors encountered