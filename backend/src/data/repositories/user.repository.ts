import { PrismaClient, type User, Prisma } from '../../../generated/prisma';
import type { AgentProviderConfig } from '../../../shared/types';
import { mergeWithDefaults } from '../../../shared/types';

export class UserRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(userData: {
    id: string;
    githubProfileId?: string | null;
    creationMachinePublicSshKey?: string | null;
    anonymousIdentifier?: string | null;
    isAnonymous?: boolean;
  }): Promise<User> {
    const now = new Date();

    // If user has GitHub profile, assign 'github' tier; otherwise 'anonymous'
    const userLimitsTierId = userData.githubProfileId ? 'github' : 'anonymous';

    return this.prisma.user.create({
      data: {
        id: userData.id,
        githubProfileId: userData.githubProfileId || null,
        creationMachinePublicSshKey: userData.creationMachinePublicSshKey || null,
        anonymousIdentifier: userData.anonymousIdentifier || null,
        isAnonymous: userData.isAnonymous || false,
        userLimitsTierId,
        createdAt: now,
        updatedAt: now
      }
    });
  }

  async update(id: string, updates: Prisma.UserUncheckedUpdateInput): Promise<User | null> {
    const now = new Date();

    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...updates,
          updatedAt: now
        }
      });
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.user.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async count(): Promise<number> {
    return this.prisma.user.count();
  }

  async findByGithubProfileId(githubProfileId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { githubProfileId }
    });
  }

  async linkGitHubProfile(userId: string, githubProfileId: string): Promise<User | null> {
    return this.update(userId, { githubProfileId });
  }

  async unlinkGitHubProfile(userId: string): Promise<User | null> {
    return this.update(userId, { githubProfileId: null });
  }

  async findByCreationMachinePublicSshKey(publicSshKey: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { creationMachinePublicSshKey: publicSshKey }
    });
  }

  async findByIdWithProfile(id: string): Promise<Prisma.UserGetPayload<{ include: { githubProfile: true } }> | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: { githubProfile: true }
    });
  }

  async getAllUsersWithGitHubProfile(): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        githubProfileId: {
          not: null
        }
      },
      select: { id: true }
    });
    return users.map(user => user.id);
  }

  async saveClaudeCodeOauthToken(userId: string, token: string): Promise<User | null> {
    const user = await this.findById(userId);
    const currentConfig = mergeWithDefaults(user?.agentProviderConfig as Partial<AgentProviderConfig>);

    const updatedConfig: AgentProviderConfig = {
      ...currentConfig,
      claudeCode: {
        ...currentConfig.claudeCode,
        subscription: {
          ...currentConfig.claudeCode.subscription,
          oauthToken: token
        }
      }
    };

    return this.update(userId, { agentProviderConfig: updatedConfig as unknown as Prisma.InputJsonValue });
  }

  async removeClaudeCodeOauthToken(userId: string): Promise<User | null> {
    const user = await this.findById(userId);
    const currentConfig = mergeWithDefaults(user?.agentProviderConfig as Partial<AgentProviderConfig>);

    const updatedConfig: AgentProviderConfig = {
      ...currentConfig,
      claudeCode: {
        ...currentConfig.claudeCode,
        subscription: {
          // Clear all subscription tokens
        }
      }
    };

    return this.update(userId, { agentProviderConfig: updatedConfig as unknown as Prisma.InputJsonValue });
  }

  async getClaudeCodeOauthToken(userId: string): Promise<string | null> {
    const user = await this.findById(userId);
    const config = mergeWithDefaults(user?.agentProviderConfig as Partial<AgentProviderConfig>);
    return config.claudeCode.subscription.oauthToken || null;
  }

  async saveClaudeOAuthTokens(userId: string, params: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number; // ms since epoch
  }): Promise<User | null> {
    const user = await this.findById(userId);
    const currentConfig = mergeWithDefaults(user?.agentProviderConfig as Partial<AgentProviderConfig>);

    const updatedConfig: AgentProviderConfig = {
      ...currentConfig,
      claudeCode: {
        ...currentConfig.claudeCode,
        subscription: {
          ...currentConfig.claudeCode.subscription,
          oauthToken: params.accessToken,
          refreshToken: params.refreshToken,
          tokenExpiry: new Date(params.expiresAt).toISOString()
        }
      }
    };

    return this.update(userId, { agentProviderConfig: updatedConfig as unknown as Prisma.InputJsonValue });
  }

  async findAllWithProfiles(): Promise<Prisma.UserGetPayload<{ include: { githubProfile: true } }>[]> {
    return this.prisma.user.findMany({
      include: { githubProfile: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getTotalAgentsCount(): Promise<number> {
    const result = await this.prisma.userUsage.aggregate({
      _sum: {
        agentsThisMonth: true
      }
    });
    return result._sum.agentsThisMonth || 0;
  }
}