
import { RepositoryContainer } from '@/data/repositories';
import { AuthService } from './auth.service';
import { GitHubService } from './github.service';
import { RepositoryService } from './repository.service';
import { AgentService } from './agent.service';
import { PermissionService } from './permission.service';
import { MentionService } from './mention.service';
import { ProjectService } from './project.service';
import { UserService } from './user.service';
import { PersonalEnvironmentService } from './personalEnvironment.service';
import { UserAgentAccessService } from './userAgentAccess.service';
import { UsageLimitsService } from './usageLimits.service';
import { IPRateLimitingService } from './ipRateLimiting.service';
import { MachinePoolService } from './machinePool.service';
import { HealthCheckService } from './healthCheck.service';
import { AgentUploadService } from './agentUpload.service';
import { StripeService } from './stripe.service';
import { SubscriptionService } from './subscription.service';
import { ClaudeOAuthService } from './claude-oauth.service';
import { DashboardAnalyticsService } from './dashboardAnalytics.service';
import { DashboardSnapshotService } from './dashboardSnapshot.service';
import { ScheduledJobsService } from './scheduledJobs.service';
import { MachineReservationQueueService } from './machineReservationQueue.service';
import { CustomMachineService } from './customMachine.service';
import { AutomationService } from './automation.service';
import { AgentMovementsService } from './agentMovements.service';
import { MachineSnapshotService } from './machineSnapshot.service';
import { AgentSearchService } from './agentSearch.service';
import { LuxService } from './lux.service';
import { PortDomainService } from './portDomain.service';

export {
  AuthService,
  GitHubService,
  RepositoryService,
  AgentService,
  PermissionService,
  MentionService,
  ProjectService,
  UserService,
  // PersonalSecretFileService, // DEPRECATED - secrets moved to environments
  PersonalEnvironmentService,
  UserAgentAccessService,
  UsageLimitsService,
  IPRateLimitingService,
  MachinePoolService,
  HealthCheckService,
  AgentUploadService,
  StripeService,
  SubscriptionService,
  ClaudeOAuthService,
  DashboardAnalyticsService,
  MachineReservationQueueService,
  CustomMachineService,
  AutomationService,
  AgentMovementsService,
  MachineSnapshotService,
  AgentSearchService,
  LuxService
};

export class ServiceContainer {
  public readonly repositoryContainer: RepositoryContainer;
  public readonly auth: AuthService;
  public readonly github: GitHubService;
  public readonly repositories: RepositoryService;
  public readonly agents: AgentService;
  public readonly permissions: PermissionService;
  public readonly mentions: MentionService;
  public readonly projects: ProjectService;
  public readonly users: UserService;
  public readonly personalEnvironments: PersonalEnvironmentService;
  public readonly userAgentAccesses: UserAgentAccessService;
  public readonly usageLimits: UsageLimitsService;
  public readonly ipRateLimiting: IPRateLimitingService;
  public readonly stripe: StripeService;
  public readonly subscription: SubscriptionService;
  public readonly machinePool: MachinePoolService;
  public readonly healthCheck: HealthCheckService;
  public readonly agentUploads: AgentUploadService;
  public readonly dashboardAnalytics: DashboardAnalyticsService;
  public readonly dashboardSnapshot: DashboardSnapshotService;
  public readonly scheduledJobs: ScheduledJobsService;
  public readonly machineReservationQueue: MachineReservationQueueService;
  public readonly automations: AutomationService;
  public readonly customMachines: CustomMachineService;
  public readonly agentMovements: AgentMovementsService;
  public readonly machineSnapshots: MachineSnapshotService;
  public readonly agentSearch: AgentSearchService;
  public readonly lux: LuxService;
  public readonly portDomains: PortDomainService;

  // Direct access to agentAttachments repository
  public get agentAttachments() {
    return this.repositoryContainer.agentAttachments;
  }
  public readonly claudeOAuth: ClaudeOAuthService;

  constructor(repositoryContainer: RepositoryContainer) {
    this.repositoryContainer = repositoryContainer;
    this.users = new UserService(repositoryContainer);
    this.github = new GitHubService(repositoryContainer, this.users);
    this.repositories = new RepositoryService(repositoryContainer);
    this.permissions = new PermissionService(this.github);
    this.machinePool = new MachinePoolService(repositoryContainer);
    this.machineReservationQueue = new MachineReservationQueueService(repositoryContainer, this.machinePool);
    this.healthCheck = new HealthCheckService(repositoryContainer);
    this.personalEnvironments = new PersonalEnvironmentService(repositoryContainer);
    this.claudeOAuth = new ClaudeOAuthService(repositoryContainer);
    this.claudeOAuth.setUserService(this.users); // Wire up dependency for config access
    this.usageLimits = new UsageLimitsService(repositoryContainer);
    // AuthService must be created before AgentService (AgentService needs it for share link token generation)
    this.auth = new AuthService(repositoryContainer, this.users, this.github, this.usageLimits);
    this.agents = new AgentService(repositoryContainer, this.github, this.permissions, this.users, this.machinePool, this.personalEnvironments, this.claudeOAuth, this.usageLimits, this.auth);
    this.mentions = new MentionService(repositoryContainer, this.github);
    this.projects = new ProjectService(repositoryContainer);
    this.userAgentAccesses = new UserAgentAccessService(repositoryContainer);
    this.ipRateLimiting = new IPRateLimitingService();
    this.agentUploads = new AgentUploadService(repositoryContainer.agentUploads);
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
    this.stripe = new StripeService(repositoryContainer, stripeSecretKey);
    this.subscription = new SubscriptionService(repositoryContainer);
    this.dashboardAnalytics = new DashboardAnalyticsService(repositoryContainer);
    this.automations = new AutomationService(repositoryContainer);
    this.dashboardSnapshot = new DashboardSnapshotService(repositoryContainer);
    this.customMachines = new CustomMachineService(repositoryContainer);
    // MachineSnapshotService requires sendToAgentServer from AgentService
    this.machineSnapshots = new MachineSnapshotService(
      repositoryContainer,
      (machineId, endpoint, body, timeoutMs) => this.agents.sendToAgentServer(machineId, endpoint, body, timeoutMs)
    );
    this.scheduledJobs = new ScheduledJobsService(this.dashboardSnapshot, this.machineSnapshots);
    this.agentMovements = new AgentMovementsService(repositoryContainer, this);

    // Wire up agentMovements to AgentService (circular dependency resolution)
    this.agents.setAgentMovementsService(this.agentMovements);
    // Wire up machineSnapshots to AgentService (for createSnapshotNow)
    this.agents.setMachineSnapshotService(this.machineSnapshots);

    // Initialize search service
    this.agentSearch = new AgentSearchService(repositoryContainer);

    // Initialize LUX computer-use service
    this.lux = new LuxService(repositoryContainer.luxUsage, repositoryContainer.agents);

    // Initialize port domain service
    this.portDomains = new PortDomainService(repositoryContainer);
  }

}

export function createServiceContainer(repositoryContainer: RepositoryContainer): ServiceContainer {
  return new ServiceContainer(repositoryContainer);
}