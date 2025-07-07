#!/bin/bash

# Mock Backend Startup Script
echo "Starting Mock Backend API..."

# Activate virtual environment
source venv/bin/activate

# Start the FastAPI server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

echo "Mock Backend API is running on http://localhost:8000"
echo "API documentation available at http://localhost:8000/docs"