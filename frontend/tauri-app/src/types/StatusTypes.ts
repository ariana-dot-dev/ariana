/**
 * Status Types for the Application
 * 
 * This file defines the three distinct status systems used throughout the application:
 * 1. PromptStatus - for individual prompt/agent execution states
 * 2. BacklogTaskStatus - for backlog item management states  
 * 3. PromptMappingStatus - for tracking prompt-to-backlog-item relationships
 * 
 * NOTE: When merging with backend/API changes, ensure these type definitions
 * remain consistent with the database schema and API contracts.
 */

/**
 * PromptStatus - Status of individual prompts/agents during execution
 * Used in: TaskManager, agent execution, canvas states
 * 
 * IMPORTANT: Renamed from TaskStatus to PromptStatus for clarity.
 * When merging changes, ensure all references to TaskStatus are updated to PromptStatus.
 */
export type PromptStatus = 'prompting' | 'queued' | 'running' | 'paused' | 'completed' | 'failed';

/**
 * BacklogTaskStatus - Status of backlog items from project management perspective
 * Used in: BacklogService, CollectiveBacklogManagement, API calls
 * 
 * IMPORTANT: This maps directly to database/API values. 
 * - 'open': Task is available for work
 * - 'in_progress': Someone is working on the task  
 * - 'finished': Task is completed from project management perspective
 * 
 * NOTE: 'finished' is used instead of 'completed' to avoid confusion with PromptStatus.completed
 * API COMPATIBILITY: The backend still expects 'completed', so mapping is required in API calls.
 */
export type BacklogTaskStatus = 'open' | 'in_progress' | 'finished';

/**
 * PromptMappingStatus - Status of the relationship between prompts and backlog tasks
 * Used in: CollectiveBacklogManagement for tracking prompt-to-task mappings
 * 
 * - 'active': Prompt is currently being worked on (mapped to agent)
 * - 'merged': Canvas has been submitted for merge (prompt work is done)
 * 
 * NOTE: 'active' is used instead of 'in_progress' to avoid confusion with BacklogTaskStatus.in_progress
 */
export type PromptMappingStatus = 'active' | 'merged';

/**
 * Utility types for API compatibility
 * These handle the mapping between internal types and API/database values
 */

/**
 * BacklogTaskStatusAPI - The actual values sent to/received from the API
 * This maintains backward compatibility with existing backend implementation
 */
export type BacklogTaskStatusAPI = 'open' | 'in_progress' | 'completed';

/**
 * Mapping functions for API compatibility
 */
export const mapBacklogStatusToAPI = (status: BacklogTaskStatus): BacklogTaskStatusAPI => {
  switch (status) {
    case 'finished':
      return 'completed'; // Map internal 'finished' to API 'completed'
    default:
      return status; // 'open' and 'in_progress' map directly
  }
};

export const mapBacklogStatusFromAPI = (status: BacklogTaskStatusAPI): BacklogTaskStatus => {
  switch (status) {
    case 'completed':
      return 'finished'; // Map API 'completed' to internal 'finished'
    default:
      return status; // 'open' and 'in_progress' map directly
  }
};

/**
 * Type guards for runtime type checking
 */
export const isPromptStatus = (status: string): status is PromptStatus => {
  return ['prompting', 'queued', 'running', 'paused', 'completed', 'failed'].includes(status);
};

export const isBacklogTaskStatus = (status: string): status is BacklogTaskStatus => {
  return ['open', 'in_progress', 'finished'].includes(status);
};

export const isPromptMappingStatus = (status: string): status is PromptMappingStatus => {
  return ['active', 'merged'].includes(status);
};

export const isBacklogTaskStatusAPI = (status: string): status is BacklogTaskStatusAPI => {
  return ['open', 'in_progress', 'completed'].includes(status);
};