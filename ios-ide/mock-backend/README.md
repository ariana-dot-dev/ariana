# Mock Backend API

A FastAPI-based mock backend for the Ariana IDE iOS application with PostgreSQL database and SQLAlchemy ORM.

## 🏗️ Architecture

- **FastAPI** REST API with automatic OpenAPI documentation
- **PostgreSQL** database with Docker containerization
- **SQLAlchemy** ORM with relationship management
- **Comprehensive data models** for users, projects, chats, and tasks

## 🗄️ Database Models

- **User** - Basic user entity with timestamps
- **GitProject** - Projects with name, description, and owner relationship
- **ChatStatus** - Status labels for chats ("🟢 Active", "📁 Archived")
- **TaskStatus** - Status labels for tasks ("📋 Todo", "⚡ In Progress", "✅ Done", "❌ Failed")
- **AgentChat** - Chat sessions linked to projects and users
- **AgentTask** - Tasks with priorities, status, and completion tracking

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended)
```bash
# Start all services (database + API)
docker-compose up --build

# API will be available at http://localhost:8000
# Database runs on localhost:5432
```

### Option 2: Local Development Setup

#### Prerequisites
- Python 3.11+
- PostgreSQL running on localhost:5432
- Database named `mock_backend` with user `admin`/`password123`

#### Setup Steps
```bash
# Clone and navigate to backend
cd mock-backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start with automated setup
./start.sh
```

## 🗄️ Database Management

### Complete Setup Sequence
```bash
# Start database
docker-compose up postgres -d

# Initialize schema
python init_db.py

# Create status tables
python fixtures.py --seed

# Setup default user & projects
python setup_default_user.py
```

### Individual Commands

#### Database Initialization
```bash
# Create all tables
python init_db.py
```

#### Fixtures Management
```bash
# Seed database with status tables and sample data
python fixtures.py --seed

# Clear all data
python fixtures.py --clear
```

#### Default User Setup
```bash
# Setup default user (ID: 1) and sample projects
python setup_default_user.py

# Clear user data (for testing)
python setup_default_user.py --clear

# Clear specific user
python setup_default_user.py --clear --user-id 2
```

## 📊 Sample Data Created

### Default User (ID: 1)
The setup script creates a default user that the iOS app expects to exist.

### Sample Projects (8 projects)
- 📱 **Ariana IDE Mobile** - iOS app for AI-powered development assistance
- 💻 **E-Commerce Platform** - Full-stack web application with React and Node.js
- 🌐 **Weather Dashboard** - Real-time weather monitoring with interactive charts
- 🔧 **Task Manager API** - RESTful API for project management
- 🤖 **Machine Learning Pipeline** - Data processing and ML model training
- 📱 **Social Media Bot** - Automated content creation and posting
- 💰 **Crypto Trading Bot** - Algorithmic trading system
- 📦 **Inventory Management** - Enterprise inventory tracking system

### Sample Chat & Tasks
- Development chat for the first project
- 3 sample tasks with different statuses (Done, In Progress, Todo)

## 🔗 API Endpoints

### Legacy Endpoints (iOS Compatibility)
- `POST /api/requests` - Submit development requests
- `GET /api/requests/{id}/status` - Check request status  
- `GET /api/requests/{id}/tasks` - Retrieve task list

### Database Endpoints
- **Users**: `GET|POST /api/users`, `GET /api/users/{id}`
- **Projects**: `GET|POST /api/projects`, `GET /api/projects/{id}`
  - Filter by user: `GET /api/projects?user_id=1`
- **Chats**: `GET|POST /api/chats`, `GET /api/chats/{id}`  
- **Tasks**: `GET|POST|PUT /api/tasks`, `GET /api/tasks/{id}`
- **Statuses**: `GET /api/chat-statuses`, `GET /api/task-statuses`

## 📚 API Documentation

When the server is running, visit:
- **Interactive Docs**: http://localhost:8000/docs
- **OpenAPI JSON**: http://localhost:8000/openapi.json

## 🔧 Configuration

### Environment Variables
```bash
# Database connection
DATABASE_URL=postgresql://admin:password123@localhost:5432/mock_backend
```

### Database Connection Details
- **Host**: localhost
- **Port**: 5432
- **Database**: mock_backend
- **User**: admin
- **Password**: password123

## 🧪 Development Workflow

### Testing Changes
```bash
# Clear and reset database
python fixtures.py --clear
python init_db.py
python fixtures.py --seed
python setup_default_user.py

# Start API with auto-reload
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Adding New Models
1. Update `models.py` with new SQLAlchemy models
2. Add corresponding Pydantic models in `main.py`
3. Create API endpoints for CRUD operations
4. Update fixtures if needed

## 🐳 Docker Services

The `docker-compose.yml` includes:
- **PostgreSQL 15** database with health checks
- **FastAPI backend** with auto-reload for development  
- **Volume persistence** for database data
- **Network isolation** with service discovery

### Docker Commands
```bash
# Start only database
docker-compose up postgres -d

# Start all services
docker-compose up --build

# Stop services
docker-compose down

# Reset with fresh database
docker-compose down -v && docker-compose up --build
```

## 🛠️ Scripts Overview

- **`main.py`** - FastAPI application with all endpoints
- **`models.py`** - SQLAlchemy database models
- **`init_db.py`** - Database table creation
- **`fixtures.py`** - Status tables and sample data seeding
- **`setup_default_user.py`** - Default user and project creation
- **`start.sh`** - Complete startup sequence with error handling
- **`Dockerfile`** - Container image configuration
- **`docker-compose.yml`** - Multi-service orchestration

---

*This backend provides a complete development environment for the Ariana IDE iOS application with realistic data models and comprehensive API coverage.*