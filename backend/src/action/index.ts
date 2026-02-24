/**
 * Action system exports.
 * Provides schema-driven action execution for agent MCP tools.
 */

export { ActionExecutor } from './action.executor';
export type { ActionAgentService, ActionProjectService, ActionRepositories } from './action.executor';
export { ACTION_CONFIG, AVAILABLE_ACTIONS } from './action.config';
export type {
  ActionInput,
  ActionResponse,
  ActionResult,
  ActionError,
  ActionConfig,
  ActionScopeType,
} from './action.types';
