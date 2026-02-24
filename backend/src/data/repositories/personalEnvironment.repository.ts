import { PrismaClient, type PersonalEnvironment } from '../../../generated/prisma';

export interface EnvironmentData {
  name: string;
  envContents: string;
  secretFiles: Array<{
    path: string;
    contents: string;
  }>;
  automationIds?: string[];
  automations?: Array<{
    name: string;
    trigger?: {
      type: string;
      fileGlob?: string;
      commandRegex?: string;
      automationId?: string;
    };
    scriptLanguage?: string;
    scriptContent?: string;
    blocking?: boolean;
    feedOutput?: boolean;
  }>;
  sshKeyPair?: {
    publicKey: string;
    privateKey: string;
    keyName: string;
  };
}

export type PersonalEnvironmentWithData = PersonalEnvironment & {
  parsedData: EnvironmentData;
  automations?: Array<{
    id: string;
    name: string;
  }>;
};

export class PersonalEnvironmentRepository {
  constructor(private prisma: PrismaClient) {}

  private parseData(data: string): EnvironmentData {
    try {
      return JSON.parse(data);
    } catch {
      return { name: '', envContents: '', secretFiles: [] };
    }
  }

  async createEnvironment(environment: {
    projectId: string;
    userId: string;
    data: EnvironmentData;
  }): Promise<PersonalEnvironmentWithData> {
    const now = new Date();
    const id = crypto.randomUUID();

    const created = await this.prisma.personalEnvironment.create({
      data: {
        id,
        projectId: environment.projectId,
        userId: environment.userId,
        data: JSON.stringify(environment.data),
        createdAt: now,
        updatedAt: now
      }
    });

    return {
      ...created,
      parsedData: this.parseData(created.data)
    };
  }

  async findByProjectId(projectId: string): Promise<PersonalEnvironmentWithData[]> {
    const environments = await this.prisma.personalEnvironment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' }
    });

    return environments.map(env => ({
      ...env,
      parsedData: this.parseData(env.data)
    }));
  }

  async findByProjectAndUser(projectId: string, userId: string): Promise<PersonalEnvironmentWithData[]> {
    const environments = await this.prisma.personalEnvironment.findMany({
      where: { projectId, userId },
      orderBy: { createdAt: 'desc' },
      include: {
        automations: {
          include: {
            automation: true
          }
        }
      }
    });

    return environments.map(env => ({
      ...env,
      parsedData: this.parseData(env.data),
      automations: env.automations.map(ea => ({
        id: ea.automation.id,
        name: JSON.parse(ea.automation.data).name
      }))
    }));
  }

  async findById(id: string): Promise<PersonalEnvironmentWithData | null> {
    const environment = await this.prisma.personalEnvironment.findUnique({
      where: { id }
    });

    if (!environment) return null;

    return {
      ...environment,
      parsedData: this.parseData(environment.data)
    };
  }

  async updateEnvironment(id: string, data: EnvironmentData): Promise<PersonalEnvironmentWithData | null> {
    const now = new Date();

    const updated = await this.prisma.personalEnvironment.update({
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

  async deleteEnvironment(id: string): Promise<void> {
    await this.prisma.personalEnvironment.delete({
      where: { id }
    });
  }

  async moveEnvironmentsToProject(fromProjectId: string, toProjectId: string): Promise<number> {
    const result = await this.prisma.personalEnvironment.updateMany({
      where: { projectId: fromProjectId },
      data: { projectId: toProjectId }
    });
    return result.count;
  }

  async getAgentsUsingEnvironment(environmentId: string): Promise<string[]> {
    const agents = await this.prisma.agent.findMany({
      where: { environmentId },
      select: { id: true }
    });
    return agents.map(a => a.id);
  }

  async setDefaultEnvironment(projectId: string, userId: string, environmentId: string): Promise<void> {
    // First, unset any existing default for this project+user
    await this.prisma.personalEnvironment.updateMany({
      where: { projectId, userId, isDefault: true },
      data: { isDefault: false }
    });

    // Then set the new default
    await this.prisma.personalEnvironment.update({
      where: { id: environmentId },
      data: { isDefault: true }
    });
  }

  async getDefaultEnvironment(projectId: string, userId: string): Promise<PersonalEnvironmentWithData | null> {
    const environment = await this.prisma.personalEnvironment.findFirst({
      where: { projectId, userId, isDefault: true }
    });

    if (!environment) return null;

    return {
      ...environment,
      parsedData: this.parseData(environment.data)
    };
  }
}
