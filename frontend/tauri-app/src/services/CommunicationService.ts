interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface InferenceRequest {
  provider: string;
  model: string;
  messages: Message[];
  api_key: string;
  temperature?: number;
  max_tokens?: number;
}

interface InferenceResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
}

interface StreamResponse {
  delta: string;
  model: string;
  done: boolean;
}

interface ClaudeRequest {
  prompt: string;
}

interface ClaudeResponse {
  content: string;
  tokens?: number;
  elapsed: number;
  model: string;
}

interface Provider {
  name: string;
  display_name: string;
  models: Array<{
    id: string;
    name: string;
    context_length: number;
  }>;
}

interface ProvidersResponse {
  providers: Provider[];
}

export class CommunicationService {
  private baseUrl = 'http://localhost:8080/api';

  async getProviders(): Promise<ProvidersResponse> {
    const response = await fetch(`${this.baseUrl}/providers`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  }

  async sendMessage(request: InferenceRequest): Promise<InferenceResponse> {
    const response = await fetch(`${this.baseUrl}/inference`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }

    return await response.json();
  }

  async *sendMessageStream(request: InferenceRequest): AsyncGenerator<StreamResponse, void, unknown> {
    const response = await fetch(`${this.baseUrl}/inference/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as StreamResponse;
              yield data;
              if (data.done) return;
            } catch (e) {
              console.warn('Failed to parse SSE data:', line);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  createSimpleMessage(content: string): Message {
    return {
      role: 'user',
      content,
    };
  }

  createSystemMessage(content: string): Message {
    return {
      role: 'system',
      content,
    };
  }

  createBasicRequest(
    provider: string,
    model: string,
    message: string,
    apiKey: string,
    systemPrompt?: string
  ): InferenceRequest {
    const messages: Message[] = [];
    
    if (systemPrompt) {
      messages.push(this.createSystemMessage(systemPrompt));
    }
    
    messages.push(this.createSimpleMessage(message));

    return {
      provider,
      model,
      messages,
      api_key: apiKey,
      temperature: 0.7,
      max_tokens: 1000,
    };
  }

  async askClaude(prompt: string): Promise<ClaudeResponse> {
    const request: ClaudeRequest = {
      prompt,
    };

    const response = await fetch(`${this.baseUrl}/claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }

    return await response.json();
  }
}

export const communicationService = new CommunicationService();