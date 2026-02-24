import { PrismaClient, type Automation } from '../../../generated/prisma';
import type { AutomationConfig } from '../../../shared/types/automation.types';

export type AutomationWithData = Automation & {
  parsedData: AutomationConfig;
};

export class AutomationRepository {
  constructor(private prisma: PrismaClient) {}

  private parseData(data: string): AutomationConfig {
    try {
      return JSON.parse(data);
    } catch {
      return {
        name: '',
        trigger: { type: 'manual' },
        scriptLanguage: 'bash',
        scriptContent: '',
        blocking: false,
        feedOutput: true
      };
    }
  }

  async createAutomation(automation: {
    projectId: string;
    userId: string;
    data: AutomationConfig;
  }): Promise<AutomationWithData> {
    const now = new Date();
    const id = crypto.randomUUID();

    const created = await this.prisma.automation.create({
      data: {
        id,
        projectId: automation.projectId,
        userId: automation.userId,
        data: JSON.stringify(automation.data),
        createdAt: now,
        updatedAt: now
      }
    });

    return {
      ...created,
      parsedData: this.parseData(created.data)
    };
  }

  async findByProjectId(projectId: string): Promise<AutomationWithData[]> {
    const automations = await this.prisma.automation.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' }
    });

    return automations.map(automation => ({
      ...automation,
      parsedData: this.parseData(automation.data)
    }));
  }

  async findByProjectAndUser(projectId: string, userId: string): Promise<AutomationWithData[]> {
    const automations = await this.prisma.automation.findMany({
      where: { projectId, userId },
      orderBy: { createdAt: 'desc' }
    });

    return automations.map(automation => ({
      ...automation,
      parsedData: this.parseData(automation.data)
    }));
  }

  async findById(id: string): Promise<AutomationWithData | null> {
    const automation = await this.prisma.automation.findUnique({
      where: { id }
    });

    if (!automation) return null;

    return {
      ...automation,
      parsedData: this.parseData(automation.data)
    };
  }

  async updateAutomation(id: string, data: AutomationConfig): Promise<AutomationWithData | null> {
    const now = new Date();

    const updated = await this.prisma.automation.update({
      where: { id },
      data: {
        data: JSON.stringify(data),
        updatedAt: now
      }
    });

    return {
      ...updated,
      parsedData: this.parseData(updated.data)
    };
  }

  async deleteAutomation(id: string): Promise<void> {
    await this.prisma.automation.delete({
      where: { id }
    });
  }

  async getEnvironmentsUsingAutomation(automationId: string): Promise<string[]> {
    const envAutomations = await this.prisma.personalEnvironmentAutomation.findMany({
      where: { automationId },
      select: { environmentId: true }
    });
    return envAutomations.map(ea => ea.environmentId);
  }

  async installAutomationToEnvironment(automationId: string, environmentId: string): Promise<void> {
    const id = crypto.randomUUID();
    const now = new Date();

    await this.prisma.personalEnvironmentAutomation.create({
      data: {
        id,
        automationId,
        environmentId,
        createdAt: now
      }
    });
  }

  async uninstallAutomationFromEnvironment(automationId: string, environmentId: string): Promise<void> {
    await this.prisma.personalEnvironmentAutomation.deleteMany({
      where: {
        automationId,
        environmentId
      }
    });
  }

  async getAutomationsForEnvironment(environmentId: string): Promise<AutomationWithData[]> {
    const envAutomations = await this.prisma.personalEnvironmentAutomation.findMany({
      where: { environmentId },
      include: {
        automation: true
      }
    });

    return envAutomations.map(ea => ({
      ...ea.automation,
      parsedData: this.parseData(ea.automation.data)
    }));
  }

  async isAutomationInstalledInEnvironment(automationId: string, environmentId: string): Promise<boolean> {
    const existing = await this.prisma.personalEnvironmentAutomation.findFirst({
      where: {
        automationId,
        environmentId
      }
    });
    return !!existing;
  }

  // Check if an automation name is unique for the user in the project
  async isNameUniqueForUser(projectId: string, userId: string, name: string, excludeId?: string): Promise<boolean> {
    const automations = await this.findByProjectAndUser(projectId, userId);
    return !automations.some(a =>
      a.parsedData.name === name && a.id !== excludeId
    );
  }

  async moveAutomationsToProject(fromProjectId: string, toProjectId: string): Promise<number> {
    const result = await this.prisma.automation.updateMany({
      where: { projectId: fromProjectId },
      data: { projectId: toProjectId }
    });
    return result.count;
  }
}
