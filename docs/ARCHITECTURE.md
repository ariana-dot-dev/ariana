# Ariana IDE Architecture

This document provides a comprehensive overview of Ariana IDE's architecture, component interactions, and system design decisions.

## System Overview

Ariana IDE is a multi-platform, AI-powered development environment consisting of several interconnected components:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Desktop App   │    │   Mobile App    │    │   CLI Tool      │
│   (Tauri+React) │    │   (Swift iOS)   │    │   (Node.js)     │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────┴───────────────┐
                    │      API Gateway            │
                    │   (Multiple Backends)       │
                    └─────────────┬───────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                       │                        │
┌────────▼────────┐    ┌─────────▼──────────┐    ┌───────▼────────┐
│   Database      │    │    Rust Backend    │    │  FastAPI       │
│   Server        │    │    (Planned)       │    │  Mock Backend  │
│   (Node.js +    │    │                    │    │  (iOS)         │
│   PostgreSQL)   │    │                    │    │                │
└─────────────────┘    └────────────────────┘    └────────────────┘
```

## Core Components

### 1. Frontend Applications

#### Desktop Application (`frontend/tauri-app/`)
- **Technology**: React + TypeScript + Tauri (Rust)
- **Purpose**: Main development interface with visual canvas
- **Key Features**:
  - Canvas-based workspace with interactive elements
  - Terminal integration with custom commands
  - File tree navigation and editing
  - Real-time task management
  - Git integration and diff management

#### CLI Tool (`frontend/src/`)
- **Technology**: Node.js + TypeScript
- **Purpose**: Command-line interface for authentication and app launching
- **Key Features**:
  - Email-based authentication flow
  - Configuration management
  - Platform-specific binary launching
  - Development mode support

#### iOS Mobile App (`ios-ide/ide-mobile/`)
- **Technology**: Swift + SwiftUI
- **Purpose**: Mobile companion for project management
- **Key Features**:
  - Project selection and overview
  - Chat interface for AI agent interaction
  - Task list visualization with status tracking
  - Voice input capabilities

### 2. Backend Services

#### Database Server (`db-server/`)
- **Technology**: Node.js + PostgreSQL + Express
- **Purpose**: Primary data persistence and API layer
- **Responsibilities**:
  - User authentication and management
  - Git repository tracking
  - Backlog and task management
  - Database migrations and setup

#### FastAPI Mock Backend (`ios-ide/mock-backend/`)
- **Technology**: Python + FastAPI + PostgreSQL + Docker
- **Purpose**: Backend service for iOS application
- **Features**:
  - RESTful API with automatic documentation
  - SQLAlchemy ORM with relationship management
  - Docker containerization
  - Comprehensive test fixtures

#### Rust Backend (Planned) (`backend/`)
- **Technology**: Rust + Actix Web + SQLite
- **Purpose**: High-performance main backend service
- **Planned Features**:
  - LLM API integration (Anthropic, OpenAI, etc.)
  - Real-time WebSocket connections
  - File system operations
  - Terminal command execution

### 3. Data Layer

#### Database Schema

**Users Table**
```sql
id (SERIAL PRIMARY KEY)
provider (VARCHAR) -- OAuth provider
provider_user_id (VARCHAR)
email (VARCHAR)
email_verified (BOOLEAN)
name (VARCHAR)
avatar_url (TEXT)
created_at, last_login (TIMESTAMP)
```

**Git Repositories**
```sql
id (SERIAL PRIMARY KEY)
user_id (UUID) -> users.id
repo_url (TEXT)
access_status (BOOLEAN)
created_at, last_access_check (TIMESTAMP)
```

**Backlog Management**
```sql
id (SERIAL PRIMARY KEY)
git_repository_url (TEXT)
task (TEXT)
status (VARCHAR) -- 'open', 'in_progress', 'completed'
owner (UUID) -> users.id
priority (INTEGER) -- 1=high, 2=medium, 3=low
created_at, updated_at, completed_at (TIMESTAMP)
```

## Component Interactions

### Authentication Flow
1. **CLI Initiation**: User runs `ariana-ide login`
2. **Email Verification**: System sends verification email
3. **Token Exchange**: CLI receives and stores JWT token
4. **App Launch**: Authenticated token passed to desktop/mobile apps

### Development Workflow
1. **Project Setup**: User selects/creates Git repository
2. **Canvas Interface**: Visual workspace loads with project context
3. **AI Agent Integration**: LLM providers process development requests
4. **Task Management**: Automated task creation and tracking
5. **Real-time Updates**: Status synchronization across all clients

### Data Synchronization
- **Desktop ↔ Database**: Direct API calls for real-time updates
- **Mobile ↔ FastAPI**: Separate backend with synchronized data models  
- **CLI ↔ Database**: Authentication and configuration management

## Technology Decisions

### Frontend Architecture
- **Tauri vs Electron**: Chosen for better performance and smaller bundle size
- **React + TypeScript**: Mature ecosystem with strong typing
- **Canvas API**: Custom rendering for flexible UI components

### Backend Architecture  
- **Multi-Backend Approach**: Different backends optimized for specific use cases
- **Node.js for Database**: Rapid development and JSON handling
- **Rust for Performance**: Planned migration for compute-intensive operations
- **FastAPI for Mobile**: Python ecosystem benefits for AI/ML integration

### Development Tools
- **Just**: Task runner for simplified command management
- **Biome**: Fast formatter and linter replacing ESLint/Prettier
- **Cross-compilation**: Docker-based builds for multiple platforms

## Security Considerations

### Authentication
- JWT tokens with secure storage
- Email-based verification flow
- OAuth provider integration (planned)

### Data Protection
- Parameterized queries preventing SQL injection
- Input validation and sanitization
- Foreign key constraints for data integrity

### Network Security
- HTTPS/WSS for all external communications
- Token-based API authentication
- Environment-based configuration management

## Performance Optimizations

### Frontend
- Canvas-based rendering for smooth interactions
- Virtual scrolling for large datasets
- Lazy loading of components and assets
- WebAssembly integration for compute-heavy operations

### Backend
- Connection pooling for database operations
- Indexed queries for performance
- Asynchronous request handling
- Caching layers for frequently accessed data

## Scalability Design

### Horizontal Scaling
- Stateless service design
- Database connection pooling
- Load balancer ready architecture

### Vertical Scaling
- Rust backend for CPU-intensive operations
- Memory-efficient data structures
- Streaming for large file operations

## Development Workflow

### Build System
- **Just**: Unified task runner across all components
- **TypeScript**: Compile-time type checking
- **Cargo**: Rust package management and building
- **npm/pnpm**: Node.js dependency management

### Testing Strategy
- Unit tests for business logic
- Integration tests for API endpoints
- End-to-end tests for user workflows
- Performance benchmarks for critical paths

### Deployment
- Docker containerization for backend services
- Platform-specific binaries for desktop applications
- App Store distribution for mobile applications
- npm registry for CLI tools

## Future Enhancements

### Planned Features
- Real-time collaborative editing
- Plugin system for extensibility
- Advanced AI agent capabilities
- Cloud-based project synchronization
- Integrated debugging and profiling tools

### Architecture Evolution
- Migration to full Rust backend
- WebAssembly modules for client-side processing
- Kubernetes orchestration for backend services
- GraphQL API layer for efficient data fetching

---

This architecture is designed to be modular, scalable, and maintainable while providing a rich development experience across multiple platforms.