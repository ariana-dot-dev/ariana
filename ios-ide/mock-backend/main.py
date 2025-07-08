from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
import uuid
import time
import asyncio
from datetime import datetime

from models import (
    User, GitProject, ChatStatus, TaskStatus, AgentChat, AgentTask,
    get_db, create_tables
)

app = FastAPI(title="Mock Backend API", version="1.0.0")

# CORS middleware for iOS app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic response models
class RequestModel(BaseModel):
    request: str


class RequestResponse(BaseModel):
    request_id: str
    status: str


class StatusResponse(BaseModel):
    ready: bool
    status: str


class Task(BaseModel):
    id: str
    name: str
    status: str
    description: Optional[str] = None


class TasksResponse(BaseModel):
    tasks: List[Task]


# Pydantic models for database entities
class UserCreate(BaseModel):
    pass


class UserResponse(BaseModel):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class GitProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    user_owner_id: int


class GitProjectResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    user_owner_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ChatStatusResponse(BaseModel):
    id: int
    label: str

    class Config:
        from_attributes = True


class TaskStatusResponse(BaseModel):
    id: int
    label: str

    class Config:
        from_attributes = True


class AgentChatCreate(BaseModel):
    name: str
    project_id: int
    user_id: int
    status_id: int = 1


class AgentChatResponse(BaseModel):
    id: int
    name: str
    project_id: int
    user_id: int
    status_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AgentTaskCreate(BaseModel):
    name: str
    description: Optional[str] = None
    status_id: int = 1
    chat_id: int
    priority: int = 2


class AgentTaskUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status_id: Optional[int] = None
    priority: Optional[int] = None


class AgentTaskResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    status_id: int
    chat_id: int
    priority: int
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# In-memory storage for legacy API endpoints
requests_storage = {}
tasks_storage = {}

# Mock task templates
MOCK_TASKS = [
    {"name": "Initialize Project", "description": "Setting up project structure and dependencies"},
    {"name": "Data Processing", "description": "Processing and analyzing input data"},
    {"name": "API Integration", "description": "Connecting to external services and APIs"},
    {"name": "Model Training", "description": "Training machine learning models"},
    {"name": "Quality Assurance", "description": "Running tests and validation checks"},
    {"name": "Deployment", "description": "Deploying to production environment"},
    {"name": "Monitoring Setup", "description": "Setting up monitoring and alerts"},
    {"name": "Documentation", "description": "Creating and updating documentation"},
]


# Create tables on startup
@app.on_event("startup")
async def startup_event():
    create_tables()


@app.get("/")
async def root():
    return {"message": "Mock Backend API is running"}


# Legacy API endpoints (keeping for backward compatibility)
@app.post("/api/requests", response_model=RequestResponse)
async def submit_request(request: RequestModel):
    request_id = str(uuid.uuid4())
    
    # Store the request
    requests_storage[request_id] = {
        "request": request.request,
        "status": "processing",
        "created_at": datetime.now(),
        "ready": False
    }
    
    # Generate mock tasks for this request
    num_tasks = min(len(MOCK_TASKS), 4 + (len(request.request) % 4))  # 4-7 tasks based on request length
    selected_tasks = MOCK_TASKS[:num_tasks]
    
    tasks = []
    for i, task_template in enumerate(selected_tasks):
        task_id = str(uuid.uuid4())
        status = "pending"
        if i == 0:  # First task is usually in progress
            status = "in_progress"
        
        task = {
            "id": task_id,
            "name": task_template["name"],
            "status": status,
            "description": task_template["description"]
        }
        tasks.append(task)
    
    tasks_storage[request_id] = tasks
    
    # Simulate processing time (mark as ready after 5-10 seconds)
    asyncio.create_task(simulate_processing(request_id))
    
    return RequestResponse(request_id=request_id, status="processing")


async def simulate_processing(request_id: str):
    """Simulate processing time and update task statuses"""
    await asyncio.sleep(5)  # Initial processing time
    
    # Mark request as ready
    if request_id in requests_storage:
        requests_storage[request_id]["ready"] = True
        requests_storage[request_id]["status"] = "ready"
    
    # Simulate task progression
    tasks = tasks_storage.get(request_id, [])
    for i, task in enumerate(tasks):
        await asyncio.sleep(2)  # 2 seconds between task updates
        
        if i == 0:  # First task completes
            task["status"] = "completed"
        elif i == 1:  # Second task starts
            task["status"] = "in_progress"
        elif i == len(tasks) - 1:  # Last task might fail sometimes
            task["status"] = "failed" if hash(request_id) % 4 == 0 else "completed"
        else:
            task["status"] = "completed"


@app.get("/api/requests/{request_id}/status", response_model=StatusResponse)
async def get_request_status(request_id: str):
    if request_id not in requests_storage:
        raise HTTPException(status_code=404, detail="Request not found")
    
    request_data = requests_storage[request_id]
    return StatusResponse(
        ready=request_data["ready"],
        status=request_data["status"]
    )


@app.get("/api/requests/{request_id}/tasks", response_model=TasksResponse)
async def get_request_tasks(request_id: str):
    if request_id not in requests_storage:
        raise HTTPException(status_code=404, detail="Request not found")
    
    if not requests_storage[request_id]["ready"]:
        raise HTTPException(status_code=400, detail="Request not ready yet")
    
    tasks = tasks_storage.get(request_id, [])
    return TasksResponse(tasks=tasks)


@app.get("/api/requests")
async def list_requests():
    """Debug endpoint to see all requests"""
    return {"requests": list(requests_storage.keys()), "total": len(requests_storage)}


@app.get("/api/requests/{request_id}")
async def get_request_details(request_id: str):
    """Debug endpoint to see request details"""
    if request_id not in requests_storage:
        raise HTTPException(status_code=404, detail="Request not found")
    
    return {
        "request": requests_storage[request_id],
        "tasks": tasks_storage.get(request_id, [])
    }


# New Database API endpoints
@app.post("/api/users", response_model=UserResponse)
async def create_user(db: Session = Depends(get_db)):
    db_user = User()
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@app.get("/api/users", response_model=List[UserResponse])
async def get_users(db: Session = Depends(get_db)):
    return db.query(User).all()


@app.get("/api/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: int, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.id == user_id).first()
    if db_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return db_user


@app.post("/api/projects", response_model=GitProjectResponse)
async def create_project(project: GitProjectCreate, db: Session = Depends(get_db)):
    # Check if user exists
    db_user = db.query(User).filter(User.id == project.user_owner_id).first()
    if db_user is None:
        raise HTTPException(status_code=400, detail="User not found")
    
    db_project = GitProject(
        name=project.name,
        description=project.description,
        user_owner_id=project.user_owner_id
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project


@app.get("/api/projects", response_model=List[GitProjectResponse])
async def get_projects(user_id: Optional[int] = None, db: Session = Depends(get_db)):
    if user_id:
        return db.query(GitProject).filter(GitProject.user_owner_id == user_id).all()
    return db.query(GitProject).all()


@app.get("/api/projects/{project_id}", response_model=GitProjectResponse)
async def get_project(project_id: int, db: Session = Depends(get_db)):
    db_project = db.query(GitProject).filter(GitProject.id == project_id).first()
    if db_project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return db_project


@app.get("/api/chat-statuses", response_model=List[ChatStatusResponse])
async def get_chat_statuses(db: Session = Depends(get_db)):
    return db.query(ChatStatus).all()


@app.get("/api/chat-statuses/{status_id}", response_model=ChatStatusResponse)
async def get_chat_status(status_id: int, db: Session = Depends(get_db)):
    db_status = db.query(ChatStatus).filter(ChatStatus.id == status_id).first()
    if db_status is None:
        raise HTTPException(status_code=404, detail="Chat status not found")
    return db_status


@app.get("/api/task-statuses", response_model=List[TaskStatusResponse])
async def get_task_statuses(db: Session = Depends(get_db)):
    return db.query(TaskStatus).all()


@app.get("/api/task-statuses/{status_id}", response_model=TaskStatusResponse)
async def get_task_status(status_id: int, db: Session = Depends(get_db)):
    db_status = db.query(TaskStatus).filter(TaskStatus.id == status_id).first()
    if db_status is None:
        raise HTTPException(status_code=404, detail="Task status not found")
    return db_status


@app.post("/api/chats", response_model=AgentChatResponse)
async def create_chat(chat: AgentChatCreate, db: Session = Depends(get_db)):
    # Validate foreign keys
    db_project = db.query(GitProject).filter(GitProject.id == chat.project_id).first()
    if db_project is None:
        raise HTTPException(status_code=400, detail="Project not found")
    
    db_user = db.query(User).filter(User.id == chat.user_id).first()
    if db_user is None:
        raise HTTPException(status_code=400, detail="User not found")
    
    db_status = db.query(ChatStatus).filter(ChatStatus.id == chat.status_id).first()
    if db_status is None:
        raise HTTPException(status_code=400, detail="Chat status not found")
    
    db_chat = AgentChat(
        name=chat.name,
        project_id=chat.project_id,
        user_id=chat.user_id,
        status_id=chat.status_id
    )
    db.add(db_chat)
    db.commit()
    db.refresh(db_chat)
    return db_chat


@app.get("/api/chats", response_model=List[AgentChatResponse])
async def get_chats(db: Session = Depends(get_db)):
    return db.query(AgentChat).all()


@app.get("/api/chats/{chat_id}", response_model=AgentChatResponse)
async def get_chat(chat_id: int, db: Session = Depends(get_db)):
    db_chat = db.query(AgentChat).filter(AgentChat.id == chat_id).first()
    if db_chat is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    return db_chat


@app.post("/api/tasks", response_model=AgentTaskResponse)
async def create_agent_task(task: AgentTaskCreate, db: Session = Depends(get_db)):
    # Validate foreign keys
    db_chat = db.query(AgentChat).filter(AgentChat.id == task.chat_id).first()
    if db_chat is None:
        raise HTTPException(status_code=400, detail="Chat not found")
    
    db_status = db.query(TaskStatus).filter(TaskStatus.id == task.status_id).first()
    if db_status is None:
        raise HTTPException(status_code=400, detail="Task status not found")
    
    if task.priority not in [1, 2, 3]:
        raise HTTPException(status_code=400, detail="Priority must be 1 (high), 2 (medium), or 3 (low)")
    
    db_task = AgentTask(
        name=task.name,
        description=task.description,
        status_id=task.status_id,
        chat_id=task.chat_id,
        priority=task.priority
    )
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task


@app.get("/api/tasks", response_model=List[AgentTaskResponse])
async def get_agent_tasks(db: Session = Depends(get_db)):
    return db.query(AgentTask).all()


@app.get("/api/tasks/{task_id}", response_model=AgentTaskResponse)
async def get_agent_task(task_id: int, db: Session = Depends(get_db)):
    db_task = db.query(AgentTask).filter(AgentTask.id == task_id).first()
    if db_task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return db_task


@app.put("/api/tasks/{task_id}", response_model=AgentTaskResponse)
async def update_agent_task(task_id: int, task_update: AgentTaskUpdate, db: Session = Depends(get_db)):
    db_task = db.query(AgentTask).filter(AgentTask.id == task_id).first()
    if db_task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    
    update_data = task_update.dict(exclude_unset=True)
    
    # Validate status_id if provided
    if "status_id" in update_data:
        db_status = db.query(TaskStatus).filter(TaskStatus.id == update_data["status_id"]).first()
        if db_status is None:
            raise HTTPException(status_code=400, detail="Task status not found")
        
        # Set completed_at if status is "Done" (status_id = 3)
        if update_data["status_id"] == 3:
            update_data["completed_at"] = datetime.now()
    
    # Validate priority if provided
    if "priority" in update_data and update_data["priority"] not in [1, 2, 3]:
        raise HTTPException(status_code=400, detail="Priority must be 1 (high), 2 (medium), or 3 (low)")
    
    for field, value in update_data.items():
        setattr(db_task, field, value)
    
    db.commit()
    db.refresh(db_task)
    return db_task

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)