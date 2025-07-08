#!/usr/bin/env python3
"""
Setup script for creating a default user (ID: 1) and sample projects.
This script creates the user that the iOS app expects to exist.
"""

import os
import sys
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import User, GitProject, ChatStatus, TaskStatus, AgentChat, AgentTask

def setup_default_user():
    """Setup default user with ID 1 and sample projects"""
    print("🚀 Setting up default user and projects...")
    
    # Get database URL from environment or use default
    database_url = os.getenv("DATABASE_URL", "postgresql://admin:password123@localhost:5432/mock_backend")
    
    try:
        # Create engine and session
        engine = create_engine(database_url)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        db = SessionLocal()
        
        # Check if user ID 1 already exists
        existing_user = db.query(User).filter(User.id == 1).first()
        if existing_user:
            print("✅ Default user (ID: 1) already exists")
            user = existing_user
        else:
            print("👤 Creating default user (ID: 1)...")
            # Create user with specific ID 1
            user = User(id=1)
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"✅ Created user with ID: {user.id}")
        
        # Check if projects already exist for this user
        existing_projects = db.query(GitProject).filter(GitProject.user_owner_id == user.id).count()
        if existing_projects > 0:
            print(f"📂 User already has {existing_projects} projects")
            return True
        
        print("📂 Creating sample projects for default user...")
        
        sample_projects = [
            {
                "name": "Ariana IDE Mobile",
                "description": "iOS app for AI-powered development assistance with real-time task management and voice input"
            },
            {
                "name": "E-Commerce Platform", 
                "description": "Full-stack web application with React frontend, Node.js backend, and PostgreSQL database"
            },
            {
                "name": "Weather Dashboard",
                "description": "Real-time weather monitoring app with interactive charts and location-based forecasts"
            },
            {
                "name": "Task Manager API",
                "description": "RESTful API for project management with authentication, teams, and advanced filtering"
            },
            {
                "name": "Machine Learning Pipeline",
                "description": "Data processing and ML model training pipeline with automated deployment to cloud"
            },
            {
                "name": "Social Media Bot",
                "description": "Automated content creation and posting bot with sentiment analysis and engagement tracking"
            },
            {
                "name": "Crypto Trading Bot",
                "description": "Algorithmic trading system with technical indicators and risk management strategies"
            },
            {
                "name": "Inventory Management",
                "description": "Enterprise inventory tracking system with barcode scanning and supply chain optimization"
            }
        ]
        
        created_projects = []
        for project_data in sample_projects:
            project = GitProject(
                name=project_data["name"],
                description=project_data["description"],
                user_owner_id=user.id
            )
            db.add(project)
            created_projects.append(project)
        
        db.commit()
        
        # Refresh all projects to get their IDs
        for project in created_projects:
            db.refresh(project)
        
        print(f"✅ Created {len(created_projects)} sample projects:")
        for project in created_projects:
            print(f"   - {project.name} (ID: {project.id})")
        
        # Optionally create a sample chat and tasks for the first project
        print("💬 Creating sample chat for first project...")
        first_project = created_projects[0]
        
        # Ensure chat statuses exist
        active_status = db.query(ChatStatus).filter(ChatStatus.id == 1).first()
        if not active_status:
            print("⚠️  Chat statuses not found. Run fixtures.py first to create status tables.")
            return True
        
        sample_chat = AgentChat(
            name="Development Chat",
            project_id=first_project.id,
            user_id=user.id,
            status_id=1  # Active
        )
        db.add(sample_chat)
        db.commit()
        db.refresh(sample_chat)
        
        print(f"✅ Created sample chat (ID: {sample_chat.id}) for project: {first_project.name}")
        
        # Create some sample tasks
        todo_status = db.query(TaskStatus).filter(TaskStatus.id == 1).first()
        if todo_status:
            sample_tasks = [
                {
                    "name": "Setup project structure", 
                    "description": "Initialize repository and basic project configuration",
                    "status_id": 3,  # Done
                    "priority": 1
                },
                {
                    "name": "Implement user authentication",
                    "description": "Add login/logout functionality with JWT tokens", 
                    "status_id": 2,  # In Progress
                    "priority": 1
                },
                {
                    "name": "Design database schema",
                    "description": "Create ERD and implement database migrations",
                    "status_id": 1,  # Todo
                    "priority": 2
                }
            ]
            
            for task_data in sample_tasks:
                task = AgentTask(
                    name=task_data["name"],
                    description=task_data["description"],
                    status_id=task_data["status_id"],
                    chat_id=sample_chat.id,
                    priority=task_data["priority"]
                )
                db.add(task)
            
            db.commit()
            print(f"✅ Created {len(sample_tasks)} sample tasks")
        
        print("\n🎉 Setup completed successfully!")
        print(f"📊 Summary:")
        print(f"   - Default User ID: {user.id}")
        print(f"   - Projects Created: {len(created_projects)}")
        print(f"   - Sample Chat ID: {sample_chat.id}")
        print(f"   - iOS app will now show projects for user ID {user.id}")
        
        return True
        
    except Exception as e:
        print(f"❌ Error setting up default user: {e}")
        return False
    finally:
        db.close()

def clear_user_data(user_id: int = 1):
    """Clear all data for a specific user (useful for testing)"""
    print(f"🧹 Clearing all data for user ID {user_id}...")
    
    database_url = os.getenv("DATABASE_URL", "postgresql://admin:password123@localhost:5432/mock_backend")
    
    try:
        engine = create_engine(database_url)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        db = SessionLocal()
        
        # Delete in reverse order of dependencies
        # Find all chats for user's projects
        user_projects = db.query(GitProject).filter(GitProject.user_owner_id == user_id).all()
        project_ids = [p.id for p in user_projects]
        
        if project_ids:
            # Delete tasks for chats in user's projects
            user_chats = db.query(AgentChat).filter(AgentChat.project_id.in_(project_ids)).all()
            chat_ids = [c.id for c in user_chats]
            
            if chat_ids:
                db.query(AgentTask).filter(AgentTask.chat_id.in_(chat_ids)).delete()
            
            # Delete chats for user's projects
            db.query(AgentChat).filter(AgentChat.project_id.in_(project_ids)).delete()
        
        # Delete user's projects
        db.query(GitProject).filter(GitProject.user_owner_id == user_id).delete()
        
        # Delete the user
        db.query(User).filter(User.id == user_id).delete()
        
        db.commit()
        print(f"✅ Cleared all data for user ID {user_id}")
        return True
        
    except Exception as e:
        print(f"❌ Error clearing user data: {e}")
        return False
    finally:
        db.close()

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Setup default user and projects")
    parser.add_argument("--clear", action="store_true", help="Clear default user data instead of creating")
    parser.add_argument("--user-id", type=int, default=1, help="User ID to work with (default: 1)")
    
    args = parser.parse_args()
    
    if args.clear:
        success = clear_user_data(args.user_id)
    else:
        success = setup_default_user()
    
    sys.exit(0 if success else 1)