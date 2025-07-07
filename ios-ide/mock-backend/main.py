from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import uuid
import time
import asyncio
from datetime import datetime

app = FastAPI(title="Mock Backend API", version="1.0.0")

# CORS middleware for iOS app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
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

# In-memory storage
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


@app.get("/")
async def root():
    return {"message": "Mock Backend API is running"}


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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)