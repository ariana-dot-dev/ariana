/**
 * LUX Computer-Use Service
 *
 * Provides secure access to the LUX vision AI API for computer-use capabilities.
 * API key is stored on backend - agents call this service via authenticated endpoints.
 * All usage is tracked per-step in the DB (LuxUsageRecord table).
 *
 * Flow:
 * 1. Agent takes screenshot on their machine (resized to 1260x700 JPEG)
 * 2. Agent sends screenshot + task to backend via JWT-authenticated API
 * 3. Backend uploads screenshot to LUX S3, calls LUX API with secret key
 * 4. Backend parses action text response, returns structured actions to agent
 * 5. Agent executes actions locally (xdotool, etc.)
 *
 * LUX API docs: https://api.agiopen.org/docs
 * Response format: <|think_start|>...<|think_end|>\n<|action_start|>...<|action_end|>
 */

import { getLogger } from '@/utils/logger';
import type { LuxUsageRepository } from '@/data/repositories/luxUsage.repository';
import type { AgentRepository } from '@/data/repositories/agent.repository';

const logger = getLogger(['lux']);

// LUX API configuration
const LUX_API_URL = process.env.LUX_API_URL || 'https://api.agiopen.org';
const LUX_API_KEY = process.env.LUX_API_KEY || '';

// Rate limiting defaults
const DEFAULT_MAX_STEPS_PER_SESSION = 50;
const DEFAULT_MAX_SESSIONS_PER_DAY = 20;
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * The system prompt template that LUX expects.
 * This tells the model how to format its output (think/action markers)
 * and lists all available action types with their coordinate system.
 */
const LUX_PROMPT_TEMPLATE = `You are a Desktop Agent completing computer use tasks from a user instruction.

Every step, you will look at the screenshot and output the desired actions in a format as:

<|think_start|> brief description of your intent and reasoning <|think_end|>
<|action_start|> one of the allowed actions as below <|action_end|>

In the action field, you have the following action formats:
1. click(x, y) # left-click at the position (x, y), where x and y are integers normalized between 0 and 1000
2. left_double(x, y) # left-double-click at the position (x, y), where x and y are integers normalized between 0 and 1000
3. left_triple(x, y) # left-triple-click at the position (x, y), where x and y are integers normalized between 0 and 1000
4. right_single(x, y) # right-click at the position (x, y), where x and y are integers normalized between 0 and 1000
5. drag(x1, y1, x2, y2) # drag the mouse from (x1, y1) to (x2, y2) to select or move contents, where x1, y1, x2, y2 are integers normalized between 0 and 1000
6. hotkey(key, c) # press the key for c times
7. type(text) # type a text string on the keyboard
8. scroll(x, y, direction, c) # scroll the mouse at position (x, y) in the direction of up or down for c times, where x and y are integers normalized between 0 and 1000
9. wait() # wait for a while
10. finish() # indicate the task is finished
11. fail() # indicate the task is infeasible

Directly output the text beginning with <|think_start|>, no additional text is needed for this scenario.

The user instruction is:
`;

/**
 * LUX action types
 */
export type LuxActionType =
  | 'click'
  | 'left_double'
  | 'left_triple'
  | 'right_single'
  | 'drag'
  | 'type'
  | 'hotkey'
  | 'scroll'
  | 'wait'
  | 'finish'
  | 'fail'
  | 'call_user';

/**
 * A single action returned by LUX
 */
export interface LuxAction {
  type: LuxActionType;
  argument: string;
  count: number;
}

/**
 * LUX API step response (parsed from LUX response content)
 */
export interface LuxStep {
  actions: LuxAction[];
  stop: boolean;
  reason: string;
}

/**
 * Active session state (in-memory only — conversation history for multi-turn).
 * Usage tracking is in the DB, this is just for the LUX API conversation context.
 */
export interface LuxSession {
  id: string;
  agentId: string;
  userId: string;
  projectId: string;
  task: string;
  model: 'lux-actor-1' | 'lux-thinker-1';
  maxSteps: number;
  lastActivityAt: Date;
  taskId: string | null; // LUX API task_id for session continuity
  messages: Array<{
    role: 'user' | 'assistant';
    content: any;
  }>;
  completed: boolean;
}

export interface StartSessionRequest {
  task: string;
  model?: 'lux-actor-1' | 'lux-thinker-1' | 'auto';
  maxSteps?: number;
}

/**
 * Classify a task to pick the best LUX model.
 *
 * Actor (lux-actor-1): ~1s/step, max 100 steps, best for direct/clear tasks.
 *   e.g. "click the settings icon", "open Chrome", "type hello"
 *
 * Thinker (lux-thinker-1): slower but more reasoning, max 300 steps, best for
 *   complex/vague/multi-step goals.
 *   e.g. "research competitors and compile a report", "set up a dev environment",
 *        "find and fix the layout bug"
 *
 * Heuristic: tasks with multiple clauses, vague language, or long descriptions
 * get Thinker; short direct instructions get Actor.
 */
function classifyTaskModel(task: string): 'lux-actor-1' | 'lux-thinker-1' {
  const lower = task.toLowerCase();
  const wordCount = task.split(/\s+/).length;

  // Complexity signals → Thinker
  const complexPatterns = [
    /\band\b.*\band\b/,             // multiple "and" → multi-part task
    /\bthen\b/,                      // sequential steps
    /\bfind\b.*\b(and|then)\b/,     // find + do something
    /\bresearch\b/,
    /\bcompare\b/,
    /\banalyze\b/,
    /\binvestigate\b/,
    /\bset\s*up\b/,
    /\bconfigure\b/,
    /\binstall\b.*\band\b/,
    /\bfill\s*(out|in)\b.*\bform\b/,
    /\bnavigate\b.*\bthrough\b/,
    /\bmultiple\b/,
    /\bseveral\b/,
    /\beach\b/,
    /\ball\s+the\b/,
    /\bstep\s*by\s*step\b/,
    /\bcomplex\b/,
    /\bcareful(ly)?\b/,
  ];

  for (const pattern of complexPatterns) {
    if (pattern.test(lower)) {
      return 'lux-thinker-1';
    }
  }

  // Long tasks (>20 words) → likely complex
  if (wordCount > 20) {
    return 'lux-thinker-1';
  }

  // Default: Actor for fast execution
  return 'lux-actor-1';
}

export interface StepRequest {
  sessionId: string;
  screenshot: string; // base64 JPEG (resized to 1260x700 by CLI)
}

export interface StepResponse {
  sessionId: string;
  actions: LuxAction[];
  stop: boolean;
  reason: string;
  usage: {
    stepsUsed: number;
    stepsRemaining: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// In-memory session map (conversation context only — usage is in DB)
const sessions = new Map<string, LuxSession>();

function generateSessionId(): string {
  return `lux_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function generateRecordId(): string {
  return `luxr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Cleanup interval is set up per-instance in LuxService constructor

/**
 * Get start of today (UTC midnight)
 */
function todayStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Build a data URL from a base64-encoded JPEG screenshot.
 * The CLI sends screenshots already resized to 1260x700 JPEG quality 85.
 */
function screenshotToDataUrl(base64Screenshot: string): string {
  return `data:image/jpeg;base64,${base64Screenshot}`;
}

/**
 * Parse LUX response text into structured actions.
 *
 * LUX returns text in the format:
 *   <|think_start|> reasoning text <|think_end|>
 *   <|action_start|> action1(args) & action2(args) <|action_end|>
 *
 * Actions can be separated by & for multiple actions in one step.
 */
function parseLuxResponse(content: string): LuxStep {
  // Extract reasoning from think markers
  let reason = '';
  const thinkMatch = content.match(/<\|think_start\|>([\s\S]*?)<\|think_end\|>/);
  if (thinkMatch) {
    reason = thinkMatch[1].trim();
  }

  // Extract actions from action markers
  let actionText = '';
  const actionMatch = content.match(/<\|action_start\|>([\s\S]*?)<\|action_end\|>/);
  if (actionMatch) {
    actionText = actionMatch[1].trim();
  }

  // If no markers found, treat the whole content as the reason
  if (!thinkMatch && !actionMatch) {
    return { actions: [], stop: true, reason: content.trim() };
  }

  // Parse individual actions (separated by &)
  const actions: LuxAction[] = [];
  let stop = false;

  const actionParts = actionText.split('&').map(s => s.trim()).filter(Boolean);

  for (const part of actionParts) {
    const parsed = parseSingleAction(part);
    if (parsed) {
      actions.push(parsed);
      if (parsed.type === 'finish' || parsed.type === 'fail') {
        stop = true;
      }
    }
  }

  return { actions, stop, reason };
}

/**
 * Parse a single action string like "click(500, 300)" into a LuxAction.
 */
function parseSingleAction(actionStr: string): LuxAction | null {
  // Match pattern: actionName(args)
  const match = actionStr.match(/^(\w+)\(([^)]*)\)$/);
  if (!match) {
    logger.warn`Failed to parse LUX action: ${actionStr}`;
    return null;
  }

  const actionName = match[1];
  const argsStr = match[2].trim();

  switch (actionName) {
    case 'click':
    case 'left_double':
    case 'left_triple':
    case 'right_single':
      return { type: actionName as LuxActionType, argument: argsStr, count: 1 };

    case 'drag':
      return { type: 'drag', argument: argsStr, count: 1 };

    case 'type':
      return { type: 'type', argument: argsStr, count: 1 };

    case 'hotkey': {
      // hotkey(key, c) — extract count from last arg
      const parts = argsStr.split(',').map(s => s.trim());
      const count = parts.length > 1 ? parseInt(parts[parts.length - 1], 10) || 1 : 1;
      const key = parts.length > 1 ? parts.slice(0, -1).join('+') : parts[0];
      return { type: 'hotkey', argument: key, count };
    }

    case 'scroll': {
      // scroll(x, y, direction, c) — extract coordinates, direction, and count
      const parts = argsStr.split(',').map(s => s.trim());
      // parts: [x, y, direction, count]
      const count = parts.length >= 4 ? parseInt(parts[3], 10) || 1 : 1;
      // Pass the full args for the CLI to parse (x, y, direction)
      const scrollArg = parts.slice(0, 3).join(', ');
      return { type: 'scroll', argument: scrollArg, count };
    }

    case 'wait':
      return { type: 'wait', argument: '', count: 1 };

    case 'finish':
      return { type: 'finish', argument: '', count: 1 };

    case 'fail':
      return { type: 'fail', argument: '', count: 1 };

    case 'call_user':
      return { type: 'call_user', argument: argsStr, count: 1 };

    default:
      logger.warn`Unknown LUX action type: ${actionName}`;
      return null;
  }
}

export class LuxService {
  constructor(
    private luxUsageRepo: LuxUsageRepository,
    private agentRepo: AgentRepository,
  ) {
    // Periodic cleanup of expired sessions
    setInterval(() => this.cleanupExpiredSessions(), 5 * 60 * 1000);
  }

  /**
   * Clean up expired sessions from memory and clear agent LUX fields
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of sessions) {
      if (now - session.lastActivityAt.getTime() > DEFAULT_SESSION_TIMEOUT_MS) {
        logger.info`Cleaning up expired session sessionId=${sessionId}`;
        const agentId = session.agentId;
        sessions.delete(sessionId);
        // Clear agent fields (fire-and-forget)
        this.agentRepo.updateAgentFields(agentId, {
          luxActiveTask: null,
          luxActiveSessionId: null,
        }).catch(err => {
          logger.error`Failed to clear agent LUX fields on cleanup: ${err}`;
        });
      }
    }
  }

  isConfigured(): boolean {
    return !!LUX_API_KEY;
  }

  /**
   * Start a new computer-use session
   */
  async startSession(
    agentId: string,
    userId: string,
    projectId: string,
    request: StartSessionRequest
  ): Promise<{ sessionId: string; maxSteps: number; model: string } | { error: string }> {
    if (!this.isConfigured()) {
      return { error: 'LUX API not configured' };
    }

    // Check daily session limit from DB
    const sessionCount = await this.luxUsageRepo.getUserSessionCountSince(userId, todayStart());
    if (sessionCount >= DEFAULT_MAX_SESSIONS_PER_DAY) {
      return { error: `Daily session limit reached (${DEFAULT_MAX_SESSIONS_PER_DAY} sessions/day)` };
    }

    const sessionId = generateSessionId();
    const selectedModel = (!request.model || request.model === 'auto')
      ? classifyTaskModel(request.task)
      : request.model;

    // Default max steps depends on model: Actor=20 (fast), Thinker=100 (thorough)
    const defaultMaxSteps = selectedModel === 'lux-thinker-1' ? 100 : 20;
    const maxSteps = request.maxSteps || defaultMaxSteps;

    const session: LuxSession = {
      id: sessionId,
      agentId,
      userId,
      projectId,
      task: request.task,
      model: selectedModel,
      maxSteps,
      lastActivityAt: new Date(),
      taskId: null,
      messages: [],
      completed: false,
    };

    sessions.set(sessionId, session);

    // Mark agent as having active LUX session (emits agent:updated via WebSocket)
    try {
      await this.agentRepo.updateAgentFields(agentId, {
        luxActiveTask: request.task,
        luxActiveSessionId: sessionId,
      });
    } catch (err) {
      logger.error`Failed to update agent LUX fields on start: ${err}`;
    }

    logger.info`Started LUX session sessionId=${sessionId} agentId=${agentId} model=${selectedModel} task=${request.task.substring(0, 50)}`;

    return { sessionId, maxSteps, model: selectedModel };
  }

  /**
   * Execute one step: send screenshot to LUX, get actions back, record usage in DB
   */
  async step(
    agentId: string,
    userId: string,
    request: StepRequest
  ): Promise<StepResponse | { error: string }> {
    if (!this.isConfigured()) {
      return { error: 'LUX API not configured' };
    }

    const session = sessions.get(request.sessionId);
    if (!session) {
      return { error: 'Session not found or expired' };
    }

    if (session.agentId !== agentId || session.userId !== userId) {
      return { error: 'Session does not belong to this agent' };
    }

    if (session.completed) {
      return { error: 'Session is already completed' };
    }

    // Check step limit from DB
    const stepCount = await this.luxUsageRepo.getSessionStepCount(session.id);
    if (stepCount >= session.maxSteps) {
      return { error: `Step limit reached (${session.maxSteps} steps)` };
    }

    try {
      // Build user message with the system prompt template + screenshot data URL
      const promptText = LUX_PROMPT_TEMPLATE + session.task;
      const userContent = [
        { type: 'text', text: promptText },
        {
          type: 'image_url',
          image_url: { url: screenshotToDataUrl(request.screenshot) },
        },
      ];

      session.messages.push({ role: 'user', content: userContent });

      // Build request body
      const requestBody: Record<string, unknown> = {
        model: session.model,
        messages: session.messages,
        temperature: 0.5,
      };

      // Include task_id for session continuity (returned by LUX in first response)
      if (session.taskId) {
        requestBody.task_id = session.taskId;
      }

      // Call LUX API
      const response = await fetch(`${LUX_API_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': LUX_API_KEY,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error`LUX API error status=${response.status} error=${errorText}`;
        return { error: `LUX API error (${response.status}): ${errorText}` };
      }

      const data = await response.json() as any;

      // Store task_id for session continuity
      if (data.task_id && !session.taskId) {
        session.taskId = data.task_id;
      }

      const choice = data.choices?.[0];
      if (!choice) {
        return { error: 'Invalid LUX API response: no choices' };
      }

      const content = choice.message?.content;
      if (!content) {
        return { error: 'Invalid LUX API response: no content' };
      }

      // Parse the text response with think/action markers
      const step = parseLuxResponse(typeof content === 'string' ? content : JSON.stringify(content));

      // Extract token usage from API response
      const apiUsage = data.usage || {};
      const promptTokens = apiUsage.prompt_tokens || 0;
      const completionTokens = apiUsage.completion_tokens || 0;
      const totalTokens = apiUsage.total_tokens || 0;

      // Add assistant response to conversation history
      session.messages.push({ role: 'assistant', content });

      session.lastActivityAt = new Date();
      if (step.stop) {
        session.completed = true;
      }

      // Record usage in DB
      const newStepCount = stepCount + 1;
      try {
        await this.luxUsageRepo.create({
          id: generateRecordId(),
          userId: session.userId,
          agentId: session.agentId,
          projectId: session.projectId,
          sessionId: session.id,
          model: session.model,
          task: session.task,
          promptTokens,
          completionTokens,
          totalTokens,
          actionsReturned: step.actions?.length || 0,
          stopped: step.stop,
          reason: step.reason || undefined,
        });
      } catch (dbError) {
        // Log but don't fail the step — usage recording is non-critical
        logger.error`Failed to record LUX usage in DB: ${dbError}`;
      }

      logger.info`LUX step completed sessionId=${session.id} step=${newStepCount} actions=${step.actions?.length || 0} tokens=${totalTokens} stop=${step.stop}`;

      return {
        sessionId: session.id,
        actions: step.actions || [],
        stop: step.stop,
        reason: step.reason || '',
        usage: {
          stepsUsed: newStepCount,
          stepsRemaining: session.maxSteps - newStepCount,
          promptTokens,
          completionTokens,
          totalTokens,
        },
      };
    } catch (error) {
      logger.error`LUX step error sessionId=${session.id} error=${error}`;
      return { error: `LUX step failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  /**
   * End a session early
   */
  async endSession(
    agentId: string,
    userId: string,
    sessionId: string
  ): Promise<{ success: boolean } | { error: string }> {
    const session = sessions.get(sessionId);
    if (!session) {
      return { error: 'Session not found' };
    }

    if (session.agentId !== agentId || session.userId !== userId) {
      return { error: 'Session does not belong to this agent' };
    }

    sessions.delete(sessionId);

    // Clear agent LUX fields (emits agent:updated via WebSocket)
    try {
      await this.agentRepo.updateAgentFields(agentId, {
        luxActiveTask: null,
        luxActiveSessionId: null,
      });
    } catch (err) {
      logger.error`Failed to clear agent LUX fields on end: ${err}`;
    }

    logger.info`Ended LUX session sessionId=${sessionId}`;

    return { success: true };
  }

  /**
   * Get usage stats for a user (from DB)
   */
  async getUsageStats(userId: string): Promise<{
    today: { sessions: number; steps: number; promptTokens: number; completionTokens: number; totalTokens: number };
    limits: { sessionsPerDay: number; stepsPerSession: number };
  }> {
    const stats = await this.luxUsageRepo.getUserUsageSince(userId, todayStart());
    return {
      today: stats,
      limits: {
        sessionsPerDay: DEFAULT_MAX_SESSIONS_PER_DAY,
        stepsPerSession: DEFAULT_MAX_STEPS_PER_SESSION,
      },
    };
  }

  /**
   * Delete all usage records for an agent
   */
  async deleteAgentUsage(agentId: string): Promise<void> {
    await this.luxUsageRepo.deleteByAgentId(agentId);
  }
}
