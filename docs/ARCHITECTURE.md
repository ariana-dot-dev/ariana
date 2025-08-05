# Architecture Overview

This document provides a comprehensive overview of Ariana IDE's architecture, components, and design decisions.

## Table of Contents
- [System Overview](#system-overview)
- [Core Components](#core-components)
- [Frontend Architecture](#frontend-architecture)
- [Backend Services](#backend-services)
- [Data Flow](#data-flow)
- [Security Architecture](#security-architecture)
- [Deployment Architecture](#deployment-architecture)

## System Overview

Ariana IDE is built as a modern, distributed development environment with the following key principles:

- **Modular Architecture**: Separate components for different concerns
- **Cross-Platform Support**: Native desktop app with web technologies
- **AI-First Design**: Deep integration with LLM providers
- **Extensible Framework**: Plugin system and customizable UI
- **Security by Design**: Authentication, encryption, and secure communication

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Desktop App   │     │     CLI Tool    │     │   Web Client    │
│    (Tauri)      │     │   (Node.js)     │     │   (Future)      │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                         │
         └───────────────────────┴─────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │    Backend Services     │
                    │   ┌─────────────────┐   │
                    │   │   Auth Service   │   │
                    │   ├─────────────────┤   │
                    │   │   LLM Gateway    │   │
                    │   ├─────────────────┤   │
                    │   │   Database API   │   │
                    │   ├─────────────────┤   │
                    │   │  WebSocket Hub   │   │
                    │   └─────────────────┘   │
                    └────────────┬────────────┘
                                 │
                ┌────────────────┴────────────────┐
                │         Data Layer              │
                │  ┌──────────┐  ┌─────────────┐  │
                │  │  SQLite  │  │ File System │  │
                │  └──────────┘  └─────────────┘  │
                └─────────────────────────────────┘
```

## Core Components

### 1. Desktop Application (Tauri)

The main user interface built with:
- **Framework**: Tauri v1.x for native desktop integration
- **UI**: React 18 with Vite for fast development
- **State Management**: Redux Toolkit for predictable state
- **Styling**: TailwindCSS for responsive design

Key features:
- Multi-window support for different IDE panels
- Native file system access
- System tray integration
- Custom protocol handlers

### 2. CLI Tool

Command-line interface for:
- Project initialization and management
- Authentication flow
- Remote development support
- CI/CD integration

Architecture:
- Built with Node.js for cross-platform compatibility
- Modular command structure
- Configurable via JSON files
- Plugin support for custom commands

### 3. Backend Services

Microservices architecture with:
- **Language**: Rust for performance and safety
- **Framework**: Actix Web for HTTP services
- **Database**: SQLite for simplicity and portability
- **Cache**: In-memory caching with TTL

Services:
- Authentication Service
- LLM Gateway Service
- Project Management Service
- Real-time Communication Service

### 4. iOS IDE Components

Specialized components for mobile development:
- Mock backend for offline development
- iOS-specific UI adaptations
- Mobile-optimized workflows

## Frontend Architecture

### Component Structure

```
frontend/
├── tauri-app/
│   ├── src/
│   │   ├── components/       # React components
│   │   │   ├── editor/      # Code editor components
│   │   │   ├── terminal/    # Terminal integration
│   │   │   ├── canvas/      # Visual canvas system
│   │   │   └── shared/      # Shared UI components
│   │   ├── hooks/           # Custom React hooks
│   │   ├── services/        # API and service layers
│   │   ├── store/           # Redux store and slices
│   │   ├── utils/           # Utility functions
│   │   └── types/           # TypeScript definitions
│   └── src-tauri/           # Rust backend for Tauri
└── src/                     # CLI source code
```

### State Management

Redux Toolkit slices for:
- **Auth State**: User authentication and session
- **Project State**: Active projects and files
- **Editor State**: Open files, cursor positions
- **Terminal State**: Terminal sessions and output
- **UI State**: Layout, themes, preferences

### Component Communication

1. **Props Drilling**: For closely related components
2. **Context API**: For theme and user preferences
3. **Redux**: For global application state
4. **Event Bus**: For cross-window communication

## Backend Services

### Authentication Service

- **Email-based authentication** with OTP codes
- **JWT tokens** for session management
- **Role-based access control** (RBAC)
- **OAuth integration** (future)

```rust
// Authentication flow
POST /auth/request -> Send OTP
POST /auth/verify -> Verify OTP, get JWT
GET /api/* -> Include JWT in Authorization header
```

### LLM Gateway

Unified interface for multiple LLM providers:
- **Provider Abstraction**: Common interface for different APIs
- **Request Queue**: Rate limiting and prioritization
- **Response Caching**: Reduce API costs
- **Streaming Support**: Real-time responses

Supported providers:
- Anthropic (Claude)
- OpenAI (GPT-4)
- Google (Gemini)
- Groq
- OpenRouter

### Database API

RESTful API for data persistence:
- **Entities**: Users, Projects, Chats, Tasks
- **Relations**: Proper foreign key constraints
- **Migrations**: Version-controlled schema changes
- **Validation**: Input sanitization and validation

### WebSocket Hub

Real-time communication for:
- **Live Collaboration**: Multiple users editing
- **Progress Updates**: Long-running task status
- **System Notifications**: Alerts and messages
- **Terminal Sharing**: Remote terminal sessions

## Data Flow

### Request Lifecycle

1. **Client Request**: User action in UI
2. **API Call**: HTTP/WebSocket to backend
3. **Authentication**: Verify JWT token
4. **Business Logic**: Process request
5. **Database Operation**: Read/write data
6. **Response**: Return to client
7. **UI Update**: Redux state update

### LLM Integration Flow

```
User Input -> Frontend -> Backend Gateway -> LLM Provider
                                          <- 
    Update UI <- Stream Response <- Process <- LLM Response
```

### File Operations

1. **Local Files**: Direct Tauri API access
2. **Remote Files**: Through backend API
3. **Version Control**: Git integration
4. **Sync**: Conflict resolution algorithms

## Security Architecture

### Authentication

- **Zero-Trust Model**: Verify every request
- **Token Rotation**: Automatic refresh
- **Session Management**: Timeout and revocation
- **MFA Support**: TOTP codes (future)

### Data Protection

- **Encryption at Rest**: For sensitive data
- **TLS in Transit**: All network communication
- **Input Validation**: Prevent injection attacks
- **CORS Policy**: Restrict origins

### API Security

- **Rate Limiting**: Per-user and per-endpoint
- **API Keys**: For external integrations
- **Audit Logging**: Track all operations
- **OWASP Compliance**: Follow best practices

## Deployment Architecture

### Development

```bash
# Local development setup
just dev-backend   # Rust backend on :8080
just dev-frontend  # Tauri app on :5173
just dev-cli      # CLI with hot reload
```

### Production

#### Cloud Deployment (Future)
```
┌─────────────────┐
│   CloudFlare    │
│   CDN & WAF     │
└────────┬────────┘
         │
┌────────┴────────┐
│  Load Balancer  │
└────────┬────────┘
         │
┌────────┴────────────────────────┐
│        Backend Instances         │
│  ┌──────────┐  ┌──────────┐    │
│  │ Server 1 │  │ Server 2 │    │
│  └──────────┘  └──────────┘    │
└────────┬────────────────────────┘
         │
┌────────┴────────┐
│   PostgreSQL    │
│   (Primary)     │
└─────────────────┘
```

#### Desktop Distribution
- **Windows**: MSI installer via Tauri
- **macOS**: DMG with code signing
- **Linux**: AppImage, deb, rpm packages

### Monitoring

- **Application Metrics**: Prometheus + Grafana
- **Error Tracking**: Sentry integration
- **Log Aggregation**: ELK stack
- **Performance**: OpenTelemetry

## Design Decisions

### Why Tauri?
- Native performance with web technologies
- Smaller bundle size than Electron
- Better security model
- Rust integration

### Why SQLite?
- Zero configuration
- Portable data files
- Excellent performance for local data
- Easy backup and migration

### Why Rust Backend?
- Memory safety without garbage collection
- Excellent performance characteristics
- Strong type system
- Great async support

### Why Redux Toolkit?
- Predictable state updates
- Time-travel debugging
- Middleware ecosystem
- TypeScript support

## Future Enhancements

### Planned Features
1. **Plugin System**: External extensions
2. **Cloud Sync**: Project synchronization
3. **Collaborative Editing**: Real-time collaboration
4. **Mobile Apps**: iOS and Android clients
5. **Voice Commands**: AI-powered voice control

### Scalability Considerations
- Horizontal scaling for backend services
- Database sharding for large deployments
- CDN integration for global distribution
- Microservices migration path

## Development Guidelines

### Code Organization
- Feature-based folder structure
- Shared types in common packages
- Consistent naming conventions
- Comprehensive documentation

### Testing Strategy
- Unit tests for business logic
- Integration tests for API endpoints
- E2E tests for critical user flows
- Performance benchmarks

### CI/CD Pipeline
- Automated testing on PR
- Code quality checks
- Security scanning
- Automated releases