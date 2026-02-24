import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { automationService } from '../automationService';
import type { AutomationVariables, AutomationTriggerType } from '../automationService';
import { globalState } from '../agentsState';
import { processPromptWithGenerationTracking } from '../promptProcessor';

const app = new Hono();

interface AutomationPayload {
  id: string;
  name: string;
  trigger: { type: AutomationTriggerType; fileGlob?: string; commandRegex?: string; automationId?: string };
  scriptLanguage: 'bash' | 'javascript' | 'python';
  scriptContent: string;
  blocking: boolean;
  feedOutput: boolean;
}

interface ExecuteAutomationsRequest {
  automationIds: string[];
  automations?: AutomationPayload[];
  triggerType: AutomationTriggerType;
  context?: {
    filePath?: string;
    command?: string;
    automationId?: string;
  };
  additionalVariables?: Partial<AutomationVariables>;
}

// Store events directly in the pending events queue
// This is accessed via the poll-automation-events endpoint
interface AutomationEvent {
  automationId: string;
  automationName: string;
  trigger: string;
  output: string | null;
  isStartTruncated: boolean;
  status: 'running' | 'finished' | 'failed';
  exitCode: number | null;
  blocking: boolean;
  feedOutput: boolean;
}

// Import the pending events array directly
import { addPendingAutomationEvent } from '../automationEventReporter';

// Report an automation event
async function reportEvent(event: AutomationEvent) {
  console.log(`[EXECUTE-AUTOMATION] Reporting event: ${event.automationName} - ${event.status} (blocking: ${event.blocking})`);
  try {
    addPendingAutomationEvent(event);
    console.log(`[EXECUTE-AUTOMATION] Event reported successfully`);
  } catch (error) {
    console.error('[EXECUTE-AUTOMATION] Failed to report event:', error);
  }
}

/**
 * Endpoint to execute specific automations by ID
 * Called by the backend when it determines automations should run
 * This is the main entry point for backend-controlled automation execution
 */
app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<ExecuteAutomationsRequest>(body);

    if (!valid || !data) {
        console.log('Invalid data in ' + c.req.path, "\nerror: ", error);
        return c.json({ error }, 400);
    }

    const { automationIds, automations: providedAutomations, triggerType, context, additionalVariables } = data;

    if (!automationIds || !Array.isArray(automationIds) || automationIds.length === 0) {
        return c.json({ error: 'Missing or empty automationIds array' }, 400);
    }

    if (!triggerType) {
        return c.json({ error: 'Missing triggerType' }, 400);
    }

    try {
        const projectDir = globalState.projectDir;
        if (!projectDir) {
            return c.json({ error: 'No project directory set' }, 400);
        }

        console.log(`[EXECUTE-AUTOMATION] Received request to execute ${automationIds.length} automation(s) for trigger: ${triggerType}`);
        console.log(`[EXECUTE-AUTOMATION] Automation IDs: ${automationIds.join(', ')}`);

        // If fresh automation configs were provided by the backend, use them
        // and update the in-memory cache so subsequent lookups are also fresh
        if (providedAutomations && Array.isArray(providedAutomations) && providedAutomations.length > 0) {
            const currentAutomations = globalState.automations || [];
            for (const provided of providedAutomations) {
                const existingIndex = currentAutomations.findIndex(a => a.id === provided.id);
                if (existingIndex >= 0) {
                    currentAutomations[existingIndex] = provided;
                } else {
                    currentAutomations.push(provided);
                }
            }
            globalState.automations = [...currentAutomations];
            automationService.loadAutomations(globalState.automations);
            console.log(`[EXECUTE-AUTOMATION] Updated ${providedAutomations.length} automation(s) from backend payload`);
        }

        // Find the automations by ID from the (now up-to-date) cache
        const allAutomations = automationService.getAutomations();
        const automationsToExecute = automationIds
            .map(id => allAutomations.find(a => a.id === id))
            .filter((a): a is NonNullable<typeof a> => a !== undefined);

        if (automationsToExecute.length === 0) {
            console.warn(`[EXECUTE-AUTOMATION] No matching automations found for IDs: ${automationIds.join(', ')}`);
            const response = {
                success: true,
                message: 'No matching automations found',
                executedCount: 0
            };
            const encryptedResponse = encryption.encrypt(response);
            return c.json({ encrypted: encryptedResponse });
        }

        console.log(`[EXECUTE-AUTOMATION] Found ${automationsToExecute.length} automation(s) to execute`);
        automationsToExecute.forEach(a => {
            console.log(`[EXECUTE-AUTOMATION] - ${a.name} (${a.id}) - blocking: ${a.blocking}, feedOutput: ${a.feedOutput}`);
        });

        // Check if any are blocking - if so, interrupt the agent
        const hasBlocking = automationsToExecute.some(a => a.blocking);
        if (hasBlocking && globalState.claudeService) {
            console.log(`[EXECUTE-AUTOMATION] Blocking automation(s) requested - interrupting agent`);
            globalState.claudeService.abortProcessing();
        }

        // Execute all automations concurrently (fire and forget)
        for (const automation of automationsToExecute) {
            try {
                // Build variables
                const messages = globalState.claudeService ? await globalState.claudeService.getMessages() : undefined;
                const variables: AutomationVariables = {
                    ...automationService.buildVariables({
                        inputFilePath: context?.filePath,
                        inputCommand: context?.command,
                        githubToken: globalState.githubToken,
                        messages: messages,
                    }),
                    ...additionalVariables,
                };

                // If this is on_automation_finishes, add lastScriptOutput
                if (triggerType === 'on_automation_finishes' && context?.automationId) {
                    variables.lastScriptOutput = automationService.getLastOutput(context.automationId) || undefined;
                }

                // Serialize trigger data
                const triggerData = JSON.stringify({
                    type: triggerType,
                    context,
                    timestamp: Date.now(),
                });

                // Kill any previous run of this automation before starting a new one
                // This prevents the old process from reporting a spurious 'failed' event
                const previousRun = automationService.killAutomation(automation.id);
                if (previousRun.killed) {
                    console.log(`[EXECUTE-AUTOMATION] Killed previous run of "${automation.name}" before relaunching`);
                }

                // Track blocking automation start (polled by backend via /claudeState)
                if (automation.blocking) {
                    automationService.startBlockingAutomation(automation.id);
                }

                // Report automation starting
                await reportEvent({
                    automationId: automation.id,
                    automationName: automation.name,
                    trigger: triggerData,
                    output: null,
                    isStartTruncated: false,
                    status: 'running',
                    exitCode: null,
                    blocking: automation.blocking,
                    feedOutput: automation.feedOutput,
                });

                // Execute automation in background (fire and forget)
                automationService.executeAutomation(automation, variables, projectDir).then(async (result) => {
                    // If this process was killed (by a relaunch), skip all reporting
                    if (result.error === '__killed__') {
                        console.log(`[EXECUTE-AUTOMATION] Skipping report for killed automation "${automation.name}"`);
                        return;
                    }

                    // Report automation finished/failed
                    const finalStatus: 'finished' | 'failed' = result.exitCode === 0 ? 'finished' : 'failed';
                    await reportEvent({
                        automationId: automation.id,
                        automationName: automation.name,
                        trigger: triggerData,
                        output: result.output,
                        isStartTruncated: result.isStartTruncated,
                        status: finalStatus,
                        exitCode: result.exitCode,
                        blocking: automation.blocking,
                        feedOutput: automation.feedOutput,
                    });

                    // If feedOutput is enabled, send output directly to Claude
                    // Feed output for both success AND failure (user wants to see automation results)
                    if (automation.feedOutput && result.output && globalState.claudeService) {
                        const statusLabel = finalStatus === 'finished' ? 'succeeded' : 'failed';
                        const contextPrompt = `<system-hide-in-chat>\nAutomation "${automation.name}" ${statusLabel} (exit code ${result.exitCode}):\n\n${result.output}\n</system-hide-in-chat>`;

                        // Interrupt agent if currently processing, then feed output
                        // Use unified prompt processor with generation tracking to prevent race conditions
                        globalState.claudeService.abortProcessing();
                        console.log(`[EXECUTE-AUTOMATION] Feeding output from "${automation.name}" to agent (${statusLabel})`);
                        const feedResult = await processPromptWithGenerationTracking(
                            contextPrompt,
                            'sonnet',
                            'automation-feed'
                        );
                        if (!feedResult.success) {
                            console.error(`[EXECUTE-AUTOMATION] Failed to feed output to agent:`, feedResult.error);
                        }
                    } else if (automation.feedOutput) {
                        // Log why we're not feeding
                        if (!result.output) {
                            console.log(`[EXECUTE-AUTOMATION] Not feeding output from "${automation.name}" - no output produced`);
                        } else if (!globalState.claudeService) {
                            console.log(`[EXECUTE-AUTOMATION] Not feeding output from "${automation.name}" - no Claude service available`);
                        }
                    }

                    // Track blocking automation finish AFTER feedOutput processing completes
                    // This prevents the backend from seeing the agent as ready while Claude is still processing
                    if (automation.blocking) {
                        automationService.finishBlockingAutomation(automation.id);
                    }

                    // Note: on_automation_finishes is triggered by backend, not here
                }).catch(async (error) => {
                    console.error(`[EXECUTE-AUTOMATION] Automation "${automation.name}" failed:`, error);

                    // Track blocking automation finish even on error
                    if (automation.blocking) {
                        automationService.finishBlockingAutomation(automation.id);
                    }

                    await reportEvent({
                        automationId: automation.id,
                        automationName: automation.name,
                        trigger: triggerData,
                        output: error instanceof Error ? error.message : String(error),
                        isStartTruncated: false,
                        status: 'failed',
                        exitCode: 1,
                        blocking: automation.blocking,
                        feedOutput: automation.feedOutput,
                    });
                });

            } catch (error) {
                console.error(`[EXECUTE-AUTOMATION] Error starting automation ${automation.name}:`, error);

                // Track blocking automation finish on setup error
                if (automation.blocking) {
                    automationService.finishBlockingAutomation(automation.id);
                }

                await reportEvent({
                    automationId: automation.id,
                    automationName: automation.name,
                    trigger: JSON.stringify({
                        type: triggerType,
                        context,
                        timestamp: Date.now(),
                    }),
                    output: error instanceof Error ? error.message : String(error),
                    isStartTruncated: false,
                    status: 'failed',
                    exitCode: 1,
                    blocking: automation.blocking,
                    feedOutput: automation.feedOutput,
                });
            }
        }

        const response = {
            success: true,
            message: `Triggered ${automationsToExecute.length} automation(s)`,
            executedCount: automationsToExecute.length,
            automationIds: automationsToExecute.map(a => a.id)
        };

        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    } catch (error) {
        console.error('[EXECUTE-AUTOMATION] Failed to execute automations:', error);
        const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
        const encryptedResponse = encryption.encrypt(errorResponse);
        return c.json({ encrypted: encryptedResponse }, 500);
    }
});

export default app;
