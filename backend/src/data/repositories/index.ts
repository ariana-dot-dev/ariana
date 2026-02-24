import { PrismaClient } from '../../../generated/prisma';

import { UserRepository } from './user.repository';
import { RepositoryRepository } from './repository.repository';
import { PersonalEnvironmentRepository } from './personalEnvironment.repository';
import { GithubTokenRepository } from './githubToken.repository';
import { GitHubProfileRepository } from './githubProfile.repository';
import { AgentPromptRepository } from './agentPrompt.repository';
import { AgentCommitRepository } from './agentCommit.repository';
import { AgentMessageRepository } from './agentMessage.repository';
import { AgentRepository } from './agent.repository';
import { ProjectRepository } from './project.repository';
import { ProjectMemberRepository } from './projectMember.repository';
import { UserAgentAccessRepository } from './userAgentAccess.repository';
import { AgentAttachmentsRepository } from './agentAttachments.repository';
import { AgentResetRepository } from './agentReset.repository';
import { AgentContextEventRepository } from './agentContextEvent.repository';
import { ParkedMachineRepository } from './parkedMachine.repository';
import { MachineHealthCheckRepository } from './machineHealthCheck.repository';
import { AgentUploadRepository } from './agentUpload.repository';
import { UserUsageRepository } from './userUsage.repository';
import { UserLimitsRepository } from './userLimits.repository';
import { SubscriptionPlanRepository } from './subscriptionPlan.repository';
import { DashboardAnalyticsRepository } from './dashboardAnalytics.repository';
import { DashboardSnapshotRepository } from './dashboardSnapshot.repository';
import { MachineReservationQueueRepository } from './machineReservationQueue.repository';
import { AutomationRepository } from './automation.repository';
import { AutomationEventRepository } from './automationEvent.repository';
import { MachineSnapshotRepository } from './machineSnapshot.repository';
import { GithubCacheRepository } from './githubCache.repository';
import { LuxUsageRepository } from './luxUsage.repository';
import { AgentPortDomainRepository } from './agentPortDomain.repository';


export {
  UserRepository,
  AgentRepository,
  AgentMessageRepository,
  AgentCommitRepository,
  AgentPromptRepository,
  RepositoryRepository,
  GithubTokenRepository,
  GitHubProfileRepository,
  // PersonalSecretFileRepository, // DEPRECATED - secrets moved to environments
  PersonalEnvironmentRepository,
  ProjectRepository,
  ProjectMemberRepository,
  UserAgentAccessRepository,
  AgentAttachmentsRepository,
  AgentResetRepository,
  AgentContextEventRepository,
  DashboardAnalyticsRepository,
  AutomationRepository,
  AutomationEventRepository,
  MachineSnapshotRepository,
  GithubCacheRepository,
  LuxUsageRepository,
};

export class RepositoryContainer {
  public readonly prisma: PrismaClient;
  public readonly users: UserRepository;
  public readonly agents: AgentRepository;
  public readonly agentMessages: AgentMessageRepository;
  public readonly agentCommits: AgentCommitRepository;
  public readonly agentPrompts: AgentPromptRepository;
  public readonly agentAttachments: AgentAttachmentsRepository;
  public readonly agentResets: AgentResetRepository;
  public readonly agentContextEvents: AgentContextEventRepository;
  public readonly repositories: RepositoryRepository;
  public readonly githubTokens: GithubTokenRepository;
  public readonly githubProfiles: GitHubProfileRepository;
  // public readonly personalSecretFiles: PersonalSecretFileRepository; // DEPRECATED - secrets moved to environments
  public readonly personalEnvironments: PersonalEnvironmentRepository;
  public readonly projects: ProjectRepository;
  public readonly projectMembers: ProjectMemberRepository;
  public readonly userAgentAccesses: UserAgentAccessRepository;
  public readonly parkedMachines: ParkedMachineRepository;
  public readonly machineHealthChecks: MachineHealthCheckRepository;
  public readonly agentUploads: AgentUploadRepository;
  public readonly userUsage: UserUsageRepository;
  public readonly userLimits: UserLimitsRepository;
  public readonly subscriptionPlans: SubscriptionPlanRepository;
  public readonly dashboardAnalytics: DashboardAnalyticsRepository;
  public readonly dashboardSnapshot: DashboardSnapshotRepository;
  public readonly machineReservationQueue: MachineReservationQueueRepository;
  public readonly automations: AutomationRepository;
  public readonly automationEvents: AutomationEventRepository;
  public readonly machineSnapshots: MachineSnapshotRepository;
  public readonly githubCache: GithubCacheRepository;
  public readonly luxUsage: LuxUsageRepository;
  public readonly agentPortDomains: AgentPortDomainRepository;


  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.users = new UserRepository(prisma);
    this.agents = new AgentRepository(prisma);
    this.agentMessages = new AgentMessageRepository(prisma);
    this.agentCommits = new AgentCommitRepository(prisma);
    this.agentPrompts = new AgentPromptRepository(prisma);
    this.agentAttachments = new AgentAttachmentsRepository(prisma);
    this.agentResets = new AgentResetRepository(prisma);
    this.agentContextEvents = new AgentContextEventRepository(prisma);
    this.repositories = new RepositoryRepository(prisma);
    this.githubTokens = new GithubTokenRepository(prisma);
    this.githubProfiles = new GitHubProfileRepository(prisma);
    // this.personalSecretFiles = new PersonalSecretFileRepository(prisma); // DEPRECATED - secrets moved to environments
    this.personalEnvironments = new PersonalEnvironmentRepository(prisma);
    this.projects = new ProjectRepository(prisma);
    this.projectMembers = new ProjectMemberRepository(prisma);
    this.userAgentAccesses = new UserAgentAccessRepository(prisma);
    this.parkedMachines = new ParkedMachineRepository(prisma);
    this.machineHealthChecks = new MachineHealthCheckRepository(prisma);
    this.agentUploads = new AgentUploadRepository(prisma);
    this.userUsage = new UserUsageRepository(prisma);
    this.userLimits = new UserLimitsRepository(prisma);
    this.subscriptionPlans = new SubscriptionPlanRepository(prisma);
    this.dashboardAnalytics = new DashboardAnalyticsRepository(prisma);
    this.dashboardSnapshot = new DashboardSnapshotRepository(prisma);
    this.machineReservationQueue = new MachineReservationQueueRepository(prisma);
    this.automations = new AutomationRepository(prisma);
    this.automationEvents = new AutomationEventRepository(prisma);
    this.machineSnapshots = new MachineSnapshotRepository(prisma);
    this.githubCache = new GithubCacheRepository(prisma);
    this.luxUsage = new LuxUsageRepository(prisma);
    this.agentPortDomains = new AgentPortDomainRepository(prisma);
  }
}

export function createRepositoryContainer(): RepositoryContainer {
  const prisma = new PrismaClient();
  return new RepositoryContainer(prisma);
}