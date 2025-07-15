# Claude Code Integration - Type Errors Fix Plan

## Feature Overview
The Claude Code Integration provides AI-powered coding assistance through terminals and background agents, including code generation, editing, and problem-solving capabilities.

## Affected Files
- `src/services/ClaudeCodeAgent.ts` (9 errors)
- `src/services/LLMService.ts` (potential issues)
- `src/services/AgentCommandService.ts` (potential issues)
- `src/commands/agent_commands.json` (command definitions)

## Root Cause Analysis

### 1. **Missing String Methods for ES Target**
The code uses `replaceAll` which doesn't exist in the current ES target:
```typescript
// Lines 537, 569 in ClaudeCodeAgent.ts
text.replaceAll('old', 'new') // Error: Property 'replaceAll' does not exist
```

### 2. **Unused Import Variables**
Multiple imports are declared but never used, suggesting incomplete implementation or refactoring:
```typescript
// Various unused imports that may indicate missing functionality
```

### 3. **Type Mismatches in Agent Commands**
The agent command system may have type mismatches between command definitions and usage.

## Fixes Required

### Phase 1: Fix String Methods
```typescript
// Replace replaceAll with regex for broader compatibility
// Before
text.replaceAll('old', 'new')

// After
text.replace(/old/g, 'new')

// Or update tsconfig.json to use ES2021+
{
  "compilerOptions": {
    "target": "ES2021", // or later
    "lib": ["ES2021", "DOM", "DOM.Iterable"]
  }
}
```

### Phase 2: Review and Clean Up Imports
```typescript
// Remove unused imports or implement missing functionality
// If import is for future use, add TODO comment
import { futureFeature } from './utils'; // TODO: implement in next sprint
```

### Phase 3: Strengthen Command Type Safety
```typescript
// Define strict types for agent commands
interface AgentCommand {
  id: string;
  name: string;
  description: string;
  parameters: CommandParameter[];
  category: CommandCategory;
}

interface CommandParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required: boolean;
  description: string;
  validation?: ValidationRule;
}

// Type-safe command execution
class AgentCommandService {
  async executeCommand<T = any>(
    command: AgentCommand,
    parameters: Record<string, any>
  ): Promise<T> {
    // Validate parameters against command definition
    this.validateParameters(command, parameters);
    
    // Execute with type safety
    return this.execute(command, parameters);
  }
  
  private validateParameters(
    command: AgentCommand,
    parameters: Record<string, any>
  ): void {
    // Runtime validation
    for (const param of command.parameters) {
      if (param.required && !(param.name in parameters)) {
        throw new Error(`Missing required parameter: ${param.name}`);
      }
      
      if (param.name in parameters) {
        const value = parameters[param.name];
        if (typeof value !== param.type) {
          throw new Error(`Parameter ${param.name} must be of type ${param.type}`);
        }
      }
    }
  }
}
```

## Claude Code Architecture Issues

The integration shows signs of rapid development:
1. **Missing error handling** - AI operations can fail in many ways
2. **No retry logic** - Network issues should be handled
3. **No rate limiting** - API calls may need throttling
4. **No caching** - Repeated requests could be cached

Consider architectural improvements:
```typescript
interface ClaudeCodeOptions {
  maxRetries: number;
  timeoutMs: number;
  rateLimitMs: number;
  cacheEnabled: boolean;
}

class ClaudeCodeAgent {
  constructor(private options: ClaudeCodeOptions) {}
  
  async generateCode(prompt: string): Promise<string> {
    return this.withRetry(async () => {
      const response = await this.llmService.generate(prompt);
      return this.postProcessCode(response);
    });
  }
  
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === this.options.maxRetries - 1) throw error;
        await this.delay(this.options.rateLimitMs * Math.pow(2, attempt));
      }
    }
    throw new Error('Max retries exceeded');
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  private postProcessCode(code: string): string {
    // Use compatible string methods
    return code
      .replace(/\r\n/g, '\n') // Normalize line endings
      .replace(/\t/g, '  ') // Convert tabs to spaces
      .trim();
  }
}
```

## AI Integration Best Practices

Consider adding:
1. **Input sanitization** - Validate prompts before sending
2. **Output validation** - Ensure generated code is safe
3. **Context management** - Track conversation history
4. **Model selection** - Choose appropriate model for task
5. **Cost tracking** - Monitor API usage

```typescript
interface AIRequest {
  prompt: string;
  context?: string[];
  model?: 'claude-3' | 'claude-3.5';
  maxTokens?: number;
  temperature?: number;
}

interface AIResponse {
  content: string;
  model: string;
  tokensUsed: number;
  cost: number;
  duration: number;
}
```

## Impact
- 9 errors in core AI integration
- Affects AI-powered coding features
- String method errors prevent code generation
- Missing type safety may cause runtime errors
- Critical for the AI-assisted development workflow

## Testing Strategy
1. Test with various prompt types (code generation, debugging, explanation)
2. Test error scenarios (network failures, invalid responses)
3. Test rate limiting and retry logic
4. Test with different model configurations
5. Test context management and conversation flow
6. Test integration with terminal and background agents
7. Verify security and output validation
8. Test performance with long conversations