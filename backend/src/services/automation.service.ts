import type { RepositoryContainer } from '@/data/repositories';
import type { AutomationWithData } from '@/data/repositories/automation.repository';
import type { AutomationConfig } from '@shared/types/automation.types';

export class AutomationService {
  constructor(
    private repositories: RepositoryContainer
  ) {}

  // Get all automations for a project (filtered by user)
  async getProjectAutomations(projectId: string, userId: string): Promise<AutomationWithData[]> {
    return this.repositories.automations.findByProjectAndUser(projectId, userId);
  }

  // Get a single automation
  async getAutomation(automationId: string): Promise<AutomationWithData | null> {
    return this.repositories.automations.findById(automationId);
  }

  // Create a new automation
  async createAutomation(data: {
    projectId: string;
    userId: string;
    automationData: AutomationConfig;
  }): Promise<AutomationWithData> {
    // Validate name is unique for user in project
    const isUnique = await this.repositories.automations.isNameUniqueForUser(
      data.projectId,
      data.userId,
      data.automationData.name
    );

    if (!isUnique) {
      throw new Error(`An automation named "${data.automationData.name}" already exists for this user in this project`);
    }

    // Validate trigger for "on before" types - they must be blocking
    const trigger = data.automationData.trigger;
    const beforeTriggers = [
      'on_before_commit',
      'on_before_push_pr'
    ];

    if (beforeTriggers.includes(trigger.type) && !data.automationData.blocking) {
      throw new Error(`Trigger type "${trigger.type}" must be blocking`);
    }

    return await this.repositories.automations.createAutomation({
      projectId: data.projectId,
      userId: data.userId,
      data: data.automationData
    });
  }

  // Update an automation
  async updateAutomation(
    automationId: string,
    data: AutomationConfig
  ): Promise<AutomationWithData | null> {
    const automation = await this.repositories.automations.findById(automationId);
    if (!automation) return null;

    // Validate name is unique for user in project (excluding this automation)
    const isUnique = await this.repositories.automations.isNameUniqueForUser(
      automation.projectId,
      automation.userId,
      data.name,
      automationId
    );

    if (!isUnique) {
      throw new Error(`An automation named "${data.name}" already exists for this user in this project`);
    }

    // Validate trigger for "on before" types - they must be blocking
    const trigger = data.trigger;
    const beforeTriggers = [
      'on_before_commit',
      'on_before_push_pr'
    ];

    if (beforeTriggers.includes(trigger.type) && !data.blocking) {
      throw new Error(`Trigger type "${trigger.type}" must be blocking`);
    }

    return await this.repositories.automations.updateAutomation(automationId, data);
  }

  // Delete an automation
  async deleteAutomation(automationId: string): Promise<void> {
    await this.repositories.automations.deleteAutomation(automationId);
  }

  // Install automation to environment
  async installAutomationToEnvironment(automationId: string, environmentId: string): Promise<void> {
    // Check if already installed
    const isInstalled = await this.repositories.automations.isAutomationInstalledInEnvironment(
      automationId,
      environmentId
    );

    if (isInstalled) {
      throw new Error('This automation is already installed in this environment');
    }

    await this.repositories.automations.installAutomationToEnvironment(automationId, environmentId);
  }

  // Uninstall automation from environment
  async uninstallAutomationFromEnvironment(automationId: string, environmentId: string): Promise<void> {
    await this.repositories.automations.uninstallAutomationFromEnvironment(automationId, environmentId);
  }

  // Get automations for an environment
  async getAutomationsForEnvironment(environmentId: string): Promise<AutomationWithData[]> {
    return this.repositories.automations.getAutomationsForEnvironment(environmentId);
  }

  // Get environments using an automation
  async getEnvironmentsUsingAutomation(automationId: string): Promise<string[]> {
    return this.repositories.automations.getEnvironmentsUsingAutomation(automationId);
  }

  // Check if automation is installed in environment
  async isAutomationInstalledInEnvironment(automationId: string, environmentId: string): Promise<boolean> {
    return this.repositories.automations.isAutomationInstalledInEnvironment(automationId, environmentId);
  }

  // Get automations for an agent (via its environment)
  async getAutomationsForAgent(agentId: string): Promise<AutomationWithData[]> {
    const agent = await this.repositories.agents.getAgentById(agentId);
    if (!agent) {
      return [];
    }

    // If agent has a specific environment, use it
    if (agent.environmentId) {
      return this.repositories.automations.getAutomationsForEnvironment(agent.environmentId);
    }

    // Fall back to default environment if agent has no environment set
    const defaultEnv = await this.repositories.personalEnvironments.getDefaultEnvironment(
      agent.projectId,
      agent.userId
    );
    if (defaultEnv) {
      return this.repositories.automations.getAutomationsForEnvironment(defaultEnv.id);
    }

    return [];
  }

  // Move automations from one project to another
  async moveAutomationsToProject(fromProjectId: string, toProjectId: string): Promise<number> {
    return this.repositories.automations.moveAutomationsToProject(fromProjectId, toProjectId);
  }
}
