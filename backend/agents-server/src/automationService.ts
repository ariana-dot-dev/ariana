import { spawn } from 'child_process';
import { writeFile, mkdir, readdir, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { SDKMessage } from './claudeService';
import { enqueueAction, getActionFilesDir } from './automationActionQueue';

// Automation types (copied from backend shared types for agents-server independence)
export type AutomationTriggerType =
  | 'manual'
  | 'on_agent_ready'
  | 'on_before_commit'
  | 'on_after_commit'
  | 'on_after_edit_files'
  | 'on_after_read_files'
  | 'on_after_run_command'
  | 'on_before_push_pr'
  | 'on_after_push_pr'
  | 'on_after_reset'
  | 'on_automation_finishes';

export interface AutomationTrigger {
  type: AutomationTriggerType;
  fileGlob?: string;
  commandRegex?: string;
  automationId?: string;
}

export type AutomationScriptLanguage = 'bash' | 'javascript' | 'python';

export interface AutomationConfig {
  name: string;
  trigger: AutomationTrigger;
  scriptLanguage: AutomationScriptLanguage;
  scriptContent: string;
  blocking: boolean;
  feedOutput: boolean;
}

export interface AutomationWithId extends AutomationConfig {
  id: string;
}

export interface AutomationVariables {
  inputFilePath?: string;
  inputCommand?: string;
  currentCommitSha?: string;
  currentCommitChanges?: string;
  currentPendingChanges?: string;
  entireAgentDiff?: string;
  lastPrompt?: string;
  allLastPrompts?: string[];
  githubToken?: string;
  conversationTranscript?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  lastScriptOutput?: string;
}

export interface AutomationExecutionResult {
  output: string;
  isStartTruncated: boolean;
  exitCode: number | null;
  error?: string;
}

export class AutomationService {
  private automations: AutomationWithId[] = [];
  private runningAutomations = new Map<string, { process: any; output: string[] }>();
  private automationOutputs = new Map<string, string>(); // Store last output for on_automation_finishes
  private runningBlockingAutomations = new Set<string>(); // Track blocking automations for polling
  private killedProcessPids = new Set<number>(); // PIDs killed by killAutomation — their close events are suppressed

  constructor() {}

  // Blocking automation tracking (polled by backend via /claudeState)
  startBlockingAutomation(automationId: string): void {
    this.runningBlockingAutomations.add(automationId);
    console.log(`[AUTOMATION] Started blocking automation: ${automationId} (total blocking: ${this.runningBlockingAutomations.size})`);
  }

  finishBlockingAutomation(automationId: string): void {
    this.runningBlockingAutomations.delete(automationId);
    console.log(`[AUTOMATION] Finished blocking automation: ${automationId} (total blocking: ${this.runningBlockingAutomations.size})`);
  }

  hasBlockingAutomationRunning(): boolean {
    return this.runningBlockingAutomations.size > 0;
  }

  getRunningBlockingAutomationIds(): string[] {
    return Array.from(this.runningBlockingAutomations);
  }

  // Clear all blocking automations (used on interrupt to prevent stuck state)
  clearAllBlockingAutomations(): void {
    const count = this.runningBlockingAutomations.size;
    if (count > 0) {
      console.log(`[AUTOMATION] Clearing ${count} blocking automation(s) on interrupt`);
      this.runningBlockingAutomations.clear();
    }
  }

  // Kill a specific running automation by ID
  // Returns { killed, output, isStartTruncated } so the caller can preserve logs
  killAutomation(automationId: string): { killed: boolean; output: string | null; isStartTruncated: boolean } {
    const running = this.runningAutomations.get(automationId);
    if (!running) {
      console.log(`[AUTOMATION] No running process found for automation: ${automationId}`);
      return { killed: false, output: null, isStartTruncated: false };
    }

    // Capture output before removing
    const output = running.output.join('\n');
    const isStartTruncated = running.output.length >= 1000;

    try {
      if (running.process && !running.process.killed) {
        // Record PID so the close event handler ignores this process
        if (running.process.pid) {
          this.killedProcessPids.add(running.process.pid);
        }
        running.process.kill('SIGTERM');
        console.log(`[AUTOMATION] Sent SIGTERM to process PID ${running.process.pid} for automation: ${automationId}`);
      }
    } catch (error) {
      console.error(`[AUTOMATION] Failed to kill process for ${automationId}:`, error);
      return { killed: false, output: null, isStartTruncated: false };
    }

    this.runningAutomations.delete(automationId);
    this.runningBlockingAutomations.delete(automationId);
    console.log(`[AUTOMATION] Killed automation: ${automationId}`);
    return { killed: true, output: output || null, isStartTruncated };
  }

  // Kill all running automation processes and clear tracking (used on interrupt)
  killAllRunningAutomations(): void {
    const processCount = this.runningAutomations.size;
    const blockingCount = this.runningBlockingAutomations.size;

    if (processCount === 0 && blockingCount === 0) {
      return;
    }

    console.log(`[AUTOMATION] Killing ${processCount} running automation process(es) on interrupt`);

    for (const [automationId, data] of this.runningAutomations.entries()) {
      try {
        if (data.process && !data.process.killed) {
          // Kill the process tree - SIGTERM for graceful, then SIGKILL if needed
          data.process.kill('SIGTERM');
          console.log(`[AUTOMATION] Sent SIGTERM to process for automation: ${automationId}`);
        }
      } catch (error) {
        console.error(`[AUTOMATION] Failed to kill process for ${automationId}:`, error);
      }
    }

    // Clear both maps
    this.runningAutomations.clear();
    this.runningBlockingAutomations.clear();

    console.log(`[AUTOMATION] Cleared all running automations and blocking state`);
  }

  // Load automations (called when agent starts)
  loadAutomations(automations: AutomationWithId[]) {
    this.automations = automations;
    console.log(`[AUTOMATION] Loaded ${automations.length} automation(s)`);
  }

  // Get all automations
  getAutomations(): AutomationWithId[] {
    return this.automations;
  }

  // Find automations by trigger type
  findByTrigger(triggerType: AutomationTriggerType): AutomationWithId[] {
    return this.automations.filter(a => a.trigger.type === triggerType);
  }

  // Check if a file path matches a glob pattern
  private matchesGlob(filePath: string, glob: string): boolean {
    // Simple glob matching - convert glob to regex
    const regexPattern = glob
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }

  // Check if a command matches a regex pattern
  private matchesCommandRegex(command: string, pattern: string): boolean {
    try {
      const regex = new RegExp(pattern);
      return regex.test(command);
    } catch (e) {
      console.error(`[AUTOMATION] Invalid regex pattern: ${pattern}`, e);
      return false;
    }
  }

  // Find automations that should run for a specific trigger and context
  findMatchingAutomations(
    triggerType: AutomationTriggerType,
    context?: {
      filePath?: string;
      command?: string;
      automationId?: string;
    }
  ): AutomationWithId[] {
    const candidates = this.findByTrigger(triggerType);

    if (!context) {
      return candidates;
    }

    return candidates.filter(automation => {
      const trigger = automation.trigger;

      // Check file glob for file-related triggers
      if (context.filePath && trigger.fileGlob) {
        return this.matchesGlob(context.filePath, trigger.fileGlob);
      }

      // Check command regex for command-related triggers
      if (context.command && trigger.commandRegex) {
        return this.matchesCommandRegex(context.command, trigger.commandRegex);
      }

      // Check automation ID for on_automation_finishes
      if (context.automationId && trigger.automationId) {
        return trigger.automationId === context.automationId;
      }

      // If no filter is specified, include the automation
      return !trigger.fileGlob && !trigger.commandRegex && !trigger.automationId;
    });
  }

  // Execute an automation script
  async executeAutomation(
    automation: AutomationWithId,
    variables: AutomationVariables,
    projectDir: string
  ): Promise<AutomationExecutionResult> {
    console.log(`[AUTOMATION] Executing automation: ${automation.name} (${automation.id})`);

    try {
      // Prepare script with variables injected
      const scriptPath = await this.prepareScript(automation, variables, projectDir);

      // Execute script
      return await this.runScript(automation, scriptPath, projectDir);
    } catch (error) {
      console.error(`[AUTOMATION] Execution failed for ${automation.name}:`, error);
      return {
        output: error instanceof Error ? error.message : String(error),
        isStartTruncated: false,
        exitCode: 1,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // Prepare script file with injected variables
  private async prepareScript(
    automation: AutomationWithId,
    variables: AutomationVariables,
    projectDir: string
  ): Promise<string> {
    const tmpDir = tmpdir();
    const scriptDir = join(tmpDir, 'ariana-automations');
    await mkdir(scriptDir, { recursive: true });

    // Ensure action directory exists
    const actionDir = getActionFilesDir();
    await mkdir(actionDir, { recursive: true });

    // Ensure variable files directory exists
    const varFilesDir = join(tmpDir, 'ariana-automations', 'vars');
    await mkdir(varFilesDir, { recursive: true });

    let scriptContent = '';
    let scriptExtension = '';
    let filesToWrite: { path: string; content: string }[] = [];

    if (automation.scriptLanguage === 'bash') {
      scriptExtension = '.sh';
      const result = this.generateBashScript(automation.scriptContent, variables, projectDir, automation);
      scriptContent = result.script;
      filesToWrite = result.filesToWrite;
    } else if (automation.scriptLanguage === 'javascript') {
      scriptExtension = '.js';
      scriptContent = this.generateJavaScriptScript(automation.scriptContent, variables, projectDir, automation);
    } else if (automation.scriptLanguage === 'python') {
      scriptExtension = '.py';
      scriptContent = this.generatePythonScript(automation.scriptContent, variables, projectDir, automation);
    }

    // Write large variable files BEFORE writing the script
    // This uses Node's writeFile which doesn't have ARG_MAX limits
    for (const { path, content } of filesToWrite) {
      await writeFile(path, content, { encoding: 'utf-8' });
    }

    const scriptPath = join(scriptDir, `automation-${automation.id}${scriptExtension}`);
    await writeFile(scriptPath, scriptContent, { mode: 0o755 });

    return scriptPath;
  }

  // Generate bash script with variables
  // Large variables are written to temp files to avoid ARG_MAX limits
  // Returns script content and files that need to be written separately
  private generateBashScript(
    userScript: string,
    variables: AutomationVariables,
    projectDir: string,
    automation: AutomationWithId
  ): { script: string; filesToWrite: { path: string; content: string }[] } {
    const varExports: string[] = [];
    const fileExports: string[] = [];
    const filesToWrite: { path: string; content: string }[] = [];
    const actionDir = getActionFilesDir();
    const varFilesDir = '/tmp/ariana-automations/vars';

    // Keep individual vars small to avoid "Argument list too long" (E2BIG) errors.
    // The Linux ARG_MAX limit applies to the total size of argv + envp passed to exec().
    // Even if each var is under the limit, many medium vars can exceed it in aggregate.
    // Use a low per-var threshold and also cap total inline size.
    const PER_VAR_INLINE_THRESHOLD = 4 * 1024; // 4KB per variable
    const TOTAL_INLINE_THRESHOLD = 16 * 1024; // 16KB total for all inline vars
    let totalInlineSize = 0;

    // Helper to add a variable - inline if small, file if large
    const addVar = (varName: string, content: string, isBase64Content = false) => {
      const escapedContent = this.escapeForBash(content);
      const exportLine = `export ${varName}="${escapedContent}"`;
      if (escapedContent.length < PER_VAR_INLINE_THRESHOLD && totalInlineSize + exportLine.length < TOTAL_INLINE_THRESHOLD) {
        varExports.push(exportLine);
        totalInlineSize += exportLine.length;
      } else {
        const filePath = `${varFilesDir}/${automation.id}-${varName}`;
        filesToWrite.push({ path: filePath, content });
        fileExports.push(`export ${varName}_FILE="${filePath}"`);
        // Load content as a shell variable (available via $VAR_NAME in the script)
        // but do NOT export it, so it won't be passed to child processes via envp.
        // This prevents E2BIG ("Argument list too long") when exec'ing bun/npm/etc.
        fileExports.push(`${varName}="$(cat "${filePath}" 2>/dev/null || echo '')"`);
        if (varName === 'CONVERSATION_TRANSCRIPT_BASE64') {
          fileExports.push(`CONVERSATION_TRANSCRIPT="$(cat "${filePath}" 2>/dev/null | base64 -d 2>/dev/null || echo '')"`);
        }
      }
    };

    if (variables.inputFilePath) varExports.push(`export INPUT_FILE_PATH="${variables.inputFilePath}"`);
    if (variables.inputCommand) varExports.push(`export INPUT_COMMAND="${variables.inputCommand}"`);
    if (variables.currentCommitSha) varExports.push(`export CURRENT_COMMIT_SHA="${variables.currentCommitSha}"`);
    if (variables.currentCommitChanges) addVar('CURRENT_COMMIT_CHANGES', variables.currentCommitChanges);
    if (variables.currentPendingChanges) addVar('CURRENT_PENDING_CHANGES', variables.currentPendingChanges);
    if (variables.entireAgentDiff) addVar('ENTIRE_AGENT_DIFF', variables.entireAgentDiff);
    if (variables.lastPrompt) addVar('LAST_PROMPT', variables.lastPrompt);
    if (variables.allLastPrompts) {
      const promptsConcat = variables.allLastPrompts.join('\n---\n');
      addVar('ALL_LAST_PROMPTS', promptsConcat);
    }
    if (variables.githubToken) varExports.push(`export GITHUB_TOKEN="${variables.githubToken}"`);
    if (variables.lastScriptOutput) addVar('LAST_SCRIPT_OUTPUT', variables.lastScriptOutput);
    if (variables.conversationTranscript) {
      const transcriptJson = JSON.stringify(variables.conversationTranscript);
      const transcriptBase64 = Buffer.from(transcriptJson).toString('base64');
      if (transcriptBase64.length < PER_VAR_INLINE_THRESHOLD && totalInlineSize + transcriptBase64.length + 200 < TOTAL_INLINE_THRESHOLD) {
        const line1 = `export CONVERSATION_TRANSCRIPT_BASE64="${transcriptBase64}"`;
        const line2 = `export CONVERSATION_TRANSCRIPT="$(echo -n "$CONVERSATION_TRANSCRIPT_BASE64" | base64 -d 2>/dev/null || echo '')"`;
        varExports.push(line1);
        varExports.push(line2);
        totalInlineSize += line1.length + line2.length;
      } else {
        // For transcript, write the base64 to file
        const filePath = `${varFilesDir}/${automation.id}-CONVERSATION_TRANSCRIPT_BASE64`;
        filesToWrite.push({ path: filePath, content: transcriptBase64 });
        fileExports.push(`export CONVERSATION_TRANSCRIPT_BASE64_FILE="${filePath}"`);
        // Shell-only vars (not exported) to avoid inflating child process env
        fileExports.push(`CONVERSATION_TRANSCRIPT_BASE64="$(cat "${filePath}" 2>/dev/null || echo '')"`);
        fileExports.push(`CONVERSATION_TRANSCRIPT="$(cat "${filePath}" 2>/dev/null | base64 -d 2>/dev/null || echo '')"`);
      }
    }

    // Combine inline exports and file-based exports
    const allExports = [...varExports, ...fileExports].join('\n');

    const script = `#!/bin/bash
# This script runs in a login shell (bash -l) which sources /etc/profile,
# ~/.bash_profile, ~/.bashrc etc. automatically - identical to SSH sessions.
cd "${projectDir}"

# Automation variables (inline and file-based)
${allExports}
export AUTOMATION_ID="${automation.id}"
export AUTOMATION_NAME="${this.escapeForBash(automation.name)}"
export ACTION_DIR="${actionDir}"

# Helper functions for automation actions
stopAgent() {
  mkdir -p "${actionDir}"
  local action_file="${actionDir}/stop-\${AUTOMATION_ID}-\$(date +%s%N).json"
  echo "{\\"type\\":\\"stop_agent\\",\\"automationId\\":\\"${automation.id}\\",\\"automationName\\":\\"${this.escapeForBash(automation.name)}\\"}" > "\$action_file"
  echo "[AUTOMATION] Stop agent action queued" >&2
}

queuePrompt() {
  local prompt_text="\$1"
  if [ -z "\$prompt_text" ]; then
    echo "[AUTOMATION] Error: queuePrompt requires a prompt text argument" >&2
    return 1
  fi
  mkdir -p "${actionDir}"
  local action_file="${actionDir}/prompt-\${AUTOMATION_ID}-\$(date +%s%N).json"
  local escaped_prompt=\$(echo "\$prompt_text" | sed 's/"/\\\\"/g' | sed 's/\\\\/\\\\\\\\/g')
  echo "{\\"type\\":\\"queue_prompt\\",\\"automationId\\":\\"${automation.id}\\",\\"automationName\\":\\"${this.escapeForBash(automation.name)}\\",\\"payload\\":{\\"promptText\\":\\"\$escaped_prompt\\"}}" > "\$action_file"
  echo "[AUTOMATION] Prompt queued: \$prompt_text" >&2
}

# User script
${userScript}
`;

    return { script, filesToWrite };
  }

  // Generate JavaScript script with variables
  private generateJavaScriptScript(userScript: string, variables: AutomationVariables, projectDir: string, automation: AutomationWithId): string {
    const actionDir = getActionFilesDir();
    return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

process.chdir("${projectDir}");

// Automation variables
const variables = ${JSON.stringify(variables, null, 2)};
const AUTOMATION_ID = "${automation.id}";
const AUTOMATION_NAME = "${automation.name.replace(/"/g, '\\"')}";
const ACTION_DIR = "${actionDir}";

// Helper functions for automation actions
function stopAgent() {
  fs.mkdirSync(ACTION_DIR, { recursive: true });
  const actionFile = path.join(ACTION_DIR, \`stop-\${AUTOMATION_ID}-\${Date.now()}.json\`);
  const action = {
    type: 'stop_agent',
    automationId: AUTOMATION_ID,
    automationName: AUTOMATION_NAME
  };
  fs.writeFileSync(actionFile, JSON.stringify(action));
  console.error('[AUTOMATION] Stop agent action queued');
}

function queuePrompt(promptText) {
  if (!promptText) {
    console.error('[AUTOMATION] Error: queuePrompt requires a prompt text argument');
    throw new Error('queuePrompt requires a prompt text argument');
  }
  fs.mkdirSync(ACTION_DIR, { recursive: true });
  const actionFile = path.join(ACTION_DIR, \`prompt-\${AUTOMATION_ID}-\${Date.now()}.json\`);
  const action = {
    type: 'queue_prompt',
    automationId: AUTOMATION_ID,
    automationName: AUTOMATION_NAME,
    payload: { promptText }
  };
  fs.writeFileSync(actionFile, JSON.stringify(action));
  console.error(\`[AUTOMATION] Prompt queued: \${promptText}\`);
}

// User script
${userScript}
`;
  }

  // Generate Python script with variables
  private generatePythonScript(userScript: string, variables: AutomationVariables, projectDir: string, automation: AutomationWithId): string {
    const actionDir = getActionFilesDir();
    return `#!/usr/bin/env python3
import os
import json
import sys
import time

os.chdir("${projectDir}")

# Automation variables
variables = ${JSON.stringify(variables, null, 2)}
AUTOMATION_ID = "${automation.id}"
AUTOMATION_NAME = "${automation.name.replace(/"/g, '\\"')}"
ACTION_DIR = "${actionDir}"

# Helper functions for automation actions
def stopAgent():
    os.makedirs(ACTION_DIR, exist_ok=True)
    action_file = os.path.join(ACTION_DIR, f"stop-{AUTOMATION_ID}-{int(time.time() * 1000000)}.json")
    action = {
        "type": "stop_agent",
        "automationId": AUTOMATION_ID,
        "automationName": AUTOMATION_NAME
    }
    with open(action_file, 'w') as f:
        json.dump(action, f)
    print('[AUTOMATION] Stop agent action queued', file=sys.stderr)

def queuePrompt(prompt_text):
    if not prompt_text:
        print('[AUTOMATION] Error: queuePrompt requires a prompt text argument', file=sys.stderr)
        raise ValueError('queuePrompt requires a prompt text argument')
    os.makedirs(ACTION_DIR, exist_ok=True)
    action_file = os.path.join(ACTION_DIR, f"prompt-{AUTOMATION_ID}-{int(time.time() * 1000000)}.json")
    action = {
        "type": "queue_prompt",
        "automationId": AUTOMATION_ID,
        "automationName": AUTOMATION_NAME,
        "payload": {"promptText": prompt_text}
    }
    with open(action_file, 'w') as f:
        json.dump(action, f)
    print(f'[AUTOMATION] Prompt queued: {prompt_text}', file=sys.stderr)

# User script
${userScript}
`;
  }

  // Escape string for bash (for use inside double quotes)
  private escapeForBash(str: string): string {
    return str
      .replace(/\\/g, '\\\\')  // Escape backslashes first
      .replace(/"/g, '\\"')     // Escape double quotes
      .replace(/\$/g, '\\$')    // Escape dollar signs
      .replace(/`/g, '\\`')     // Escape backticks
      .replace(/\n/g, '\\n')    // Escape newlines
      .replace(/\r/g, '\\r');   // Escape carriage returns
  }

  // Run script and capture output
  private async runScript(
    automation: AutomationWithId,
    scriptPath: string,
    projectDir: string
  ): Promise<AutomationExecutionResult> {
    return new Promise((resolve) => {
      const outputLines: string[] = [];
      const maxLines = 1000;
      let isStartTruncated = false;

      // Run scripts in a login shell environment identical to SSH sessions
      // bash -l sources /etc/profile, ~/.bash_profile, ~/.bashrc etc. just like SSH
      const command = automation.scriptLanguage === 'bash' ? 'bash' :
                     automation.scriptLanguage === 'javascript' ? 'bash' :
                     'bash';

      // For bash scripts: run directly with login shell
      // For node/python: wrap in login shell to get proper environment, then exec the interpreter
      const args = automation.scriptLanguage === 'bash'
        ? ['-l', scriptPath]
        : ['-l', '-c', `${automation.scriptLanguage === 'javascript' ? 'node' : 'python3'} "${scriptPath}"`];

      const proc = spawn(command, args, {
        cwd: projectDir,
        env: {
          ...process.env,
          HOME: '/home/ariana',
          USER: 'ariana',
          LOGNAME: 'ariana',
          SHELL: '/bin/bash',
        }
      });

      this.runningAutomations.set(automation.id, { process: proc, output: outputLines });

      proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          outputLines.push(line);
          if (outputLines.length > maxLines) {
            outputLines.shift();
            isStartTruncated = true;
          }
        }
      });

      proc.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          outputLines.push(`[STDERR] ${line}`);
          if (outputLines.length > maxLines) {
            outputLines.shift();
            isStartTruncated = true;
          }
        }
      });

      proc.on('close', (code) => {
        // If this process was killed by killAutomation (relaunch), suppress the close event
        // so it doesn't report a spurious 'failed' status over the new run
        if (proc.pid && this.killedProcessPids.has(proc.pid)) {
          this.killedProcessPids.delete(proc.pid);
          console.log(`[AUTOMATION] Suppressing close event for killed process PID ${proc.pid} (automation: ${automation.id})`);
          // Resolve with a special marker so the caller knows not to report
          resolve({
            output: outputLines.join('\n'),
            isStartTruncated,
            exitCode: code,
            error: '__killed__'
          });
          return;
        }

        this.runningAutomations.delete(automation.id);
        const output = outputLines.join('\n');

        // Store output for on_automation_finishes triggers
        this.automationOutputs.set(automation.id, output);

        resolve({
          output,
          isStartTruncated,
          exitCode: code
        });
      });

      proc.on('error', (error) => {
        if (proc.pid && this.killedProcessPids.has(proc.pid)) {
          this.killedProcessPids.delete(proc.pid);
          resolve({
            output: error.message,
            isStartTruncated: false,
            exitCode: 1,
            error: '__killed__'
          });
          return;
        }
        this.runningAutomations.delete(automation.id);
        resolve({
          output: error.message,
          isStartTruncated: false,
          exitCode: 1,
          error: error.message
        });
      });
    });
  }

  // Get running automation output (for live updates)
  getRunningAutomationOutput(automationId: string): string | null {
    const running = this.runningAutomations.get(automationId);
    if (!running) return null;
    return running.output.join('\n');
  }

  // Get ALL running automations output (for polling endpoint)
  getAllRunningAutomationsOutput(): Record<string, { output: string; isStartTruncated: boolean }> {
    const result: Record<string, { output: string; isStartTruncated: boolean }> = {};
    for (const [automationId, data] of this.runningAutomations.entries()) {
      result[automationId] = {
        output: data.output.join('\n'),
        isStartTruncated: data.output.length >= 1000
      };
    }
    return result;
  }

  // Get last output for an automation (for on_automation_finishes)
  getLastOutput(automationId: string): string | null {
    return this.automationOutputs.get(automationId) || null;
  }

  // Poll action files and enqueue actions
  async pollActionFiles(): Promise<void> {
    const actionDir = getActionFilesDir();
    try {
      await mkdir(actionDir, { recursive: true });
      const files = await readdir(actionDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = join(actionDir, file);
        try {
          const content = await readFile(filePath, 'utf-8');
          const action = JSON.parse(content);

          // Validate action structure
          if (action.type && action.automationId && action.automationName) {
            enqueueAction({
              type: action.type,
              automationId: action.automationId,
              automationName: action.automationName,
              payload: action.payload
            });

            // Delete the file after processing
            await unlink(filePath);
          } else {
            console.warn(`[AUTOMATION] Invalid action file structure: ${file}`);
            await unlink(filePath);
          }
        } catch (error) {
          console.error(`[AUTOMATION] Failed to process action file ${file}:`, error);
          // Try to delete corrupted file
          try {
            await unlink(filePath);
          } catch {}
        }
      }
    } catch (error) {
      // Ignore errors if directory doesn't exist yet
      if ((error as any).code !== 'ENOENT') {
        console.error('[AUTOMATION] Failed to poll action files:', error);
      }
    }
  }

  // Build automation variables from current state
  buildVariables(
    context: {
      inputFilePath?: string;
      inputCommand?: string;
      currentCommitSha?: string;
      messages?: SDKMessage[];
      githubToken?: string;
    }
  ): AutomationVariables {
    const variables: AutomationVariables = {};

    if (context.inputFilePath) variables.inputFilePath = context.inputFilePath;
    if (context.inputCommand) variables.inputCommand = context.inputCommand;
    if (context.currentCommitSha) variables.currentCommitSha = context.currentCommitSha;
    if (context.githubToken) variables.githubToken = context.githubToken;

    // Extract prompts from messages
    if (context.messages && Array.isArray(context.messages)) {
      const prompts: string[] = [];
      const transcript: Array<{ role: 'user' | 'assistant'; content: string }> = [];

      for (const msg of context.messages) {
        if (msg.type === 'user' && typeof msg.message === 'string') {
          prompts.push(msg.message);
          transcript.push({ role: 'user', content: msg.message });
        } else if (msg.type === 'assistant' && 'message' in msg) {
          // Extract text content from assistant messages
          const content = msg.message?.content || [];
          const textContent = content
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('\n');

          if (textContent) {
            transcript.push({ role: 'assistant', content: textContent });
          }
        }
      }

      if (prompts.length > 0) {
        variables.lastPrompt = prompts[prompts.length - 1];
        variables.allLastPrompts = prompts;
      }

      if (transcript.length > 0) {
        variables.conversationTranscript = transcript;
      }
    }

    return variables;
  }
}

// Global automation service instance
export const automationService = new AutomationService();
