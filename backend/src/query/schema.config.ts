/**
 * Entity configuration for the schema-driven query system.
 * This defines what fields, filters, and relations are exposed for each entity.
 *
 * SECURITY: Sensitive fields (machineSharedKey, tokens, etc.) are NOT included.
 */

import type { EntityConfig } from './query.types';

export const ENTITY_CONFIG: Record<string, EntityConfig> = {
  project: {
    prismaModel: 'project',
    description: 'Projects containing repositories and agents. Access is based on project membership.',
    scopeType: 'project_member',
    defaultSortField: 'createdAt',
    defaultSortOrder: 'desc',
    allowedFields: {
      id: {
        prismaField: 'id',
        type: 'string',
        description: 'Unique project identifier',
        operators: ['equals', 'in', 'notIn'],
        sortable: false,
      },
      name: {
        prismaField: 'name',
        type: 'string',
        description: 'Project name',
        operators: ['equals', 'contains', 'startsWith'],
        sortable: true,
      },
      repositoryId: {
        prismaField: 'repositoryId',
        type: 'string',
        description: 'ID of the linked repository',
        operators: ['equals'],
        sortable: false,
      },
      cloneUrl: {
        prismaField: 'cloneUrl',
        type: 'string',
        description: 'Git clone URL for the repository',
        operators: ['equals', 'contains'],
        sortable: false,
      },
      createdAt: {
        prismaField: 'createdAt',
        type: 'datetime',
        description: 'When the project was created',
        operators: ['gt', 'gte', 'lt', 'lte'],
        sortable: true,
      },
      updatedAt: {
        prismaField: 'updatedAt',
        type: 'datetime',
        description: 'When the project was last updated',
        operators: ['gt', 'gte', 'lt', 'lte'],
        sortable: true,
      },
    },
    allowedRelations: {
      repository: {
        prismaRelation: 'repository',
        targetEntity: 'repository',
        description: 'The GitHub repository linked to this project',
        selectFields: ['id', 'name', 'fullName', 'url', 'baseBranch'],
      },
    },
  },

  agent: {
    prismaModel: 'agent',
    description: 'AI coding agents that work on your projects. Each agent has a state, branch, and can have commits and prompts.',
    scopeType: 'direct_user',
    defaultSortField: 'createdAt',
    defaultSortOrder: 'desc',
    allowedFields: {
      id: {
        prismaField: 'id',
        type: 'string',
        description: 'Unique agent identifier',
        operators: ['equals', 'in', 'notIn'],
        sortable: false,
      },
      name: {
        prismaField: 'name',
        type: 'string',
        description: 'Agent name',
        operators: ['equals', 'contains', 'startsWith'],
        sortable: true,
      },
      projectId: {
        prismaField: 'projectId',
        type: 'string',
        description: 'ID of the project this agent belongs to',
        operators: ['equals', 'in'],
        sortable: false,
      },
      state: {
        prismaField: 'state',
        type: 'string',
        description: 'Current state: init, provisioning, provisioned, cloning, ready, idle, running, error, archived',
        operators: ['equals', 'in', 'notIn'],
        sortable: true,
      },
      isRunning: {
        prismaField: 'isRunning',
        type: 'boolean',
        description: 'Whether agent is currently executing',
        operators: ['equals'],
        sortable: true,
      },
      isReady: {
        prismaField: 'isReady',
        type: 'boolean',
        description: 'Whether agent is ready to accept prompts',
        operators: ['equals'],
        sortable: false,
      },
      branchName: {
        prismaField: 'branchName',
        type: 'string',
        description: 'Git branch the agent is working on',
        operators: ['equals', 'contains', 'startsWith'],
        sortable: true,
      },
      baseBranch: {
        prismaField: 'baseBranch',
        type: 'string',
        description: 'Base branch the agent branched from',
        operators: ['equals', 'contains'],
        sortable: false,
      },
      prUrl: {
        prismaField: 'prUrl',
        type: 'string',
        description: 'Pull request URL if one exists',
        operators: ['equals'],
        sortable: false,
      },
      lastCommitSha: {
        prismaField: 'lastCommitSha',
        type: 'string',
        description: 'SHA of the last commit made by this agent',
        operators: ['equals'],
        sortable: false,
      },
      lastCommitUrl: {
        prismaField: 'lastCommitUrl',
        type: 'string',
        description: 'URL to view the last commit',
        operators: ['equals'],
        sortable: false,
      },
      lastPromptText: {
        prismaField: 'lastPromptText',
        type: 'string',
        description: 'Text of the last prompt sent to this agent',
        operators: ['contains'],
        sortable: false,
      },
      lastPromptAt: {
        prismaField: 'lastPromptAt',
        type: 'datetime',
        description: 'When the last prompt was sent',
        operators: ['gt', 'gte', 'lt', 'lte'],
        sortable: true,
      },
      isTrashed: {
        prismaField: 'isTrashed',
        type: 'boolean',
        description: 'Whether agent is in trash',
        operators: ['equals'],
        sortable: false,
      },
      isTemplate: {
        prismaField: 'isTemplate',
        type: 'boolean',
        description: 'Whether agent is a template',
        operators: ['equals'],
        sortable: false,
      },
      templateVisibility: {
        prismaField: 'templateVisibility',
        type: 'string',
        description: 'Template visibility: personal or shared (null if not template)',
        operators: ['equals', 'in'],
        sortable: false,
      },
      prState: {
        prismaField: 'prState',
        type: 'string',
        description: 'Pull request state: open, closed, merged (null if no PR)',
        operators: ['equals', 'in'],
        sortable: false,
      },
      taskSummary: {
        prismaField: 'taskSummary',
        type: 'string',
        description: 'AI-generated summary of current task',
        operators: ['contains'],
        sortable: false,
      },
      createdAt: {
        prismaField: 'createdAt',
        type: 'datetime',
        description: 'When the agent was created',
        operators: ['gt', 'gte', 'lt', 'lte'],
        sortable: true,
      },
      updatedAt: {
        prismaField: 'updatedAt',
        type: 'datetime',
        description: 'When the agent was last updated',
        operators: ['gt', 'gte', 'lt', 'lte'],
        sortable: true,
      },
    },
    allowedRelations: {
      project: {
        prismaRelation: 'project',
        targetEntity: 'project',
        description: 'The project this agent belongs to',
        selectFields: ['id', 'name', 'cloneUrl'],
      },
    },
    // SENSITIVE FIELDS EXCLUDED: machineId, machineIpv4, machineSharedKey, userId
  },

  agentCommit: {
    prismaModel: 'agentCommit',
    description: 'Git commits made by agents. Access requires ownership of the parent agent.',
    scopeType: 'via_agent',
    agentIdField: 'agentId',
    defaultSortField: 'createdAt',
    defaultSortOrder: 'desc',
    allowedFields: {
      id: {
        prismaField: 'id',
        type: 'string',
        description: 'Unique commit record identifier',
        operators: ['equals', 'in'],
        sortable: false,
      },
      agentId: {
        prismaField: 'agentId',
        type: 'string',
        description: 'ID of the agent that made this commit',
        operators: ['equals', 'in'],
        sortable: false,
      },
      projectId: {
        prismaField: 'projectId',
        type: 'string',
        description: 'ID of the project',
        operators: ['equals', 'in'],
        sortable: false,
      },
      commitSha: {
        prismaField: 'commitSha',
        type: 'string',
        description: 'Git commit SHA',
        operators: ['equals', 'startsWith'],
        sortable: false,
      },
      commitMessage: {
        prismaField: 'commitMessage',
        type: 'string',
        description: 'Commit message',
        operators: ['contains'],
        sortable: false,
      },
      commitUrl: {
        prismaField: 'commitUrl',
        type: 'string',
        description: 'URL to view commit on GitHub',
        operators: ['equals'],
        sortable: false,
      },
      branchName: {
        prismaField: 'branchName',
        type: 'string',
        description: 'Branch the commit was made on',
        operators: ['equals', 'contains'],
        sortable: true,
      },
      filesChanged: {
        prismaField: 'filesChanged',
        type: 'number',
        description: 'Number of files changed',
        operators: ['equals', 'gt', 'gte', 'lt', 'lte'],
        sortable: true,
      },
      additions: {
        prismaField: 'additions',
        type: 'number',
        description: 'Lines added',
        operators: ['equals', 'gt', 'gte', 'lt', 'lte'],
        sortable: true,
      },
      deletions: {
        prismaField: 'deletions',
        type: 'number',
        description: 'Lines deleted',
        operators: ['equals', 'gt', 'gte', 'lt', 'lte'],
        sortable: true,
      },
      pushed: {
        prismaField: 'pushed',
        type: 'boolean',
        description: 'Whether commit has been pushed to remote',
        operators: ['equals'],
        sortable: true,
      },
      createdAt: {
        prismaField: 'createdAt',
        type: 'datetime',
        description: 'When the commit was recorded',
        operators: ['gt', 'gte', 'lt', 'lte'],
        sortable: true,
      },
    },
    allowedRelations: {
      agent: {
        prismaRelation: 'agent',
        targetEntity: 'agent',
        description: 'The agent that made this commit',
        selectFields: ['id', 'name', 'state'],
      },
    },
  },

  agentPrompt: {
    prismaModel: 'agentPrompt',
    description: 'Prompts (tasks) sent to agents. Access requires ownership of the parent agent.',
    scopeType: 'via_agent',
    agentIdField: 'agentId',
    defaultSortField: 'createdAt',
    defaultSortOrder: 'desc',
    allowedFields: {
      id: {
        prismaField: 'id',
        type: 'string',
        description: 'Unique prompt identifier',
        operators: ['equals', 'in'],
        sortable: false,
      },
      agentId: {
        prismaField: 'agentId',
        type: 'string',
        description: 'ID of the agent this prompt was sent to',
        operators: ['equals', 'in'],
        sortable: false,
      },
      prompt: {
        prismaField: 'prompt',
        type: 'string',
        description: 'The prompt text',
        operators: ['contains'],
        sortable: false,
      },
      status: {
        prismaField: 'status',
        type: 'string',
        description: 'Status: queued, processing, completed, failed',
        operators: ['equals', 'in'],
        sortable: true,
      },
      createdAt: {
        prismaField: 'createdAt',
        type: 'datetime',
        description: 'When the prompt was created',
        operators: ['gt', 'gte', 'lt', 'lte'],
        sortable: true,
      },
    },
    allowedRelations: {
      agent: {
        prismaRelation: 'agent',
        targetEntity: 'agent',
        description: 'The agent this prompt was sent to',
        selectFields: ['id', 'name', 'state'],
      },
    },
  },

  agentMessage: {
    prismaModel: 'agentMessage',
    description: 'Messages exchanged with agents. Access requires ownership of the parent agent.',
    scopeType: 'via_agent',
    agentIdField: 'agentId',
    defaultSortField: 'timestamp',
    defaultSortOrder: 'desc',
    allowedFields: {
      id: {
        prismaField: 'id',
        type: 'string',
        description: 'Message ID',
        operators: ['equals', 'in'],
        sortable: false,
      },
      agentId: {
        prismaField: 'agentId',
        type: 'string',
        description: 'Agent ID',
        operators: ['equals', 'in'],
        sortable: false,
      },
      taskId: {
        prismaField: 'taskId',
        type: 'string',
        description: 'Prompt/task ID (use to filter messages from a specific prompt)',
        operators: ['equals', 'in'],
        sortable: false,
      },
      role: {
        prismaField: 'role',
        type: 'string',
        description: 'Message role (user/assistant)',
        operators: ['equals', 'in'],
        sortable: false,
      },
      content: {
        prismaField: 'content',
        type: 'string',
        description: 'Message content',
        operators: ['contains'],
        sortable: false,
      },
      timestamp: {
        prismaField: 'timestamp',
        type: 'datetime',
        description: 'When message was created',
        operators: ['gt', 'gte', 'lt', 'lte'],
        sortable: true,
      },
    },
    allowedRelations: {},
  },
};

/** List of queryable entity names */
export const QUERYABLE_ENTITIES = Object.keys(ENTITY_CONFIG);

/** Maximum results per query */
export const MAX_QUERY_LIMIT = 100;

/** Default results per query */
export const DEFAULT_QUERY_LIMIT = 20;
