import type { ServiceContainer } from '@/services';
import { addCorsHeaders } from '@/middleware/auth';
import type { AuthenticatedRequest } from '@/middleware/auth';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['api', 'agents', 'diff']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

export async function handleGetDiffs(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check read access
    const hasAccess = await context.services.userAgentAccesses.hasReadAccess(auth.user.id, agentId);
    if (!hasAccess) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 403 }), context.origin);
    }

    // Fetch attachments (totalDiff + pendingDiff) and commits in parallel
    const [attachments, allCommits] = await Promise.all([
      context.services.agentAttachments.getAttachments(agentId),
      context.services.agents.getAgentCommits(agentId),
    ]);

    // Filter to non-deleted, non-reverted commits, sorted oldest-first
    const commits = allCommits
      .filter(c => !c.isDeleted && !c.isReverted)
      .sort((a, b) => {
        const ta = a.createdAt ? a.createdAt.getTime() : 0;
        const tb = b.createdAt ? b.createdAt.getTime() : 0;
        return ta - tb;
      })
      .map(c => ({
        sha: c.commitSha,
        message: c.commitMessage,
        additions: c.additions ?? 0,
        deletions: c.deletions ?? 0,
        filesChanged: c.filesChanged ?? 0,
        patch: c.commitPatch || '',
        timestamp: c.createdAt ? c.createdAt.getTime() : 0,
      }));

    return addCorsHeaders(Response.json({
      success: true,
      totalDiff: attachments?.totalDiff || '',
      pendingDiff: attachments?.pendingDiff || '',
      commits,
    }), context.origin);
  } catch (error) {
    logger.error`Get diffs failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}
