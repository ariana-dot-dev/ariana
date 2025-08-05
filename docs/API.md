# API Documentation

This document describes the REST API endpoints available in Ariana IDE's backend services.

## Base URLs

- **Database Server**: `http://localhost:3000` (development)
- **FastAPI Mock Backend**: `http://localhost:8000` (iOS development)
- **Production**: `https://api2.ariana.dev` (when available)

## Authentication

Most endpoints require JWT authentication. Include the token in the Authorization header:

```http
Authorization: Bearer <your-jwt-token>
```

Obtain tokens through the CLI authentication flow:
```bash
ariana-ide login
```

## Database Server API

### User Management

#### Get Current User
```http
GET /api/user
Authorization: Bearer <token>
```

Response:
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "User Name",
  "provider": "email",
  "avatar_url": "https://...",
  "created_at": "2024-01-01T00:00:00Z"
}
```

#### Get User Statistics
```http
GET /api/users/stats
Authorization: Bearer <token>
```

### Git Repository Management

#### Create Repository
```http
POST /api/repositories
Authorization: Bearer <token>
Content-Type: application/json

{
  "repo_url": "https://github.com/user/repo.git"
}
```

#### Get User Repositories
```http
GET /api/repositories
Authorization: Bearer <token>
```

Response:
```json
[
  {
    "id": 1,
    "repo_url": "https://github.com/user/repo.git",
    "access_status": true,
    "created_at": "2024-01-01T00:00:00Z",
    "last_access_check": "2024-01-01T00:00:00Z"
  }
]
```

#### Update Repository Access
```http
PUT /api/repositories/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "access_status": false
}
```

#### Delete Repository
```http
DELETE /api/repositories/:id
Authorization: Bearer <token>
```

### Backlog Management

#### Create Backlog Item
```http
POST /api/backlog
Authorization: Bearer <token>
Content-Type: application/json

{
  "git_repository_url": "https://github.com/user/repo.git",
  "task": "Implement user authentication",
  "status": "open",
  "priority": 1
}
```

Response:
```json
{
  "id": 1,
  "git_repository_url": "https://github.com/user/repo.git",
  "task": "Implement user authentication",
  "status": "open",
  "priority": 1,
  "owner": "user-uuid",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

#### Get Backlog Items
```http
GET /api/backlog?status=open&git_repository_url=https://github.com/user/repo.git
Authorization: Bearer <token>
```

Query Parameters:
- `status`: Filter by status (`open`, `in_progress`, `completed`)
- `git_repository_url`: Filter by repository URL
- `owner`: Filter by owner UUID (admin only)

#### Update Backlog Item
```http
PUT /api/backlog/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "task": "Updated task description",
  "status": "in_progress",
  "priority": 2
}
```

#### Delete Backlog Item
```http
DELETE /api/backlog/:id
Authorization: Bearer <token>
```

#### Get Backlog Statistics
```http
GET /api/backlog/stats
Authorization: Bearer <token>
```

Response:
```json
{
  "total": 50,
  "open": 20,
  "in_progress": 15,
  "completed": 15,
  "by_priority": {
    "high": 10,
    "medium": 25,
    "low": 15
  }
}
```

## FastAPI Mock Backend (iOS)

### Base URL
```
http://localhost:8000
```

### Interactive Documentation
Access automatic API documentation at `http://localhost:8000/docs`

### Legacy Endpoints (iOS Compatibility)

#### Submit Development Request
```http
POST /api/requests
Content-Type: application/json

{
  "description": "Add dark mode to the application",
  "priority": "high"
}
```

Response:
```json
{
  "request_id": "12345",
  "status": "received",
  "message": "Request submitted for processing"
}
```

#### Check Request Status
```http
GET /api/requests/12345/status
```

Response:
```json
{
  "request_id": "12345",
  "status": "processing",
  "progress_percentage": 75,
  "estimated_completion": "2024-01-01T15:30:00Z"
}
```

#### Get Request Tasks
```http
GET /api/requests/12345/tasks
```

Response:
```json
{
  "request_id": "12345",
  "tasks": [
    {
      "id": 1,
      "name": "Create dark mode toggle component",
      "status": "completed",
      "priority": 1
    },
    {
      "id": 2,
      "name": "Implement theme switching logic",
      "status": "in_progress",
      "priority": 1
    }
  ]
}
```

### Database Endpoints

#### Users
```http
GET /api/users          # List all users
POST /api/users         # Create user
GET /api/users/{id}     # Get specific user
```

#### Projects
```http
GET /api/projects       # List projects
POST /api/projects      # Create project
GET /api/projects/{id}  # Get specific project
```

#### Chats
```http
GET /api/chats          # List chats
POST /api/chats         # Create chat
GET /api/chats/{id}     # Get specific chat
```

#### Tasks
```http
GET /api/tasks          # List tasks
POST /api/tasks         # Create task
PUT /api/tasks/{id}     # Update task
GET /api/tasks/{id}     # Get specific task
```

#### Status References
```http
GET /api/chat-statuses  # Get available chat statuses
GET /api/task-statuses  # Get available task statuses
```

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": "Additional details if available"
}
```

### Common HTTP Status Codes
- `200`: Success
- `201`: Created
- `400`: Bad Request (invalid input)
- `401`: Unauthorized (missing/invalid token)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found
- `422`: Unprocessable Entity (validation errors)
- `500`: Internal Server Error

## Rate Limiting

API endpoints may be rate limited:
- **Development**: No limits
- **Production**: 100 requests per minute per user

Rate limit headers:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

## WebSocket Connections (Planned)

Real-time updates will be available via WebSocket:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');
ws.send(JSON.stringify({
  type: 'subscribe',
  channel: 'backlog_updates',
  token: 'your-jwt-token'
}));
```

## SDK Examples

### JavaScript/TypeScript
```typescript
const response = await fetch('/api/backlog', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    git_repository_url: 'https://github.com/user/repo.git',
    task: 'Implement new feature',
    priority: 1
  })
});

const backlogItem = await response.json();
```

### cURL
```bash
curl -X POST http://localhost:3000/api/backlog \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "git_repository_url": "https://github.com/user/repo.git",
    "task": "Implement new feature",
    "priority": 1
  }'
```

### Swift (iOS)
```swift
struct BacklogItem: Codable {
    let gitRepositoryUrl: String
    let task: String
    let priority: Int
}

func createBacklogItem(_ item: BacklogItem) async throws {
    var request = URLRequest(url: URL(string: "http://localhost:8000/api/tasks")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(item)
    
    let (_, response) = try await URLSession.shared.data(for: request)
    // Handle response...
}
```

---

For more details on specific endpoints, refer to the component-specific documentation:
- [Database Server README](../db-server/README.md)
- [iOS Backend README](../ios-ide/mock-backend/README.md)