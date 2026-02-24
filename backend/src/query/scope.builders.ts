/**
 * Scope builders for user access enforcement.
 *
 * CRITICAL SECURITY: These functions generate WHERE clauses that ensure
 * users can ONLY access their own data. The scope is ALWAYS applied
 * and cannot be bypassed by user-provided filters.
 */

import type { PrismaClient } from '../../generated/prisma';
import type { EntityConfig, ScopeType } from './query.types';

type WhereClause = Record<string, unknown>;

/**
 * Scope builder function type.
 * Takes userId and user filters, returns scoped WHERE clause.
 */
export type ScopeBuilder = (
  userId: string,
  userFilters: WhereClause
) => Promise<WhereClause>;

/**
 * Builds scope for entities with direct userId field.
 * Used for: Agent (where userId = currentUser)
 */
export function buildDirectUserScope(userId: string, userFilters: WhereClause): WhereClause {
  return {
    AND: [
      { userId }, // MANDATORY: only user's own records
      userFilters,
    ],
  };
}

/**
 * Builds scope for entities accessed via project membership.
 * Used for: Project (where user is a member)
 */
export function buildProjectMemberScope(userId: string, userFilters: WhereClause): WhereClause {
  return {
    AND: [
      {
        members: {
          some: { userId }, // MANDATORY: user must be project member
        },
      },
      userFilters,
    ],
  };
}

/**
 * Creates a scope builder for entities accessed via agent ownership.
 * Used for: AgentCommit, AgentPrompt
 *
 * This fetches the user's agent IDs first, then scopes queries to only those agents.
 */
export function createViaAgentScopeBuilder(
  prisma: PrismaClient,
  agentIdField: string
): ScopeBuilder {
  return async (userId: string, userFilters: WhereClause): Promise<WhereClause> => {
    // Extract agentId filter from user filters if present
    const agentIdFilter = extractAgentIdFromFilters(userFilters, agentIdField);

    if (agentIdFilter) {
      // User specified agentId(s) - verify they own ALL of them
      const agentIds = Array.isArray(agentIdFilter) ? agentIdFilter : [agentIdFilter];

      // Fetch only agents owned by this user
      const ownedAgents = await prisma.agent.findMany({
        where: {
          id: { in: agentIds },
          userId, // MANDATORY: user must own these agents
        },
        select: { id: true },
      });

      const ownedAgentIds = ownedAgents.map((a) => a.id);

      // If user doesn't own all requested agents, restrict to only owned ones
      // This prevents information leakage about other users' agents
      return {
        AND: [{ [agentIdField]: { in: ownedAgentIds } }, userFilters],
      };
    } else {
      // No specific agentId filter - scope to ALL user's agents
      const userAgents = await prisma.agent.findMany({
        where: { userId },
        select: { id: true },
      });

      const userAgentIds = userAgents.map((a) => a.id);

      // If user has no agents, return impossible condition
      if (userAgentIds.length === 0) {
        return { [agentIdField]: { in: [] } }; // Will return empty results
      }

      return {
        AND: [{ [agentIdField]: { in: userAgentIds } }, userFilters],
      };
    }
  };
}

/**
 * Extract agentId value from user filters object.
 * Handles both direct equality and Prisma operators.
 */
function extractAgentIdFromFilters(
  filters: WhereClause,
  agentIdField: string
): string | string[] | null {
  // Handle direct field access
  if (filters[agentIdField]) {
    const filter = filters[agentIdField];
    if (typeof filter === 'string') return filter;
    if (typeof filter === 'object' && filter !== null) {
      const filterObj = filter as Record<string, unknown>;
      if (filterObj.equals) return filterObj.equals as string;
      if (filterObj.in) return filterObj.in as string[];
    }
  }

  // Handle AND array
  if (filters.AND && Array.isArray(filters.AND)) {
    for (const clause of filters.AND) {
      const result = extractAgentIdFromFilters(clause as WhereClause, agentIdField);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Get the appropriate scope builder for an entity configuration.
 */
export function getScopeBuilder(
  entityConfig: EntityConfig,
  prisma: PrismaClient
): ScopeBuilder {
  switch (entityConfig.scopeType) {
    case 'direct_user':
      return async (userId, userFilters) => buildDirectUserScope(userId, userFilters);

    case 'project_member':
      return async (userId, userFilters) => buildProjectMemberScope(userId, userFilters);

    case 'via_agent':
      if (!entityConfig.agentIdField) {
        throw new Error(
          `Entity with via_agent scope must have agentIdField defined`
        );
      }
      return createViaAgentScopeBuilder(prisma, entityConfig.agentIdField);

    default:
      throw new Error(`Unknown scope type: ${entityConfig.scopeType}`);
  }
}
