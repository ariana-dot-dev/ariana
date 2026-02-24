/**
 * Action configuration for the schema-driven action system.
 * Defines what actions are available and their parameters.
 *
 * SECURITY: Actions are scoped to user's own data or shared access.
 */

import type { ActionConfig } from './action.types';

export const ACTION_CONFIG: Record<string, ActionConfig> = {
  sendPrompt: {
    description: 'Send a task/prompt to an agent. Prompts queue automatically and execute when agent is ready.',
    targetEntity: 'agent',
    targetIdParam: 'agentId',
    scopeType: 'agent_write',
    // No requiredAgentStates - prompts can be queued in any state
    // Archived agents auto-resume when prompt is queued
    blockedAgentStates: ['error'],
    params: {
      agentId: {
        type: 'string',
        description: 'ID of the agent to send the prompt to',
        required: true,
      },
      prompt: {
        type: 'string',
        description: 'The task or instruction for the agent',
        required: true,
        minLength: 1,
        maxLength: 50000,
      },
      model: {
        type: 'enum',
        description: 'AI model to use (default: sonnet)',
        required: false,
        enumValues: ['sonnet', 'opus', 'haiku'],
      },
    },
  },

  archiveAgent: {
    description: 'Archive an agent to stop it and free resources. Can be resumed later.',
    targetEntity: 'agent',
    targetIdParam: 'agentId',
    scopeType: 'agent_owner',
    blockedAgentStates: ['archived'],
    params: {
      agentId: {
        type: 'string',
        description: 'ID of the agent to archive',
        required: true,
      },
    },
  },

  resumeAgent: {
    description: 'Resume an archived agent. Provisions a new machine (may take a moment).',
    targetEntity: 'agent',
    targetIdParam: 'agentId',
    scopeType: 'agent_owner',
    requiredAgentStates: ['archived'],
    params: {
      agentId: {
        type: 'string',
        description: 'ID of the archived agent to resume',
        required: true,
      },
    },
  },

  renameAgent: {
    description: 'Change the name of an agent.',
    targetEntity: 'agent',
    targetIdParam: 'agentId',
    scopeType: 'agent_owner',
    params: {
      agentId: {
        type: 'string',
        description: 'ID of the agent to rename',
        required: true,
      },
      name: {
        type: 'string',
        description: 'New name for the agent',
        required: true,
        minLength: 1,
        maxLength: 100,
      },
    },
  },

  trashAgent: {
    description: 'Move an agent to trash. Can be restored later.',
    targetEntity: 'agent',
    targetIdParam: 'agentId',
    scopeType: 'agent_owner',
    params: {
      agentId: {
        type: 'string',
        description: 'ID of the agent to trash',
        required: true,
      },
    },
  },

  restoreAgent: {
    description: 'Restore an agent from trash.',
    targetEntity: 'agent',
    targetIdParam: 'agentId',
    scopeType: 'agent_owner',
    params: {
      agentId: {
        type: 'string',
        description: 'ID of the trashed agent to restore',
        required: true,
      },
    },
  },

  createAgent: {
    description: 'Create a new AI coding agent for a project.',
    targetEntity: 'project',
    targetIdParam: 'projectId',
    scopeType: 'project_member',
    params: {
      projectId: {
        type: 'string',
        description: 'ID of the project to create the agent in',
        required: true,
      },
      name: {
        type: 'string',
        description: 'Name for the new agent (optional, auto-generated if not provided)',
        required: false,
        maxLength: 100,
      },
      baseBranch: {
        type: 'string',
        description: 'Git branch to base the agent on (optional, uses default branch if not provided)',
        required: false,
      },
    },
  },

  startAgent: {
    description: 'Start a provisioned agent by selecting its setup type (e.g. existing workspace).',
    targetEntity: 'agent',
    targetIdParam: 'agentId',
    scopeType: 'agent_write',
    requiredAgentStates: ['provisioned'],
    blockedAgentStates: ['archived', 'error', 'init', 'provisioning', 'cloning'],
    params: {
      agentId: {
        type: 'string',
        description: 'ID of the agent to start',
        required: true,
      },
      setupType: {
        type: 'string',
        description: 'Setup type to use (recommended: "existing")',
        required: false,
      },
      cloneUrl: {
        type: 'string',
        description: 'Optional public clone URL (uses git-clone-public if provided)',
        required: false,
      },
      branch: {
        type: 'string',
        description: 'Branch name to use when cloning',
        required: false,
      },
      baseBranch: {
        type: 'string',
        description: 'Optional base branch when using branch-based setups',
        required: false,
      },
    },
  },

  interruptAgent: {
    description: 'Stop/interrupt a running agent. The agent will stop processing the current task.',
    targetEntity: 'agent',
    targetIdParam: 'agentId',
    scopeType: 'agent_write',
    requiredAgentStates: ['running'],
    params: {
      agentId: {
        type: 'string',
        description: 'ID of the running agent to interrupt',
        required: true,
      },
    },
  },

  revertToCheckpoint: {
    description: 'Revert agent to a previous commit checkpoint. Discards changes after that commit.',
    targetEntity: 'agent',
    targetIdParam: 'agentId',
    scopeType: 'agent_owner',
    requiredAgentStates: ['ready', 'idle'],
    blockedAgentStates: ['archived', 'running'],
    params: {
      agentId: {
        type: 'string',
        description: 'ID of the agent to revert',
        required: true,
      },
      commitSha: {
        type: 'string',
        description: 'Git commit SHA to revert to',
        required: true,
      },
    },
  },

  createProject: {
    description: 'Create a new project from a GitHub repository URL.',
    targetEntity: null,
    scopeType: 'user_only',
    params: {
      name: {
        type: 'string',
        description: 'Name for the new project',
        required: true,
        minLength: 1,
        maxLength: 100,
      },
      cloneUrl: {
        type: 'string',
        description: 'GitHub repository clone URL (e.g., https://github.com/user/repo.git)',
        required: true,
      },
    },
  },

  deleteProject: {
    description: 'Delete a project and all its agents. This is irreversible!',
    targetEntity: 'project',
    targetIdParam: 'projectId',
    scopeType: 'project_member',
    params: {
      projectId: {
        type: 'string',
        description: 'ID of the project to delete',
        required: true,
      },
    },
  },

  cancelPrompt: {
    description: 'Cancel a queued prompt that has not started processing yet.',
    targetEntity: 'prompt',
    targetIdParam: 'promptId',
    scopeType: 'agent_write',
    params: {
      promptId: {
        type: 'string',
        description: 'ID of the queued prompt to cancel',
        required: true,
      },
    },
  },

  // === MCP-focused actions ===

  spawnAgent: {
    description: 'Create and start a new agent based on a branch. Combines create + wait for provisioned + start.',
    targetEntity: 'project',
    targetIdParam: 'projectId',
    scopeType: 'project_member',
    params: {
      projectId: {
        type: 'string',
        description: 'ID of the project to create the agent in',
        required: true,
      },
      baseBranch: {
        type: 'string',
        description: 'Git branch to base the agent on (required)',
        required: true,
      },
      name: {
        type: 'string',
        description: 'Name for the new agent (optional, auto-generated if not provided)',
        required: false,
        maxLength: 100,
      },
    },
  },

  forkAgent: {
    description: 'Fork an existing agent (useful for templates). Creates a new agent with same state/code as source.',
    targetEntity: 'agent',
    targetIdParam: 'sourceAgentId',
    scopeType: 'agent_write', // Need read access to source
    params: {
      sourceAgentId: {
        type: 'string',
        description: 'ID of the agent to fork from',
        required: true,
      },
      name: {
        type: 'string',
        description: 'Name for the forked agent (optional)',
        required: false,
        maxLength: 100,
      },
    },
  },

  waitForAgentReady: {
    description: 'Wait for an agent to reach ready or idle state. Useful after spawning/forking.',
    targetEntity: 'agent',
    targetIdParam: 'agentId',
    scopeType: 'agent_write',
    params: {
      agentId: {
        type: 'string',
        description: 'ID of the agent to wait for',
        required: true,
      },
      timeoutMs: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 120000, max: 300000)',
        required: false,
        min: 1000,
        max: 300000,
      },
    },
  },

  getAgentConversation: {
    description: 'Get summarized conversation history for an agent. Returns prompts, responses (summarized tools), checkpoints, automations.',
    targetEntity: 'agent',
    targetIdParam: 'agentId',
    scopeType: 'agent_write',
    params: {
      agentId: {
        type: 'string',
        description: 'ID of the agent',
        required: true,
      },
      limit: {
        type: 'number',
        description: 'Max events to return (default: 50, max: 200)',
        required: false,
        min: 1,
        max: 200,
      },
      beforeTimestamp: {
        type: 'number',
        description: 'Only return events before this timestamp (for pagination)',
        required: false,
      },
    },
  },

  // === Environment self-actions (calling agent manages its own environment) ===

  getMyEnvironment: {
    description: 'Get the calling agent\'s current environment configuration as JSON. Returns null if no environment is set.',
    targetEntity: null,
    scopeType: 'caller_agent',
    params: {},
  },

  setMyEnvironment: {
    description: 'Update the calling agent\'s environment from JSON. Validates and applies changes immediately. Creates/updates automations if included.',
    targetEntity: null,
    scopeType: 'caller_agent',
    params: {
      environment: {
        type: 'object',
        description: 'Environment JSON: { name, envContents, secretFiles: [{path, contents}], sshKeyPair?: {publicKey, privateKey, keyName}, automations?: [{name, trigger: {type, fileGlob?, commandRegex?, automationId?}, scriptLanguage, scriptContent, blocking, feedOutput}] }',
        required: true,
      },
    },
  },

  // === Automation actions ===

  listAutomations: {
    description: 'List all automations for the calling agent\'s user in the current project.',
    targetEntity: null,
    scopeType: 'caller_agent',
    params: {},
  },

  getAutomation: {
    description: 'Get details of a specific automation by ID.',
    targetEntity: null,
    scopeType: 'caller_agent',
    params: {
      automationId: {
        type: 'string',
        description: 'ID of the automation to retrieve',
        required: true,
      },
    },
  },

  createAutomation: {
    description: 'Create a new automation. Note: "on_before_commit" and "on_before_push_pr" triggers must be blocking.',
    targetEntity: null,
    scopeType: 'caller_agent',
    params: {
      automation: {
        type: 'object',
        description: 'Automation config: { name, trigger: {type, fileGlob?, commandRegex?, automationId?}, scriptLanguage: "bash"|"javascript"|"python", scriptContent, blocking, feedOutput }',
        required: true,
      },
    },
  },

  updateAutomation: {
    description: 'Update an existing automation.',
    targetEntity: null,
    scopeType: 'caller_agent',
    params: {
      automationId: {
        type: 'string',
        description: 'ID of the automation to update',
        required: true,
      },
      automation: {
        type: 'object',
        description: 'Automation config: { name, trigger: {type, fileGlob?, commandRegex?, automationId?}, scriptLanguage: "bash"|"javascript"|"python", scriptContent, blocking, feedOutput }',
        required: true,
      },
    },
  },

  deleteAutomation: {
    description: 'Delete an automation.',
    targetEntity: null,
    scopeType: 'caller_agent',
    params: {
      automationId: {
        type: 'string',
        description: 'ID of the automation to delete',
        required: true,
      },
    },
  },

  // === Port domain management (secure cert-gateway proxy) ===

  registerPortDomain: {
    description: 'Register an HTTPS subdomain for a port on the calling agent. Max 50 domains per agent. Backend proxies to cert-gateway.',
    targetEntity: null,
    scopeType: 'caller_agent',
    params: {
      port: {
        type: 'number',
        description: 'Port number to register subdomain for',
        required: true,
        min: 1,
        max: 65535,
      },
    },
  },

  unregisterPortDomain: {
    description: 'Unregister an HTTPS subdomain for a port on the calling agent. Backend proxies to cert-gateway.',
    targetEntity: null,
    scopeType: 'caller_agent',
    params: {
      port: {
        type: 'number',
        description: 'Port number to unregister subdomain for',
        required: true,
        min: 1,
        max: 65535,
      },
    },
  },
};

/** List of available action names */
export const AVAILABLE_ACTIONS = Object.keys(ACTION_CONFIG);
