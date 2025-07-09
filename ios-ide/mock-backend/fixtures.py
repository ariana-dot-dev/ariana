#!/usr/bin/env python3
"""
Fixtures script for seeding the database with initial data.
This script populates the database with status tables and sample data.
"""

import os
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import User, GitProject, ChatStatus, TaskStatus, AgentChat, AgentTask


def seed_database():
    """Seed the database with initial data"""
    print("🌱 Seeding database with fixtures...")
    
    # Get database URL from environment or use default
    database_url = os.getenv("DATABASE_URL", "postgresql://admin:password123@localhost:5432/mock_backend")
    
    try:
        # Create engine and session
        engine = create_engine(database_url)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        db = SessionLocal()
        
        # Check if data already exists
        existing_chat_statuses = db.query(ChatStatus).count()
        if existing_chat_statuses > 0:
            print("📊 Database already contains data. Skipping fixture creation.")
            print("💡 Use --force flag to recreate fixtures (future enhancement)")
            return True
        
        print("📋 Creating chat statuses...")
        chat_statuses = [
            ChatStatus(id=1, label="🟢 Active"),
            ChatStatus(id=2, label="📁 Archived")
        ]
        
        for status in chat_statuses:
            db.add(status)
        
        print("📋 Creating task statuses...")
        task_statuses = [
            TaskStatus(id=1, label="📋 Todo"),
            TaskStatus(id=2, label="⚡ In Progress"),
            TaskStatus(id=3, label="✅ Done"),
            TaskStatus(id=4, label="❌ Failed")
        ]
        
        for status in task_statuses:
            db.add(status)
        
        # Commit status tables first
        db.commit()
        
        print("👤 Creating sample user...")
        sample_user = User()
        db.add(sample_user)
        db.commit()
        db.refresh(sample_user)
        
        print("📂 Creating sample project...")
        sample_project = GitProject(
            name="Sample IDE Project",
            description="A sample project for testing the mock backend API",
            user_owner_id=sample_user.id
        )
        db.add(sample_project)
        db.commit()
        db.refresh(sample_project)
        
        print("💬 Creating sample chat...")
        sample_chat = AgentChat(
            name="Main Development Chat",
            project_id=sample_project.id,
            user_id=sample_user.id,
            status_id=1  # Active
        )
        db.add(sample_chat)
        db.commit()
        db.refresh(sample_chat)
        
        print("📝 Creating sample tasks...")
        sample_tasks = [
            AgentTask(
                name="Set up project structure",
                description="Initialize the basic project structure and configuration files",
                status_id=3,  # Done
                chat_id=sample_chat.id,
                priority=1  # High
            ),
            AgentTask(
                name="Implement user authentication",
                description="Add login and registration functionality",
                status_id=2,  # In Progress
                chat_id=sample_chat.id,
                priority=1  # High
            ),
            AgentTask(
                name="Design API endpoints",
                description="Plan and document all required API endpoints",
                status_id=1,  # Todo
                chat_id=sample_chat.id,
                priority=2  # Medium
            ),
            AgentTask(
                name="Write unit tests",
                description="Create comprehensive test coverage for all components",
                status_id=1,  # Todo
                chat_id=sample_chat.id,
                priority=2  # Medium
            ),
            AgentTask(
                name="Setup CI/CD pipeline",
                description="Configure automated testing and deployment",
                status_id=1,  # Todo
                chat_id=sample_chat.id,
                priority=3  # Low
            )
        ]
        
        for task in sample_tasks:
            db.add(task)
        
        db.commit()
        
        print("✅ Database seeding completed successfully!")
        print(f"📊 Created:")
        print(f"   - {len(chat_statuses)} chat statuses")
        print(f"   - {len(task_statuses)} task statuses")
        print(f"   - 1 sample user (ID: {sample_user.id})")
        print(f"   - 1 sample project (ID: {sample_project.id})")
        print(f"   - 1 sample chat (ID: {sample_chat.id})")
        print(f"   - {len(sample_tasks)} sample tasks")
        
        return True
        
    except Exception as e:
        print(f"❌ Error seeding database: {e}")
        return False
    finally:
        db.close()


def clear_database():
    """Clear all data from the database (useful for testing)"""
    print("🧹 Clearing database...")
    
    database_url = os.getenv("DATABASE_URL", "postgresql://admin:password123@localhost:5432/mock_backend")
    
    try:
        engine = create_engine(database_url)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        db = SessionLocal()
        
        # Delete in reverse order of dependencies
        db.query(AgentTask).delete()
        db.query(AgentChat).delete()
        db.query(GitProject).delete()
        db.query(User).delete()
        db.query(TaskStatus).delete()
        db.query(ChatStatus).delete()
        
        db.commit()
        print("✅ Database cleared successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Error clearing database: {e}")
        return False
    finally:
        db.close()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Database fixtures management")
    parser.add_argument("--clear", action="store_true", help="Clear all data from database")
    parser.add_argument("--seed", action="store_true", help="Seed database with fixtures")
    
    args = parser.parse_args()
    
    if args.clear:
        success = clear_database()
    elif args.seed:
        success = seed_database()
    else:
        # Default action is to seed
        success = seed_database()
    
    sys.exit(0 if success else 1)