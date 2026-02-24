import { PrismaClient } from '../../../generated/prisma';

export interface CommitStats {
  totalCommits: number;
  totalPushedCommits: number;
  pushedCommitsPercentage: number;
}

export interface AgentWithPushAndPRStats {
  totalAgents: number;
  agentsWithPushAndPR: number;
  agentsWithPushAndPRPercentage: number;
}

export interface UserWithMetrics {
  id: string;
  email: string;
  name: string;
  isAnonymous: boolean;
  createdAt: Date | null;
  projectCount: number;
  agentCount: number;
  commitCount: number;
  pushedCommitCount: number;
  pushedCommitPercentage: number;
}

export interface UserDistributionByCount {
  count: number;
  usersByAgents: number;
  usersByPrompts: number;
  usersByAgentsWithPR: number;
}

export interface RetentionCohortData {
  dayNumber: number;
  users0DayGap: number;
  users1DayGap: number;
  users3DayGap: number;
  users7DayGap: number;
}

export interface SessionDurationData {
  halfHourBucket: number;
  userCount: number;
}

export type CohortPeriod = 'daily' | 'weekly' | 'biweekly';

export interface SignupCohort {
  cohortLabel: string;
  cohortStart: Date;
  cohortEnd: Date;
  userCount: number;
}

export interface ActivationRateData {
  cohortLabel: string;
  userCount: number;
  activatedDay1: number;
  activatedDay3: number;
  activatedDay7: number;
  activationRateDay1: number;
  activationRateDay3: number;
  activationRateDay7: number;
}

export interface EngagementProgressionData {
  cohortLabel: string;
  dayNumber: number;
  avgAgents: number;
  avgPrompts: number;
  avgPushedCommits: number;
}

export interface TimeToFirstActionData {
  cohortLabel: string;
  medianTimeToFirstAgent: number | null;
  medianTimeToFirstPrompt: number | null;
  medianTimeToFirstPush: number | null;
  p75TimeToFirstAgent: number | null;
  p75TimeToFirstPrompt: number | null;
  p75TimeToFirstPush: number | null;
}

export interface RetentionByWeekData {
  cohortLabel: string;
  userCount: number;
  retainedWeek2: number;
  retentionRateWeek2: number;
  retainedWeek3: number;
  retentionRateWeek3: number;
}

export interface SuccessRateByCohortData {
  cohortLabel: string;
  totalAgents: number;
  agentsWithPush: number;
  agentsWithPR: number;
  pushRate: number;
  prRate: number;
}

export class DashboardAnalyticsRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Build a Prisma where clause to exclude users by GitHub profile name.
   * Used for on-the-fly computed analytics.
   */
  private buildExcludeUsersWhere(excludeUsers: string[]): Record<string, any> {
    if (excludeUsers.length === 0) return {};
    return {
      OR: [
        { githubProfile: null },
        { githubProfile: { name: { notIn: excludeUsers } } }
      ]
    };
  }

  async getCommitStats(): Promise<CommitStats> {
    const totalCommits = await this.prisma.agentCommit.count();
    const totalPushedCommits = await this.prisma.agentCommit.count({
      where: { pushed: true }
    });

    const pushedCommitsPercentage = totalCommits > 0
      ? (totalPushedCommits / totalCommits) * 100
      : 0;

    return {
      totalCommits,
      totalPushedCommits,
      pushedCommitsPercentage
    };
  }

  async getAgentWithPushAndPRStats(): Promise<AgentWithPushAndPRStats> {
    const totalAgents = await this.prisma.agent.count();
    const agentsWithPushAndPR = await this.prisma.agent.count({
      where: {
        AND: [
          { lastCommitPushed: true },
          { prUrl: { not: null } }
        ]
      }
    });

    const agentsWithPushAndPRPercentage = totalAgents > 0
      ? (agentsWithPushAndPR / totalAgents) * 100
      : 0;

    return {
      totalAgents,
      agentsWithPushAndPR,
      agentsWithPushAndPRPercentage
    };
  }

  async getUsersWithMetrics(): Promise<UserWithMetrics[]> {
    const users = await this.prisma.user.findMany({
      include: {
        githubProfile: true,
        projectMemberships: {
          select: { id: true }
        },
        agents: {
          select: {
            id: true,
            tasks: {
              select: {
                agentCommits: {
                  select: {
                    id: true,
                    pushed: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return users.map(user => {
      const agentCount = user.agents.length;
      const projectCount = user.projectMemberships.length;

      let commitCount = 0;
      let pushedCommitCount = 0;
      for (const agent of user.agents) {
        for (const task of agent.tasks) {
          for (const commit of task.agentCommits) {
            commitCount++;
            if (commit.pushed) pushedCommitCount++;
          }
        }
      }

      return {
        id: user.id,
        email: user.githubProfile?.email || user.anonymousIdentifier || 'N/A',
        name: user.githubProfile?.name || 'Anonymous',
        isAnonymous: user.isAnonymous,
        createdAt: user.createdAt,
        projectCount,
        agentCount,
        commitCount,
        pushedCommitCount,
        pushedCommitPercentage: commitCount > 0 ? (pushedCommitCount / commitCount) * 100 : 0,
      };
    });
  }

  async getUserDistributionData(excludeUsers: string[] = []): Promise<UserDistributionByCount[]> {
    const excludeWhere = this.buildExcludeUsersWhere(excludeUsers);

    // Get all users with their agent counts, prompt counts, and agents with PR counts
    const usersWithCounts = await this.prisma.user.findMany({
      where: excludeWhere,
      select: {
        id: true,
        agents: {
          select: {
            id: true,
            prUrl: true,
            tasks: {
              select: {
                id: true
              }
            }
          }
        }
      }
    });

    // Calculate max values to determine the range
    let maxAgents = 0;
    let maxPrompts = 0;
    let maxAgentsWithPR = 0;

    const userStats = usersWithCounts.map(user => {
      const agentCount = user.agents.length;
      const promptCount = user.agents.reduce((sum, agent) => sum + agent.tasks.length, 0);
      const agentsWithPRCount = user.agents.filter(agent => agent.prUrl !== null).length;

      maxAgents = Math.max(maxAgents, agentCount);
      maxPrompts = Math.max(maxPrompts, promptCount);
      maxAgentsWithPR = Math.max(maxAgentsWithPR, agentsWithPRCount);

      return {
        agentCount,
        promptCount,
        agentsWithPRCount
      };
    });

    // Create distribution data
    const maxCount = Math.max(maxAgents, maxPrompts, maxAgentsWithPR);
    const distribution: UserDistributionByCount[] = [];

    for (let count = 0; count <= maxCount; count++) {
      distribution.push({
        count,
        usersByAgents: userStats.filter(u => u.agentCount >= count).length,
        usersByPrompts: userStats.filter(u => u.promptCount >= count).length,
        usersByAgentsWithPR: userStats.filter(u => u.agentsWithPRCount >= count).length
      });
    }

    return distribution;
  }

  async getRetentionCohortData(excludeUsers: string[] = []): Promise<RetentionCohortData[]> {
    const excludeWhere = this.buildExcludeUsersWhere(excludeUsers);

    // Get all users with their activity timestamps (agent creation, prompt creation, project creation)
    const usersWithActivity = await this.prisma.user.findMany({
      where: excludeWhere,
      include: {
        agents: {
          include: {
            tasks: {
              select: {
                createdAt: true
              }
            }
          }
        },
        projectMemberships: {
          select: {
            createdAt: true
          }
        }
      }
    });

    const cohortData: RetentionCohortData[] = [];

    // For each day from 1 to 90
    for (let dayNumber = 1; dayNumber <= 90; dayNumber++) {
      let users0DayGap = 0;
      let users1DayGap = 0;
      let users3DayGap = 0;
      let users7DayGap = 0;

      for (const user of usersWithActivity) {
        if (!user.createdAt) continue;

        // Collect all activity timestamps
        const activityDates: Date[] = [];

        user.agents.forEach(agent => {
          if (agent.createdAt) activityDates.push(agent.createdAt);
          agent.tasks?.forEach(task => {
            if (task.createdAt) activityDates.push(task.createdAt);
          });
        });

        user.projectMemberships.forEach(pm => {
          if (pm.createdAt) activityDates.push(pm.createdAt);
        });

        // Sort dates
        activityDates.sort((a, b) => a.getTime() - b.getTime());

        // Check if user has activity from day 1 to dayNumber with different gap tolerances
        const userStartDate = user.createdAt;
        const targetDate = new Date(userStartDate);
        targetDate.setDate(targetDate.getDate() + dayNumber);

        // Check each gap tolerance
        if (this.hasConsistentActivity(userStartDate, targetDate, activityDates, 0)) {
          users0DayGap++;
        }
        if (this.hasConsistentActivity(userStartDate, targetDate, activityDates, 1)) {
          users1DayGap++;
        }
        if (this.hasConsistentActivity(userStartDate, targetDate, activityDates, 3)) {
          users3DayGap++;
        }
        if (this.hasConsistentActivity(userStartDate, targetDate, activityDates, 7)) {
          users7DayGap++;
        }
      }

      cohortData.push({
        dayNumber,
        users0DayGap,
        users1DayGap,
        users3DayGap,
        users7DayGap
      });
    }

    return cohortData;
  }

  private hasConsistentActivity(
    startDate: Date,
    endDate: Date,
    activityDates: Date[],
    maxGapDays: number
  ): boolean {
    // Filter activities within the date range
    const relevantActivities = activityDates.filter(
      date => date >= startDate && date <= endDate
    );

    if (relevantActivities.length === 0) return false;

    // Check for gaps
    let currentDate = new Date(startDate);
    let lastActivityDate = startDate;

    for (const activityDate of relevantActivities) {
      const daysDiff = Math.floor(
        (activityDate.getTime() - lastActivityDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff > maxGapDays + 1) {
        return false;
      }

      lastActivityDate = activityDate;
    }

    // Check if we reached the end date
    const daysSinceLastActivity = Math.floor(
      (endDate.getTime() - lastActivityDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    return daysSinceLastActivity <= maxGapDays + 1;
  }

  async getSessionDurationData(excludeUsers: string[] = []): Promise<SessionDurationData[]> {
    const excludeWhere = this.buildExcludeUsersWhere(excludeUsers);

    // Get all users with their activity timestamps
    const usersWithActivity = await this.prisma.user.findMany({
      where: excludeWhere,
      include: {
        agents: {
          include: {
            tasks: {
              select: {
                createdAt: true
              }
            }
          }
        },
        projectMemberships: {
          select: {
            createdAt: true
          }
        }
      }
    });

    // Calculate session durations for each user
    const userSessionDurations: number[] = [];

    for (const user of usersWithActivity) {
      // Collect all activity timestamps
      const activityTimestamps: number[] = [];

      user.agents.forEach(agent => {
        if (agent.createdAt) activityTimestamps.push(agent.createdAt.getTime());
        agent.tasks?.forEach(task => {
          if (task.createdAt) activityTimestamps.push(task.createdAt.getTime());
        });
      });

      user.projectMemberships.forEach(pm => {
        if (pm.createdAt) activityTimestamps.push(pm.createdAt.getTime());
      });

      // Sort timestamps
      activityTimestamps.sort((a, b) => a - b);

      // Merge overlapping sessions (within 25 minutes before and 5 minutes after)
      const sessions: Array<{ start: number; end: number }> = [];

      for (const timestamp of activityTimestamps) {
        const sessionStart = timestamp - (25 * 60 * 1000); // 25 minutes before
        const sessionEnd = timestamp + (5 * 60 * 1000);    // 5 minutes after

        // Find overlapping session
        const overlapping = sessions.find(
          s => !(sessionEnd < s.start || sessionStart > s.end)
        );

        if (overlapping) {
          // Merge with existing session
          overlapping.start = Math.min(overlapping.start, sessionStart);
          overlapping.end = Math.max(overlapping.end, sessionEnd);
        } else {
          // Create new session
          sessions.push({ start: sessionStart, end: sessionEnd });
        }
      }

      // Calculate total duration in half hours
      const totalDurationMs = sessions.reduce(
        (sum, session) => sum + (session.end - session.start),
        0
      );
      const totalHalfHours = Math.floor(totalDurationMs / (30 * 60 * 1000));

      userSessionDurations.push(totalHalfHours);
    }

    // Create distribution data
    const maxHalfHours = Math.max(...userSessionDurations, 0);
    const distribution: SessionDurationData[] = [];

    for (let halfHours = 0; halfHours <= maxHalfHours; halfHours++) {
      distribution.push({
        halfHourBucket: halfHours,
        userCount: userSessionDurations.filter(d => d >= halfHours).length
      });
    }

    return distribution;
  }

  // Helper to generate cohort periods
  private generateCohortPeriods(period: CohortPeriod, lookbackDays: number = 60): SignupCohort[] {
    const now = new Date();
    const cohorts: SignupCohort[] = [];

    let periodDays: number;
    switch (period) {
      case 'daily':
        periodDays = 1;
        break;
      case 'weekly':
        periodDays = 7;
        break;
      case 'biweekly':
        periodDays = 14;
        break;
    }

    // Start from the oldest period and work forward
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - lookbackDays);
    startDate.setHours(0, 0, 0, 0);

    let currentStart = new Date(startDate);
    while (currentStart < now) {
      const currentEnd = new Date(currentStart);
      currentEnd.setDate(currentEnd.getDate() + periodDays);

      if (currentEnd > now) break; // Skip incomplete periods

      const label = this.formatCohortLabel(currentStart, currentEnd, period);
      cohorts.push({
        cohortLabel: label,
        cohortStart: new Date(currentStart),
        cohortEnd: new Date(currentEnd),
        userCount: 0 // Will be filled later
      });

      currentStart = currentEnd;
    }

    return cohorts;
  }

  private formatCohortLabel(start: Date, end: Date, period: CohortPeriod): string {
    const formatDate = (d: Date) => {
      const month = d.toLocaleString('en-US', { month: 'short' });
      const day = d.getDate();
      return `${month} ${day}`;
    };

    if (period === 'daily') {
      return formatDate(start);
    }

    const endDisplay = new Date(end);
    endDisplay.setDate(endDisplay.getDate() - 1); // End is exclusive, show last included day
    return `${formatDate(start)} - ${formatDate(endDisplay)}`;
  }

  async getActivationRatesByCohort(period: CohortPeriod, excludeUsers: string[] = []): Promise<ActivationRateData[]> {
    const cohorts = this.generateCohortPeriods(period, 60);
    const excludeWhere = this.buildExcludeUsersWhere(excludeUsers);

    // Get all users with their first activity timestamps
    const users = await this.prisma.user.findMany({
      where: {
        createdAt: { not: null },
        ...excludeWhere
      },
      select: {
        id: true,
        createdAt: true,
        agents: {
          select: {
            createdAt: true
          },
          orderBy: { createdAt: 'asc' },
          take: 1
        }
      }
    });

    const results: ActivationRateData[] = [];

    for (const cohort of cohorts) {
      const cohortUsers = users.filter(u =>
        u.createdAt &&
        u.createdAt >= cohort.cohortStart &&
        u.createdAt < cohort.cohortEnd
      );

      const userCount = cohortUsers.length;
      if (userCount === 0) {
        results.push({
          cohortLabel: cohort.cohortLabel,
          userCount: 0,
          activatedDay1: 0,
          activatedDay3: 0,
          activatedDay7: 0,
          activationRateDay1: 0,
          activationRateDay3: 0,
          activationRateDay7: 0
        });
        continue;
      }

      let activatedDay1 = 0;
      let activatedDay3 = 0;
      let activatedDay7 = 0;

      for (const user of cohortUsers) {
        if (!user.createdAt || user.agents.length === 0) continue;

        const firstAgentAt = user.agents[0].createdAt;
        if (!firstAgentAt) continue;

        const hoursToFirstAgent = (firstAgentAt.getTime() - user.createdAt.getTime()) / (1000 * 60 * 60);

        if (hoursToFirstAgent <= 24) activatedDay1++;
        if (hoursToFirstAgent <= 72) activatedDay3++;
        if (hoursToFirstAgent <= 168) activatedDay7++;
      }

      results.push({
        cohortLabel: cohort.cohortLabel,
        userCount,
        activatedDay1,
        activatedDay3,
        activatedDay7,
        activationRateDay1: userCount > 0 ? (activatedDay1 / userCount) * 100 : 0,
        activationRateDay3: userCount > 0 ? (activatedDay3 / userCount) * 100 : 0,
        activationRateDay7: userCount > 0 ? (activatedDay7 / userCount) * 100 : 0
      });
    }

    return results;
  }

  async getEngagementProgression(period: CohortPeriod, excludeUsers: string[] = []): Promise<EngagementProgressionData[]> {
    const cohorts = this.generateCohortPeriods(period, 60);
    const now = new Date();
    const excludeWhere = this.buildExcludeUsersWhere(excludeUsers);

    // Get all users with their activity
    // AgentCommit is related to AgentPrompt (task), so we navigate through tasks
    const users = await this.prisma.user.findMany({
      where: {
        createdAt: { not: null },
        ...excludeWhere
      },
      select: {
        id: true,
        createdAt: true,
        agents: {
          select: {
            createdAt: true,
            tasks: {
              select: {
                createdAt: true,
                agentCommits: {
                  where: { pushed: true },
                  select: { createdAt: true }
                }
              }
            }
          }
        }
      }
    });

    const results: EngagementProgressionData[] = [];
    const maxDays = 14; // Track up to 14 days

    for (const cohort of cohorts) {
      const cohortUsers = users.filter(u =>
        u.createdAt &&
        u.createdAt >= cohort.cohortStart &&
        u.createdAt < cohort.cohortEnd
      );

      if (cohortUsers.length === 0) continue;

      // Calculate cohort age (how many days since cohort started)
      const cohortAge = Math.floor((now.getTime() - cohort.cohortEnd.getTime()) / (1000 * 60 * 60 * 24));
      const daysToTrack = Math.min(maxDays, cohortAge);

      for (let dayNumber = 1; dayNumber <= daysToTrack; dayNumber++) {
        let totalAgents = 0;
        let totalPrompts = 0;
        let totalPushedCommits = 0;

        for (const user of cohortUsers) {
          if (!user.createdAt) continue;

          const dayEnd = new Date(user.createdAt);
          dayEnd.setDate(dayEnd.getDate() + dayNumber);

          // Count agents created by this day
          const agentsByDay = user.agents.filter(a =>
            a.createdAt && a.createdAt <= dayEnd
          ).length;
          totalAgents += agentsByDay;

          // Count prompts by this day
          let promptsByDay = 0;
          for (const agent of user.agents) {
            promptsByDay += agent.tasks.filter(t =>
              t.createdAt && t.createdAt <= dayEnd
            ).length;
          }
          totalPrompts += promptsByDay;

          // Count pushed commits by this day (through tasks)
          let pushedByDay = 0;
          for (const agent of user.agents) {
            for (const task of agent.tasks) {
              pushedByDay += task.agentCommits.filter(c =>
                c.createdAt && c.createdAt <= dayEnd
              ).length;
            }
          }
          totalPushedCommits += pushedByDay;
        }

        results.push({
          cohortLabel: cohort.cohortLabel,
          dayNumber,
          avgAgents: totalAgents / cohortUsers.length,
          avgPrompts: totalPrompts / cohortUsers.length,
          avgPushedCommits: totalPushedCommits / cohortUsers.length
        });
      }
    }

    return results;
  }

  async getTimeToFirstAction(period: CohortPeriod, excludeUsers: string[] = []): Promise<TimeToFirstActionData[]> {
    const cohorts = this.generateCohortPeriods(period, 60);
    const excludeWhere = this.buildExcludeUsersWhere(excludeUsers);

    // Get all users with their first actions
    // AgentCommit is related to AgentPrompt (task), so we navigate through tasks
    const users = await this.prisma.user.findMany({
      where: {
        createdAt: { not: null },
        ...excludeWhere
      },
      select: {
        id: true,
        createdAt: true,
        agents: {
          select: {
            createdAt: true,
            tasks: {
              select: {
                createdAt: true,
                agentCommits: {
                  where: { pushed: true },
                  select: { createdAt: true },
                  orderBy: { createdAt: 'asc' },
                  take: 1
                }
              },
              orderBy: { createdAt: 'asc' }
            }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    const results: TimeToFirstActionData[] = [];

    for (const cohort of cohorts) {
      const cohortUsers = users.filter(u =>
        u.createdAt &&
        u.createdAt >= cohort.cohortStart &&
        u.createdAt < cohort.cohortEnd
      );

      if (cohortUsers.length === 0) {
        results.push({
          cohortLabel: cohort.cohortLabel,
          medianTimeToFirstAgent: null,
          medianTimeToFirstPrompt: null,
          medianTimeToFirstPush: null,
          p75TimeToFirstAgent: null,
          p75TimeToFirstPrompt: null,
          p75TimeToFirstPush: null
        });
        continue;
      }

      const timesToFirstAgent: number[] = [];
      const timesToFirstPrompt: number[] = [];
      const timesToFirstPush: number[] = [];

      for (const user of cohortUsers) {
        if (!user.createdAt) continue;

        // Time to first agent (in hours)
        if (user.agents.length > 0 && user.agents[0].createdAt) {
          const hours = (user.agents[0].createdAt.getTime() - user.createdAt.getTime()) / (1000 * 60 * 60);
          timesToFirstAgent.push(hours);
        }

        // Time to first prompt
        let firstPromptTime: Date | null = null;
        for (const agent of user.agents) {
          if (agent.tasks.length > 0 && agent.tasks[0].createdAt) {
            if (!firstPromptTime || agent.tasks[0].createdAt < firstPromptTime) {
              firstPromptTime = agent.tasks[0].createdAt;
            }
          }
        }
        if (firstPromptTime) {
          const hours = (firstPromptTime.getTime() - user.createdAt.getTime()) / (1000 * 60 * 60);
          timesToFirstPrompt.push(hours);
        }

        // Time to first push (through tasks)
        let firstPushTime: Date | null = null;
        for (const agent of user.agents) {
          for (const task of agent.tasks) {
            if (task.agentCommits.length > 0 && task.agentCommits[0].createdAt) {
              if (!firstPushTime || task.agentCommits[0].createdAt < firstPushTime) {
                firstPushTime = task.agentCommits[0].createdAt;
              }
            }
          }
        }
        if (firstPushTime) {
          const hours = (firstPushTime.getTime() - user.createdAt.getTime()) / (1000 * 60 * 60);
          timesToFirstPush.push(hours);
        }
      }

      results.push({
        cohortLabel: cohort.cohortLabel,
        medianTimeToFirstAgent: this.calculatePercentile(timesToFirstAgent, 50),
        medianTimeToFirstPrompt: this.calculatePercentile(timesToFirstPrompt, 50),
        medianTimeToFirstPush: this.calculatePercentile(timesToFirstPush, 50),
        p75TimeToFirstAgent: this.calculatePercentile(timesToFirstAgent, 75),
        p75TimeToFirstPrompt: this.calculatePercentile(timesToFirstPrompt, 75),
        p75TimeToFirstPush: this.calculatePercentile(timesToFirstPush, 75)
      });
    }

    return results;
  }

  private calculatePercentile(values: number[], percentile: number): number | null {
    if (values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) return sorted[lower];

    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }

  async getRetentionBySignupCohort(period: CohortPeriod, excludeUsers: string[] = []): Promise<RetentionByWeekData[]> {
    const cohorts = this.generateCohortPeriods(period, 60);
    const now = new Date();
    const excludeWhere = this.buildExcludeUsersWhere(excludeUsers);

    // Get all users with their activity timestamps
    const users = await this.prisma.user.findMany({
      where: {
        createdAt: { not: null },
        ...excludeWhere
      },
      select: {
        id: true,
        createdAt: true,
        agents: {
          select: {
            createdAt: true,
            tasks: {
              select: { createdAt: true }
            }
          }
        }
      }
    });

    const results: RetentionByWeekData[] = [];

    for (const cohort of cohorts) {
      const cohortUsers = users.filter(u =>
        u.createdAt &&
        u.createdAt >= cohort.cohortStart &&
        u.createdAt < cohort.cohortEnd
      );

      const userCount = cohortUsers.length;
      if (userCount === 0) {
        results.push({
          cohortLabel: cohort.cohortLabel,
          userCount: 0,
          retainedWeek2: 0,
          retentionRateWeek2: 0,
          retainedWeek3: 0,
          retentionRateWeek3: 0
        });
        continue;
      }

      let retainedWeek2 = 0;
      let retainedWeek3 = 0;

      for (const user of cohortUsers) {
        if (!user.createdAt) continue;

        // Collect all activity timestamps for this user
        const activityDates: Date[] = [];
        for (const agent of user.agents) {
          if (agent.createdAt) activityDates.push(agent.createdAt);
          for (const task of agent.tasks) {
            if (task.createdAt) activityDates.push(task.createdAt);
          }
        }

        // Week 2 = days 7-13 after signup
        const week2Start = new Date(user.createdAt);
        week2Start.setDate(week2Start.getDate() + 7);
        const week2End = new Date(user.createdAt);
        week2End.setDate(week2End.getDate() + 14);

        // Week 3 = days 14-20 after signup
        const week3Start = new Date(user.createdAt);
        week3Start.setDate(week3Start.getDate() + 14);
        const week3End = new Date(user.createdAt);
        week3End.setDate(week3End.getDate() + 21);

        // Only count if the period has passed
        if (week2End <= now) {
          const hasWeek2Activity = activityDates.some(d => d >= week2Start && d < week2End);
          if (hasWeek2Activity) retainedWeek2++;
        }

        if (week3End <= now) {
          const hasWeek3Activity = activityDates.some(d => d >= week3Start && d < week3End);
          if (hasWeek3Activity) retainedWeek3++;
        }
      }

      // Calculate eligible users (those who have reached that week)
      const usersEligibleWeek2 = cohortUsers.filter(u => {
        if (!u.createdAt) return false;
        const week2End = new Date(u.createdAt);
        week2End.setDate(week2End.getDate() + 14);
        return week2End <= now;
      }).length;

      const usersEligibleWeek3 = cohortUsers.filter(u => {
        if (!u.createdAt) return false;
        const week3End = new Date(u.createdAt);
        week3End.setDate(week3End.getDate() + 21);
        return week3End <= now;
      }).length;

      results.push({
        cohortLabel: cohort.cohortLabel,
        userCount,
        retainedWeek2,
        retentionRateWeek2: usersEligibleWeek2 > 0 ? (retainedWeek2 / usersEligibleWeek2) * 100 : 0,
        retainedWeek3,
        retentionRateWeek3: usersEligibleWeek3 > 0 ? (retainedWeek3 / usersEligibleWeek3) * 100 : 0
      });
    }

    return results;
  }

  async getSuccessRateByCohort(period: CohortPeriod, excludeUsers: string[] = []): Promise<SuccessRateByCohortData[]> {
    const cohorts = this.generateCohortPeriods(period, 60);
    const excludeWhere = this.buildExcludeUsersWhere(excludeUsers);

    // Get all users with their agents and success metrics
    const users = await this.prisma.user.findMany({
      where: {
        createdAt: { not: null },
        ...excludeWhere
      },
      select: {
        id: true,
        createdAt: true,
        agents: {
          select: {
            id: true,
            lastCommitPushed: true,
            prUrl: true
          }
        }
      }
    });

    const results: SuccessRateByCohortData[] = [];

    for (const cohort of cohorts) {
      const cohortUsers = users.filter(u =>
        u.createdAt &&
        u.createdAt >= cohort.cohortStart &&
        u.createdAt < cohort.cohortEnd
      );

      let totalAgents = 0;
      let agentsWithPush = 0;
      let agentsWithPR = 0;

      for (const user of cohortUsers) {
        for (const agent of user.agents) {
          totalAgents++;
          if (agent.lastCommitPushed) agentsWithPush++;
          if (agent.prUrl) agentsWithPR++;
        }
      }

      results.push({
        cohortLabel: cohort.cohortLabel,
        totalAgents,
        agentsWithPush,
        agentsWithPR,
        pushRate: totalAgents > 0 ? (agentsWithPush / totalAgents) * 100 : 0,
        prRate: totalAgents > 0 ? (agentsWithPR / totalAgents) * 100 : 0
      });
    }

    return results;
  }
}
