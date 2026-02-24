// Simple GitHub-only permission system with 24-hour caching
import type { GitHubService } from './github.service';
import { ProjectRole } from '../../shared/types';
import { getLogger } from '../utils/logger';

const logger = getLogger(['permissions']);

interface PermissionCacheEntry {
  permission: ProjectRole | null;
  expiresAt: number;
}

export class PermissionService {
  private cache = new Map<string, PermissionCacheEntry>();
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  constructor(private githubService: GitHubService) {}

  /**
   * Check if user has the required permission level for a repository
   * Uses 24-hour cache to minimize GitHub API calls
   */
  async checkRepoAccess(
    userId: string,
    repoFullName: string,
    requiredLevel: ProjectRole = ProjectRole.READ
  ): Promise<boolean> {
    const permission = await  this.githubService.getCurrentUserRepositoryPermission(
      userId,
      repoFullName
    );
    if (!permission) return false;

    // Permission hierarchy: admin > maintain > write > triage > read > visitor
    // VISITOR is Ariana-only (not a GitHub role) - lowest permission level
    const levels = {
      [ProjectRole.VISITOR]: 0,
      [ProjectRole.READ]: 1,
      [ProjectRole.TRIAGE]: 2,
      [ProjectRole.WRITE]: 3,
      [ProjectRole.MAINTAIN]: 4,
      [ProjectRole.ADMIN]: 5
    };
    return levels[permission.accessLevel] >= levels[requiredLevel];
  }

  /**
   * Clear cache for a specific user-repo combination
   */
  clearCache(userId: string, repoFullName: string): void {
    const cacheKey = `${userId}:${repoFullName}`;
    this.cache.delete(cacheKey);
  }

  /**
   * Clear all cached permissions for a user
   */
  clearUserCache(userId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear expired cache entries (run periodically)
   */
  cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}