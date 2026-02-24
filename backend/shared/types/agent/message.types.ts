// Agent message and conversation types
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  timestamp: number;
  tools?: Array<{
    use: ToolUse;
    result?: ToolResult;
  }>;
  isStreaming?: boolean;
}


export interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  error?: string;
}

export interface ToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input?: any;
  status?: 'pending' | 'completed' | 'error';
}

// Content block for structured messages
export interface ContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  name?: string;
  input?: any;
  id?: string;
}


