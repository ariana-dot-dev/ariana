// Agent summary batch handlers - for efficient polling of multiple agents

import type { ServiceContainer } from '@/services';
import { addCorsHeaders } from '@/middleware/auth';
import type { AuthenticatedRequest } from '@/middleware/auth';
import { getLogger } from '@/utils/logger';
import type { AgentCommit } from '@shared/types';

const logger = getLogger(['api', 'agents', 'summary']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

interface AgentSummary {
  agentId: string;
  lastCommitSha: string | null;
  lastCommitUrl: string | null;
  lastCommitAt: string | null;
  additions: number;
  deletions: number;
}

export async function handleGetAgentsSummary(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const agentIdsParam = url.searchParams.get('agentIds');

    if (!agentIdsParam) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'agentIds parameter required'
      }, { status: 400 }), context.origin);
    }

    const agentIds = agentIdsParam.split(',');

    // Check read access for each agent
    const summaries: AgentSummary[] = [];

    for (const agentId of agentIds) {
      const hasAccess = await context.services.userAgentAccesses.hasReadAccess(auth.user.id, agentId);
      if (!hasAccess) {
        continue; // Skip agents user doesn't have access to
      }

      const agent = await context.services.agents.getAgent(agentId);
      if (!agent) {
        continue;
      }

      // Get all non-deleted commits and calculate cumulative additions/deletions
      const commits = await context.services.agents.getAgentCommits(agentId);
      const nonDeletedCommits = commits.filter((c: AgentCommit) => !c.isDeleted);

      // Sum up additions and deletions across all commits
      const totalAdditions = nonDeletedCommits.reduce((sum, c) => sum + (c.additions || 0), 0);
      const totalDeletions = nonDeletedCommits.reduce((sum, c) => sum + (c.deletions || 0), 0);

      summaries.push({
        agentId,
        lastCommitSha: agent.lastCommitSha,
        lastCommitUrl: agent.lastCommitUrl,
        lastCommitAt: agent.lastCommitAt?.toISOString() || null,
        additions: totalAdditions,
        deletions: totalDeletions
      });
    }

    return addCorsHeaders(Response.json({
      success: true,
      summaries
    }), context.origin);
  } catch (error) {
    logger.error`Get agents summary failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}
