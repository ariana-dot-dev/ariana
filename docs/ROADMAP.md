# Ariana IDE Roadmap

## Short term Roadmap

- [x] TS Scripting engine + Boot script
- [x] LLM API integration (Anthropic, OpenAI, Google, Groq, OpenRouter)
- [x] Auto Layout
- [ ] Small Agent for UI control
- [ ] Machine/Env setup system with [mise](https://mise.jdx.dev/getting-started.html)
- [x] Terminal UI DONNNNNE (buggy)
- [ ] Machine/Env UI + fs UI
- [ ] Text editing UI

## Architecture

- **Backend**: Rust + Actix Web + SQLite + LLM API
- **CLI**: Node.js with email-based authentication flow
- **Desktop App**: Tauri + React + Vite

## Project Structure

```
ariana/
├── backend/          # Rust backend server
│   ├── src/
│   │   ├── main.rs
│   │   ├── auth.rs
│   │   ├── database.rs
│   │   ├── email.rs
│   │   └── llm/      # LLM API integration
│   └── Cargo.toml
├── frontend/         # Node.js CLI + Tauri app
│   ├── src/
│   │   └── cli.js    # Main CLI application
│   ├── tauri-app/    # Tauri desktop application
│   └── package.json
├── docs/             # Documentation
└── README.md
```

## Server Configuration

The backend provides the following endpoints:
- `/ping` - Health check
- `/auth/*` - Authentication endpoints
- `/api/providers` - List LLM providers and models
- `/api/inference` - LLM text completion
- `/api/inference/stream` - LLM streaming completion

See [API Documentation](./API.md) for complete API reference.