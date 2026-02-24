import { getLogger } from '../utils/logger';

const logger = getLogger(['ipRateLimiting']);

export type IPResourceType = 'project' | 'agent' | 'specification' | 'prompt' | 'general';

interface IPRateLimit {
  timestamps: number[]; // Sliding window timestamps
  lastCleanup: number;
}

interface IPRateLimitConfig {
  perMinute: number;
  perHour: number;
  per24Hours: number;
}

/**
 * In-memory IP-based rate limiting service
 * Prevents abuse by limiting resource creation per IP address
 */
export class IPRateLimitingService {
  // In-memory store: IP -> resource type -> rate limit data
  private ipLimits: Map<string, Map<IPResourceType, IPRateLimit>> = new Map();

  // Configuration for different resource types
  private configs: Record<IPResourceType, IPRateLimitConfig> = {
    // Projects: moderate limits
    'project': { perMinute: 10, perHour: 25, per24Hours: 35 },
    // Agents: moderate limits
    'agent': { perMinute: 10, perHour: 25, per24Hours: 35 },
    // Specifications: moderate limits
    'specification': { perMinute: 10, perHour: 25, per24Hours: 35 },
    // Prompts: more lenient (users actively using agents)
    'prompt': { perMinute: 25, perHour: 100, per24Hours: 1000 },
    // General API rate limit: very lenient (prevent DDoS)
    'general': { perMinute: 1000, perHour: 60000, per24Hours: 1440000 },
  };

  constructor() {
    // Cleanup old entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Check if IP address can perform an action
   * Returns { allowed: boolean, reason?: string }
   */
  checkIPLimit(ipAddress: string, resourceType: IPResourceType): { allowed: boolean; reason?: string; retryAfter?: number } {
    const now = Date.now();
    const config = this.configs[resourceType];

    // Get or create IP entry
    if (!this.ipLimits.has(ipAddress)) {
      this.ipLimits.set(ipAddress, new Map());
    }

    const ipResourceLimits = this.ipLimits.get(ipAddress)!;

    // Get or create resource limit entry
    if (!ipResourceLimits.has(resourceType)) {
      ipResourceLimits.set(resourceType, {
        timestamps: [],
        lastCleanup: now
      });
    }

    const limit = ipResourceLimits.get(resourceType)!;

    // Clean up old timestamps
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    limit.timestamps = limit.timestamps.filter(ts => ts > oneDayAgo);

    // Count requests in different time windows
    const lastMinute = limit.timestamps.filter(ts => ts > oneMinuteAgo).length;
    const lastHour = limit.timestamps.filter(ts => ts > oneHourAgo).length;
    const last24Hours = limit.timestamps.length;

    // Check limits
    if (lastMinute >= config.perMinute) {
      const oldestInWindow = limit.timestamps.filter(ts => ts > oneMinuteAgo).sort()[0];
      const retryAfter = Math.ceil((oldestInWindow + 60 * 1000 - now) / 1000);

      logger.warn(`IP rate limit exceeded - ip: ${this.maskIP(ipAddress)}, resource: ${resourceType}, limit: ${config.perMinute}/min, current: ${lastMinute}`);
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${config.perMinute} ${resourceType}s per minute`,
        retryAfter
      };
    }

    if (lastHour >= config.perHour) {
      const oldestInWindow = limit.timestamps.filter(ts => ts > oneHourAgo).sort()[0];
      const retryAfter = Math.ceil((oldestInWindow + 60 * 60 * 1000 - now) / 1000);

      logger.warn(`IP rate limit exceeded - ip: ${this.maskIP(ipAddress)}, resource: ${resourceType}, limit: ${config.perHour}/hour, current: ${lastHour}`);
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${config.perHour} ${resourceType}s per hour`,
        retryAfter
      };
    }

    if (last24Hours >= config.per24Hours) {
      const oldestInWindow = limit.timestamps.sort()[0];
      const retryAfter = Math.ceil((oldestInWindow + 24 * 60 * 60 * 1000 - now) / 1000);

      logger.warn(`IP rate limit exceeded - ip: ${this.maskIP(ipAddress)}, resource: ${resourceType}, limit: ${config.per24Hours}/day, current: ${last24Hours}`);
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${config.per24Hours} ${resourceType}s per 24 hours`,
        retryAfter
      };
    }

    return { allowed: true };
  }

  /**
   * Record that an IP address performed an action
   */
  recordIPAction(ipAddress: string, resourceType: IPResourceType): void {
    const now = Date.now();

    if (!this.ipLimits.has(ipAddress)) {
      this.ipLimits.set(ipAddress, new Map());
    }

    const ipResourceLimits = this.ipLimits.get(ipAddress)!;

    if (!ipResourceLimits.has(resourceType)) {
      ipResourceLimits.set(resourceType, {
        timestamps: [],
        lastCleanup: now
      });
    }

    const limit = ipResourceLimits.get(resourceType)!;
    limit.timestamps.push(now);
  }

  /**
   * Cleanup old entries to prevent memory leaks
   */
  private cleanup(): void {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    let removedIPs = 0;
    let removedEntries = 0;

    for (const [ipAddress, resourceLimits] of this.ipLimits.entries()) {
      for (const [resourceType, limit] of resourceLimits.entries()) {
        // Remove timestamps older than 24 hours
        const oldLength = limit.timestamps.length;
        limit.timestamps = limit.timestamps.filter(ts => ts > oneDayAgo);
        removedEntries += oldLength - limit.timestamps.length;

        // Remove resource entry if no recent activity
        if (limit.timestamps.length === 0 && limit.lastCleanup < oneDayAgo) {
          resourceLimits.delete(resourceType);
        }
      }

      // Remove IP entry if no resources tracked
      if (resourceLimits.size === 0) {
        this.ipLimits.delete(ipAddress);
        removedIPs++;
      }
    }

    if (removedIPs > 0 || removedEntries > 0) {
      logger.info(`IP rate limit cleanup completed - removed ${removedIPs} IPs, ${removedEntries} old entries`);
    }
  }

  /**
   * Mask IP address for logging (privacy)
   */
  private maskIP(ip: string): string {
    const parts = ip.split('.');
    if (parts.length === 4) {
      // IPv4: show first two octets
      return `${parts[0]}.${parts[1]}.xxx.xxx`;
    }
    // IPv6 or other: show first 8 chars
    return ip.substring(0, 8) + 'xxx';
  }

  /**
   * Get current stats (for monitoring/debugging)
   */
  getStats(): { totalIPs: number; totalEntries: number } {
    let totalEntries = 0;
    for (const resourceLimits of this.ipLimits.values()) {
      totalEntries += resourceLimits.size;
    }
    return {
      totalIPs: this.ipLimits.size,
      totalEntries
    };
  }
}
