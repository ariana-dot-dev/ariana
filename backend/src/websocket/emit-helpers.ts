import { eventBus } from '@/events/emitter';

// Helper functions to emit WebSocket events from API handlers.
// These are called after successful mutations to notify WebSocket subscribers.

export function emitAgentEventsChanged(agentId: string, changes?: {
  addedMessageIds?: string[];
  modifiedMessageIds?: string[];
  addedCommitIds?: string[];
  modifiedCommitIds?: string[];
  addedResetIds?: string[];
  addedAutomationEventIds?: string[];
  modifiedAutomationEventIds?: string[];
  addedContextEventIds?: string[];
  addedPromptIds?: string[];
  modifiedPromptIds?: string[];
}): void {
  eventBus.emitEvent('agent:events:changed', { agentId, ...changes });
}

export function emitAgentSummaryChanged(agentId: string): void {
  eventBus.emitEvent('agent:summary:changed', { agentId });
}

export function emitAgentCreated(agentId: string, userId: string): void {
  eventBus.emitEvent('agent:created', { agentId, userId });
}

export function emitAgentUpdated(agentId: string): void {
  eventBus.emitEvent('agent:updated', { agentId });
}

export function emitAgentDeleted(agentId: string, userId: string): void {
  eventBus.emitEvent('agent:deleted', { agentId, userId });
}

export function emitAgentAccessesChanged(userId: string): void {
  eventBus.emitEvent('agent:accesses:changed', { userId });
}

export function emitProjectCreated(userId: string, projectId: string): void {
  eventBus.emitEvent('project:created', { userId, projectId });
}

export function emitProjectUpdated(projectId: string): void {
  eventBus.emitEvent('project:updated', { projectId });
}

export function emitProjectDeleted(projectId: string, userId: string): void {
  eventBus.emitEvent('project:deleted', { projectId, userId });
}

export function emitCollaboratorsChanged(projectId: string): void {
  eventBus.emitEvent('project:collaborators:changed', { projectId });
}

export function emitIssuesChanged(projectId: string): void {
  eventBus.emitEvent('project:issues:changed', { projectId });
}

export function emitTokenHealthChanged(userId: string): void {
  eventBus.emitEvent('github:token-health:changed', { userId });
}
