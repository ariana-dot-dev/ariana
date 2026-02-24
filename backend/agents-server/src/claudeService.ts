import { Options, query, Query, SDKCompactBoundaryMessage, SDKMessageBase, SDKPartialAssistantMessage, SDKResultMessage, SDKSystemMessage, SDKUserMessage, SDKUserMessageReplay } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID, UUID } from 'crypto';
import { customEnvironmentVariables } from './handlers/start';
import { addCompactionCompleteEvent } from './contextEventReporter';

/**
 * Extended options for running Claude queries
 */
export interface ExtendedQueryOptions {
  // Session ID to resume a previous conversation (preferred over continue)
  resume?: string;
  // Deprecated: use resume instead. Kept for backwards compatibility.
  continue?: boolean;
  systemPromptAppend?: string;
  cwd?: string;
  abortController?: AbortController;
}

export type SDKAssistantMessage = SDKMessageBase & {
    type: 'assistant';
    message: {
        id: string,
        type: string,
        role: string,
        model: string,
        content: {
            type: 'text',
            text: string
        }[],
        stop_reason: null,
        stop_sequence: null,
        usage: {
            input_tokens: number,
            cache_creation_input_tokens: number,
            cache_read_input_tokens: number,
            cache_creation: {
                ephemeral_5m_input_tokens: number,
                ephemeral_1h_input_tokens: number
            },
            output_tokens: number,
            service_tier: "standard"
        }
    };
    parent_tool_use_id: string | null;
    uuid: UUID;
    timestamp: Date;
};

export type UserMessage = {
    type: 'user',
    message: string,
    timestamp: Date,
    uuid: UUID
}

export type SDKMessage = SDKAssistantMessage
    | UserMessage
    | SDKResultMessage
    | SDKSystemMessage
    | SDKPartialAssistantMessage
    | SDKCompactBoundaryMessage;

export interface MessageRequest {
    message: string;
}

function mapModel(model: 'opus' | 'sonnet' | 'haiku'): string {
    if (model === 'opus') return 'claude-opus-4-6';
    if (model === 'sonnet') return 'claude-sonnet-4-6';
    return model;
}

/**
 * Shared function to run a Claude SDK query with consistent configuration and logging
 * @param prompt - The prompt to send to Claude
 * @param model - The model to use ('opus', 'sonnet', or 'haiku')
 * @param options - Additional options (continue, systemPromptAppend, cwd, abortController)
 * @returns AsyncGenerator of SDK messages
 */
export async function* runClaudeQuery(
    prompt: string,
    model: 'opus' | 'sonnet' | 'haiku',
    options: ExtendedQueryOptions = {}
): AsyncGenerator<any, void, unknown> {
    const env: { [key: string]: string | undefined } = {
        "SHELL": process.env.SHELL,
        "PWD": options.cwd || process.env.PWD,
        "PATH": process.env.PATH,
        "USER": process.env.USER,
        "HOME": process.env.HOME,
        "NODE": process.env.NODE,
        "LANG": process.env.LANG,
        "WINDOW": process.env.WINDOW,
        "IS_SANDBOX": process.env.IS_SANDBOX || "1"
    };

    // Claude SDK authentication - pass through all relevant env vars
    // These are set by the backend based on user's provider configuration
    if (process.env.ANTHROPIC_BASE_URL) {
        env["ANTHROPIC_BASE_URL"] = process.env.ANTHROPIC_BASE_URL;
    }
    if (process.env.ANTHROPIC_AUTH_TOKEN) {
        env["ANTHROPIC_AUTH_TOKEN"] = process.env.ANTHROPIC_AUTH_TOKEN;
    }
    if (process.env.ANTHROPIC_API_KEY !== undefined) {
        env["ANTHROPIC_API_KEY"] = process.env.ANTHROPIC_API_KEY;
    }
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN && process.env.CLAUDE_CODE_OAUTH_TOKEN !== "") {
        env["CLAUDE_CODE_OAUTH_TOKEN"] = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }

    // Add GitHub token for gh CLI authentication
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN !== "") {
        env["GITHUB_TOKEN"] = process.env.GITHUB_TOKEN;
    }

    // Add custom environment variables from PersonalEnvironment
    for (const key of Array.from(customEnvironmentVariables)) {
        const value = process.env[key];
        if (value !== undefined) {
            env[key] = value;
        }
    }

    const claudeOptions: Options = {
        // Use resume with session ID if available, otherwise fall back to continue flag
        ...(options.resume ? { resume: options.resume } : { continue: options.continue ?? false }),
        model: mapModel(model),
        fallbackModel: mapModel(model === 'haiku' ? 'sonnet' : (
            model === 'sonnet' ? 'opus' : (
                model === 'opus' ? 'sonnet' : 'haiku'
            )
        )),
        permissionMode: 'bypassPermissions',
        systemPrompt: options.systemPromptAppend
            ? { type: "preset", preset: "claude_code", append: options.systemPromptAppend }
            : { type: "preset", preset: "claude_code" },
        abortController: options.abortController,
        settingSources: ["user", "project", "local"],
        cwd: options.cwd || process.env.WORK_DIR || '/tmp',
        env,
        pathToClaudeCodeExecutable: process.env.CLAUDE_PATH || '/usr/local/bin/claude',
        // Enable Skill tool for Ariana CLI
        allowedTools: ['Skill'],
    };

    console.log('[Claude] Query options:', JSON.stringify({
        ...claudeOptions,
        abortController: options.abortController ? '[AbortController]' : undefined
    }, null, 2));

    for await (const message of query({ prompt, options: claudeOptions })) {
        console.log(`[Claude] Received message type: ${message.type}`);
        console.log('[Claude] Full SDK message:', JSON.stringify(message, null, 2));

        // Extra logging for Skill tool to understand SDK output
        if (message.type === 'assistant' && message.message?.content) {
            for (const block of message.message.content) {
                if (block.type === 'tool_use' && block.name === 'Skill') {
                    console.log('[Claude] *** SKILL TOOL USE DETECTED ***');
                    console.log('[Claude] Skill block:', JSON.stringify(block, null, 2));
                }
            }
        }
        // Check for skill-related user messages (tool results)
        if (message.type === 'user' && message.message?.content) {
            const content = Array.isArray(message.message.content) ? message.message.content : [];
            for (const block of content) {
                if (block.type === 'tool_result') {
                    console.log('[Claude] *** TOOL RESULT ***');
                    console.log('[Claude] Tool result block:', JSON.stringify(block, null, 2));
                }
            }
        }

        yield message;
    }
}

export class ClaudeService {
    private _isProcessing: boolean = false;
    private abortController: AbortController;
    private messages: Map<UUID, SDKMessage> = new Map();
    private pastConversations: SDKMessage[] = [];
    private initialInstructions: string = '';

    // Context tracking - populated dynamically from SDK result messages
    private contextWindow: number | null = null;

    // SDK session ID for conversation continuity
    // Captured from the 'init' system message and used with 'resume' option
    private sessionId: string | null = null;

    // Promise that resolves when the current processMessage completes.
    // Used to wait for the previous processing to finish before starting a new one.
    private processingComplete: Promise<void> = Promise.resolve();
    private resolveProcessingComplete: (() => void) | null = null;

    // Current active Query object - needed to call interrupt() for immediate stop
    private currentQuery: Query | null = null;

    // Streaming message tracking - accumulates text deltas into a single message
    // that gets served via getMessages() with isStreaming=true
    private streamingMessageUuid: UUID | null = null;
    private streamingText: string = '';
    private streamingTimestamp: Date | null = null;

    // Dedup tracking: maps API message ID → UUID in the messages Map.
    // includePartialMessages causes the SDK to re-yield the same assistant message
    // multiple times as content streams in. This map lets us update in place.
    private assistantMessageIdToUuid: Map<string, UUID> = new Map();

    constructor() {
        this.abortController = new AbortController();
    }

    setInitialInstructions(instructions: string): void {
        this.initialInstructions = instructions;
    }

    /**
     * Get current context usage stats.
     * Returns null if context window hasn't been determined yet (no result message received).
     */
    getContextUsage(): { usedPercent: number; remainingPercent: number; totalTokens: number; contextWindow: number } | null {
        // Context window must be known from a previous result message
        if (this.contextWindow === null) {
            return null;
        }

        // Find the last assistant message with usage
        const messages = Array.from(this.messages.values());
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.type === 'assistant' && 'message' in msg && msg.message?.usage) {
                const usage = msg.message.usage;
                const totalTokens = usage.input_tokens +
                                   usage.cache_creation_input_tokens +
                                   usage.cache_read_input_tokens;
                const usedPercent = Math.round((totalTokens / this.contextWindow) * 100);
                return {
                    usedPercent,
                    remainingPercent: 100 - usedPercent,
                    totalTokens,
                    contextWindow: this.contextWindow
                };
            }
        }
        return null;
    }

    async processMessage(request: MessageRequest, model: 'opus' | 'sonnet' | 'haiku') {
        // Wait for any previous processing to complete before starting.
        // This prevents race conditions when interrupt happens and a new prompt is sent
        // before the old processMessage has fully cleaned up.
        if (this._isProcessing) {
            console.log('[Claude] Waiting for previous processing to complete before starting new prompt');
            await this.processingComplete;
        }

        this._isProcessing = true;

        // Create a new Promise for tracking when this processing completes
        this.processingComplete = new Promise((resolve) => {
            this.resolveProcessingComplete = resolve;
        });

        const userMessageStoreUuid = randomUUID();
        const userMessage: UserMessage = {
            type: 'user',
            message: request.message,
            timestamp: new Date(),
            uuid: userMessageStoreUuid
        };
        this.messages.set(userMessageStoreUuid, userMessage);

        let completedSuccessfully = false;

        try {
            // Build system prompt append with initial instructions
            const systemPromptAppend = this.initialInstructions;

            // Build query options inline so we can store the Query object for interrupt()
            const env: { [key: string]: string | undefined } = {
                "SHELL": process.env.SHELL,
                "PWD": process.env.WORK_DIR || '/tmp',
                "PATH": process.env.PATH,
                "USER": process.env.USER,
                "HOME": process.env.HOME,
                "NODE": process.env.NODE,
                "LANG": process.env.LANG,
                "WINDOW": process.env.WINDOW,
                "IS_SANDBOX": process.env.IS_SANDBOX || "1"
            };

            // Claude SDK authentication - pass through all relevant env vars
            if (process.env.ANTHROPIC_BASE_URL) {
                env["ANTHROPIC_BASE_URL"] = process.env.ANTHROPIC_BASE_URL;
            }
            if (process.env.ANTHROPIC_AUTH_TOKEN) {
                env["ANTHROPIC_AUTH_TOKEN"] = process.env.ANTHROPIC_AUTH_TOKEN;
            }
            if (process.env.ANTHROPIC_API_KEY !== undefined) {
                env["ANTHROPIC_API_KEY"] = process.env.ANTHROPIC_API_KEY;
            }
            if (process.env.CLAUDE_CODE_OAUTH_TOKEN && process.env.CLAUDE_CODE_OAUTH_TOKEN !== "") {
                env["CLAUDE_CODE_OAUTH_TOKEN"] = process.env.CLAUDE_CODE_OAUTH_TOKEN;
            }
            if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN !== "") {
                env["GITHUB_TOKEN"] = process.env.GITHUB_TOKEN;
            }

            // Add custom environment variables from PersonalEnvironment
            for (const key of Array.from(customEnvironmentVariables)) {
                const value = process.env[key];
                if (value !== undefined) {
                    env[key] = value;
                }
            }

            const claudeOptions: Options = {
                ...(this.sessionId ? { resume: this.sessionId } : { continue: false }),
                model,
                fallbackModel: model === 'haiku' ? 'sonnet' : (model === 'sonnet' ? 'opus' : 'sonnet'),
                permissionMode: 'bypassPermissions',
                systemPrompt: systemPromptAppend
                    ? { type: "preset", preset: "claude_code", append: systemPromptAppend }
                    : { type: "preset", preset: "claude_code" },
                abortController: this.abortController,
                settingSources: ["user", "project", "local"],
                cwd: process.env.WORK_DIR || '/tmp',
                env,
                pathToClaudeCodeExecutable: process.env.CLAUDE_PATH || '/usr/local/bin/claude',
                allowedTools: ['Skill'],
                includePartialMessages: true,
                betas: ['context-1m-2025-08-07']
            };

            console.log('[Claude] Query options:', JSON.stringify({
                ...claudeOptions,
                abortController: '[AbortController]'
            }, null, 2));

            // Create the Query object and store it for interrupt() support
            // Query extends AsyncGenerator, so we can iterate over it
            this.currentQuery = query({ prompt: request.message, options: claudeOptions });

            for await (const message of this.currentQuery) {
                // Check if aborted
                if (this.abortController.signal.aborted) {
                    console.log('[Claude] Processing aborted - session preserved for resume');
                    this.clearStreamingMessage();
                    break;
                }

                // Capture session ID from init message for future resume
                if (message.type === 'system' && 'subtype' in message && message.subtype === 'init' && message.session_id) {
                    this.sessionId = message.session_id;
                    console.log(`[Claude] Captured session ID: ${this.sessionId}`);
                }

                // Handle streaming events - accumulate text deltas into a single streaming message
                if (message.type === 'stream_event') {
                    const event = (message as SDKPartialAssistantMessage).event as any;
                    if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
                        // Start a new streaming text block
                        if (!this.streamingMessageUuid) {
                            this.streamingMessageUuid = randomUUID();
                            this.streamingText = '';
                            this.streamingTimestamp = new Date();
                        }
                    } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                        // Append text delta to streaming buffer
                        this.streamingText += event.delta.text;
                    }
                    // Note: Don't clear on message_stop - wait for the full assistant message
                    // to avoid a gap where neither streaming nor full message is visible
                    continue; // Don't store stream events as individual messages
                }

                // When a full assistant message arrives, clear any streaming state
                if (message.type === 'assistant') {
                    this.clearStreamingMessage();

                    // Dedup: includePartialMessages causes the SDK to re-yield the same
                    // assistant message multiple times as content streams in. The API
                    // message ID is stable across re-yields, so update in place.
                    const apiMessageId = (message as SDKAssistantMessage).message?.id;
                    if (apiMessageId) {
                        const existingUuid = this.assistantMessageIdToUuid.get(apiMessageId);
                        if (existingUuid) {
                            this.messages.set(existingUuid, { ...message, uuid: existingUuid, timestamp: new Date() } as SDKMessage);
                            console.log(`[Claude] Updated assistant message ${apiMessageId} (UUID: ${existingUuid})`);
                            continue;
                        }
                    }
                }

                // Message is already in SDKMessage format, just store it directly
                const storedUuid = randomUUID();
                this.messages.set(storedUuid, { ...message, uuid: storedUuid, timestamp: new Date() } as SDKMessage);

                // Track assistant message API IDs for dedup
                if (message.type === 'assistant') {
                    const apiMessageId = (message as SDKAssistantMessage).message?.id;
                    if (apiMessageId) {
                        this.assistantMessageIdToUuid.set(apiMessageId, storedUuid);
                    }
                }

                console.log(`[Claude] Stored message with UUID: ${storedUuid}`);

                // Handle compaction boundary messages from SDK
                if (message.type === 'system' && 'subtype' in message) {
                    const systemMsg = message as SDKCompactBoundaryMessage;
                    if (systemMsg.subtype === 'compact_boundary') {
                        const compactMeta = systemMsg.compact_metadata;
                        console.log(`[Claude] Compaction completed: trigger=${compactMeta.trigger}, pre_tokens=${compactMeta.pre_tokens}`);

                        // Report compaction event to be polled by backend
                        // Note: SDK only provides pre_tokens, not post-compaction token count
                        addCompactionCompleteEvent(
                            null, // taskId will be filled by backend
                            `Context automatically compacted (trigger: ${compactMeta.trigger})`,
                            compactMeta.pre_tokens
                        );
                    }
                }

                // NOTE: Tool-based automation triggers (on_after_read_files, on_after_edit_files, on_after_run_command)
                // are now handled by the backend via message polling, not here

                // If this is a result message, capture context window and finish
                if (message.type === 'result') {
                    // Extract context window from modelUsage (per SDK docs)
                    const resultMsg = message as SDKResultMessage;
                    if ('modelUsage' in resultMsg && resultMsg.modelUsage) {
                        for (const [modelName, usage] of Object.entries(resultMsg.modelUsage)) {
                            if (usage && typeof (usage as { contextWindow: number }).contextWindow === 'number') {
                                this.contextWindow = (usage as { contextWindow: number }).contextWindow;
                                console.log(`[Claude] Context window from SDK: ${this.contextWindow} (model: ${modelName})`);
                                break;
                            }
                        }
                    }
                    console.log('[Claude] Processing completed');
                    this._isProcessing = false;
                    completedSuccessfully = true;
                    break;
                }
            }

            // Session ID is preserved regardless of completion status
            // This allows resuming after interrupts
            if (completedSuccessfully) {
                console.log(`[Claude] Query completed successfully, session ID preserved: ${this.sessionId}`);
            }
        } catch (e) {
            console.error('[Claude] Error during processing:', JSON.stringify(e, null, 2));
            throw e;
        } finally {
            // CRITICAL: Always reset processing flag to prevent getting stuck
            // This ensures that even if an error occurs or processing is aborted,
            // the agent won't be stuck in "working" state forever
            this._isProcessing = false;

            // Clear the query reference
            this.currentQuery = null;

            // Resolve the processing complete promise so any waiting processMessage can proceed
            if (this.resolveProcessingComplete) {
                this.resolveProcessingComplete();
                this.resolveProcessingComplete = null;
            }
        }
    }

    /**
     * Abort current Claude processing using SDK's interrupt() for immediate stop
     */
    abortProcessing(): void {
        console.log('[Claude] Aborting current processing');
        this.clearStreamingMessage();

        if (this.currentQuery) {
            console.log('[Claude] Calling query.interrupt()');
            this.currentQuery.interrupt().catch((err: any) => {
                console.error('[Claude] Error during interrupt:', err);
            });
        }

        // Signal abort for the loop check in processMessage
        this.abortController.abort();
        this.abortController = new AbortController();
    }

    /**
     * Clear the streaming message state
     */
    private clearStreamingMessage(): void {
        this.streamingMessageUuid = null;
        this.streamingText = '';
        this.streamingTimestamp = null;
    }

    /**
     * Get unacknowledged messages and mark them as acknowledged.
     * Includes a streaming message (with isStreaming=true) if text is being generated.
     */
    async getMessages(): Promise<(SDKAssistantMessage | UserMessage)[]> {
        // Combine pastConversations with current messages
        const currentMessages = Array.from(this.messages.values());
        const allMessages = [...this.pastConversations, ...currentMessages];

        // @ts-ignore
        const result = allMessages.filter(m =>
            (m.type == 'user' || m.type == 'assistant')
            && (typeof m.message == "string" || "content" in m.message)
            && "timestamp" in m)
            // @ts-ignore
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        // Append the current streaming message if one exists with content
        if (this.streamingMessageUuid && this.streamingText.length > 0 && this.streamingTimestamp) {
            const streamingMsg = {
                type: 'assistant' as const,
                message: {
                    id: 'streaming',
                    type: 'message',
                    role: 'assistant',
                    model: '',
                    content: [{ type: 'text' as const, text: this.streamingText }],
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, output_tokens: 0, service_tier: "standard" as const }
                },
                parent_tool_use_id: null,
                uuid: this.streamingMessageUuid,
                timestamp: this.streamingTimestamp,
                isStreaming: true
            };
            result.push(streamingMsg as any);
        }

        return result;
    }

    /**
     * Reset conversation: move all current messages to pastConversations and clear messages
     * Starts a fresh SDK session with no context
     */
    resetConversation(): void {
        console.log('[Claude] Resetting conversation');
        this.clearStreamingMessage();

        // Move all current messages to pastConversations
        const currentMessages = Array.from(this.messages.values());
        this.pastConversations.push(...currentMessages);

        // Clear current messages and dedup tracking
        this.messages.clear();
        this.assistantMessageIdToUuid.clear();

        // Clear session ID - next message will start a fresh session
        const oldSessionId = this.sessionId;
        this.sessionId = null;

        console.log(`[Claude] Conversation reset - ${currentMessages.length} messages moved to past conversations, total past: ${this.pastConversations.length}, cleared session: ${oldSessionId}`);
    }

    async isProcessing(): Promise<boolean> {
        return this._isProcessing;
    }

    /**
     * Export conversation state for fork/resume operations.
     * Returns the state that needs to be preserved across machine transfers.
     * Does NOT include runtime state like _isProcessing or abortController.
     */
    exportState(): {
        messages: Array<{ uuid: string; data: SDKMessage }>;
        pastConversations: SDKMessage[];
        initialInstructions: string;
        sessionId: string | null;
    } {
        console.log('[Claude] Exporting conversation state');
        const messagesArray = Array.from(this.messages.entries()).map(([uuid, data]) => ({
            uuid: uuid as string,
            data
        }));
        console.log(`[Claude] Exported ${messagesArray.length} messages, ${this.pastConversations.length} past conversations, sessionId: ${this.sessionId}`);
        return {
            messages: messagesArray,
            pastConversations: this.pastConversations,
            initialInstructions: this.initialInstructions,
            sessionId: this.sessionId
        };
    }

    /**
     * Restore conversation state after fork/resume operations.
     * Called after /start to restore the conversation context from a source agent.
     */
    restoreState(state: {
        messages: Array<{ uuid: string; data: SDKMessage }>;
        pastConversations: SDKMessage[];
        initialInstructions: string;
        sessionId?: string | null;
    }): void {
        console.log('[Claude] Restoring conversation state');

        // Helper to convert timestamp strings back to Date objects
        // JSON serialization turns Date objects into ISO strings
        const fixTimestamp = (msg: SDKMessage): SDKMessage => {
            if ('timestamp' in msg && msg.timestamp) {
                const ts = msg.timestamp;
                // If timestamp is a string (from JSON), convert back to Date
                if (typeof ts === 'string') {
                    (msg as any).timestamp = new Date(ts);
                } else if (typeof ts === 'number') {
                    (msg as any).timestamp = new Date(ts);
                }
                // If already a Date, leave it alone
            }
            return msg;
        };

        // Restore messages map with timestamp fix
        this.messages.clear();
        this.assistantMessageIdToUuid.clear();
        for (const { uuid, data } of state.messages) {
            this.messages.set(uuid as UUID, fixTimestamp(data));
            // Rebuild dedup tracking for restored assistant messages
            if (data.type === 'assistant') {
                const apiId = (data as SDKAssistantMessage).message?.id;
                if (apiId) {
                    this.assistantMessageIdToUuid.set(apiId, uuid as UUID);
                }
            }
        }

        // Restore other fields with timestamp fix
        this.pastConversations = state.pastConversations.map(fixTimestamp);
        this.initialInstructions = state.initialInstructions;

        // Restore session ID for conversation continuity
        // This allows the SDK to resume the exact session after fork/resume
        this.sessionId = state.sessionId ?? null;

        console.log(`[Claude] Restored ${this.messages.size} messages, ${this.pastConversations.length} past conversations, sessionId: ${this.sessionId}`);
        console.log(`[Claude] Initial instructions length: ${this.initialInstructions.length}`);
    }
}
