#!/usr/bin/env bun
/**
 * Ariana CLI
 *
 * Human-friendly CLI for agents to query and manage other agents.
 * Communicates with the backend via internal API using JWT tokens.
 *
 * Usage:
 *   ariana agents list [--project <id>]
 *   ariana agents get <agent-id> [--json]
 *   ariana agent spawn --project <id> --branch <branch> [--name <name>]
 *   ariana agent fork <source-id> [--name <name>]
 *   ariana agent wait <id> [--timeout <ms>]
 *   ariana agent prompt <id> <message> [--model opus|sonnet|haiku]
 *   ariana agent interrupt <id>
 *   ariana agent rename <id> <name>
 *   ariana agent conversation <id> [--limit <n>]
 *   ariana projects list
 *   ariana env get
 *   ariana env set < config.json
 *
 * Environment:
 *   ARIANA_TOKEN - JWT token for backend API auth (required)
 *   ARIANA_BACKEND_URL - Backend URL (default: https://ariana.dev)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const BACKEND_URL = process.env.ARIANA_BACKEND_URL || 'https://ariana.dev';
const QUERY_ENDPOINT = '/api/internal/agent/query';
const ACTION_ENDPOINT = '/api/internal/agent/action';

// Get home directory (works on both Hetzner and custom machines)
function getHomeDir(): string {
    return process.env.HOME || '/root';
}

// File to store the last used agent ID (per-machine)
function getLastAgentFile(): string {
    return `${getHomeDir()}/.ariana/last-agent`;
}

function getToken(): string {
    const token = process.env.ARIANA_TOKEN;
    if (!token) {
        console.error('Error: ARIANA_TOKEN environment variable is not set');
        process.exit(1);
    }
    return token;
}

async function apiRequest(endpoint: string, body: unknown): Promise<unknown> {
    const token = getToken();
    const url = `${BACKEND_URL}${endpoint}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });

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

async function query(body: unknown): Promise<unknown> {
    return apiRequest(QUERY_ENDPOINT, body);
}

async function action(actionName: string, params: unknown): Promise<unknown> {
    return apiRequest(ACTION_ENDPOINT, { action: actionName, params });
}

/**
 * Save the last used agent ID to disk (for auto-selection when ID is omitted)
 */
function saveLastAgent(agentId: string): void {
    try {
        const file = getLastAgentFile();
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, agentId);
    } catch {
        // Silently ignore - not critical
    }
}

/**
 * Get the last used agent ID from disk, or null if not available
 */
function getLastAgent(): string | null {
    try {
        const file = getLastAgentFile();
        if (existsSync(file)) {
            return readFileSync(file, 'utf-8').trim();
        }
    } catch {
        // Silently ignore
    }
    return null;
}

/**
 * Resolve agent ID: use provided ID, or fall back to last used, or query for most recent
 */
async function resolveAgentId(providedId: string | undefined, command: string): Promise<string> {
    if (providedId) {
        saveLastAgent(providedId);
        return providedId;
    }

    // Try last used agent
    const lastAgent = getLastAgent();
    if (lastAgent) {
        console.log(`Using last used agent: ${lastAgent}`);
        return lastAgent;
    }

    // Query for most recently created agent
    const result = await query({
        entity: 'agent',
        select: ['id', 'name', 'state'],
        orderBy: 'createdAt',
        orderDirection: 'desc',
        limit: 1,
    }) as { data?: Array<{ id: string; name?: string; state: string }> };

    if (result.data && result.data.length > 0) {
        const agent = result.data[0];
        console.log(`Using most recent agent: ${agent.id}${agent.name ? ` (${agent.name})` : ''} [${agent.state}]`);
        saveLastAgent(agent.id);
        return agent.id;
    }

    console.error(`Error: No agent ID provided and no agents found`);
    console.error(`Usage: ariana ${command} <agent-id> ...`);
    process.exit(1);
}

function printResult(data: unknown, asJson: boolean = false) {
    if (asJson) {
        console.log(JSON.stringify(data, null, 2));
    } else {
        // Pretty print for humans
        console.log(JSON.stringify(data, null, 2));
    }
}

function usage() {
    console.log(`Ariana CLI - Agent orchestration and self-management

For full documentation, invoke the "ariana" skill first.

Quick reference:
  ariana projects list                        List accessible projects
  ariana agents list                          List agents
  ariana agent spawn --project <id> --branch <branch> --name <name>
  ariana agent prompt <id> "task"             Send a prompt (queues automatically)
  ariana env get                              Get environment config
  ariana automations list                     List automations

IMPORTANT:
  - Spawn returns immediately - prompts queue automatically
  - When spawning multiple agents, use & for parallel: cmd1 & cmd2 & wait
`);
}

function parseArgs(args: string[]): { flags: Record<string, string | boolean>, positional: string[] } {
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

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
        usage();
        process.exit(0);
    }

    const command = args[0];
    const subcommand = args[1];
    const rest = args.slice(2);
    const { flags, positional } = parseArgs(rest);

    try {
        switch (command) {
            case 'agents': {
                switch (subcommand) {
                    case 'list': {
                        const filters: any[] = [];
                        if (flags.project) {
                            filters.push({ field: 'projectId', operator: 'equals', value: flags.project });
                        }
                        const result = await query({
                            entity: 'agent',
                            filters: filters.length > 0 ? filters : undefined,
                            select: ['id', 'name', 'state', 'branchName', 'taskSummary', 'createdAt'],
                            limit: 50,
                        });
                        printResult(result, !!flags.json);
                        break;
                    }
                    case 'get': {
                        const agentId = await resolveAgentId(positional[0], 'agents get');
                        const result = await query({
                            entity: 'agent',
                            filters: [{ field: 'id', operator: 'equals', value: agentId }],
                        });
                        printResult(result, !!flags.json);
                        break;
                    }
                    default:
                        console.error(`Unknown subcommand: agents ${subcommand}`);
                        console.error('Available: list, get');
                        process.exit(1);
                }
                break;
            }

            case 'agent': {
                switch (subcommand) {
                    case 'spawn': {
                        const projectId = flags.project as string;
                        const baseBranch = flags.branch as string;
                        const name = flags.name as string | undefined;

                        if (!projectId || !baseBranch) {
                            console.error('Error: --project and --branch are required');
                            console.error('Usage: ariana agent spawn --project <id> --branch <branch> [--name <name>]');
                            process.exit(1);
                        }

                        const result = await action('spawnAgent', { projectId, baseBranch, name });
                        printResult(result);
                        break;
                    }
                    case 'fork': {
                        const sourceAgentId = await resolveAgentId(positional[0], 'agent fork');
                        const name = flags.name as string | undefined;

                        const result = await action('forkAgent', { sourceAgentId, name });
                        // Save the NEW agent as last used (from result)
                        if ((result as any)?.agentId) {
                            saveLastAgent((result as any).agentId);
                        }
                        printResult(result);
                        break;
                    }
                    case 'wait': {
                        const agentId = await resolveAgentId(positional[0], 'agent wait');
                        const timeoutMs = flags.timeout ? parseInt(flags.timeout as string, 10) : undefined;

                        const result = await action('waitForAgentReady', { agentId, timeoutMs });
                        printResult(result);
                        break;
                    }
                    case 'prompt': {
                        // For prompt, first positional could be agent ID or start of message
                        // If it looks like an agent ID (contains underscore or is long hex), treat as ID
                        const firstArg = positional[0];
                        let agentId: string;
                        let prompt: string;

                        const looksLikeId = firstArg && (firstArg.includes('_') || /^[a-f0-9-]{20,}$/i.test(firstArg));

                        if (looksLikeId) {
                            agentId = await resolveAgentId(firstArg, 'agent prompt');
                            prompt = positional.slice(1).join(' ');
                        } else {
                            // No ID provided, use all positional args as prompt
                            agentId = await resolveAgentId(undefined, 'agent prompt');
                            prompt = positional.join(' ');
                        }

                        const model = flags.model as string | undefined;
                        const shouldInterrupt = !!flags.interrupt;

                        if (!prompt) {
                            console.error('Error: prompt message required');
                            console.error('Usage: ariana agent prompt [<agent-id>] <message> [--model opus|sonnet|haiku] [--interrupt]');
                            process.exit(1);
                        }

                        // If --interrupt flag, interrupt first then send prompt
                        if (shouldInterrupt) {
                            console.log('Interrupting agent before sending prompt...');
                            await action('interruptAgent', { agentId });
                        }

                        const result = await action('sendPrompt', { agentId, prompt, model });
                        printResult(result);
                        break;
                    }
                    case 'interrupt': {
                        const agentId = await resolveAgentId(positional[0], 'agent interrupt');
                        const result = await action('interruptAgent', { agentId });
                        printResult(result);
                        break;
                    }
                    case 'rename': {
                        // First arg could be agent ID or name (if using last agent)
                        const firstArg = positional[0];
                        const looksLikeId = firstArg && (firstArg.includes('_') || /^[a-f0-9-]{20,}$/i.test(firstArg));

                        let agentId: string;
                        let name: string;

                        if (looksLikeId && positional.length > 1) {
                            agentId = await resolveAgentId(firstArg, 'agent rename');
                            name = positional.slice(1).join(' ');
                        } else {
                            // No ID provided, use all as name
                            agentId = await resolveAgentId(undefined, 'agent rename');
                            name = positional.join(' ');
                        }

                        if (!name) {
                            console.error('Error: new name required');
                            console.error('Usage: ariana agent rename [<agent-id>] <name>');
                            process.exit(1);
                        }

                        const result = await action('renameAgent', { agentId, name });
                        printResult(result);
                        break;
                    }
                    case 'conversation': {
                        const agentId = await resolveAgentId(positional[0], 'agent conversation');
                        const limit = flags.limit ? parseInt(flags.limit as string, 10) : undefined;

                        const result = await action('getAgentConversation', { agentId, limit });
                        printResult(result);
                        break;
                    }
                    default:
                        console.error(`Unknown subcommand: agent ${subcommand}`);
                        console.error('Available: spawn, fork, wait, prompt, interrupt, rename, conversation');
                        process.exit(1);
                }
                break;
            }

            case 'projects': {
                switch (subcommand) {
                    case 'list': {
                        const result = await query({
                            entity: 'project',
                            select: ['id', 'name', 'createdAt'],
                            limit: 50,
                        });
                        printResult(result, !!flags.json);
                        break;
                    }
                    default:
                        console.error(`Unknown subcommand: projects ${subcommand || '(none)'}`);
                        console.error('Available: list');
                        process.exit(1);
                }
                break;
            }

            case 'env': {
                switch (subcommand) {
                    case 'get': {
                        const result = await action('getMyEnvironment', {});
                        printResult(result);
                        break;
                    }
                    case 'set': {
                        // Read JSON from stdin
                        const chunks: Buffer[] = [];
                        for await (const chunk of process.stdin) {
                            chunks.push(chunk);
                        }
                        const input = Buffer.concat(chunks).toString('utf-8').trim();

                        if (!input) {
                            console.error('Error: no JSON provided on stdin');
                            console.error('Usage: ariana env set < config.json');
                            process.exit(1);
                        }

                        let environment: unknown;
                        try {
                            environment = JSON.parse(input);
                        } catch (e) {
                            console.error('Error: invalid JSON on stdin');
                            process.exit(1);
                        }

                        const result = await action('setMyEnvironment', { environment });
                        printResult(result);
                        break;
                    }
                    default:
                        console.error(`Unknown subcommand: env ${subcommand || '(none)'}`);
                        console.error('Available: get, set');
                        process.exit(1);
                }
                break;
            }

            case 'automations': {
                switch (subcommand) {
                    case 'list': {
                        const result = await action('listAutomations', {});
                        printResult(result, !!flags.json);
                        break;
                    }
                    case 'get': {
                        const automationId = positional[0];
                        if (!automationId) {
                            console.error('Error: automation ID required');
                            console.error('Usage: ariana automations get <automation-id>');
                            process.exit(1);
                        }
                        const result = await action('getAutomation', { automationId });
                        printResult(result, !!flags.json);
                        break;
                    }
                    case 'create': {
                        // Read JSON from stdin
                        const chunks: Buffer[] = [];
                        for await (const chunk of process.stdin) {
                            chunks.push(chunk);
                        }
                        const input = Buffer.concat(chunks).toString('utf-8').trim();

                        if (!input) {
                            console.error('Error: no JSON provided on stdin');
                            console.error('Usage: ariana automations create < automation.json');
                            process.exit(1);
                        }

                        let automation: unknown;
                        try {
                            automation = JSON.parse(input);
                        } catch (e) {
                            console.error('Error: invalid JSON on stdin');
                            process.exit(1);
                        }

                        const result = await action('createAutomation', { automation });
                        printResult(result);
                        break;
                    }
                    case 'update': {
                        const automationId = positional[0];
                        if (!automationId) {
                            console.error('Error: automation ID required');
                            console.error('Usage: ariana automations update <automation-id> < automation.json');
                            process.exit(1);
                        }

                        // Read JSON from stdin
                        const chunks: Buffer[] = [];
                        for await (const chunk of process.stdin) {
                            chunks.push(chunk);
                        }
                        const input = Buffer.concat(chunks).toString('utf-8').trim();

                        if (!input) {
                            console.error('Error: no JSON provided on stdin');
                            console.error('Usage: ariana automations update <automation-id> < automation.json');
                            process.exit(1);
                        }

                        let automation: unknown;
                        try {
                            automation = JSON.parse(input);
                        } catch (e) {
                            console.error('Error: invalid JSON on stdin');
                            process.exit(1);
                        }

                        const result = await action('updateAutomation', { automationId, automation });
                        printResult(result);
                        break;
                    }
                    case 'delete': {
                        const automationId = positional[0];
                        if (!automationId) {
                            console.error('Error: automation ID required');
                            console.error('Usage: ariana automations delete <automation-id>');
                            process.exit(1);
                        }
                        const result = await action('deleteAutomation', { automationId });
                        printResult(result);
                        break;
                    }
                    default:
                        console.error(`Unknown subcommand: automations ${subcommand || '(none)'}`);
                        console.error('Available: list, get, create, update, delete');
                        process.exit(1);
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
