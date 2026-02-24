import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Maximize, Minimize, ChevronDown } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuCheckboxItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import type { Agent } from '@/bindings/types';
import { AgentState } from '@/bindings/types';
import { ProjectWorkspace, useAppStore } from '@/stores/useAppStore';
import { MentionsInput, Mention } from 'react-mentions';
import { MentionSuggestion,  } from '@/types/MentionSuggestion';
import { transformMentionDisplay } from '@/utils/mentionUtils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from '@/hooks/use-toast';
import { SUGGESTIONS_STYLE } from "@/components/agent-chat/constants/ChatSuggestions.ts";
import type { PromptMention } from '@/types/MentionSuggestion.ts';
import { cn } from '@/lib/utils';
import { CheckoutCommandDialog } from './CheckoutCommandDialog';
import { SlopModeDialog } from './SlopModeDialog';
import { SlopModeTimer } from './SlopModeTimer';
import { RalphModeDialog } from './RalphModeDialog';
import { RalphModeIndicator } from './RalphModeIndicator';
import SendPlane from '../ui/icons/SendPlane';
import Clean from '../ui/icons/Clean';
import Upload from '../ui/icons/Upload';
import Stop from '../ui/icons/Stop';
import { useIsTouchDevice } from '@/hooks/useIsTouchDevice';
import { useAgentPeremption } from '@/hooks/useAgentPeremption';
import { posthog } from '@/lib/posthog';
import { agentCreationService } from '@/services/agent.service';
import GitDisabled from '../ui/icons/GitDisabled';
import GitMerge from '../ui/icons/GitMerge';

const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku'] as const;

type ClaudeModel = typeof CLAUDE_MODELS[number];

const MODEL_LABELS: Record<ClaudeModel, string> = {
    opus: 'Opus',
    sonnet: 'Sonnet',
    haiku: 'Haiku',
};

function isClaudeModel(value: string): value is ClaudeModel {
    return (CLAUDE_MODELS as readonly string[]).includes(value);
}


interface PromptInputProps {
    agent: Agent,
    projectWorkspace: ProjectWorkspace,
    sendPrompt: (prompt: string, model?: ClaudeModel) => Promise<boolean>,
    sending: boolean,
    isLoading: boolean,
    canInterrupt: boolean,
    interruptAgent: () => Promise<void>,
    resetAgent: () => Promise<void>,
    mentionSuggestions: MentionSuggestion[]
    handleAddMentionToInput: (mention: PromptMention) => void,
    refetchEvents: () => Promise<void>,
    hasUnpushedCommits: boolean,
    hasUncommittedChanges: boolean,
    maximized: boolean,
    setMaximized: (value: boolean) => void,
    eventsCount: number,
    hasWriteAccess: boolean,
    prompt: string,
    setPrompt: (value: string) => void,
    onTabInteracted?: () => void,
    isFocused?: boolean,
}


export function PromptInputComponent({
  agent,
  projectWorkspace,
  sendPrompt,
  sending,
  isLoading,
  canInterrupt,
  interruptAgent,
  resetAgent,
  mentionSuggestions,
  handleAddMentionToInput,
  refetchEvents,
  hasUnpushedCommits,
  hasUncommittedChanges,
  maximized,
  setMaximized,
  eventsCount,
  hasWriteAccess,
  prompt,
  setPrompt,
  onTabInteracted,
  isFocused = true
}: PromptInputProps) {
    // Use local state for immediate updates to avoid input lag issues with store updates
    // This fixes the bug where typing "hello world" would result in dropped characters like "hod"
    // Initialize with the value from the store (passed as prop) to persist across tab switches
    const [localPrompt, setLocalPrompt] = useState(prompt || '');
    const [prevAgentId, setPrevAgentId] = useState(agent.id);

    const [isResetting, setIsResetting] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [showCheckoutDialog, setShowCheckoutDialog] = useState(false);
    const [showSlopModeDialog, setShowSlopModeDialog] = useState(false);
    const [slopModeActive, setSlopModeActive] = useState(false);
    const [slopModeUntil, setSlopModeUntil] = useState<Date | null>(null);
    const [showRalphModeDialog, setShowRalphModeDialog] = useState(false);
    const [ralphModeActive, setRalphModeActive] = useState(false);

    // Sync local state with parent
    useEffect(() => {
        // When agent changes (tab switch), load the prompt from store
        if (agent.id !== prevAgentId) {
            setPrevAgentId(agent.id);
            setLocalPrompt(prompt || '');
        }
        // When parent clears the prompt (after sending)
        else if (prompt === '' && localPrompt !== '') {
            setLocalPrompt('');
        }
    }, [prompt, agent.id, prevAgentId]);

    // Model selection from store
    const selectedModel = useAppStore(state => state.selectedModel);
    const setSelectedModel = useAppStore(state => state.setSelectedModel);
    const selectedModelLabel = MODEL_LABELS[selectedModel];
    const handleModelChange = useCallback((value: string) => {
        if (!isClaudeModel(value) || value === selectedModel) {
            return;
        }

        setSelectedModel(value);
        posthog.capture('model_selected', {
            agent_id: agent.id,
            model: value
        });
    }, [agent.id, selectedModel, setSelectedModel]);
    const mentionsInputRef = useRef<HTMLDivElement>(null);
    const isTouchDevice = useIsTouchDevice();
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [isBig, setIsBig] = useState(false);
    const autoSentRef = useRef(false); // Track if we've already auto-sent

    // Get time left before archival
    const { msLeft } = useAgentPeremption(agent);

    // Prompt modes from store (per-agent per-task)
    const taskId = 'last'; // Current task ID
    const storeKey = useMemo(() => `${agent.id}|${taskId}`, [agent.id, taskId]);

    // Select individual values from store to avoid creating new object references
    const webSearchEnabled = useAppStore(useCallback(
        (state) => state.promptModes.get(storeKey)?.webSearch ?? false,
        [storeKey]
    ));
    const planModeEnabled = useAppStore(useCallback(
        (state) => state.promptModes.get(storeKey)?.planMode ?? false,
        [storeKey]
    ));
    const ultrathinkEnabled = useAppStore(useCallback(
        (state) => state.promptModes.get(storeKey)?.ultrathink ?? false,
        [storeKey]
    ));

    const setPromptModes = useAppStore(state => state.setPromptModes);

    const setWebSearchEnabled = useCallback((value: boolean) => {
        posthog.capture('web_search_toggled', {
            agent_id: agent.id,
            enabled: value
        });
        setPromptModes(agent.id, taskId, {
            webSearch: value,
            planMode: planModeEnabled,
            ultrathink: ultrathinkEnabled
        });
        onTabInteracted?.();
    }, [agent.id, taskId, planModeEnabled, ultrathinkEnabled, setPromptModes, onTabInteracted]);

    const setPlanModeEnabled = useCallback((value: boolean) => {
        posthog.capture('plan_mode_toggled', {
            agent_id: agent.id,
            enabled: value
        });
        setPromptModes(agent.id, taskId, {
            webSearch: webSearchEnabled,
            planMode: value,
            ultrathink: ultrathinkEnabled
        });
        onTabInteracted?.();
    }, [agent.id, taskId, webSearchEnabled, ultrathinkEnabled, setPromptModes, onTabInteracted]);

    const setUltrathinkEnabled = useCallback((value: boolean) => {
        posthog.capture('ultrathink_toggled', {
            agent_id: agent.id,
            enabled: value
        });
        setPromptModes(agent.id, taskId, {
            webSearch: webSearchEnabled,
            planMode: planModeEnabled,
            ultrathink: value
        });
        onTabInteracted?.();
    }, [agent.id, taskId, webSearchEnabled, planModeEnabled, setPromptModes, onTabInteracted]);

    // Slop mode handlers
    const handleStartSlopMode = useCallback(async (minutes: number, customPrompt?: string) => {
        const hours = minutes / 60;
        const result = await agentCreationService.startSlopMode(agent.id, hours, customPrompt);
        if (result.success && result.inSlopModeUntil) {
            setSlopModeActive(true);
            setSlopModeUntil(new Date(result.inSlopModeUntil));

            const formatDuration = (mins: number) => {
                if (mins < 60) return `${mins} minutes`;
                const h = Math.floor(mins / 60);
                const m = mins % 60;
                if (m === 0) return `${h} hour${h !== 1 ? 's' : ''}`;
                return `${h} hour${h !== 1 ? 's' : ''} ${m} minutes`;
            };

            toast({
                title: 'Slop Mode Started',
                description: `Agent will work autonomously for ${formatDuration(minutes)}`,
            });
        } else {
            toast({
                title: 'Failed to Start Slop Mode',
                description: result.error || 'Unknown error',
                variant: 'destructive'
            });
        }
    }, [agent.id]);

    const handleStopSlopMode = useCallback(async () => {
        const result = await agentCreationService.stopSlopMode(agent.id);
        if (result.success) {
            setSlopModeActive(false);
            setSlopModeUntil(null);
            toast({
                title: 'Slop Mode Stopped',
                description: 'Agent will no longer receive auto-prompts',
            });
        } else {
            toast({
                title: 'Failed to Stop Slop Mode',
                description: result.error || 'Unknown error',
                variant: 'destructive'
            });
        }
    }, [agent.id]);

    // Ralph mode handlers
    const handleStartRalphMode = useCallback(async (taskDescription: string) => {
        const result = await agentCreationService.startRalphMode(agent.id, taskDescription);
        if (result.success) {
            setRalphModeActive(true);
            toast({
                title: 'Ralph Mode Started',
                description: 'Agent will work autonomously until task complete',
            });
        } else {
            toast({
                title: 'Failed to Start Ralph Mode',
                description: result.error || 'Unknown error',
                variant: 'destructive'
            });
        }
    }, [agent.id]);

    const handleStopRalphMode = useCallback(async () => {
        const result = await agentCreationService.stopRalphMode(agent.id);
        if (result.success) {
            setRalphModeActive(false);
            toast({
                title: 'Ralph Mode Stopped',
                description: 'Agent will no longer work autonomously',
            });
        } else {
            toast({
                title: 'Failed to Stop Ralph Mode',
                description: result.error || 'Unknown error',
                variant: 'destructive'
            });
        }
    }, [agent.id]);

    // Check ralph mode status from agent
    useEffect(() => {
        setRalphModeActive(!!agent.inRalphMode);
    }, [agent.inRalphMode]);

    // Check slop mode status from agent
    useEffect(() => {
        if (agent.inSlopModeUntil) {
            const until = new Date(agent.inSlopModeUntil);
            const now = new Date();
            if (until.getTime() > now.getTime()) {
                setSlopModeActive(true);
                setSlopModeUntil(until);
            } else {
                setSlopModeActive(false);
                setSlopModeUntil(null);
            }
        } else {
            setSlopModeActive(false);
            setSlopModeUntil(null);
        }
    }, [agent.inSlopModeUntil]);

    // Reactive check if agent can be reset
    const canModifyConversation = useMemo(() => {
        const state = agent.state as AgentState;
        // ARCHIVED agents auto-resume, so they're included
        const validStates = [AgentState.READY, AgentState.IDLE, AgentState.RUNNING, AgentState.ARCHIVED];
        return validStates.includes(state) && eventsCount > 4;
    }, [agent.state, eventsCount]);

    // Reactive check if git push button should be shown
    const canShowPushButton = useMemo(() => {
        const state = agent.state as AgentState;
        // ARCHIVED agents auto-resume, so they're included
        const validStates = [AgentState.READY, AgentState.IDLE, AgentState.RUNNING, AgentState.ARCHIVED];
        // console.log('cloneUrl:', projectWorkspace.cloneUrl);
        return validStates.includes(state) && (!projectWorkspace.cloneUrl || projectWorkspace.cloneUrl.includes('github.com'));
    }, [agent.state, projectWorkspace.cloneUrl]);

    // Visual feedback when escape key triggers interrupt
    const [escapeFlash, setEscapeFlash] = useState(false);

    // Add Escape key handler for interrupt — only when this tab is focused
    useEffect(() => {
        if (!isFocused) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && canInterrupt) {
                e.preventDefault();
                posthog.capture('agent_interrupted_via_escape', {
                    agent_id: agent.id
                });
                // Flash the stop button to give visual feedback
                setEscapeFlash(true);
                setTimeout(() => setEscapeFlash(false), 400);
                interruptAgent();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFocused, canInterrupt, interruptAgent]);

    // Force textarea resize when prompt changes (fixes paste issue)
    useEffect(() => {
        if (mentionsInputRef.current) {
            const textarea = mentionsInputRef.current.querySelector('textarea');
            if (textarea) {
                // Reset height to auto to get the correct scrollHeight
                textarea.style.height = 'auto';
                // Set height to scrollHeight to fit content
                textarea.style.height = `${textarea.scrollHeight}px`;
                if (!maximized && textarea.scrollHeight > 170) {
                    setIsBig(true);
                    textarea.style.overflowY = 'scroll'
                } else if (textarea.scrollHeight <= 170) {
                    setIsBig(false);
                    textarea.style.overflowY = 'visible'
                }
            }
        }
    }, [localPrompt, maximized, agent.id]);

    // Check if PR already exists for this agent
    // Only consider an open PR as "having a PR" for UI purposes
    const hasOpenPR = agent.prUrl && agent.prState === 'open';

    // Auto-send prompt when archival is imminent (3 seconds) and there's text in input
    useEffect(() => {
        // Only auto-send if:
        // 1. Agent will be archived in 3 seconds or less (but not already archived)
        // 2. There's text in the prompt input
        // 3. We haven't already auto-sent
        // 4. Not currently sending
        if (msLeft > 0 && msLeft <= 1500 && localPrompt.trim() && !autoSentRef.current && !sending) {
            autoSentRef.current = true;
            const processedPrompt = processPrompt(localPrompt);

            // Send the prompt to preserve user's WIP
            // Note: setPrompt('') is handled in handleSendPrompt in AgentChat
            sendPrompt(processedPrompt, selectedModel).then((success) => {
                if (success) {
                    // Reset toggles to default state after successful send
                    setPromptModes(agent.id, taskId, {
                        webSearch: false,
                        planMode: false,
                        ultrathink: false
                    });
                    toast({
                        title: "Prompt Auto-sent",
                        description: "Your prompt was automatically sent to preserve it before archival.",
                    });
                }
            });
        }

        // Reset auto-sent flag if time increases (e.g., lifetime extended)
        if (msLeft > 1500) {
            autoSentRef.current = false;
        }
    }, [msLeft, localPrompt, sending, sendPrompt]);

    // Send a prompt to push commits
    const handlePushPrompt = async () => {
      if (canInterrupt) {
        await interruptAgent();
      }
      await sendPrompt('push to remote', selectedModel);
    };

    // Send a prompt to create a PR
    const handleCreatePRPrompt = async () => {
      if (canInterrupt) {
        await interruptAgent();
      }
      const baseBranch = agent.baseBranch || 'main';
      await sendPrompt(`push & create a PR for what we've been doing so far into branch ${baseBranch}`, selectedModel);
    };

    // Process prompt with toggle suffixes
    const processPrompt = (basePrompt: string): string => {
      let processedPrompt = basePrompt;

      if (webSearchEnabled) {
        processedPrompt += '\n\n use web search tool';
      }

      if (planModeEnabled) {
        processedPrompt += "\n\n just give me a plan, don't implement, or just give an answer if it was a simple question";
      }

      if (ultrathinkEnabled) {
        processedPrompt += '\n\n ultrathink';
      }

      return processedPrompt;
    };

    return (
        <div className={cn(
            maximized ? "w-full h-[99%] md:h-[100%] rounded-sm z-50" : "relative z-20 h-fit min-h-fit w-[79ch] rounded-lg",
            " max-w-full shrink-0 bg-background p-3"
        )}>
            {/* Slop Mode Timer / Ralph Mode Indicator - Top Left */}
            {(slopModeActive && slopModeUntil) || ralphModeActive ? (
                <div className="absolute -top-2 rounded-md backdrop-blur-sm bg-background/50 -translate-y-full left-0 w-fit flex-shrink-0 flex items-center gap-1 md:gap-2">
                    {slopModeActive && slopModeUntil && (
                        <SlopModeTimer
                            inSlopModeUntil={slopModeUntil}
                            onStop={handleStopSlopMode}
                        />
                    )}
                    {ralphModeActive && (
                        <RalphModeIndicator onStop={handleStopRalphMode} />
                    )}
                </div>
            ) : null}

            {/* Action Buttons - Top Right */}
            {(
                <div className="absolute -top-2 rounded-md backdrop-blur-sm bg-background/50 -translate-y-full right-0 w-fit flex-shrink-0 flex items-center gap-1 md:gap-2">
                    {/* Push Button */}
                    <div className={cn(canShowPushButton && hasUnpushedCommits ? 'opacity-100' : 'opacity-20  pointer-events-none')}>
                        <Button
                            variant="transparent"
                            hoverVariant="accent"
                            className="px-2 py-0.5 flex items-center gap-2 not-hover:text-foreground/50"
                            onClick={handlePushPrompt}
                        >
                            <div className="h-5 w-5">
                                <Upload className="max-h-full max-w-full text-inherit" />
                            </div>
                            <div>push</div>
                        </Button>
                    </div>
                    {/* Create PR Button - only show if no open PR */}
                    <div className={cn(canShowPushButton && !hasOpenPR ? 'opacity-100' : 'opacity-20  pointer-events-none')}>
                        <Button
                            variant="transparent"
                            hoverVariant="accent"
                            className="px-2 py-0.5 flex items-center gap-2 not-hover:text-foreground/50"
                            onClick={handleCreatePRPrompt}
                        >
                            <div className="h-5 w-5">
                                <GitMerge className="max-h-full max-w-full text-inherit" />
                            </div>
                            <div>create PR</div>
                        </Button>
                    </div>
                    <div className={cn(canInterrupt ? 'opacity-100' : 'opacity-20  pointer-events-none')}>
                        <Button
                        variant={escapeFlash ? "destructive" : "transparent"}
                        hoverVariant="destructive"
                        className={cn(
                            "px-2 py-0.5 flex items-center gap-2 not-hover:text-foreground/50 transition-colors duration-150",
                            escapeFlash && "text-destructive-foreground"
                        )}
                        onClick={interruptAgent}
                        >
                            <div className="h-5 w-5">
                                <Stop className="max-h-full max-w-full text-inherit" />
                            </div>
                            <div className="flex items-center gap-1"><span>interrupt</span> <span className='md:block hidden'>(esc)</span></div>
                        </Button>
                    </div>
                    <div className={cn(hasWriteAccess && canModifyConversation && agent.state !== AgentState.RUNNING ? 'opacity-100' : 'opacity-20  pointer-events-none')}>
                        <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                          variant="transparent"
                                          hoverVariant="accent"
                                          className="px-2 py-0.5 flex items-center gap-2 not-hover:text-foreground/50"
                                          onClick={() => setShowResetConfirm(true)}
                                          disabled={isResetting}
                                        >
                                            {isResetting ? (
                                                <div className="h-4 w-4 border-2 border-foreground/50 border-t-transparent rounded-full animate-spin" />
                                            ) : (
                                                <div className="h-5 w-5">
                                                    <Clean className="max-h-full max-w-full text-inherit" />
                                                </div>
                                            )}
                                            <div>clear</div>
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <div className="max-w-xs">
                                            <p className="font-semibold">Clear Conversation</p>
                                            <p className="text-xs mt-1">Clears the conversation from the agent's context so it can handle more context. The cleared conversation will still be visible to you in here.</p>
                                        </div>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                    </div>
                </div>
            )}

            {/* Reset Confirmation Dialog */}
            <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Reset Conversation?</AlertDialogTitle>
                        <AlertDialogDescription>
                            <p className="mt-2 text-amber-600 dark:text-amber-500">
                                This will clear all the agent's context and cannot be undone.
                            </p>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className='px-3 py-2'>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive px-3 py-2 text-destructive-foreground hover:bg-destructive/90"
                            onClick={async () => {
                                setIsResetting(true);
                                try {
                                    posthog.capture('agent_reset', {
                                        agent_id: agent.id,
                                        events_count: eventsCount
                                    });
                                    await resetAgent();
                                    toast({
                                        title: "Conversation Reset",
                                        description: "All conversation history has been cleared.",
                                    });
                                    await refetchEvents();
                                } catch (error) {
                                    toast({
                                        title: "Reset Failed",
                                        description: error instanceof Error ? error.message : "Unknown error",
                                        variant: "destructive"
                                    });
                                } finally {
                                    setIsResetting(false);
                                    setShowResetConfirm(false);
                                }
                            }}
                        >
                            Reset Conversation
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <div className="flex flex-col gap-2 justify-between h-full overflow-visible">
                {/* First line: Text input */}
                <div
                    ref={mentionsInputRef}
                    className={cn(
                        isTouchDevice && isInputFocused ? 'min-h-44' : 'min-h-14',
                        'transition-all duration-200 mb-6',
                        isBig ? 'overflow-y-scroll' : 'overflow-y-visible',
                        maximized ? 'max-h-[90%] p-6' : 'max-h-[190px] pt-3 pb-1.5 px-3'
                    )}
                >
                    <MentionsInput
                        value={localPrompt}
                        onChange={(e, newValue) => {
                            // Use local state first, then update parent
                            setLocalPrompt(newValue);
                            setPrompt(newValue);
                        }}
                        spellCheck={false}
                        placeholder={
                            agent.state === AgentState.READY || agent.state === AgentState.IDLE
                                ? "What do you want to do?"
                                : agent.state === AgentState.ARCHIVED
                                    ? "Queue a prompt (It'll resume the agent on a new machine)..."
                                    : isLoading
                                        ? "Queue a prompt (Agent is setting up)..."
                                        : "Queue a prompt (Agent is busy)..."
                        }
                        onFocus={() => setIsInputFocused(true)}
                        onBlur={() => setIsInputFocused(false)}
                        onPaste={(e) => {
                            // Get pasted text
                            const pastedText = e.clipboardData.getData('text');

                            // Only wrap if it doesn't already start with ```
                            if (pastedText && !pastedText.trimStart().startsWith('```') && pastedText.split('\n').length > 2) {
                                e.preventDefault();
                                e.stopPropagation();

                                // Get current cursor position
                                const target = e.target as HTMLTextAreaElement;
                                const start = target.selectionStart;
                                const end = target.selectionEnd;

                                // Wrap pasted text in code blocks
                                const wrappedText = '```\n' + pastedText + '\n```';

                                // Insert wrapped text at cursor position
                                const newValue = localPrompt.substring(0, start) + wrappedText + localPrompt.substring(end);
                                setLocalPrompt(newValue);
                                setPrompt(newValue);

                                // Set cursor position after the pasted content
                                setTimeout(() => {
                                    target.setSelectionRange(start + wrappedText.length, start + wrappedText.length);
                                }, 0);
                            }
                        }}
                        onKeyDown={async (e) => {
                            // On touch devices, don't auto-send on Enter (allows multiline input with virtual keyboard)
                            if (e.key === 'Enter' && !e.shiftKey && !isTouchDevice) {
                                e.preventDefault();
                                const processedPrompt = processPrompt(localPrompt);
                                let success = await sendPrompt(processedPrompt, selectedModel);
                                // Note: setPrompt('') is handled in handleSendPrompt in AgentChat
                                if (success) {
                                    // Reset toggles to default state after successful send
                                    setPromptModes(agent.id, taskId, {
                                        webSearch: false,
                                        planMode: false,
                                        ultrathink: false
                                    });
                                }
                            }
                        }}
                        disabled={sending}
                        forceSuggestionsAboveCursor={true}
                        style={SUGGESTIONS_STYLE as React.CSSProperties}
                        className={cn(
                            "mention overflow-visible",
                            maximized ? '!text-xl' : '!text-base'
                        )}
                    >
                        <Mention
                            trigger="@"
                            data={mentionSuggestions.map(suggestion => ({
                                id: suggestion.id,
                                display: suggestion.display,
                                type: suggestion.type,
                            }))}
                            displayTransform={(id, display) =>
                                transformMentionDisplay(id, display, mentionSuggestions)
                            }
                            className="mentions__mention"
                            onAdd={(mention: string | number) => {
                                // in current implementation mention is always a string
                                if (typeof mention !== 'string') return;
                                const mentionData = mentionSuggestions.find(s => s.id === mention);
                                if (mentionData) {
                                    handleAddMentionToInput({
                                        id: mentionData.id,
                                        type: mentionData.type
                                    });
                                }
                            }}
                        />
                    </MentionsInput>
                </div>

                {/* Second line: Controls */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 h-9.5">

                        {/* Refine Together Toggle */}
                        {/* <div className="flex items-center space-x-2 px-3 py-1.5 border-(length:--border-width) border-background/50 rounded-md opacity-60">
                            <label htmlFor="clarify-toggle" className="text-sm text-muted-foreground">
                                Refine Together
                            </label>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <Info className="h-3 w-3 text-muted-foreground" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>When enabled, Claude will ask clarifying questions to better understand your request.</p>
                                        <p className="mt-1 text-xs opacity-80">Coming at the end of September!</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <Switch
                                id="clarify-toggle"
                                checked={false}
                                disabled={true}
                            />
                        </div> */}

                        <Button
                            variant="transparent"
                            hoverVariant='default'
                            onClick={() => {
                                posthog.capture('prompt_input_maximized_toggled', {
                                    agent_id: agent.id,
                                    maximized: !maximized
                                });
                                setMaximized(!maximized);
                            }}
                            size="icon"
                            className='w-9 h-9 flex items-center justify-center'
                        >
                            {maximized ? (
                                <Minimize className="h-4 w-4" />
                            ) : (
                                <Maximize className="h-4 w-4" />
                            )}
                        </Button>

                        {/* Mobile: Model Selector and Modes Dropdown */}
                        <div className="flex items-center gap-2">
                            {/* Model Selector - Mobile */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="transparent"
                                        hoverVariant="background"
                                        size="sm"
                                        className="h-7 px-2 py-1 w-21w flex items-center gap-1 text-xs text-muted-foreground/80 rounded-lg"
                                    >
                                        <span>{selectedModelLabel}</span>
                                        <ChevronDown className="h-3 w-3" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                    <DropdownMenuRadioGroup value={selectedModel} onValueChange={handleModelChange}>
                                        {CLAUDE_MODELS.map((model) => (
                                            <DropdownMenuRadioItem key={model} value={model} className="text-xs">
                                                {MODEL_LABELS[model]}
                                            </DropdownMenuRadioItem>
                                        ))}
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            {/* Modes Dropdown - Mobile */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="transparent"
                                        hoverVariant="background"
                                        size="sm"
                                        className="h-7 px-2 py-1 flex items-center gap-1 text-xs text-muted-foreground/60 rounded-lg"
                                    >
                                        <span>modes</span>
                                        <ChevronDown className="h-3 w-3" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                    <DropdownMenuCheckboxItem
                                        checked={webSearchEnabled}
                                        onCheckedChange={setWebSearchEnabled}
                                    >
                                        Web Search
                                    </DropdownMenuCheckboxItem>
                                    <DropdownMenuCheckboxItem
                                        checked={planModeEnabled}
                                        onCheckedChange={setPlanModeEnabled}
                                    >
                                        Plan Mode
                                    </DropdownMenuCheckboxItem>
                                    <DropdownMenuCheckboxItem
                                        checked={ultrathinkEnabled}
                                        onCheckedChange={setUltrathinkEnabled}
                                    >
                                        Ultrathink
                                    </DropdownMenuCheckboxItem>
                                    <DropdownMenuCheckboxItem
                                        onSelect={(e) => {
                                            e.preventDefault();
                                            setShowSlopModeDialog(true);
                                        }}
                                    >
                                        Slop Mode
                                    </DropdownMenuCheckboxItem>
                                    <DropdownMenuCheckboxItem
                                        onSelect={(e) => {
                                            e.preventDefault();
                                            setShowRalphModeDialog(true);
                                        }}
                                    >
                                        Ralph Mode
                                    </DropdownMenuCheckboxItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>

                    <div className="flex items-center space-x-2">
                        <Button
                            variant="default"
                            onClick={async () => {
                                const processedPrompt = processPrompt(localPrompt);
                                let success = await sendPrompt(processedPrompt, selectedModel);
                                // Note: setPrompt('') is handled in handleSendPrompt in AgentChat
                                if (success) {
                                    // Reset toggles to default state after successful send
                                    setPromptModes(agent.id, taskId, {
                                        webSearch: false,
                                        planMode: false,
                                        ultrathink: false
                                    });
                                }
                            }}
                            disabled={!localPrompt.trim() || sending}
                            className='flex items-center justify-center hover:text-accent pl-2.5'
                        >
                            <SendPlane className="!min-h-5 !min-w-5 text-inherit" />
                            <div>send</div>
                        </Button>
                    </div>
                </div>
            </div>

            {/* Checkout Command Dialog */}
            <CheckoutCommandDialog
                open={showCheckoutDialog}
                onClose={() => setShowCheckoutDialog(false)}
                branchName={agent.branchName}
            />

            {/* Slop Mode Dialog */}
            <SlopModeDialog
                open={showSlopModeDialog}
                onOpenChange={setShowSlopModeDialog}
                onConfirm={handleStartSlopMode}
            />

            {/* Ralph Mode Dialog */}
            <RalphModeDialog
                open={showRalphModeDialog}
                onOpenChange={setShowRalphModeDialog}
                onConfirm={handleStartRalphMode}
            />
        </div>
    )
}