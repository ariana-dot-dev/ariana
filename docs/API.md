# API Reference

This document provides comprehensive API documentation for Ariana IDE's backend services.

## Table of Contents
- [Authentication](#authentication)
- [LLM API](#llm-api)
- [Database API](#database-api)
- [Legacy iOS API](#legacy-ios-api)
- [WebSocket Events](#websocket-events)

## Base URL

Production: `https://api.ariana.dev`  
Development: `http://localhost:8080`

## Authentication

All API endpoints (except `/ping` and `/auth/*`) require authentication using a bearer token.

### Request Authentication

```bash
POST /auth/request
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "message": "Authentication code sent to your email"
}
```

### Verify Authentication

```bash
POST /auth/verify
Content-Type: application/json

{
  "email": "user@example.com",
  "code": "123456"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

### Using Authentication

Include the token in the Authorization header for all authenticated requests:

```bash
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

## LLM API

### Health Check

```bash
GET /ping
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### List Providers

Get available LLM providers and their models.

```bash
GET /api/providers
Authorization: Bearer <token>
```

**Response:**
```json
{
  "providers": [
    {
      "name": "anthropic",
      "models": ["claude-3-opus", "claude-3-sonnet", "claude-3-haiku"],
      "features": ["streaming", "function_calling"]
    },
    {
      "name": "openai",
      "models": ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
      "features": ["streaming", "function_calling", "vision"]
    }
  ]
}
```

### Text Completion

```bash
POST /api/inference
Authorization: Bearer <token>
Content-Type: application/json

{
  "provider": "anthropic",
  "model": "claude-3-sonnet",
  "messages": [
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 1000
}
```

**Response:**
```json
{
  "id": "completion-123",
  "model": "claude-3-sonnet",
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 15,
    "total_tokens": 25
  },
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "I'm doing well, thank you! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ]
}
```

### Streaming Completion

```bash
POST /api/inference/stream
Authorization: Bearer <token>
Content-Type: application/json

{
  "provider": "anthropic",
  "model": "claude-3-sonnet",
  "messages": [
    {
      "role": "user",
      "content": "Write a short story"
    }
  ],
  "stream": true
}
```

**Response:** Server-Sent Events stream
```
data: {"type": "chunk", "content": "Once upon a time"}
data: {"type": "chunk", "content": " in a land far away"}
data: {"type": "done", "usage": {"total_tokens": 150}}
```

## Database API

### Users

#### Get All Users
```bash
GET /api/users
Authorization: Bearer <token>
```

#### Get User by ID
```bash
GET /api/users/{id}
Authorization: Bearer <token>
```

#### Create User
```bash
POST /api/users
Authorization: Bearer <token>
Content-Type: application/json

{
  "email": "user@example.com",
  "name": "John Doe"
}
```

### Projects

#### Get All Projects
```bash
GET /api/projects
GET /api/projects?user_id=1  # Filter by user
Authorization: Bearer <token>
```

#### Get Project by ID
```bash
GET /api/projects/{id}
Authorization: Bearer <token>
```

#### Create Project
```bash
POST /api/projects
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My Project",
  "description": "Project description",
  "user_id": 1
}
```

### Chats

#### Get All Chats
```bash
GET /api/chats
GET /api/chats?project_id=1  # Filter by project
Authorization: Bearer <token>
```

#### Get Chat by ID
```bash
GET /api/chats/{id}
Authorization: Bearer <token>
```

#### Create Chat
```bash
POST /api/chats
Authorization: Bearer <token>
Content-Type: application/json

{
  "project_id": 1,
  "title": "Feature Discussion",
  "status": "active"
}
```

### Tasks

#### Get All Tasks
```bash
GET /api/tasks
GET /api/tasks?chat_id=1  # Filter by chat
GET /api/tasks?status=pending  # Filter by status
Authorization: Bearer <token>
```

#### Get Task by ID
```bash
GET /api/tasks/{id}
Authorization: Bearer <token>
```

#### Create Task
```bash
POST /api/tasks
Authorization: Bearer <token>
Content-Type: application/json

{
  "chat_id": 1,
  "description": "Implement user authentication",
  "status": "pending"
}
```

#### Update Task
```bash
PUT /api/tasks/{id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "completed",
  "completed_at": "2024-01-01T12:00:00Z"
}
```

### Status Enums

#### Get Chat Statuses
```bash
GET /api/chat-statuses
Authorization: Bearer <token>
```

**Response:**
```json
{
  "statuses": ["active", "archived", "deleted"]
}
```

#### Get Task Statuses
```bash
GET /api/task-statuses
Authorization: Bearer <token>
```

**Response:**
```json
{
  "statuses": ["pending", "in_progress", "completed", "failed"]
}
```

## Legacy iOS API

These endpoints maintain compatibility with the iOS IDE client.

### Submit Request

```bash
POST /api/requests
Authorization: Bearer <token>
Content-Type: application/json

{
  "description": "Add user authentication feature",
  "context": {
    "files": ["src/auth.js", "src/user.js"],
    "language": "javascript"
  }
}
```

**Response:**
```json
{
  "id": "req-123",
  "status": "processing",
  "created_at": "2024-01-01T00:00:00Z"
}
```

### Check Request Status

```bash
GET /api/requests/{id}/status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": "req-123",
  "status": "completed",
  "progress": 100,
  "message": "All tasks completed successfully"
}
```

### Get Request Tasks

```bash
GET /api/requests/{id}/tasks
Authorization: Bearer <token>
```

**Response:**
```json
{
  "tasks": [
    {
      "id": "task-1",
      "description": "Create auth middleware",
      "status": "completed",
      "order": 1
    },
    {
      "id": "task-2",
      "description": "Add login endpoint",
      "status": "completed",
      "order": 2
    }
  ]
}
```

## WebSocket Events

Connect to receive real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:8080/ws');
ws.send(JSON.stringify({ 
  type: 'auth', 
  token: 'your-bearer-token' 
}));
```

### Event Types

#### Task Update
```json
{
  "type": "task_update",
  "task_id": "task-123",
  "status": "completed",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

#### Chat Message
```json
{
  "type": "chat_message",
  "chat_id": "chat-123",
  "message": {
    "role": "assistant",
    "content": "Task completed successfully"
  }
}
```

#### Progress Update
```json
{
  "type": "progress",
  "request_id": "req-123",
  "progress": 75,
  "message": "Processing task 3 of 4"
}
```

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Detailed error message",
    "field": "email" // Optional, for validation errors
  }
}
```

### Common Error Codes

- `UNAUTHORIZED` - Missing or invalid authentication token
- `NOT_FOUND` - Resource not found
- `INVALID_REQUEST` - Invalid request parameters
- `RATE_LIMITED` - Too many requests
- `SERVER_ERROR` - Internal server error

## Rate Limiting

API requests are rate-limited per user:
- **Default**: 100 requests per minute
- **LLM endpoints**: 20 requests per minute
- **Streaming endpoints**: 5 concurrent connections

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1704070800
```

## Pagination

List endpoints support pagination:

```bash
GET /api/tasks?page=2&limit=20
```

**Response:**
```json
{
  "data": [...],
  "pagination": {
    "page": 2,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```