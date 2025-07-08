#!/usr/bin/env python3
"""
Database initialization script for the mock backend.
This script creates all tables and sets up the database schema.
"""

import os
import sys
from sqlalchemy import create_engine
from models import Base, create_tables


def init_database():
    """Initialize the database with tables"""
    print("🚀 Initializing database...")
    
    # Get database URL from environment or use default
    database_url = os.getenv("DATABASE_URL", "postgresql://admin:password123@localhost:5432/mock_backend")
    print(f"📊 Database URL: {database_url}")
    
    try:
        # Create engine
        engine = create_engine(database_url)
        
        # Create all tables
        print("📋 Creating tables...")
        Base.metadata.create_all(bind=engine)
        
        print("✅ Database initialization completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Error initializing database: {e}")
        return False


if __name__ == "__main__":
    success = init_database()
    sys.exit(0 if success else 1)