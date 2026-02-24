import { ServiceContainer } from '@/services';
import { addCorsHeaders, requireAuthAsync, createAuthErrorResponse } from '@/middleware/auth';
import type { AuthenticatedRequest } from '@/middleware/auth';
import {
  handleCreateProject,
  handleGetProjects,
  handleGetProject,
  handleCheckAndLinkRepository,
  handleGetIssues,
  handleGetProjectCollaborators,
  handleDeleteProject,
  type RequestContext
} from './handlers';
// DEPRECATED - Secrets moved to environments
// import {
//   handleGetSecretFiles,
//   handleCreateSecretFile,
//   handleUpdateSecretFile,
//   handleDeleteSecretFile
// } from './secret-handlers';
import {
  handleGetEnvironments,
  handleGetEnvironment,
  handleCreateEnvironment,
  handleUpdateEnvironment,
  handleInstallEnvironmentToAgent,
  handleSetDefaultEnvironment,
  handleDeleteEnvironment,
  handleGenerateSshKey
} from './environment-handlers';
import {
  handleGetAutomations,
  handleCreateAutomation,
  handleUpdateAutomation,
  handleInstallAutomationToEnvironment,
  handleUninstallAutomationFromEnvironment,
  handleGetAutomationsForEnvironment,
  handleDeleteAutomation,
  handleTriggerManualAutomation,
  handleStopAutomation,
  handleFeedAutomationLogs
} from './automation-handlers';
import { handleCreateAgent, handleStartAgent } from '../agents/handlers';
import { handleGetProjectTemplates } from '../agents/template-handlers';
import { createResourceRateLimit } from '@/middleware/rateLimit';
import { handleRemoveCollaborator } from './handlers';

// Route project endpoints
export async function handleProjectRoutes(
  req: Request,
  url: URL,
  services: ServiceContainer,
  origin: string | null
): Promise<Response | null> {
  const context: RequestContext = { services, origin };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return addCorsHeaders(new Response(null, { status: 200 }), origin);
  }

  // Auth check for all project endpoints
  let auth: AuthenticatedRequest;
  try {
    auth = await requireAuthAsync(req, services);
  } catch (error) {
    return createAuthErrorResponse(error as Error, origin);
  }

  // Parse project ID from path
  const projectIdMatch = url.pathname.match(/^\/api\/projects\/([^\/]+)/);
  const projectId = projectIdMatch ? projectIdMatch[1] : null;

  // Create project from GitHub
  if (url.pathname === '/api/projects' && req.method === 'POST') {
    const projectRateLimit = createResourceRateLimit('project');
    return await projectRateLimit(req, context, () => handleCreateProject(req, context, auth));
  }

  // Get all projects
  if (url.pathname === '/api/projects' && req.method === 'GET') {
    return await handleGetProjects(req, context, auth);
  }

  if (projectId) {
    if (url.pathname === `/api/projects/${projectId}` && req.method === 'GET') {
      return await handleGetProject(req, context, projectId, auth);
    }

    // Delete project
    if (url.pathname === `/api/projects/${projectId}` && req.method === 'DELETE') {
      return await handleDeleteProject(req, context, projectId, auth);
    }

    // Check and link repository
    if (url.pathname === `/api/projects/${projectId}/check-and-link-repository` && req.method === 'POST') {
      return await handleCheckAndLinkRepository(req, context, projectId, auth);
    }

    // Issues endpoint
    if (url.pathname === `/api/projects/${projectId}/issues` && req.method === 'GET') {
      return await handleGetIssues(req, context, projectId, auth);
    }

    // Collaborators endpoint
    if (url.pathname === `/api/projects/${projectId}/collaborators` && req.method === 'GET') {
      return await handleGetProjectCollaborators(req, context, projectId, auth);
    }

    // Remove collaborator endpoint
    const collaboratorMatch = url.pathname.match(/^\/api\/projects\/([^\/]+)\/collaborators\/([^\/]+)$/);
    if (collaboratorMatch && req.method === 'DELETE') {
      const [, projId, userId] = collaboratorMatch;
      return await handleRemoveCollaborator(req, context, projId, userId, auth);
    }

    // DEPRECATED - Secret file endpoints moved to environments
    // Secret files are now managed within environments at:
    // POST   /api/projects/:projectId/environments/:envId/secrets
    // PUT    /api/projects/:projectId/environments/:envId/secrets/:secretId
    // DELETE /api/projects/:projectId/environments/:envId/secrets/:secretId

    // Environment endpoints
    if (url.pathname === `/api/projects/${projectId}/environments` && req.method === 'GET') {
      return await handleGetEnvironments(req, context, projectId, auth);
    }

    if (url.pathname === `/api/projects/${projectId}/environments` && req.method === 'POST') {
      return await handleCreateEnvironment(req, context, projectId, auth);
    }

    // Generate SSH key for environment
    if (url.pathname === `/api/projects/${projectId}/environments/generate-ssh-key` && req.method === 'POST') {
      return await handleGenerateSshKey(req, context, projectId, auth);
    }

    // Environment update/delete/actions routes
    const envMatch = url.pathname.match(/^\/api\/projects\/([^\/]+)\/environments\/([^\/]+)$/);
    if (envMatch) {
      const [, projId, envId] = envMatch;

      if (req.method === 'GET') {
        return await handleGetEnvironment(req, context, projId, envId, auth);
      }

      if (req.method === 'PUT') {
        return await handleUpdateEnvironment(req, context, projId, envId, auth);
      }

      if (req.method === 'DELETE') {
        return await handleDeleteEnvironment(req, context, projId, envId, auth);
      }
    }

    // Install environment to agent
    if (url.pathname.match(`/api/projects/${projectId}/environments/[^/]+/install`) && req.method === 'POST') {
      const envIdMatch = url.pathname.match(`/api/projects/${projectId}/environments/([^/]+)/install`);
      if (envIdMatch) {
        const envId = envIdMatch[1];
        return await handleInstallEnvironmentToAgent(req, context, projectId, envId, auth);
      }
    }

    // Set default environment
    if (url.pathname.match(`/api/projects/${projectId}/environments/[^/]+/set-default`) && req.method === 'POST') {
      const envIdMatch = url.pathname.match(`/api/projects/${projectId}/environments/([^/]+)/set-default`);
      if (envIdMatch) {
        const envId = envIdMatch[1];
        return await handleSetDefaultEnvironment(req, context, projectId, envId, auth);
      }
    }

    // Get automations for environment
    if (url.pathname.match(`/api/projects/${projectId}/environments/[^/]+/automations`) && req.method === 'GET') {
      const envIdMatch = url.pathname.match(`/api/projects/${projectId}/environments/([^/]+)/automations`);
      if (envIdMatch) {
        const envId = envIdMatch[1];
        return await handleGetAutomationsForEnvironment(req, context, projectId, envId, auth);
      }
    }

    // Automation endpoints
    if (url.pathname === `/api/projects/${projectId}/automations` && req.method === 'GET') {
      return await handleGetAutomations(req, context, projectId, auth);
    }

    if (url.pathname === `/api/projects/${projectId}/automations` && req.method === 'POST') {
      return await handleCreateAutomation(req, context, projectId, auth);
    }

    // Automation update/delete/actions routes
    const automationMatch = url.pathname.match(/^\/api\/projects\/([^\/]+)\/automations\/([^\/]+)$/);
    if (automationMatch) {
      const [, projId, automationId] = automationMatch;

      if (req.method === 'PUT') {
        return await handleUpdateAutomation(req, context, projId, automationId, auth);
      }

      if (req.method === 'DELETE') {
        return await handleDeleteAutomation(req, context, projId, automationId, auth);
      }
    }

    // Install automation to environment
    if (url.pathname.match(`/api/projects/${projectId}/automations/[^/]+/install`) && req.method === 'POST') {
      const automationIdMatch = url.pathname.match(`/api/projects/${projectId}/automations/([^/]+)/install`);
      if (automationIdMatch) {
        const automationId = automationIdMatch[1];
        return await handleInstallAutomationToEnvironment(req, context, projectId, automationId, auth);
      }
    }

    // Uninstall automation from environment
    if (url.pathname.match(`/api/projects/${projectId}/automations/[^/]+/uninstall`) && req.method === 'POST') {
      const automationIdMatch = url.pathname.match(`/api/projects/${projectId}/automations/([^/]+)/uninstall`);
      if (automationIdMatch) {
        const automationId = automationIdMatch[1];
        return await handleUninstallAutomationFromEnvironment(req, context, projectId, automationId, auth);
      }
    }

    // Trigger manual automation on agent
    if (url.pathname.match(`/api/projects/${projectId}/automations/[^/]+/trigger`) && req.method === 'POST') {
      const automationIdMatch = url.pathname.match(`/api/projects/${projectId}/automations/([^/]+)/trigger`);
      if (automationIdMatch) {
        const automationId = automationIdMatch[1];
        return await handleTriggerManualAutomation(req, context, projectId, automationId, auth);
      }
    }

    // Stop a running automation on agent
    if (url.pathname.match(`/api/projects/${projectId}/automations/[^/]+/stop`) && req.method === 'POST') {
      const automationIdMatch = url.pathname.match(`/api/projects/${projectId}/automations/([^/]+)/stop`);
      if (automationIdMatch) {
        const automationId = automationIdMatch[1];
        return await handleStopAutomation(req, context, projectId, automationId, auth);
      }
    }

    // Feed automation logs to agent
    if (url.pathname.match(`/api/projects/${projectId}/automations/[^/]+/feed-to-agent`) && req.method === 'POST') {
      const automationIdMatch = url.pathname.match(`/api/projects/${projectId}/automations/([^/]+)/feed-to-agent`);
      if (automationIdMatch) {
        const automationId = automationIdMatch[1];
        return await handleFeedAutomationLogs(req, context, projectId, automationId, auth);
      }
    }

    // Agent creation endpoint
    if (url.pathname === `/api/projects/${projectId}/agents` && req.method === 'POST') {
      const agentRateLimit = createResourceRateLimit('agent');
      return await agentRateLimit(req, context, () => handleCreateAgent(req, context, auth, projectId));
    }

    // Get project templates
    if (url.pathname === `/api/projects/${projectId}/templates` && req.method === 'GET') {
      return await handleGetProjectTemplates(req, context, projectId, auth);
    }

    // Agent start endpoint
    if (url.pathname.match(`/api/projects/${projectId}/agents/[^/]+/start`) && req.method === 'POST') {
      const agentIdMatch = url.pathname.match(`/api/projects/${projectId}/agents/([^/]+)/start`);
      if (agentIdMatch) {
        const agentId = agentIdMatch[1];
        return await handleStartAgent(req, context, auth, agentId);
      }
    }
  }

  return null; // Not a project endpoint
}