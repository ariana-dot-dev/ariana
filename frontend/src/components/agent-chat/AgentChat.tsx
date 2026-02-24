import { Button } from '@/components/ui/button';
import { HelpCircle, ChevronRight, ChevronDown } from 'lucide-react';
import { Agent, AgentState } from '@/bindings/types';
import { AgentChatHeader } from './AgentSyncHeader';
import { BottomTerminalPanel } from './BottomTerminalPanel';
import { PromptInputComponent } from './PromptInput';
import { agentStateToString, describeAgentState } from './utils';
import { useEvents } from './hooks/useEvents';
import { useClarification } from './hooks/useClarification';
import { useMentions } from './hooks/useMentions';
import { useScrollAnchor } from './hooks/useScrollAnchor';
import { useAutoLoadMore } from './hooks/useAutoLoadMore';
import { useAgentState } from './hooks/useAgentState';
import { useUploadProgressStore } from '@/stores/useUploadProgressStore';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { DiffView } from './DiffView';
import { DesktopView } from './DesktopView';
import { WebPreviewsView } from './WebPreviewsView';
import { useAgentDiffs } from '@/hooks/useAgentDiffs';
import Logo from '../ui/logo';
import {Event} from "@/components/agent-chat/Event.tsx";
import {GroupedEventsList} from "@/components/agent-chat/GroupedEventsList.tsx";
import { ProjectWorkspace, useAppStore } from '@/stores/useAppStore';
import { useNetworkForwarding } from '@/hooks/useNetworkForwarding';
import { useServicePreviewability } from './hooks/useServicePreviewability';
import { posthog } from '@/lib/posthog';
import { StoppedAgentResumeButton } from '../agent-manager/StoppedAgentIndicator';
import { agentTips } from './tips';
import { TipDialog } from './TipDialog';
import { LuxActivityBanner } from './LuxActivityBanner';
import { FloatingChatPrompt } from './FloatingChatPrompt';

interface AgentChatProps {
  agent: Agent | null;
  projectWorkspace: ProjectWorkspace;
  allAgents: Agent[];
  isFocused?: boolean; // Is this tab currently visible/active
  automations?: any[];
  onTriggerAutomation?: (automationId: string, agentId: string) => Promise<void>;
  onStopAutomation?: (automationId: string, agentId: string) => Promise<void>;
  onFeedAutomationToAgent?: (automationId: string, agentId: string, output: string, automationName: string) => Promise<void>;
  onTabInteracted?: () => void; // Called when user interacts with the tab (for preview tab behavior)
  onCreateAgentWithPrompt?: (prompt: string) => void;
}

export function AgentChat({ agent, projectWorkspace, allAgents = [], isFocused = true, automations = [], onTriggerAutomation, onStopAutomation, onFeedAutomationToAgent, onTabInteracted, onCreateAgentWithPrompt }: AgentChatProps) {
  // Safety check - return null if agent is not provided
  if (!agent) {
    return null;
  }

  // Track if we've already marked this tab as interacted
  const hasInteractedRef = useRef(false);
  const markInteracted = useCallback(() => {
    if (!hasInteractedRef.current && onTabInteracted) {
      hasInteractedRef.current = true;
      onTabInteracted();
    }
  }, [onTabInteracted]);

  const [parentHeight, setParentHeight] = useState(0);
  const [div3Height, setDiv3Height] = useState(0);
  const parentRef = useRef(null);
  const div3Ref = useRef(null);
  const [terminalPosition, setTerminalPosition] = useState<'bottom' | 'right'>('bottom');
  const [viewMode, setViewMode] = useState<'conversation' | 'diffs' | 'desktop' | 'web-previews'>('conversation');
  const [inputMaximized, setInputMaximized] = useState(false);
  const [eventsCount, setEventsCount] = useState(0);
  const [randomTip] = useState(() => agentTips[Math.floor(Math.random() * agentTips.length)]);
  const [tipDialogOpen, setTipDialogOpen] = useState(false);
  const savedScrollPosition = useRef<number>(0);
  const [activePreviewPort, setActivePreviewPort] = useState<number | null>(null);

  // Get current user from store
  const currentUser = useAppStore(state => state.user);
  const isOwner = currentUser?.id === agent.userId;

  // Get prompt draft from store (persists per agent, even on close/reopen)
  const getPromptDraft = useAppStore(state => state.getPromptDraft);
  const setPromptDraft = useAppStore(state => state.setPromptDraft);
  const prompt = getPromptDraft(agent.id);
  const setPrompt = useCallback((value: string) => {
    setPromptDraft(agent.id, value);
    // Mark tab as interacted when user starts typing
    if (value.length > 0) {
      markInteracted();
    }
  }, [agent.id, setPromptDraft, markInteracted]);

  // Get active ports for web previews (stickyActivePorts survives brief empty blips)
  const { activePorts, stickyActivePorts } = useNetworkForwarding();

  // Probe which ports actually serve previewable HTML (only when tab is focused to avoid 502 spam)
  const previewablePorts = useServicePreviewability({
    activePorts,
    machineUrl: agent.machineUrl,
    servicePreviewToken: agent.servicePreviewToken,
    enabled: isFocused,
  });

  // Use the diffs store - only poll when tab is focused
  const { diffData, hasUncommittedChanges } = useAgentDiffs(agent.id, isFocused);

  // Force view back to conversation if desktop/web-previews becomes unavailable
  const desktopActiveStates: string[] = [AgentState.READY, AgentState.RUNNING, AgentState.IDLE, AgentState.ARCHIVING];
  useEffect(() => {
    if (viewMode === 'desktop' && !desktopActiveStates.includes(agent.state)) {
      setViewMode('conversation');
    }
    if (viewMode === 'web-previews' && stickyActivePorts.length === 0) {
      setViewMode('conversation');
    }
  }, [agent.state, viewMode, stickyActivePorts.length]);

  useEffect(() => {
    const updateHeights = () => {
      if (parentRef.current) {
        setParentHeight((parentRef.current as any).clientHeight);
      }
      if (div3Ref.current) {
        setDiv3Height((div3Ref.current as any).scrollHeight);
      }
    };

    // Initial measurement
    updateHeights();

    // Create ResizeObserver for both elements
    const resizeObserver = new ResizeObserver(updateHeights);
    
    if (parentRef.current) {
      resizeObserver.observe(parentRef.current);
    }
    if (div3Ref.current) {
      resizeObserver.observe(div3Ref.current);
    }

    // Also listen to window resize
    window.addEventListener('resize', updateHeights);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateHeights);
    };
  }, []);

  // Calculate max height for div2
  const div2MaxHeight = Math.max(100, parentHeight - div3Height + 2); // 100 is min-height, 20 is buffer
  
  const {
    events,
    lastPrompt,
    sending,
    hasMore,
    isLoadingMore,
    loadOlderEvents,
    sendPrompt,
    interruptAgent,
    resetAgent,
    refetchEvents,
    cancelPrompt,
    skipQueue
  } = useEvents(agent, isFocused);

  const {
    mentionSuggestions,
    selectedMentions,
    handleAddMentionToInput,
    resetSelectedMentions
  } = useMentions(projectWorkspace, isFocused);

  useEffect(() => {
    // Flatten all events and find the index of the last reset event
    const allEvents = events;
    let lastResetIndex = -1;

    for (let i = allEvents.length - 1; i >= 0; i--) {
      if (allEvents[i].type === 'reset') {
        lastResetIndex = i;
        break;
      }
    }

    // Count events after the last reset
    const count = lastResetIndex === -1
      ? allEvents.length
      : allEvents.length - lastResetIndex - 1;

    setEventsCount(count);
  }, [events]);

  // Use last event id + count as scroll dependency — cheap to compute,
  // only changes when there's actually new content
  const lastEventId = events.length > 0 ? events[events.length - 1].id : '';
  const scrollDependency = `${events.length}:${lastEventId}`;

  // Modern scroll management using IntersectionObserver
  const { scrollContainerRef, isAtBottom, scrollToBottom } = useScrollAnchor(scrollDependency);

  // Auto-load more messages when scrolling near top
  const loadMoreSentinelRef = useAutoLoadMore({
    scrollContainerRef,
    hasMore,
    isLoading: isLoadingMore,
    onLoadMore: loadOlderEvents,
    threshold: 400
  });

  // Restore scroll position when switching back to conversation mode
  useEffect(() => {
    if (viewMode === 'conversation' && scrollContainerRef.current && savedScrollPosition.current > 0) {
      scrollContainerRef.current.scrollTop = savedScrollPosition.current;
      savedScrollPosition.current = 0; // Clear after restoring
    }
  }, [viewMode, scrollContainerRef]);

  const {
    isLoading,
    canInterrupt,
    canSendPrompts,
    canUseTerminals,
    hasWriteAccess,
    isTerminalOpen,
    setIsTerminalOpen,
    handleToggleTerminal
  } = useAgentState(agent);

  const handleToggleTerminalPosition = () => {
    setTerminalPosition(prev => prev === 'bottom' ? 'right' : 'bottom');
  };

  // Wrap terminal toggle to mark tab as interacted
  const handleToggleTerminalWithInteraction = useCallback(() => {
    markInteracted();
    handleToggleTerminal();
  }, [markInteracted, handleToggleTerminal]);

  // Handle view mode change
  const handleViewModeChange = (mode: string) => {
    posthog.capture('agent_view_mode_changed', {
      agent_id: agent.id,
      from_mode: viewMode,
      to_mode: mode
    });

    // Save scroll position when leaving conversation mode
    if (viewMode === 'conversation' && scrollContainerRef.current) {
      savedScrollPosition.current = scrollContainerRef.current.scrollTop;
    }

    setViewMode(mode as typeof viewMode);
  };

  // Get upload progress for this agent
  const uploadProgress = useUploadProgressStore(state => state.progress.get(agent.id));

  // Check if there are unpushed commits
  // A commit is unpushed if: pushed === false (regardless of commitUrl)
  // Memoize to avoid re-computing on every render
  const hasUnpushedCommits = useMemo(
    () => events.filter(
      e => e.type === 'git_checkpoint' && (e.data.pushed === false && !e.data.commitUrl)
    ).length > 0,
    [events] // Re-compute when events array changes
  );

  // Handle sending prompt with mentions
  const handleSendPrompt = async (promptText: string, model?: 'opus' | 'sonnet' | 'haiku'): Promise<boolean> => {
    markInteracted(); // Mark tab as interacted when sending a prompt
    const result = await sendPrompt(promptText, selectedMentions, model);
    if (result) {
      resetSelectedMentions();
      setPrompt(''); // Clear prompt after successful send
    }
    return result;
  };

  // Automation action callbacks (bound to current agent)
  const handleRelaunchAutomation = useCallback(async (automationId: string) => {
    if (!onTriggerAutomation || !agent) return;
    await onTriggerAutomation(automationId, agent.id);
  }, [onTriggerAutomation, agent]);

  const handleStopAutomation = useCallback(async (automationId: string) => {
    if (!onStopAutomation || !agent) return;
    await onStopAutomation(automationId, agent.id);
  }, [onStopAutomation, agent]);

  const handleFeedAutomationToAgent = useCallback(async (automationId: string, output: string, automationName: string) => {
    if (!onFeedAutomationToAgent || !agent) return;
    await onFeedAutomationToAgent(automationId, agent.id, output, automationName);
  }, [onFeedAutomationToAgent, agent]);

  const chatContent = (
    <>
      {/* Sync Header */}
      <AgentChatHeader
          projectWorkspace={projectWorkspace}
          agent={agent}
          allAgents={allAgents}
          lastPrompt={lastPrompt}
          canUseTerminals={canUseTerminals}
          isTerminalOpen={isTerminalOpen}
          onToggleTerminal={handleToggleTerminalWithInteraction}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          automations={automations}
          onTriggerAutomation={onTriggerAutomation}
          isFocused={isFocused}
          previewablePortsCount={previewablePorts.length}
      />
      {/* LUX activity banner — always mounted so it can track done→dismiss transitions */}
      <LuxActivityBanner
        agentId={agent.id}
        luxActiveTask={(agent as any).luxActiveTask ?? null}
        luxActiveSessionId={(agent as any).luxActiveSessionId ?? null}
        visible={viewMode === 'desktop'}
      />
      {/* Chat Area — each view mode gets its own container */}
      {viewMode === 'conversation' ? (
        <div className={cn(
          "p-2 overflow-y-auto w-full max-h-full flex-1 min-h-0 flex flex-col items-center",
            inputMaximized ? 'relative' : '',
        )} ref={scrollContainerRef}
          style={{
            minHeight: '0%',
            maxHeight: canSendPrompts ? `${div2MaxHeight}px` : '100%',
            // Native browser scroll anchoring for stable prepending of older messages
            overflowAnchor: 'auto'
          }}
        >
          <div className="relative flex flex-col mb-6 gap-6 mt-44 h-fit w-full max-w-[80ch]">
            <GroupedEventsList
              events={events}
              agent={agent}
              projectWorkspace={projectWorkspace}
              refetchEvents={refetchEvents}
              onCancelPrompt={cancelPrompt}
              onSkipQueue={skipQueue}
              onRelaunchAutomation={handleRelaunchAutomation}
              onStopAutomation={handleStopAutomation}
              onFeedAutomationToAgent={handleFeedAutomationToAgent}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              loadMoreSentinelRef={loadMoreSentinelRef}
            />
            {agent.state === AgentState.RUNNING && (
              <div className='absolute top-full left-0 flex flex-col gap-2 mt-6 ml-5 lg:ml-10'>
                <div className='flex gap-2 items-center animate-pulse'>
                  <Logo className="h-6 w-6" />
                  <span className="text-sm font-medium text-accent">Working...</span>
                </div>
                <div className="text-xs text-muted-foreground/70 ml-8">
                  Tip: <button
                    onClick={() => setTipDialogOpen(true)}
                    className="hover:underline cursor-pointer"
                  >
                    {randomTip.catchphrase}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Jump to latest button — sticky at bottom of scroll area */}
          {!isAtBottom && (
            <div className="sticky w-full max-w-[80ch] bottom-9 z-10 flex justify-end pointer-events-none">
              <button
                onClick={scrollToBottom}
                className="pointer-events-auto flex items-center gap-1.5 px-2 py-0.5 bg-background/80 backdrop-blur border border-border rounded-md text-sm text-muted-foreground/70 hover:text-foreground transition-colors"
              >
                <ChevronDown className="w-4 h-4" />
                Jump to latest
              </button>
            </div>
          )}

          <div className="w-full min-h-[300px] flex flex-col items-center justify-center max-w-[73ch]">
            {isLoading && (
              <div className="text-center text-muted-foreground py-8 px-4">
                <div className="flex flex-col items-center space-y-3">
                  <div className="w-8 h-8 border-2 border-muted border-t-transparent rounded-full animate-spin" />
                  <p>{agentStateToString(agent.state as any)}</p>
                  {describeAgentState(agent.state as any, uploadProgress) && (
                    <div className="text-sm text-center">
                      {describeAgentState(agent.state as any, uploadProgress)?.split('\n').map((line, i) => (
                        <p key={i} className={i > 0 ? 'text-xs text-muted-foreground/70 mt-1' : ''}>{line}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {agent.state === AgentState.ERROR && (
              <div className="text-center py-8 px-4">
                <div className="flex flex-col items-center space-y-4">
                  <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                    <span className="text-2xl">⚠️</span>
                  </div>
                  <div className="space-y-2">
                    <p className="text-destructive font-medium">Agent Failed to Start</p>
                    {agent.errorMessage && (
                      <p className="text-sm text-muted-foreground">{agent.errorMessage}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      ) : viewMode === 'diffs' ? (
        <div className="p-2 overflow-y-auto w-full flex-1 min-h-0 flex flex-col items-center relative">
          <div className="flex flex-col mt-44 mb-6 w-full items-center">
            <DiffView
              diffData={diffData}
              sendPrompt={handleSendPrompt}
              interruptAgent={interruptAgent}
              canInterrupt={canInterrupt}
              canSendPrompts={canSendPrompts}
              onCreateAgentWithPrompt={onCreateAgentWithPrompt}
            />
          </div>
          <FloatingChatPrompt
            viewMode="diffs"
            sendPrompt={handleSendPrompt}
            interruptAgent={interruptAgent}
            canInterrupt={canInterrupt}
            canSendPrompts={canSendPrompts}
          />
        </div>
      ) : viewMode === 'desktop' ? (
        <div className="flex-1 min-h-0 pt-12 flex flex-col relative">
          <DesktopView agentId={agent.id} />
          <FloatingChatPrompt
            viewMode="desktop"
            sendPrompt={handleSendPrompt}
            interruptAgent={interruptAgent}
            canInterrupt={canInterrupt}
            canSendPrompts={canSendPrompts}
          />
        </div>
      ) : viewMode === 'web-previews' ? (
        <div className="flex-1 min-h-0 pt-12 flex flex-col relative">
          <WebPreviewsView
            previewablePorts={previewablePorts}
            onActivePortChange={setActivePreviewPort}
          />
          <FloatingChatPrompt
            viewMode="web-previews"
            sendPrompt={handleSendPrompt}
            interruptAgent={interruptAgent}
            canInterrupt={canInterrupt}
            canSendPrompts={canSendPrompts}
            activePreviewInfo={activePreviewPort ? `localhost:${activePreviewPort}` : undefined}
          />
        </div>
      ) : null}
      <div ref={canSendPrompts ? div3Ref : undefined} className={cn(
        "flex flex-col items-center w-full",
        inputMaximized ? "absolute top-0 left-0 h-full" : ""
      )}>
        {/* Input Area */}
        {canSendPrompts && viewMode !== 'desktop' && viewMode !== 'diffs' && viewMode !== 'web-previews' ? (
          <PromptInputComponent
            agent={agent}
            projectWorkspace={projectWorkspace}
            sendPrompt={handleSendPrompt}
            sending={sending}
            isLoading={isLoading}
            canInterrupt={canInterrupt}
            interruptAgent={interruptAgent}
            resetAgent={resetAgent}
            mentionSuggestions={mentionSuggestions}
            handleAddMentionToInput={handleAddMentionToInput}
            refetchEvents={refetchEvents}
            hasUnpushedCommits={hasUnpushedCommits}
            hasUncommittedChanges={hasUncommittedChanges}
            maximized={inputMaximized}
            setMaximized={setInputMaximized}
            eventsCount={eventsCount}
            hasWriteAccess={hasWriteAccess}
            prompt={prompt}
            setPrompt={setPrompt}
            onTabInteracted={markInteracted}
            isFocused={isFocused}
          />
        ) : (
          <div className="h-10"></div>
        )}
                {/* Stopped agent banner */}
        {agent.state === AgentState.ARCHIVED && (
          <div className="flex items-center justify-center gap-3 opacity-50 hover:opacity-100 px-4 py-2 text-sm text-muted-foreground">
            <span className='text-xs'>The agent's computer was stopped. Its disk was backed up.</span>
            <StoppedAgentResumeButton agentId={agent.id} />
          </div>
        )}
      </div>
    </>
  );

  return (
    <div ref={parentRef} className="relative flex h-full w-full md:border-2 md:border-t-0 border-lightest dark:border-background-darker box-border overflow-hidden">
      {canUseTerminals && isTerminalOpen && terminalPosition === 'right' ? (
        <ResizablePanelGroup direction="horizontal" >
          <ResizablePanel defaultSize={60} minSize={4} collapsible collapsedSize={0}>
            <div className="flex flex-col px-4 h-full">
              {chatContent}
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle className='bg-transparent border-transparent' />
          <ResizablePanel defaultSize={40} minSize={4} collapsible collapsedSize={0}>
            <div className="mt-14 h-full">
              <BottomTerminalPanel
                agentId={agent.id}
                isOpen={isTerminalOpen}
                onClose={() => setIsTerminalOpen(false)}
                vertical={true}
                onTogglePosition={handleToggleTerminalPosition}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="flex flex-col h-full w-full">
          {canUseTerminals && isTerminalOpen && terminalPosition === 'bottom' ? (
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={60} minSize={5} collapsible collapsedSize={5} >
                <div className="flex flex-col px-4 h-full">
                  {chatContent}
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={40} minSize={5} collapsible collapsedSize={0}>
                <BottomTerminalPanel
                  agentId={agent.id}
                  isOpen={isTerminalOpen}
                  onClose={() => setIsTerminalOpen(false)}
                  vertical={false}
                  onTogglePosition={handleToggleTerminalPosition}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <div className="flex flex-col px-0 md:px-2.5 h-full">
              {chatContent}
            </div>
          )}
        </div>
      )}
      <TipDialog
        tip={randomTip}
        open={tipDialogOpen}
        onOpenChange={setTipDialogOpen}
      />
    </div>
  );
}