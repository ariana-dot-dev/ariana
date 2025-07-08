from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from sqlalchemy.sql import func
from datetime import datetime
import os

Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    projects = relationship("GitProject", back_populates="owner")
    chats = relationship("AgentChat", back_populates="user")


class GitProject(Base):
    __tablename__ = "git_projects"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text)
    user_owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    owner = relationship("User", back_populates="projects")
    chats = relationship("AgentChat", back_populates="project")


class ChatStatus(Base):
    __tablename__ = "chat_statuses"
    
    id = Column(Integer, primary_key=True, index=True)
    label = Column(String, nullable=False)
    
    # Relationships
    chats = relationship("AgentChat", back_populates="status")


class TaskStatus(Base):
    __tablename__ = "task_statuses"
    
    id = Column(Integer, primary_key=True, index=True)
    label = Column(String, nullable=False)
    
    # Relationships
    tasks = relationship("AgentTask", back_populates="status")


class AgentChat(Base):
    __tablename__ = "agent_chats"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    project_id = Column(Integer, ForeignKey("git_projects.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status_id = Column(Integer, ForeignKey("chat_statuses.id"), nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    project = relationship("GitProject", back_populates="chats")
    user = relationship("User", back_populates="chats")
    status = relationship("ChatStatus", back_populates="chats")
    tasks = relationship("AgentTask", back_populates="chat")


class AgentTask(Base):
    __tablename__ = "agent_tasks"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text)
    status_id = Column(Integer, ForeignKey("task_statuses.id"), nullable=False, default=1)
    chat_id = Column(Integer, ForeignKey("agent_chats.id"), nullable=False)
    priority = Column(Integer, default=2)  # 1=high, 2=medium, 3=low
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    status = relationship("TaskStatus", back_populates="tasks")
    chat = relationship("AgentChat", back_populates="tasks")


# Database setup
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://admin:password123@localhost:5432/mock_backend")


engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    Base.metadata.create_all(bind=engine)