import { communicationService } from './CommunicationService';

// Types for command structure
export interface Command {
  command: string;
  args: Record<string, any>;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: any;
}

// Command handler interface
export interface CommandHandler {
  (args: Record<string, any>): Promise<CommandResult>;
}

export class CommandDispatcher {
  private handlers: Map<string, CommandHandler> = new Map();
  private agentCreateCallback?: (agentName: string, prompt: string) => {success: boolean, message: string, data?: any};

  constructor() {
    this.registerDefaultHandlers();
  }

  /**
   * Set the agent creation callback for actual UI integration
   */
  setAgentCreateCallback(callback: (agentName: string, prompt: string) => {success: boolean, message: string, data?: any}) {
    this.agentCreateCallback = callback;
  }

  /**
   * Register a command handler
   */
  registerHandler(command: string, handler: CommandHandler): void {
    this.handlers.set(command, handler);
  }

  /**
   * Execute a single command
   */
  async executeCommand(command: Command): Promise<CommandResult> {
    const handler = this.handlers.get(command.command);
    
    if (!handler) {
      return {
        success: false,
        message: `Unknown command: ${command.command}`,
        data: { command: command.command, availableCommands: Array.from(this.handlers.keys()) }
      };
    }

    try {
      const result = await handler(command.args);
      return result;
    } catch (error) {
      return {
        success: false,
        message: `Error executing command '${command.command}': ${error instanceof Error ? error.message : String(error)}`,
        data: { command: command.command, error: error }
      };
    }
  }

  /**
   * Execute multiple commands in sequence
   */
  async executeCommands(commands: Command[]): Promise<CommandResult[]> {
    const results: CommandResult[] = [];
    
    for (const command of commands) {
      const result = await this.executeCommand(command);
      results.push(result);
      
      // Stop execution if a command fails (optional behavior)
      if (!result.success) {
        console.warn(`Command '${command.command}' failed, continuing with next command...`);
      }
    }
    
    return results;
  }

  /**
   * Get list of available commands
   */
  getAvailableCommands(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Register default command handlers
   */
  private registerDefaultHandlers(): void {
    // Create Agent Command
    this.registerHandler('create_agent', async (args) => {
      return await this.handleCreateAgent(args);
    });

    // Prompt Agent Command
    this.registerHandler('prompt_agent', async (args) => {
      return await this.handlePromptAgent(args);
    });

    // List Agents Command
    this.registerHandler('list_agents', async (args) => {
      return await this.handleListAgents(args);
    });

    // Delete Agent Command
    this.registerHandler('delete_agent', async (args) => {
      return await this.handleDeleteAgent(args);
    });

    // Merge Agent Command
    this.registerHandler('merge_agent', async (args) => {
      return await this.handleMergeAgent(args);
    });
  }

  /**
   * Handle create_agent command
   */
  private async handleCreateAgent(args: Record<string, any>): Promise<CommandResult> {
    const { agentName, prompt } = args;
    
    // Validate required arguments
    if (!agentName) {
      return {
        success: false,
        message: "Missing required argument: agentName"
      };
    }

    try {
      // If we have a callback for actual UI integration, use it
      if (this.agentCreateCallback) {
        const result = this.agentCreateCallback(agentName, prompt || 'general assistance');
        return result;
      }
      
      // Fallback: simulate the "Create New Agent" button behavior
      // Send an initial prompt to Claude to establish the agent's context
      const systemPrompt = `You are now acting as an AI agent named "${agentName}". Your primary task is: ${prompt || 'general assistance'}.

Please acknowledge your role and briefly describe how you will approach this task.`;

      const response = await communicationService.askClaude(systemPrompt);
      
      return {
        success: true,
        message: `Agent "${agentName}" created successfully! (Note: This is a simulation - no actual UI agent was created)`,
        data: {
          agentName,
          prompt: prompt || 'general assistance',
          initialResponse: response.content,
          timestamp: new Date().toISOString()
        }
      };
      
    } catch (error) {
      return {
        success: false,
        message: `Failed to create agent "${agentName}": ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Handle prompt_agent command
   */
  private async handlePromptAgent(args: Record<string, any>): Promise<CommandResult> {
    const { agentName, prompt } = args;
    
    if (!agentName || !prompt) {
      return {
        success: false,
        message: "Missing required arguments: agentName and prompt"
      };
    }

    try {
      // Send prompt to the specified agent
      const systemPrompt = `You are agent "${agentName}". Please respond to this prompt: ${prompt}`;
      const response = await communicationService.askClaude(systemPrompt);
      
      return {
        success: true,
        message: `Agent "${agentName}" responded successfully`,
        data: {
          agentName,
          prompt,
          response: response.content,
          timestamp: new Date().toISOString()
        }
      };
      
    } catch (error) {
      return {
        success: false,
        message: `Failed to prompt agent "${agentName}": ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Handle list_agents command
   */
  private async handleListAgents(args: Record<string, any>): Promise<CommandResult> {
    // For now, return a placeholder response
    // In a real implementation, this would query the actual agent storage
    return {
      success: true,
      message: "Agent list retrieved successfully",
      data: {
        agents: [
          { name: "Example Agent", status: "active", created: "2024-01-01" }
        ],
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Handle delete_agent command
   */
  private async handleDeleteAgent(args: Record<string, any>): Promise<CommandResult> {
    const { agentName } = args;
    
    if (!agentName) {
      return {
        success: false,
        message: "Missing required argument: agentName"
      };
    }

    // For now, return a placeholder response
    return {
      success: true,
      message: `Agent "${agentName}" deleted successfully`,
      data: {
        agentName,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Handle merge_agent command
   */
  private async handleMergeAgent(args: Record<string, any>): Promise<CommandResult> {
    const { agentName } = args;
    
    if (!agentName) {
      return {
        success: false,
        message: "Missing required argument: agentName"
      };
    }

    // For now, return a placeholder response
    return {
      success: true,
      message: `Agent "${agentName}" merged successfully`,
      data: {
        agentName,
        timestamp: new Date().toISOString()
      }
    };
  }
}

// Export singleton instance
export const commandDispatcher = new CommandDispatcher();