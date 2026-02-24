import type { RepositoryContainer } from '@/data/repositories';
import type { PersonalEnvironmentWithData, EnvironmentData } from '@/data/repositories/personalEnvironment.repository';
import type { AutomationWithData } from '@/data/repositories/automation.repository';
import type { AutomationConfig } from '@shared/types/automation.types';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['services', 'personalEnvironment']);

interface EnvParseResult {
  valid: boolean;
  variables: Record<string, string>;
  errors: string[];
}

/** JSON schema for environment with embedded automations */
export interface EnvironmentJSON {
  name: string;
  envContents: string;
  secretFiles: Array<{ path: string; contents: string }>;
  sshKeyPair?: { publicKey: string; privateKey: string; keyName: string } | null;
  automations?: Array<{
    name: string;
    trigger: { type: string; fileGlob?: string; commandRegex?: string; automationId?: string };
    scriptLanguage: 'bash' | 'javascript' | 'python';
    scriptContent: string;
    blocking: boolean;
    feedOutput: boolean;
  }>;
}

/** Dependencies for upsertEnvironmentFromJSON - passed by caller to avoid circular deps */
export interface EnvironmentUpsertDeps {
  automationService: {
    getAutomationsForEnvironment(environmentId: string): Promise<AutomationWithData[]>;
    getProjectAutomations(projectId: string, userId: string): Promise<AutomationWithData[]>;
    createAutomation(data: { projectId: string; userId: string; automationData: AutomationConfig }): Promise<AutomationWithData>;
    updateAutomation(automationId: string, data: AutomationConfig): Promise<AutomationWithData | null>;
    installAutomationToEnvironment(automationId: string, environmentId: string): Promise<void>;
    uninstallAutomationFromEnvironment(automationId: string, environmentId: string): Promise<void>;
  };
  /** Called after environment is updated to sync to running agent */
  onEnvironmentUpdated?: (agentId: string) => Promise<void>;
}

export class PersonalEnvironmentService {
  constructor(
    private repositories: RepositoryContainer
  ) {}

  // Parse .env format contents into key-value pairs
  parseEnvContents(contents: string): EnvParseResult {
    const variables: Record<string, string> = {};
    const errors: string[] = [];
    const lines = contents.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('#')) {
        continue;
      }

      // Check for KEY=VALUE format
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!match) {
        errors.push(`Line ${i + 1}: Invalid format. Expected KEY=value`);
        continue;
      }

      const [, key, value] = match;

      // Handle quoted values
      let processedValue = value;
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        processedValue = value.slice(1, -1);
      }

      variables[key] = processedValue;
    }

    return {
      valid: errors.length === 0,
      variables,
      errors
    };
  }

  // Validate .env format
  validateEnvFormat(contents: string): { valid: boolean; errors: string[] } {
    const result = this.parseEnvContents(contents);
    return {
      valid: result.valid,
      errors: result.errors
    };
  }

  // Get all environments for a project (filtered by user)
  async getProjectEnvironments(projectId: string, userId: string): Promise<PersonalEnvironmentWithData[]> {
    return this.repositories.personalEnvironments.findByProjectAndUser(projectId, userId);
  }

  // Get a single environment
  async getEnvironment(environmentId: string): Promise<PersonalEnvironmentWithData | null> {
    return this.repositories.personalEnvironments.findById(environmentId);
  }

  // Create a new environment
  async createEnvironment(data: {
    projectId: string;
    userId: string;
    environmentData: EnvironmentData;
  }): Promise<PersonalEnvironmentWithData> {
    // Validate .env format
    const validation = this.validateEnvFormat(data.environmentData.envContents);
    if (!validation.valid) {
      throw new Error(`Invalid .env format: ${validation.errors.join(', ')}`);
    }

    return await this.repositories.personalEnvironments.createEnvironment({
      projectId: data.projectId,
      userId: data.userId,
      data: data.environmentData
    });
  }

  // Update an environment
  async updateEnvironment(
    environmentId: string,
    data: EnvironmentData
  ): Promise<PersonalEnvironmentWithData | null> {
    const environment = await this.repositories.personalEnvironments.findById(environmentId);
    if (!environment) return null;

    // Validate .env format
    const validation = this.validateEnvFormat(data.envContents);
    if (!validation.valid) {
      throw new Error(`Invalid .env format: ${validation.errors.join(', ')}`);
    }

    return await this.repositories.personalEnvironments.updateEnvironment(environmentId, data);
  }

  // Delete an environment
  async deleteEnvironment(environmentId: string): Promise<void> {
    await this.repositories.personalEnvironments.deleteEnvironment(environmentId);
  }

  // Move environments from one project to another
  async moveEnvironmentsToProject(fromProjectId: string, toProjectId: string): Promise<number> {
    return this.repositories.personalEnvironments.moveEnvironmentsToProject(fromProjectId, toProjectId);
  }

  // Get environment variables as a Record for agent server
  async getEnvironmentVariablesForAgent(agentId: string): Promise<Record<string, string>> {
    const agent = await this.repositories.agents.getAgentById(agentId);
    if (!agent) {
      return {};
    }

    // If agent has a specific environment, use it
    if (agent.environmentId) {
      const environment = await this.repositories.personalEnvironments.findById(agent.environmentId);
      if (environment) {
        const parsed = this.parseEnvContents(environment.parsedData.envContents);
        return parsed.variables;
      }
    }

    // Fall back to default environment if agent has no environment set
    const defaultEnv = await this.repositories.personalEnvironments.getDefaultEnvironment(agent.projectId, agent.userId);
    if (defaultEnv) {
      const parsed = this.parseEnvContents(defaultEnv.parsedData.envContents);
      return parsed.variables;
    }

    return {};
  }

  // Get secret files for an agent
  async getSecretFilesForAgent(agentId: string): Promise<Array<{ path: string; contents: string }>> {
    const agent = await this.repositories.agents.getAgentById(agentId);
    if (!agent) {
      return [];
    }

    // If agent has a specific environment, use it
    if (agent.environmentId) {
      const environment = await this.repositories.personalEnvironments.findById(agent.environmentId);
      if (environment && environment.parsedData.secretFiles) {
        return environment.parsedData.secretFiles;
      }
    }

    // Fall back to default environment if agent has no environment set
    const defaultEnv = await this.repositories.personalEnvironments.getDefaultEnvironment(agent.projectId, agent.userId);
    if (defaultEnv && defaultEnv.parsedData.secretFiles) {
      return defaultEnv.parsedData.secretFiles;
    }

    return [];
  }

  // Get SSH key pair for agent
  async getSshKeyPairForAgent(agentId: string): Promise<{ publicKey: string; privateKey: string; keyName: string } | null> {
    const agent = await this.repositories.agents.getAgentById(agentId);
    if (!agent) {
      return null;
    }

    // If agent has a specific environment, use it
    if (agent.environmentId) {
      const environment = await this.repositories.personalEnvironments.findById(agent.environmentId);
      if (environment && environment.parsedData.sshKeyPair) {
        return environment.parsedData.sshKeyPair;
      }
    }

    // Fall back to default environment if agent has no environment set
    const defaultEnv = await this.repositories.personalEnvironments.getDefaultEnvironment(agent.projectId, agent.userId);
    if (defaultEnv && defaultEnv.parsedData.sshKeyPair) {
      return defaultEnv.parsedData.sshKeyPair;
    }

    return null;
  }

  // Get agents using an environment
  async getAgentsUsingEnvironment(environmentId: string): Promise<string[]> {
    return this.repositories.personalEnvironments.getAgentsUsingEnvironment(environmentId);
  }

  // Install environment to an agent
  async installEnvironmentToAgent(environmentId: string, agentId: string): Promise<{ previousEnvironmentId: string | null; previousEnvironmentName: string | null }> {
    const agent = await this.repositories.agents.getAgentById(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    const environment = await this.repositories.personalEnvironments.findById(environmentId);
    if (!environment) {
      throw new Error('Environment not found');
    }

    // Verify environment belongs to agent's user and project
    if (environment.userId !== agent.userId || environment.projectId !== agent.projectId) {
      throw new Error('Environment does not belong to agent\'s user or project');
    }

    // Get previous environment info
    let previousEnvironmentId = agent.environmentId;
    let previousEnvironmentName: string | null = null;

    if (previousEnvironmentId) {
      const prevEnv = await this.repositories.personalEnvironments.findById(previousEnvironmentId);
      previousEnvironmentName = prevEnv?.parsedData.name || null;
    }

    // Update agent's environment
    await this.repositories.agents.updateAgentFields(agentId, {
      environmentId: environmentId
    });

    return {
      previousEnvironmentId,
      previousEnvironmentName
    };
  }

  // Uninstall environment from an agent
  async uninstallEnvironmentFromAgent(agentId: string): Promise<void> {
    await this.repositories.agents.updateAgentFields(agentId, {
      environmentId: null
    });
  }

  // Set default environment for a project/user
  async setDefaultEnvironment(projectId: string, userId: string, environmentId: string): Promise<void> {
    await this.repositories.personalEnvironments.setDefaultEnvironment(projectId, userId, environmentId);
  }

  // Get default environment for a project/user
  async getDefaultEnvironment(projectId: string, userId: string): Promise<PersonalEnvironmentWithData | null> {
    return this.repositories.personalEnvironments.getDefaultEnvironment(projectId, userId);
  }

  /**
   * Upsert environment from JSON with embedded automations.
   * This is the shared logic used by both API handlers and MCP.
   *
   * If the agent already has an environment: updates it
   * If not: creates a new environment and installs it to the agent
   *
   * Handles automation reconciliation:
   * - Creates new automations that don't exist
   * - Updates existing automations
   * - Uninstalls automations that were removed from JSON
   */
  async upsertEnvironmentFromJSON(
    agentId: string,
    userId: string,
    projectId: string,
    json: EnvironmentJSON,
    deps: EnvironmentUpsertDeps
  ): Promise<{ success: boolean; error?: string; environmentId?: string }> {
    try {
      const agent = await this.repositories.agents.getAgentById(agentId);
      if (!agent) {
        return { success: false, error: 'Agent not found' };
      }

      // Verify agent belongs to user and project
      if (agent.userId !== userId || agent.projectId !== projectId) {
        return { success: false, error: 'Agent does not belong to user or project' };
      }

      let environmentId = agent.environmentId;

      if (environmentId) {
        // Update existing environment
        const environment = await this.getEnvironment(environmentId);
        if (!environment) {
          return { success: false, error: 'Environment not found' };
        }

        // Verify environment belongs to user
        if (environment.userId !== userId) {
          return { success: false, error: 'Environment does not belong to user' };
        }

        // Handle automations BEFORE updating environment (same as API handler)
        if (json.automations) {
          await this.reconcileAutomations(
            environmentId,
            projectId,
            userId,
            json.automations,
            deps.automationService
          );
        }

        // Update environment data
        await this.updateEnvironment(environmentId, {
          name: json.name,
          envContents: json.envContents,
          secretFiles: json.secretFiles || [],
          sshKeyPair: json.sshKeyPair || undefined,
        });
      } else {
        // Create new environment
        const newEnv = await this.createEnvironment({
          projectId,
          userId,
          environmentData: {
            name: json.name,
            envContents: json.envContents,
            secretFiles: json.secretFiles || [],
            sshKeyPair: json.sshKeyPair || undefined,
          },
        });
        environmentId = newEnv.id;

        // Install to agent
        await this.installEnvironmentToAgent(environmentId, agentId);

        // Handle automations for new environment
        if (json.automations) {
          await this.reconcileAutomations(
            environmentId,
            projectId,
            userId,
            json.automations,
            deps.automationService
          );
        }
      }

      // Sync to running agent if callback provided
      if (deps.onEnvironmentUpdated && agent.isRunning) {
        try {
          await deps.onEnvironmentUpdated(agentId);
        } catch (error) {
          logger.error`Failed to sync environment to running agent ${agentId}: ${error}`;
        }
      }

      return { success: true, environmentId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Get environment for agent as JSON format (for MCP getMyEnvironment)
   */
  async getEnvironmentAsJSON(
    agentId: string,
    automationService: { getAutomationsForEnvironment(environmentId: string): Promise<AutomationWithData[]> }
  ): Promise<EnvironmentJSON | null> {
    const agent = await this.repositories.agents.getAgentById(agentId);
    if (!agent || !agent.environmentId) {
      return null;
    }

    const env = await this.getEnvironment(agent.environmentId);
    if (!env) {
      return null;
    }

    const automations = await automationService.getAutomationsForEnvironment(agent.environmentId);

    return {
      name: env.parsedData.name,
      envContents: env.parsedData.envContents,
      secretFiles: (env.parsedData.secretFiles || []).map(sf => ({
        path: sf.path,
        contents: sf.contents,
      })),
      sshKeyPair: env.parsedData.sshKeyPair || null,
      automations: automations.map(auto => ({
        name: auto.parsedData.name,
        trigger: auto.parsedData.trigger,
        scriptLanguage: auto.parsedData.scriptLanguage as 'bash' | 'javascript' | 'python',
        scriptContent: auto.parsedData.scriptContent,
        blocking: auto.parsedData.blocking,
        feedOutput: auto.parsedData.feedOutput,
      })),
    };
  }

  /**
   * Reconcile automations for an environment based on JSON input.
   * Creates new automations, updates existing ones, and uninstalls removed ones.
   * This is the logic extracted from handleUpdateEnvironment.
   */
  private async reconcileAutomations(
    environmentId: string,
    projectId: string,
    userId: string,
    automationsJson: NonNullable<EnvironmentJSON['automations']>,
    automationService: EnvironmentUpsertDeps['automationService']
  ): Promise<void> {
    // Get current automations for this environment
    const currentAutomations = await automationService.getAutomationsForEnvironment(environmentId);
    const currentAutomationNames = new Set(currentAutomations.map(a => a.parsedData.name));
    const requestedAutomationNames = new Set(automationsJson.map(a => a.name));

    // Uninstall automations that are no longer referenced
    for (const automation of currentAutomations) {
      if (!requestedAutomationNames.has(automation.parsedData.name)) {
        try {
          await automationService.uninstallAutomationFromEnvironment(automation.id, environmentId);
        } catch (error) {
          logger.error`Failed to uninstall automation ${automation.id} from environment ${environmentId}: ${error}`;
        }
      }
    }

    // Get all user automations for lookup by name
    const allUserAutomations = await automationService.getProjectAutomations(projectId, userId);

    // Install or update referenced automations
    for (const automationRef of automationsJson) {
      // Find automation by name for this user+project
      const existing = allUserAutomations.find(a => a.parsedData.name === automationRef.name);

      if (!existing) {
        // Automation doesn't exist, create it with the full data from JSON
        try {
          const created = await automationService.createAutomation({
            projectId,
            userId,
            automationData: {
              name: automationRef.name,
              trigger: automationRef.trigger as AutomationConfig['trigger'],
              scriptLanguage: automationRef.scriptLanguage,
              scriptContent: automationRef.scriptContent,
              blocking: automationRef.blocking,
              feedOutput: automationRef.feedOutput,
            },
          });
          // Install to environment
          await automationService.installAutomationToEnvironment(created.id, environmentId);
        } catch (error) {
          logger.error`Failed to create and install new automation from JSON: ${error}`;
        }
      } else {
        // Automation exists - update it if fields have changed
        try {
          await automationService.updateAutomation(existing.id, {
            name: automationRef.name,
            trigger: automationRef.trigger as AutomationConfig['trigger'],
            scriptLanguage: automationRef.scriptLanguage,
            scriptContent: automationRef.scriptContent,
            blocking: automationRef.blocking,
            feedOutput: automationRef.feedOutput,
          });
        } catch (error) {
          logger.error`Failed to update automation ${existing.id} from JSON: ${error}`;
        }

        // Install if not already installed to this environment
        const isInstalled = currentAutomations.some(a => a.id === existing.id);
        if (!isInstalled) {
          try {
            await automationService.installAutomationToEnvironment(existing.id, environmentId);
          } catch (error) {
            logger.error`Failed to install automation ${existing.id} to environment ${environmentId}: ${error}`;
          }
        }
      }
    }
  }
}
