import type { RepositoryContainer } from '@/data/repositories';
import type { User, Prisma } from '../../generated/prisma';
import { getLogger } from '../utils/logger';
import { randomUUID } from 'crypto';
import type { AgentProviderConfig } from '../../shared/types';
import {
  DEFAULT_AGENT_PROVIDER_CONFIG,
  mergeWithDefaults,
  getActiveEnvironment
} from '../../shared/types';

type UserUpdateData = Prisma.UserUncheckedUpdateInput;

const logger = getLogger(['user']);

export class UserService {
  constructor(private repositories: RepositoryContainer) {}

  // Create new user
  async createUser(data: {
    githubProfileId?: string | null;
    creationMachinePublicSshKey?: string | null;
  }): Promise<User> {
    try {
      const userId = randomUUID();

      const user = await this.repositories.users.create({
        id: userId,
        githubProfileId: data.githubProfileId,
        creationMachinePublicSshKey: data.creationMachinePublicSshKey
      });

      logger.info `User created successfully - userId: ${user.id}, hasGithubProfile: ${!!user.githubProfileId}, hasSshKey: ${!!user.creationMachinePublicSshKey}`;

      return user;
    } catch (error) {
      logger.error `Failed to create user - error: ${error}`;
      throw new Error('USER_CREATION_FAILED: Failed to create user');
    }
  }

  // Get user by ID
  async getUserById(userId: string): Promise<User | null> {
    try {
      const user = await this.repositories.users.findById(userId);
      return user;
    } catch (error) {
      logger.error `Failed to retrieve user - error: ${error}, userId: ${userId}`;
      throw new Error('USER_RETRIEVAL_FAILED: Failed to retrieve user');
    }
  }

  // Update user
  async updateUser(userId: string, updates: UserUpdateData): Promise<User | null> {
    try {
      const user = await this.repositories.users.update(userId, updates);

      if (user) {
        logger.info `User updated successfully - userId: ${userId}`;
      } else {
        logger.warn `User update failed: user not found - userId: ${userId}`;
      }

      return user;
    } catch (error) {
      logger.error `Failed to update user - error: ${error}, userId: ${userId}`;
      throw new Error('USER_UPDATE_FAILED: Failed to update user');
    }
  }

  // Delete user
  async deleteUser(userId: string): Promise<boolean> {
    try {
      const deleted = await this.repositories.users.delete(userId);

      if (deleted) {
        logger.info `User deleted successfully - userId: ${userId}`;
      } else {
        logger.warn `User deletion failed: user not found - userId: ${userId}`;
      }

      return deleted;
    } catch (error) {
      logger.error `Failed to delete user - error: ${error}, userId: ${userId}`;
      throw new Error('USER_DELETION_FAILED: Failed to delete user');
    }
  }

  // Find user by GitHub profile ID
  async findUserByGithubProfileId(githubProfileId: string): Promise<User | null> {
    try {
      const user = await this.repositories.users.findByGithubProfileId(githubProfileId);

      if (user) {
        logger.debug `User found by GitHub profile - githubProfileId: ${githubProfileId}, userId: ${user.id}`;
      } else {
        logger.debug `No user found for GitHub profile - githubProfileId: ${githubProfileId}`;
      }

      return user;
    } catch (error) {
      logger.error `Failed to find user by GitHub profile - error: ${error}, githubProfileId: ${githubProfileId}`;
      throw new Error('USER_GITHUB_LOOKUP_FAILED: Failed to find user by GitHub profile');
    }
  }

  // Find user by SSH key (for account recovery)
  async findUserBySshKey(publicSshKey: string): Promise<User | null> {
    try {
      const user = await this.repositories.users.findByCreationMachinePublicSshKey(publicSshKey);

      if (user) {
        logger.info `User found by SSH key - userId: ${user.id}`;
      } else {
        logger.debug `No user found for SSH key`;
      }

      return user;
    } catch (error) {
      logger.error `Failed to find user by SSH key - error: ${error}`;
      throw new Error('USER_SSH_LOOKUP_FAILED: Failed to find user by SSH key');
    }
  }

  // Link GitHub profile to user
  async linkGitHubProfile(userId: string, githubProfileId: string): Promise<User | null> {
    try {
      const user = await this.repositories.users.linkGitHubProfile(userId, githubProfileId);

      if (user) {
        logger.info `GitHub profile linked to user - userId: ${userId}, githubProfileId: ${githubProfileId}`;
      } else {
        logger.warn `Failed to link GitHub profile: user not found - userId: ${userId}`;
      }

      return user;
    } catch (error) {
      logger.error `Failed to link GitHub profile - error: ${error}, userId: ${userId}, githubProfileId: ${githubProfileId}`;
      throw new Error('USER_GITHUB_LINK_FAILED: Failed to link GitHub profile');
    }
  }

  // Unlink GitHub profile from user
  async unlinkGitHubProfile(userId: string): Promise<User | null> {
    try {
      const user = await this.repositories.users.unlinkGitHubProfile(userId);

      if (user) {
        logger.info `GitHub profile unlinked from user - userId: ${userId}`;
      } else {
        logger.warn `Failed to unlink GitHub profile: user not found - userId: ${userId}`;
      }

      return user;
    } catch (error) {
      logger.error `Failed to unlink GitHub profile - error: ${error}, userId: ${userId}`;
      throw new Error('USER_GITHUB_UNLINK_FAILED: Failed to unlink GitHub profile');
    }
  }

  // Get total user count
  async getUserCount(): Promise<number> {
    try {
      const count = await this.repositories.users.count();
      logger.debug `Total user count retrieved - count: ${count}`;
      return count;
    } catch (error) {
      logger.error `Failed to get user count - error: ${error}`;
      throw new Error('USER_COUNT_FAILED: Failed to get user count');
    }
  }

  // Check if user exists
  async userExists(userId: string): Promise<boolean> {
    try {
      const user = await this.repositories.users.findById(userId);
      return !!user;
    } catch (error) {
      logger.error `Failed to check if user exists - error: ${error}, userId: ${userId}`;
      return false;
    }
  }

  // Get user with GitHub profile
  async getUserWithProfile(userId: string): Promise<Prisma.UserGetPayload<{ include: { githubProfile: true } }> | null> {
    try {
      const user = await this.repositories.users.findByIdWithProfile(userId);
      return user;
    } catch (error) {
      logger.error `Failed to retrieve user with profile - error: ${error}, userId: ${userId}`;
      throw new Error('USER_PROFILE_RETRIEVAL_FAILED: Failed to retrieve user with profile');
    }
  }

  // Get agent provider config (single source of truth)
  async getAgentProviderConfig(userId: string): Promise<AgentProviderConfig> {
    try {
      const user = await this.repositories.users.findById(userId);
      if (!user) {
        logger.debug `User not found, returning default config - userId: ${userId}`;
        return { ...DEFAULT_AGENT_PROVIDER_CONFIG };
      }

      const config = mergeWithDefaults(user.agentProviderConfig as Partial<AgentProviderConfig> | null);
      logger.debug `Agent provider config retrieved - userId: ${userId}, activeAuthMethod: ${config.claudeCode.activeAuthMethod}`;
      return config;
    } catch (error) {
      logger.error `Failed to get agent provider config - error: ${error}, userId: ${userId}`;
      return { ...DEFAULT_AGENT_PROVIDER_CONFIG };
    }
  }

  // Set agent provider config (full or partial update)
  async setAgentProviderConfig(userId: string, config: AgentProviderConfig): Promise<User | null> {
    try {
      const user = await this.repositories.users.update(userId, {
        agentProviderConfig: config as unknown as Prisma.InputJsonValue
      });

      if (user) {
        logger.info `Agent provider config saved - userId: ${userId}, activeAuthMethod: ${config.claudeCode.activeAuthMethod}`;
      } else {
        logger.warn `Failed to save agent provider config: user not found - userId: ${userId}`;
      }

      return user;
    } catch (error) {
      logger.error `Failed to save agent provider config - error: ${error}, userId: ${userId}`;
      throw new Error('AGENT_PROVIDER_CONFIG_SAVE_FAILED: Failed to save agent provider config');
    }
  }

  // Get active credentials as environment variables (for agent operations)
  async getActiveCredentials(userId: string): Promise<{ environment: Record<string, string>; config: AgentProviderConfig }> {
    const config = await this.getAgentProviderConfig(userId);
    const environment = getActiveEnvironment(config);
    return { environment, config };
  }

  // Get all users with their GitHub profiles
  async getAllUsers(): Promise<Prisma.UserGetPayload<{ include: { githubProfile: true } }>[]> {
    try {
      const users = await this.repositories.users.findAllWithProfiles();
      logger.debug `Retrieved all users - count: ${users.length}`;
      return users;
    } catch (error) {
      logger.error `Failed to get all users - error: ${error}`;
      throw new Error('USER_LIST_FAILED: Failed to get all users');
    }
  }

  // Get total agents count from user usage
  async getTotalAgentsCount(): Promise<number> {
    try {
      const totalAgents = await this.repositories.users.getTotalAgentsCount();
      logger.debug `Retrieved total agents count - count: ${totalAgents}`;
      return totalAgents;
    } catch (error) {
      logger.error `Failed to get total agents count - error: ${error}`;
      throw new Error('AGENTS_COUNT_FAILED: Failed to get total agents count');
    }
  }
}