import { globalState } from './agentsState';

/**
 * Unified prompt processor that handles generation tracking to prevent race conditions.
 * Use this for all code paths that send prompts to Claude.
 *
 * The generation counter prevents stale handlers from corrupting state after interrupt.
 * Each prompt increments generation, and only the current generation's handler updates state.
 */
export async function processPromptWithGenerationTracking(
    prompt: string,
    model: 'opus' | 'sonnet' | 'haiku',
    source: string // For logging: 'prompt', 'automation', etc.
): Promise<{ success: boolean; interrupted: boolean; error?: string }> {
    if (!globalState.claudeService) {
        throw new Error('Claude service not initialized yet');
    }

    // Capture generation at start to detect if interrupt happened during processing.
    // If generation changes (due to interrupt or new prompt), this handler should not
    // update claudeReadyForPrompt to avoid race conditions.
    const startGeneration = ++globalState.promptGeneration;
    console.log(`[${source}] Starting prompt processing, generation=${startGeneration}`);

    globalState.claudeReadyForPrompt = false;

    try {
        await globalState.claudeService.processMessage(
            { message: prompt },
            model
        );

        // Only update state if we're still the current generation
        if (globalState.promptGeneration === startGeneration) {
            globalState.claudeReadyForPrompt = true;
            console.log(`[${source}] Prompt completed normally, generation=${startGeneration}`);
        } else {
            console.log(`[${source}] Prompt completed but generation changed (${startGeneration} -> ${globalState.promptGeneration}), not updating state`);
        }

        return { success: true, interrupted: false };
    } catch (error: any) {
        // Only update state if we're still the current generation
        if (globalState.promptGeneration === startGeneration) {
            globalState.claudeReadyForPrompt = true;
        }

        // If the error is an abort error, treat it as successful interruption
        if (error.name === 'AbortError' || error.message?.includes('aborted by user')) {
            console.log(`[${source}] Prompt processing was interrupted by user, generation=${startGeneration}`);
            return { success: true, interrupted: true };
        }

        // Otherwise, return the error
        console.error(`[${source}] Prompt processing failed:`, error);
        return { success: false, interrupted: false, error: error.message || 'Unknown error' };
    }
}
