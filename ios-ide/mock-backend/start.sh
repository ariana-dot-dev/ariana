#!/bin/bash

# Mock Backend Startup Script
echo "🚀 Starting Mock Backend API..."

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "⚠️  DATABASE_URL not set, using default PostgreSQL connection"
    export DATABASE_URL="postgresql://admin:password123@localhost:5432/mock_backend"
fi

echo "📊 Database URL: $DATABASE_URL"

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    echo "📦 Activating virtual environment..."
    source venv/bin/activate
else
    echo "⚠️  Virtual environment not found. Make sure you've run: python -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
fi

# Wait for database to be ready (useful when using Docker Compose)
echo "⏳ Waiting for database to be ready..."
python -c "
import time
import sys
from sqlalchemy import create_engine
import os

database_url = os.getenv('DATABASE_URL')
max_retries = 30
retry_count = 0

while retry_count < max_retries:
    try:
        engine = create_engine(database_url)
        engine.connect()
        print('✅ Database is ready!')
        break
    except Exception as e:
        print(f'⏳ Waiting for database... (attempt {retry_count + 1}/{max_retries})')
        time.sleep(2)
        retry_count += 1

if retry_count >= max_retries:
    print('❌ Database connection failed after maximum retries')
    sys.exit(1)
"

# Initialize database
echo "📋 Initializing database..."
python init_db.py

# Seed database with fixtures
echo "🌱 Seeding database with fixtures..."
python fixtures.py --seed

# Start the FastAPI server
echo "🎯 Starting FastAPI server..."
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

echo "✅ Mock Backend API is running on http://localhost:8000"
echo "📚 API documentation available at http://localhost:8000/docs"