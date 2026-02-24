// Agent search handlers

import type { ServiceContainer } from '@/services';
import { addCorsHeaders } from '@/middleware/auth';
import type { AuthenticatedRequest } from '@/middleware/auth';
import { getLogger } from '@/utils/logger';
import type { RequestContext } from './handlers';

const logger = getLogger(['api', 'agents', 'search']);

export interface SearchAgentsResponse {
  success: boolean;
  results?: Array<{
    agentId: string;
    score: number;
    excerpt: string;
    excerptMatchStart: number;
    excerptMatchEnd: number;
  }>;
  error?: string;
}

/**
 * Search agents by query string
 * GET /api/agents/search?q=<query>&projectId=<projectId>
 *
 * Searches in:
 * - Agent name
 * - Agent task summary
 * - Message content (excluding tool calls)
 * - Prompt texts
 *
 * Uses fuzzy matching with Levenshtein distance threshold of ±1/3 query length
 *
 * Optional projectId parameter filters results to agents in that project only.
 */
export async function handleSearchAgents(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get('q');
    const projectId = url.searchParams.get('projectId');

    if (!query || query.trim().length === 0) {
      return addCorsHeaders(Response.json({
        success: true,
        results: []
      } as SearchAgentsResponse), context.origin);
    }

    // Get all agents the user has access to
    const userAccesses = await context.services.userAgentAccesses.getUserAccesses(auth.user.id);
    const accessibleByShare = new Set(userAccesses.map(a => a.agentId));

    // Also get owned agents (with project info for filtering)
    const allAgents = await context.services.agents.getUserAgentsWithProjects(auth.user.id, false);

    // Build a map of agentId -> projectId for filtering
    const agentProjectMap = new Map<string, string>();
    for (const agent of allAgents) {
      if (agent.projectId) {
        agentProjectMap.set(agent.id, agent.projectId);
      }
    }

    // If filtering by project, we also need project info for shared agents
    if (projectId) {
      for (const agentId of accessibleByShare) {
        if (!agentProjectMap.has(agentId)) {
          const agent = await context.services.agents.getAgent(agentId);
          if (agent?.projectId) {
            agentProjectMap.set(agentId, agent.projectId);
          }
        }
      }
    }

    const allAccessibleIds = [
      ...allAgents.map(a => a.id),
      ...accessibleByShare
    ];
    // Deduplicate
    let uniqueAccessibleIds = [...new Set(allAccessibleIds)];

    // Filter by projectId if specified
    if (projectId) {
      uniqueAccessibleIds = uniqueAccessibleIds.filter(id => agentProjectMap.get(id) === projectId);
    }

    logger.info`Searching ${uniqueAccessibleIds.length} agents for user ${auth.user.id}`;

    // Perform search
    const searchResults = await context.services.agentSearch.searchAgents(
      auth.user.id,
      query.trim(),
      uniqueAccessibleIds
    );

    // Return results
    const response: SearchAgentsResponse = {
      success: true,
      results: searchResults.map(r => ({
        agentId: r.agentId,
        score: r.score,
        excerpt: r.excerpt,
        excerptMatchStart: r.excerptMatchStart,
        excerptMatchEnd: r.excerptMatchEnd
      }))
    };

    return addCorsHeaders(Response.json(response), context.origin);
  } catch (error) {
    logger.error`Search agents failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    } as SearchAgentsResponse, { status: 500 }), context.origin);
  }
}
