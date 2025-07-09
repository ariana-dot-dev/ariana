# Ariana IDE - iOS Mobile Application

A comprehensive iOS application that integrates with an AI-powered backend service for intelligent development task automation. The project consists of an iOS Swift application and a Python FastAPI mock backend with PostgreSQL database.

## 📱 Project Overview

**Ariana IDE** is a mobile development environment that enables users to:
- Manage development projects and repositories
- Create and track AI agent conversations 
- Monitor automated development tasks with real-time status updates
- Organize work with priority-based task management
- Collaborate through project-based chat systems

## 🏗️ Architecture

### iOS Application (`ide-mobile/`)
- **SwiftUI** interface with real-time task monitoring
- **BackendService** for API communication
- Task status visualization with color-coded indicators
- Asynchronous request processing with polling

### Mock Backend (`mock-backend/`)
- **FastAPI** REST API with automatic documentation
- **PostgreSQL** database with SQLAlchemy ORM
- Docker containerization for easy deployment
- Comprehensive data models for users, projects, chats, and tasks

## 🗄️ Database Schema

```
User
├── id (PK)
├── created_at, updated_at

GitProject  
├── id (PK)
├── name, description
├── user_owner_id → User.id
├── created_at, updated_at

AgentChat
├── id (PK) 
├── name
├── project_id → GitProject.id
├── user_id → User.id
├── status_id → ChatStatus.id
├── created_at, updated_at

AgentTask
├── id (PK)
├── name, description
├── status_id → TaskStatus.id  
├── chat_id → AgentChat.id
├── priority (1=high, 2=medium, 3=low)
├── created_at, updated_at, completed_at
```

## 🚀 Getting Started

### Prerequisites
- **iOS Development**: Xcode 14+ with iOS 15+ target
- **Backend Development**: Docker & Docker Compose, or Python 3.11+
- **Database**: PostgreSQL (handled by Docker Compose)

### Quick Start with Docker (Recommended)

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd ariana-ide/ios-ide
   ```

2. **Start the backend services**
   ```bash
   cd mock-backend
   docker-compose up --build
   ```
   
   This will:
   - Start PostgreSQL database on port 5432
   - Launch FastAPI backend on port 8000  
   - Automatically create tables and seed with sample data

3. **Open iOS project**
   ```bash
   open ide-mobile/ide-mobile.xcodeproj
   ```
   
4. **Run the iOS app** in Xcode simulator or device

5. **Access API documentation** at http://localhost:8000/docs

### Local Development Setup

#### Backend Setup
```bash
cd mock-backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies  
pip install -r requirements.txt

# Start PostgreSQL (ensure it's running on localhost:5432)
# Create database 'mock_backend' with user 'admin'/'password123'

# Initialize and start
./start.sh
```

#### iOS Setup
1. Open `ide-mobile/ide-mobile.xcodeproj` in Xcode
2. Ensure your development team is set in project settings
3. Build and run on simulator or device

## 🔧 Database Management

### Initialize Database
```bash
cd mock-backend
python init_db.py
```

### Manage Fixtures
```bash
# Seed database with sample data
python fixtures.py --seed

# Clear all data  
python fixtures.py --clear
```

### Sample Data Included
- **Chat Statuses**: "🟢 Active", "📁 Archived"
- **Task Statuses**: "📋 Todo", "⚡ In Progress", "✅ Done", "❌ Failed"  
- **Sample User** with project, chat, and 5 development tasks

## 🔗 API Endpoints

### Legacy Endpoints (iOS Compatibility)
- `POST /api/requests` - Submit development requests
- `GET /api/requests/{id}/status` - Check request status  
- `GET /api/requests/{id}/tasks` - Retrieve task list

### Database Endpoints
- **Users**: `GET|POST /api/users`, `GET /api/users/{id}`
- **Projects**: `GET|POST /api/projects`, `GET /api/projects/{id}`
- **Chats**: `GET|POST /api/chats`, `GET /api/chats/{id}`  
- **Tasks**: `GET|POST|PUT /api/tasks`, `GET /api/tasks/{id}`
- **Statuses**: `GET /api/chat-statuses`, `GET /api/task-statuses`

## 📊 Key Features

### Real-time Task Management
- Task status progression: Todo → In Progress → Done/Failed
- Priority levels: High (1), Medium (2), Low (3)
- Automatic completion timestamps
- Color-coded status indicators in iOS app

### Project Organization  
- User-owned Git projects
- Project-scoped chat sessions
- Hierarchical task organization
- Foreign key relationships maintained

### Development Workflow
- Submit development requests through iOS app
- AI agent processes requests into actionable tasks
- Real-time status monitoring with polling
- Task completion tracking and metrics

## 🛠️ Development

### Backend Development
- FastAPI with automatic OpenAPI documentation
- SQLAlchemy ORM with relationship management
- PostgreSQL with Docker containerization
- Comprehensive error handling and validation

### iOS Development  
- SwiftUI reactive interface
- Async/await network operations
- Model-driven architecture
- Real-time UI updates

### Database Schema Evolution
- SQLAlchemy migrations support (Alembic included)
- Fixture-based testing data
- Referential integrity enforcement
- Timestamp automation

## 📚 Documentation

- **API Documentation**: http://localhost:8000/docs (when backend is running)
- **Database Models**: See `mock-backend/models.py`
- **iOS Models**: See `ide-mobile/ide-mobile/BackendService.swift`

## 🐳 Docker Services

The `docker-compose.yml` includes:
- **PostgreSQL 15** database with health checks
- **FastAPI backend** with auto-reload for development  
- **Volume persistence** for database data
- **Network isolation** with service discovery

---

*This project demonstrates modern mobile app development with AI integration, featuring robust backend architecture, real-time data synchronization, and professional development workflows.*