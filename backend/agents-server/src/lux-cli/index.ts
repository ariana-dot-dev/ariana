#!/usr/bin/env bun
/**
 * LUX CLI - Computer-Use for Ariana Agents
 *
 * Enables agents to control the desktop using AI vision.
 * Communicates with the backend via internal API using JWT tokens.
 * Screenshots are taken locally, sent to backend for AI processing,
 * and actions are executed locally via xdotool.
 *
 * Usage:
 *   lux start <task>              Start a computer-use session
 *   lux step                      Execute one step (screenshot -> actions)
 *   lux run [--max-steps N]       Run until complete or limit
 *   lux end                       End the current session
 *   lux status                    Show usage and limits
 *
 * Environment:
 *   ARIANA_TOKEN - JWT token for backend API auth (required)
 *   ARIANA_BACKEND_URL - Backend URL (default: https://ariana.dev)
 *   DISPLAY - X11 display for screenshots (default: :0)
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const BACKEND_URL = process.env.ARIANA_BACKEND_URL || 'https://ariana.dev';
const DISPLAY = process.env.DISPLAY || ':0';

// Screen dimensions (detected at runtime)
let SCREEN_WIDTH = 1920;
let SCREEN_HEIGHT = 1080;

// LUX recommended screenshot dimensions
const LUX_WIDTH = 1260;
const LUX_HEIGHT = 700;

// API endpoints
const LUX_START_ENDPOINT = '/api/internal/agent/lux/session/start';
const LUX_STEP_ENDPOINT = '/api/internal/agent/lux/step';
const LUX_END_ENDPOINT = '/api/internal/agent/lux/session/end';
const LUX_STATUS_ENDPOINT = '/api/internal/agent/lux/status';

// Session state file
function getHomeDir(): string {
  return process.env.HOME || '/root';
}

function getSessionFile(): string {
  return `${getHomeDir()}/.ariana/lux-session`;
}

function getToken(): string {
  const token = process.env.ARIANA_TOKEN;
  if (!token) {
    console.error('Error: ARIANA_TOKEN environment variable is not set');
    process.exit(1);
  }
  return token;
}

async function apiRequest(endpoint: string, method: string, body?: unknown): Promise<unknown> {
  const token = getToken();
  const url = `${BACKEND_URL}${endpoint}`;

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok) {
    console.error(`API error (${response.status}):`, JSON.stringify(data, null, 2));
    process.exit(1);
  }

  return data;
}

/**
 * Save current session ID to disk
 */
function saveSession(sessionId: string): void {
  try {
    const file = getSessionFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, sessionId);
  } catch {
    // Silently ignore
  }
}

/**
 * Get current session ID from disk
 */
function getSession(): string | null {
  try {
    const file = getSessionFile();
    if (existsSync(file)) {
      return readFileSync(file, 'utf-8').trim();
    }
  } catch {
    // Silently ignore
  }
  return null;
}

/**
 * Clear session from disk
 */
function clearSession(): void {
  try {
    const file = getSessionFile();
    if (existsSync(file)) {
      writeFileSync(file, '');
    }
  } catch {
    // Silently ignore
  }
}

/**
 * Detect screen dimensions using xdpyinfo
 */
function detectScreenSize(): void {
  try {
    const output = execSync(`DISPLAY=${DISPLAY} xdpyinfo | grep dimensions`, { encoding: 'utf-8' });
    const match = output.match(/(\d+)x(\d+)/);
    if (match) {
      SCREEN_WIDTH = parseInt(match[1], 10);
      SCREEN_HEIGHT = parseInt(match[2], 10);
      console.log(`Screen size: ${SCREEN_WIDTH}x${SCREEN_HEIGHT}`);
    }
  } catch {
    console.log(`Using default screen size: ${SCREEN_WIDTH}x${SCREEN_HEIGHT}`);
  }
}

/**
 * Take a screenshot, resize to LUX dimensions (1260x700), convert to JPEG quality 85,
 * and return as base64.
 *
 * LUX performs best with 1260x700 JPEG input (from SDK defaults).
 */
function takeScreenshot(): string {
  const rawFile = '/tmp/lux-screenshot-raw.png';
  const jpegFile = '/tmp/lux-screenshot.jpg';

  try {
    // Capture full screen
    execSync(`DISPLAY=${DISPLAY} import -window root ${rawFile}`, { encoding: 'utf-8' });

    // Resize to LUX dimensions and convert to JPEG quality 85
    execSync(`convert ${rawFile} -resize ${LUX_WIDTH}x${LUX_HEIGHT}! -quality 85 ${jpegFile}`, { encoding: 'utf-8' });

    // Read and encode as base64
    const buffer = readFileSync(jpegFile);
    return buffer.toString('base64');
  } catch (error) {
    console.error('Failed to take screenshot:', error);
    process.exit(1);
  }
}

/**
 * Scale coordinates from LUX (0-1000) to screen pixels
 */
function scaleCoords(coordStr: string): { x: number; y: number } {
  const parts = coordStr.split(',').map(s => parseInt(s.trim(), 10));
  const luxX = parts[0] || 0;
  const luxY = parts[1] || 0;

  // LUX uses 0-1000 normalized coordinates
  const x = Math.min(Math.round((luxX / 1000) * SCREEN_WIDTH), SCREEN_WIDTH - 1);
  const y = Math.min(Math.round((luxY / 1000) * SCREEN_HEIGHT), SCREEN_HEIGHT - 1);

  return { x, y };
}

/**
 * Execute a single LUX action using xdotool
 */
function executeAction(action: { type: string; argument: string; count: number }): void {
  const { type, argument, count } = action;
  const repeatCount = count || 1;

  console.log(`  Action: ${type}(${argument}) x${repeatCount}`);

  try {
    for (let i = 0; i < repeatCount; i++) {
      switch (type) {
        case 'click': {
          const { x, y } = scaleCoords(argument);
          execSync(`DISPLAY=${DISPLAY} xdotool mousemove ${x} ${y} click 1`);
          break;
        }

        case 'left_double': {
          const { x, y } = scaleCoords(argument);
          execSync(`DISPLAY=${DISPLAY} xdotool mousemove ${x} ${y} click --repeat 2 --delay 100 1`);
          break;
        }

        case 'left_triple': {
          const { x, y } = scaleCoords(argument);
          execSync(`DISPLAY=${DISPLAY} xdotool mousemove ${x} ${y} click --repeat 3 --delay 100 1`);
          break;
        }

        case 'right_single': {
          const { x, y } = scaleCoords(argument);
          execSync(`DISPLAY=${DISPLAY} xdotool mousemove ${x} ${y} click 3`);
          break;
        }

        case 'drag': {
          // Argument format: "startX, startY, endX, endY"
          const coords = argument.split(',').map(s => parseInt(s.trim(), 10));
          const startX = Math.min(Math.round((coords[0] / 1000) * SCREEN_WIDTH), SCREEN_WIDTH - 1);
          const startY = Math.min(Math.round((coords[1] / 1000) * SCREEN_HEIGHT), SCREEN_HEIGHT - 1);
          const endX = Math.min(Math.round((coords[2] / 1000) * SCREEN_WIDTH), SCREEN_WIDTH - 1);
          const endY = Math.min(Math.round((coords[3] / 1000) * SCREEN_HEIGHT), SCREEN_HEIGHT - 1);
          execSync(`DISPLAY=${DISPLAY} xdotool mousemove ${startX} ${startY} mousedown 1 mousemove ${endX} ${endY} mouseup 1`);
          break;
        }

        case 'type': {
          // Escape special characters for xdotool
          const text = argument.replace(/'/g, "'\\''");
          execSync(`DISPLAY=${DISPLAY} xdotool type -- '${text}'`);
          break;
        }

        case 'hotkey': {
          // Convert LUX hotkey format to xdotool format
          const key = argument.toLowerCase();
          execSync(`DISPLAY=${DISPLAY} xdotool key ${key}`);
          break;
        }

        case 'scroll': {
          // Argument format: "x, y, direction" — count is in action.count
          const parts = argument.split(',').map(s => s.trim());
          const { x, y } = scaleCoords(`${parts[0]}, ${parts[1]}`);
          const direction = parts[2]?.toLowerCase() || 'down';

          // Move mouse to position first, then scroll
          execSync(`DISPLAY=${DISPLAY} xdotool mousemove ${x} ${y}`);
          if (direction === 'up') {
            execSync(`DISPLAY=${DISPLAY} xdotool click 4`);
          } else {
            execSync(`DISPLAY=${DISPLAY} xdotool click 5`);
          }
          break;
        }

        case 'wait': {
          Bun.sleepSync(1000);
          break;
        }

        case 'finish': {
          console.log('  Task marked as complete by AI');
          break;
        }

        case 'fail': {
          console.log('  Task marked as infeasible by AI');
          break;
        }

        case 'call_user': {
          console.log(`  AI requests human intervention: ${argument}`);
          break;
        }

        default:
          console.log(`  Unknown action type: ${type}`);
      }

      // Small delay between repeated actions
      if (i < repeatCount - 1) {
        Bun.sleepSync(100);
      }
    }
  } catch (error) {
    console.error(`  Failed to execute action ${type}:`, error);
  }
}

/**
 * Execute all actions from a step
 */
function executeActions(actions: Array<{ type: string; argument: string; count: number }>): void {
  if (!actions || actions.length === 0) {
    console.log('No actions to execute');
    return;
  }

  console.log(`Executing ${actions.length} action(s)...`);
  for (const action of actions) {
    executeAction(action);
    // Brief pause between actions
    Bun.sleepSync(200);
  }
}

function parseArgs(args: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

function usage() {
  console.log(`LUX CLI - Computer-Use for Ariana Agents

Control the desktop using AI vision. Screenshots are taken locally,
sent to backend for AI processing, and actions are executed locally.

Commands:
  lux start <task>              Start a session with a goal
  lux step                      Execute one step (screenshot -> AI -> actions)
  lux run [--max-steps N]       Run steps until complete (default: model-based)
  lux end                       End the current session
  lux status                    Show usage and limits

Options for start:
  --model <model>               Model: auto (default), lux-actor-1, lux-thinker-1
  --max-steps <N>               Override max steps (actor=20, thinker=100)

Model selection (auto mode):
  Actor:   Fast (~1s/step), for clear direct tasks like "click X", "open Y"
  Thinker: Thorough, for complex/vague goals like "research X and compare Y"

Examples:
  lux start "Open Firefox and go to github.com"
  lux start "Research competitors and compile a summary" --model lux-thinker-1
  lux run --max-steps 10
  lux end

The AI will analyze screenshots and return actions like:
  - click(x, y): Click at normalized coordinates (0-1000)
  - left_double(x, y): Double-click
  - type(text): Type text on keyboard
  - hotkey(key, c): Press key combo (e.g., ctrl+c)
  - scroll(x, y, direction, c): Scroll up/down at position
  - drag(x1, y1, x2, y2): Drag from one point to another
  - finish(): Task is complete
  - fail(): Task is infeasible
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    usage();
    process.exit(0);
  }

  // Detect screen size on startup
  detectScreenSize();

  const command = args[0];
  const rest = args.slice(1);
  const { flags, positional } = parseArgs(rest);

  try {
    switch (command) {
      case 'start': {
        const task = positional.join(' ');
        if (!task) {
          console.error('Error: task description required');
          console.error('Usage: lux start <task>');
          process.exit(1);
        }

        // Default to 'auto' — backend picks Actor vs Thinker based on task complexity
        const model = (flags.model as string) || 'auto';
        const maxSteps = flags['max-steps'] ? parseInt(flags['max-steps'] as string, 10) : undefined;

        console.log(`Starting LUX session...`);
        console.log(`Task: ${task}`);

        const result = await apiRequest(LUX_START_ENDPOINT, 'POST', {
          task,
          model,
          maxSteps,
        }) as { sessionId: string; maxSteps: number; model: string };

        saveSession(result.sessionId);
        console.log(`Model: ${result.model} (${model === 'auto' ? 'auto-selected' : 'manual'})`);
        console.log(`Session started: ${result.sessionId}`);
        console.log(`Max steps: ${result.maxSteps}`);
        break;
      }

      case 'step': {
        const sessionId = getSession();
        if (!sessionId) {
          console.error('Error: no active session');
          console.error('Start a session first: lux start <task>');
          process.exit(1);
        }

        console.log('Taking screenshot...');
        const screenshot = takeScreenshot();
        console.log(`Screenshot size: ${Math.round(screenshot.length / 1024)}KB (1260x700 JPEG)`);

        console.log('Sending to LUX AI...');
        const result = await apiRequest(LUX_STEP_ENDPOINT, 'POST', {
          sessionId,
          screenshot,
        }) as {
          sessionId: string;
          actions: Array<{ type: string; argument: string; count: number }>;
          stop: boolean;
          reason: string;
          usage: { stepsUsed: number; stepsRemaining: number };
        };

        console.log(`\nAI reasoning: ${result.reason}`);
        console.log(`Steps: ${result.usage.stepsUsed}/${result.usage.stepsUsed + result.usage.stepsRemaining}`);

        if (result.stop) {
          console.log('\nTask completed!');
          clearSession();
        } else {
          executeActions(result.actions);
        }
        break;
      }

      case 'run': {
        const sessionId = getSession();
        if (!sessionId) {
          console.error('Error: no active session');
          console.error('Start a session first: lux start <task>');
          process.exit(1);
        }

        const maxSteps = flags['max-steps'] ? parseInt(flags['max-steps'] as string, 10) : 20;
        console.log(`Running up to ${maxSteps} steps...`);

        for (let step = 1; step <= maxSteps; step++) {
          console.log(`\n--- Step ${step}/${maxSteps} ---`);

          // Brief pause to let UI settle after previous action
          if (step > 1) {
            Bun.sleepSync(1000);
          } else {
            Bun.sleepSync(500);
          }

          console.log('Taking screenshot...');
          const screenshot = takeScreenshot();

          console.log('Sending to LUX AI...');
          const result = await apiRequest(LUX_STEP_ENDPOINT, 'POST', {
            sessionId,
            screenshot,
          }) as {
            sessionId: string;
            actions: Array<{ type: string; argument: string; count: number }>;
            stop: boolean;
            reason: string;
            usage: { stepsUsed: number; stepsRemaining: number };
          };

          console.log(`AI reasoning: ${result.reason}`);

          if (result.stop) {
            console.log('\nTask completed!');
            clearSession();
            break;
          }

          executeActions(result.actions);

          // Check if we're out of steps
          if (result.usage.stepsRemaining === 0) {
            console.log('\nStep limit reached');
            break;
          }
        }
        break;
      }

      case 'end': {
        const sessionId = getSession();
        if (!sessionId) {
          console.log('No active session');
          process.exit(0);
        }

        console.log('Ending session...');
        await apiRequest(LUX_END_ENDPOINT, 'POST', { sessionId });
        clearSession();
        console.log('Session ended');
        break;
      }

      case 'status': {
        const result = await apiRequest(LUX_STATUS_ENDPOINT, 'GET', undefined) as {
          configured: boolean;
          today: { sessions: number; steps: number };
          limits: { sessionsPerDay: number; stepsPerSession: number };
        };

        console.log('LUX Computer-Use Status');
        console.log('=======================');
        console.log(`Configured: ${result.configured ? 'Yes' : 'No'}`);
        console.log(`\nToday's usage:`);
        console.log(`  Sessions: ${result.today.sessions}/${result.limits.sessionsPerDay}`);
        console.log(`  Total steps: ${result.today.steps}`);
        console.log(`\nLimits:`);
        console.log(`  Sessions per day: ${result.limits.sessionsPerDay}`);
        console.log(`  Steps per session: ${result.limits.stepsPerSession}`);

        const sessionId = getSession();
        if (sessionId) {
          console.log(`\nActive session: ${sessionId}`);
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        usage();
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
