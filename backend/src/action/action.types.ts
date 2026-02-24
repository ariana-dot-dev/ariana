/**
 * Type definitions for the action execution system.
 * Mirrors the query system pattern for consistency.
 */


export type ParamType = 'string' | 'number' | 'boolean' | 'enum' | 'object';

export interface ParamConfig {
  type: ParamType;
  description: string;
  required: boolean;
  /** For enum type */
  enumValues?: string[];
  /** Validation rules */
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
}


export type ActionScopeType =
  | 'agent_owner' // User must own the agent
  | 'agent_write' // User must have write access to agent (owner or shared)
  | 'project_member' // User must be a member of the project
  | 'user_only' // No entity scope, just requires authenticated user
  | 'caller_agent'; // Self-action: operates on the calling agent

export interface ActionConfig {
  /** Human-readable description */
  description: string;
  /** Which entity this action operates on (null for user-level actions) */
  targetEntity: 'agent' | 'project' | 'prompt' | null;
  /** How to identify the target (field name in params) */
  targetIdParam?: string;
  /** Authorization scope */
  scopeType: ActionScopeType;
  /** Parameter definitions */
  params: Record<string, ParamConfig>;
  /** Agent state requirements (if applicable) */
  requiredAgentStates?: string[];
  /** States that block this action */
  blockedAgentStates?: string[];
}


export interface ActionInput {
  action: string;
  params: Record<string, unknown>;
}


export interface ActionResult {
  success: true;
  action: string;
  message: string;
  data?: Record<string, unknown>;
}

export type ActionErrorCode =
  | 'INVALID_ACTION'
  | 'INVALID_PARAM'
  | 'MISSING_PARAM'
  | 'UNAUTHORIZED'
  | 'INVALID_STATE'
  | 'NOT_FOUND'
  | 'EXECUTION_ERROR'
  | 'LIMIT_EXCEEDED';

export interface ActionError {
  success: false;
  error: string;
  code: ActionErrorCode;
}

export type ActionResponse = ActionResult | ActionError;
