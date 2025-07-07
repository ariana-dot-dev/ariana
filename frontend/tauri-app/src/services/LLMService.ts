import { ClaudeCodeAgent } from "./ClaudeCodeAgent";
import { OsSession } from "../bindings/os";

export interface LLMRequest {
	prompt: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	provider?: string;
	apiKey?: string;
}

export interface LLMResponse {
	content: string;
	tokens?: number;
	elapsed: number;
	model: string;
}

export interface LLMProvider {
	name: string;
	makeRequest(request: LLMRequest): Promise<LLMResponse>;
}

export class ClaudeLLMProvider implements LLMProvider {
	name = "claude";
	private claudeAgent: ClaudeCodeAgent;
	private osSession: OsSession;

	constructor(osSession: OsSession) {
		this.claudeAgent = new ClaudeCodeAgent();
		this.osSession = osSession;
	}

	async makeRequest(request: LLMRequest): Promise<LLMResponse> {
		const startTime = Date.now();
		
		return new Promise((resolve, reject) => {
			let responseContent = "";
			let taskCompleted = false;

			const handleScreenUpdate = (tuiLines: any[]) => {
				const screenText = tuiLines.map(line => line.content).join('\n');
				responseContent = screenText;
			};

			const handleTaskCompleted = (result: any) => {
				if (taskCompleted) return;
				taskCompleted = true;
				
				this.claudeAgent.off("screenUpdate", handleScreenUpdate);
				this.claudeAgent.off("taskCompleted", handleTaskCompleted);
				this.claudeAgent.off("taskError", handleTaskError);

				const elapsed = Date.now() - startTime;
				resolve({
					content: responseContent,
					tokens: result.tokens,
					elapsed,
					model: "claude"
				});
			};

			const handleTaskError = (error: string) => {
				if (taskCompleted) return;
				taskCompleted = true;
				
				this.claudeAgent.off("screenUpdate", handleScreenUpdate);
				this.claudeAgent.off("taskCompleted", handleTaskCompleted);
				this.claudeAgent.off("taskError", handleTaskError);
				
				reject(new Error(error));
			};

			this.claudeAgent.on("screenUpdate", handleScreenUpdate);
			this.claudeAgent.on("taskCompleted", handleTaskCompleted);
			this.claudeAgent.on("taskError", handleTaskError);

			this.claudeAgent.startTask(this.osSession, request.prompt).catch(reject);
		});
	}

	async cleanup(): Promise<void> {
		await this.claudeAgent.cleanup();
	}
}

export class HttpLLMProvider implements LLMProvider {
	name = "http";
	private baseUrl: string;

	constructor(baseUrl: string = "http://localhost:8080") {
		this.baseUrl = baseUrl;
	}

	async makeRequest(request: LLMRequest): Promise<LLMResponse> {
		// Use Claude CLI endpoint for local Claude execution
		const apiRequest = {
			prompt: request.prompt
		};

		try {
			const response = await fetch(`${this.baseUrl}/api/claude`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(apiRequest),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error || `HTTP ${response.status}`);
			}

			const data = await response.json();

			return {
				content: data.content,
				tokens: data.tokens,
				elapsed: data.elapsed,
				model: data.model
			};
		} catch (error) {
			throw new Error(`HTTP LLM request failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

export class LLMService {
	private providers: Map<string, LLMProvider> = new Map();
	private defaultProvider: string = "http";

	constructor(osSession?: OsSession, baseUrl?: string) {
		// Register HTTP provider (default)
		this.registerProvider(new HttpLLMProvider(baseUrl));
		
		// Register Claude Code agent if osSession provided
		if (osSession) {
			this.registerProvider(new ClaudeLLMProvider(osSession));
		}
	}

	registerProvider(provider: LLMProvider): void {
		this.providers.set(provider.name, provider);
	}

	setDefaultProvider(providerName: string): void {
		if (!this.providers.has(providerName)) {
			throw new Error(`Provider '${providerName}' not found`);
		}
		this.defaultProvider = providerName;
	}

	async makeRequest(request: LLMRequest, providerName?: string): Promise<LLMResponse> {
		const provider = this.providers.get(providerName || this.defaultProvider);
		if (!provider) {
			throw new Error(`Provider '${providerName || this.defaultProvider}' not found`);
		}

		return provider.makeRequest(request);
	}

	async makeClaude(request: LLMRequest): Promise<LLMResponse> {
		const provider = this.providers.get("claude");
		if (!provider) {
			throw new Error("Claude provider not found");
		}
		return provider.makeRequest(request);
	}
}