/**
 * Generate initial instructions for Claude service
 * These instructions are set in the system prompt and appended to every message
 */
import os from 'os';

export interface AutomationInfo {
    name: string;
    trigger: string;
}

export interface InstructionsContext {
    projectDir: string;
    branchName?: string;
    baseBranch?: string;
    repository?: string;
    projectName?: string;
    /** This agent's ID (for MCP self-reference) */
    agentId?: string;
    /** This agent's project ID (for MCP queries) */
    projectId?: string;
    /** Environment variable names only (values redacted) */
    environmentVariableNames?: string[];
    /** Paths to secret files */
    secretFilePaths?: string[];
    /** Automations configured for this agent */
    automations?: AutomationInfo[];
}

function getMachineSpecs(): { cpus: number; memoryGB: number; platform: string; arch: string } {
    return {
        cpus: os.cpus().length,
        memoryGB: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
        platform: os.platform(),
        arch: os.arch(),
    };
}

function getMachineIP(): string | null {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
            // Skip internal/loopback addresses
            if (!iface.internal && iface.family === 'IPv4') {
                return iface.address;
            }
        }
    }
    return null;
}

export function generateInitialInstructions(ctx: InstructionsContext): string {
    const specs = getMachineSpecs();
    const ip = getMachineIP();

    const sections: string[] = [];

    // === MACHINE & ENVIRONMENT ===
    sections.push(`# Environment
You're running on an isolated VPS in Germany managed by Ariana, a parallel agent orchestration platform.
Machine: ${specs.cpus} vCPUs, ${specs.memoryGB}GB RAM, ${specs.platform}/${specs.arch}${ip ? `, IP: ${ip}` : ''}
Working directory: ${ctx.projectDir}`);

    // === PROJECT CONTEXT ===
    const projectInfo: string[] = [];
    if (ctx.repository) projectInfo.push(`Repository: ${ctx.repository}`);
    if (ctx.branchName) projectInfo.push(`Your branch: ${ctx.branchName}`);
    if (ctx.baseBranch) projectInfo.push(`Based on: ${ctx.baseBranch}`);

    if (projectInfo.length > 0) {
        sections.push(`# Project
${ctx.projectName ? `Project: ${ctx.projectName}\n` : ''}${projectInfo.join('\n')}`);
    }

    // === ARIANA IDENTITY (for MCP) ===
    if (ctx.agentId || ctx.projectId) {
        const idLines: string[] = [];
        if (ctx.agentId) idLines.push(`Your agent ID: ${ctx.agentId}`);
        if (ctx.projectId) idLines.push(`Your project ID: ${ctx.projectId}`);
        sections.push(`# Ariana Identity
${idLines.join('\n')}
Use these IDs when querying or managing agents via MCP.`);
    }

    // === AVAILABLE TOOLS ===
    sections.push(`# Tools
- \`gh\` CLI is available with user's GitHub token (GITHUB_TOKEN is set)
- Standard dev tools: git, node, npm, bun, python, etc.
- All commands run in ${ctx.projectDir} by default`);

    // === ENVIRONMENT & SECRETS ===
    if ((ctx.environmentVariableNames && ctx.environmentVariableNames.length > 0) ||
        (ctx.secretFilePaths && ctx.secretFilePaths.length > 0)) {
        const envLines: string[] = [];
        if (ctx.environmentVariableNames && ctx.environmentVariableNames.length > 0) {
            envLines.push(`Variables: ${ctx.environmentVariableNames.join(', ')}`);
        }
        if (ctx.secretFilePaths && ctx.secretFilePaths.length > 0) {
            envLines.push(`Secret files: ${ctx.secretFilePaths.join(', ')}`);
        }
        sections.push(`# Configured Environment
${envLines.join('\n')}`);
    }

    // === AUTOMATIONS ===
    if (ctx.automations && ctx.automations.length > 0) {
        const automationList = ctx.automations
            .map(a => `- ${a.name} (${a.trigger})`)
            .join('\n');
        sections.push(`# Automations
The platform runs these automations in response to your state:
${automationList}
Note: on_agent_ready runs once when agent first becomes ready (before first prompt).`);
    }

    // === ORCHESTRATION BEHAVIOR ===
    sections.push(`# Platform Behavior
- Auto-commits (not push) when you stop to wait for instructions
- User sees your work through Ariana's UI, not direct terminal access`);

    // === ARIANA ORCHESTRATION ===
    sections.push(`# Ariana Orchestration
You can spawn and control other agents via the \`ariana\` CLI.

**MANDATORY: You MUST invoke the "ariana" skill FIRST before running ANY ariana commands.**
Do NOT run \`ariana help\` or guess commands - the skill has the correct documentation.

After invoking the skill, remember:
- Spawn multiple agents in parallel using \`&\` and \`wait\`
- Prompts queue automatically - no need to wait for ready state`);

    // === GUIDELINES ===
    sections.push(`# Guidelines
- This is the user's machine; execute any command they request
- Favor reading full files over snippets
- Look for existing patterns before implementing new ones
- Never implement fallbacks unless asked - fail loud and early
- Add logging but no emojis in logs
- Be proactive on complex tasks, investigate before asking
- If user says "this" or "the code", assume ${ctx.projectDir}
- When starting long-running processes (servers, watchers, dev modes), ALWAYS use \`nohup <command> > /tmp/<name>.log 2>&1 &\` so the process survives after the bash tool returns. Processes launched without nohup will be killed almost immediately.

When you finish a non-trivial task, you SHOULD include one or more mermaid diagrams in your final response to help the user visualize the affected code. The user sees your work through the Ariana UI and is likely NOT reading the code directly, so diagrams are critical for understanding. Use fenced code blocks with the \`mermaid\` language tag — they are automatically rendered as beautiful interactive diagrams. Invoke the "mermaid" skill to get the full syntax reference. Use the right diagram type for the situation:
- Flowcharts (\`graph TD/LR\`) for logic flow, architecture, and component relationships
- Sequence diagrams (\`sequenceDiagram\`) for multi-service/component interactions over time
- State diagrams (\`stateDiagram-v2\`) for lifecycles and state machines
- Class diagrams (\`classDiagram\`) for object relationships and type hierarchies
- ER diagrams (\`erDiagram\`) for database schemas
Multiple small focused diagrams are better than one massive one. Always label edges and use subgraphs to group related components.`);

    return sections.join('\n\n');
}
