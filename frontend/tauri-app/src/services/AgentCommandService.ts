import { CommunicationService } from './CommunicationService';
import agentCommands from '../commands/agent_commands.json';
import { GitProject } from '../types/GitProject';

// Types for command processing
export interface AgentCommand {
  id: string;
  name: string;
  description: string;
  pattern: string[];
  parameters?: Record<string, {
    type: string;
    required: boolean;
    description: string;
  }>;
  action: {
    type: string;
    payload: Record<string, any>;
  };
}

export interface ParsedCommand {
  commandId: string;
  commandName: string;
  parameters: Record<string, any>;
  action: {
    type: string;
    payload: Record<string, any>;
  };
}

export interface Agent {
  id: string;
  name: string;
  status: 'created' | 'active' | 'busy' | 'idle';
  created: string;
  lastActivity: string;
  conversations: Array<{
    prompt: string;
    response: string;
    timestamp: string;
  }>;
}

export class AgentCommandService {
  private communicationService: CommunicationService;
  private agents: Map<string, Agent> = new Map();
  private commands: AgentCommand[];
  private currentProject: GitProject | null = null;
  private updateProjectCallback?: () => void;

  constructor() {
    this.communicationService = new CommunicationService();
    this.commands = agentCommands.commands as AgentCommand[];
  }

  setCurrentProject(project: GitProject | null) {
    this.currentProject = project;
  }

  setUpdateProjectCallback(callback: () => void) {
    this.updateProjectCallback = callback;
  }

  /**
   * Enhanced natural language parser that identifies commands and extracts arguments
   * Example: "create agent that writes hello world" -> [{"command": "create_agent", "args": {"prompt": "write hello world"}}]
   */
  async parseNaturalLanguageToCommands(input: string): Promise<Array<{command: string, args: Record<string, any>}>> {
    const systemPrompt = `You are an intelligent command parser for an AI development environment. Parse natural language input into structured JSON commands.

Available Commands:
${JSON.stringify(this.commands, null, 2)}

Instructions:
1. Identify the user's intent from the natural language input
2. Map the intent to appropriate command(s) from the available commands
3. Extract relevant parameters and arguments from the input
4. Return a JSON array with simplified command structure
5. For agent creation with tasks, include the task as a "prompt" argument
6. Be flexible with pattern matching and understand variations in wording
7. Handle compound commands (multiple actions in one input)

Input: "${input}"

Expected output format:
[
  {"command": "command_id", "args": {"param1": "value1", "param2": "value2"}}
]

Examples:
- "create agent that writes hello world" -> [{"command": "create_agent", "args": {"agentName": "CodeWriter", "prompt": "write hello world"}}]
- "ask MyAgent to fix bugs" -> [{"command": "prompt_agent", "args": {"agentName": "MyAgent", "prompt": "fix bugs"}}]
- "list all agents" -> [{"command": "list_agents", "args": {}}]
- "delete agent TestAgent" -> [{"command": "delete_agent", "args": {"agentName": "TestAgent"}}]

Return only the JSON array, no other text.`;

    try {
      const response = await this.communicationService.askClaude(systemPrompt);
      
      // Try to parse the response as JSON
      const responseText = response.content.trim();
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      
      if (jsonMatch) {
        const parsedCommands = JSON.parse(jsonMatch[0]);
        return parsedCommands.map((cmd: any) => ({
          command: cmd.command,
          args: cmd.args || {}
        }));
      }
      
      return [];
    } catch (error) {
      console.error('Error parsing natural language to commands:', error);
      return [];
    }
  }

  /**
   * Parse natural language input and return JSON without executing commands
   * Returns the parsed command structure for display or further processing
   */
  async parseToJsonOnly(input: string): Promise<string> {
    try {
      const parsedCommands = await this.parseNaturalLanguageToCommands(input);
      return JSON.stringify(parsedCommands, null, 2);
    } catch (error) {
      console.error('Error parsing to JSON:', error);
      return JSON.stringify([{"error": "Failed to parse command", "input": input}], null, 2);
    }
  }

  /**
   * Parse natural language input into structured commands using LLM
   */
  async parseCommands(input: string): Promise<ParsedCommand[]> {
    const systemPrompt = `You are a command parser. Parse the following natural language input into structured commands based on these available commands:

${JSON.stringify(this.commands, null, 2)}

Rules:
1. Match input text to command patterns
2. Extract parameters from the input
3. Return JSON array of parsed commands
4. If no commands match, return empty array
5. Handle multiple commands in a single input
6. Replace {now} with current timestamp
7. Be flexible with pattern matching (allow variations in wording)

Input: "${input}"

Response format:
[
  {
    "commandId": "command_id",
    "commandName": "Command Name",
    "parameters": {"param1": "value1"},
    "action": {"type": "action_type", "payload": {...}}
  }
]`;

    try {
      const response = await this.communicationService.askClaude(systemPrompt);
      
      // Try to parse the response as JSON
      const responseText = response.content.trim();
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      
      if (jsonMatch) {
        const parsedCommands = JSON.parse(jsonMatch[0]);
        
        // Process each command to replace placeholders
        return parsedCommands.map((cmd: any) => ({
          ...cmd,
          action: {
            ...cmd.action,
            payload: this.replacePlaceholders(cmd.action.payload, cmd.parameters)
          }
        }));
      }
      
      return [];
    } catch (error) {
      console.error('Error parsing commands:', error);
      return [];
    }
  }

  /**
   * Execute a parsed command
   */
  async executeCommand(command: ParsedCommand): Promise<string> {
    const { action } = command;
    
    switch (action.type) {
      case 'agent_create':
        return await this.createAgent(action.payload);
      
      case 'agent_prompt':
        return await this.promptAgent(action.payload);
      
      case 'agent_merge':
        return await this.mergeAgent(action.payload);
      
      case 'agent_list':
        return this.listAgents();
      
      case 'agent_delete':
        return this.deleteAgent(action.payload);
      
      
      case 'general_query':
        return await this.handleGeneralQuery(action.payload);
      
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * Process natural language input end-to-end
   */
  async processInput(input: string): Promise<string> {
    const commands = await this.parseCommands(input);
    
    if (commands.length === 0) {
      return "I couldn't understand that command. Try commands like 'create new agent MyAgent' or 'list agents'.";
    }

    const results: string[] = [];
    
    for (const command of commands) {
      try {
        const result = await this.executeCommand(command);
        results.push(result);
      } catch (error) {
        results.push(`Error executing command: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    return results.join('\n\n');
  }

  // Agent management methods
  private async createAgent(payload: any): Promise<string> {
    const { name } = payload;
    
    if (!this.currentProject) {
      return "Error: No project selected. Please select a project first.";
    }

    try {
      // Use the existing GitProject addCanvasCopy method to create a new canvas/agent
      const result = await this.currentProject.addCanvasCopy();
      
      if (result.success && result.canvasId) {
        // Get the newly created canvas
        const newCanvas = this.currentProject.canvases.find(c => c.id === result.canvasId);
        
        if (newCanvas) {
          // Rename the canvas to the provided agent name
          const renamed = this.currentProject.renameCanvas(result.canvasId, name);
          
          if (renamed) {
            // Set the new canvas as the current one
            const canvasIndex = this.currentProject.canvases.findIndex(c => c.id === result.canvasId);
            if (canvasIndex !== -1) {
              this.currentProject.setCurrentCanvasIndex(canvasIndex);
            }
            
            // Create an agent entry for tracking
            const agent: Agent = {
              id: result.canvasId,
              name,
              status: 'created',
              created: new Date().toISOString(),
              lastActivity: new Date().toISOString(),
              conversations: []
            };
            
            this.agents.set(result.canvasId, agent);
            
            // Trigger project update to save changes and refresh UI
            if (this.updateProjectCallback) {
              this.updateProjectCallback();
            }
            
            return `Agent "${name}" created successfully! New workspace canvas created with isolated Git branch.`;
          } else {
            return `Agent workspace created but failed to rename canvas. Canvas ID: ${result.canvasId}`;
          }
        } else {
          return `Error: Could not find newly created canvas with ID: ${result.canvasId}`;
        }
      } else {
        return `Failed to create agent workspace: ${result.error || 'Unknown error'}`;
      }
    } catch (error) {
      return `Error creating agent: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async promptAgent(payload: any): Promise<string> {
    const { agentName, prompt } = payload;
    const agent = this.findAgentByName(agentName);
    
    if (!agent) {
      return `Agent "${agentName}" not found.`;
    }

    agent.status = 'busy';
    agent.lastActivity = new Date().toISOString();
    
    try {
      // Send prompt to Claude via the agent
      const response = await this.communicationService.askClaude(
        `As agent "${agentName}", respond to: ${prompt}`
      );
      
      agent.conversations.push({
        prompt,
        response: response.content,
        timestamp: new Date().toISOString()
      });
      
      agent.status = 'idle';
      return `Agent "${agentName}" responded: ${response.content}`;
    } catch (error) {
      agent.status = 'idle';
      return `Error communicating with agent "${agentName}": ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async mergeAgent(payload: any): Promise<string> {
    const { agentName } = payload;
    const agent = this.findAgentByName(agentName);
    
    if (!agent) {
      return `Agent "${agentName}" not found.`;
    }

    if (agent.conversations.length === 0) {
      return `Agent "${agentName}" has no conversations to merge.`;
    }

    // Create a summary of all conversations
    const conversationSummary = agent.conversations.map(conv => 
      `Q: ${conv.prompt}\nA: ${conv.response}`
    ).join('\n\n');

    const mergePrompt = `Summarize and merge these conversations from agent "${agentName}":\n\n${conversationSummary}`;
    
    try {
      const response = await this.communicationService.askClaude(mergePrompt);
      return `Merged conversations from agent "${agentName}":\n${response.content}`;
    } catch (error) {
      return `Error merging agent "${agentName}": ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private listAgents(): string {
    if (this.agents.size === 0) {
      return "No agents created yet.";
    }

    const agentsList = Array.from(this.agents.values())
      .map(agent => `• ${agent.name} (${agent.status}) - Created: ${new Date(agent.created).toLocaleString()}`)
      .join('\n');

    return `Available agents:\n${agentsList}`;
  }

  private deleteAgent(payload: any): string {
    const { agentName } = payload;
    const agent = this.findAgentByName(agentName);
    
    if (!agent) {
      return `Agent "${agentName}" not found.`;
    }

    this.agents.delete(agent.id);
    return `Agent "${agentName}" deleted successfully.`;
  }


  private async handleGeneralQuery(payload: any): Promise<string> {
    const { query } = payload;
    
    try {
      const response = await this.communicationService.askClaude(query);
      return response.content;
    } catch (error) {
      return `Error processing query: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // Helper methods
  private findAgentByName(name: string): Agent | undefined {
    return Array.from(this.agents.values()).find(agent => 
      agent.name.toLowerCase() === name.toLowerCase()
    );
  }

  private replacePlaceholders(payload: any, parameters: Record<string, any>): any {
    const result = { ...payload };
    
    // Replace {now} with current timestamp
    Object.keys(result).forEach(key => {
      if (typeof result[key] === 'string') {
        result[key] = result[key].replace('{now}', new Date().toISOString());
        
        // Replace parameter placeholders
        Object.keys(parameters).forEach(paramKey => {
          const placeholder = `{${paramKey}}`;
          if (result[key].includes(placeholder)) {
            result[key] = result[key].replace(placeholder, parameters[paramKey]);
          }
        });
      }
    });
    
    return result;
  }

  // Public methods for external access
  public getAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  public getAgent(name: string): Agent | undefined {
    return this.findAgentByName(name);
  }
}