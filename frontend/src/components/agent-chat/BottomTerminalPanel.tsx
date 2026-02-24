import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Terminal as TerminalIcon, PanelBottom, PanelRight } from 'lucide-react';
import TerminalComponent from "@/terminal/TerminalComponent";
import { useTerminalStore } from '@/hooks/useTerminalStore';
import { useAppStore } from '@/stores/useAppStore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import TerminalUse from '../ui/icons/TerminalUse';
import { uploadSSHKeyAndGetIP } from '@/services/agent.service';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface BottomTerminalPanelProps {
  agentId: string;
  isOpen: boolean;
  onClose: () => void;
  vertical?: boolean;
  onTogglePosition?: () => void;
}

export function BottomTerminalPanel({ agentId, isOpen, onClose, vertical = false, onTogglePosition }: BottomTerminalPanelProps) {

  const allTerminals = useTerminalStore(state => state.terminals);
  const currentAgentTerminals = allTerminals.filter(t => t.agentId === agentId);
  const activeTerminalIds = useTerminalStore(state => state.activeTerminalIds);
  const createTerminal = useTerminalStore(state => state.createTerminal);
  const deleteTerminal = useTerminalStore(state => state.deleteTerminal);
  const setActiveTerminal = useTerminalStore(state => state.setActiveTerminal);
  const setCreatingTerminal = useTerminalStore(state => state.setCreatingTerminal);
  const isCreatingTerminal = useTerminalStore(state => state.isCreatingTerminal);

  const activeTerminalId = activeTerminalIds[agentId] || null;

  // Reset active terminal when agent changes or terminals list changes
  useEffect(() => {
    if (currentAgentTerminals.length > 0) {
      // Check if current activeTerminalId is valid for this agent
      const isActiveTerminalValid = currentAgentTerminals.some(t => t.id === activeTerminalId);
      if (!isActiveTerminalValid) {
        // Switch to first terminal of this agent
        setActiveTerminal(agentId, currentAgentTerminals[0].id);
      }
    } else {
      // No terminals for this agent, clear active terminal
      if (activeTerminalId !== null) {
        setActiveTerminal(agentId, null);
      }
    }
  }, [agentId, currentAgentTerminals.length, activeTerminalId]);

  // Create initial terminal if none exist when opening
  useEffect(() => {
    if (isOpen && currentAgentTerminals.length === 0 && !isCreatingTerminal(agentId)) {
      setCreatingTerminal(agentId, true);
      handleAddTerminal();
      // Reset the flag after a short delay to allow the terminal to be added to the store
      setTimeout(() => setCreatingTerminal(agentId, false), 1000);
    } else if (!isOpen) {
      // Reset the flag when panel closes
      setCreatingTerminal(agentId, false);
    }
  }, [isOpen, currentAgentTerminals.length, agentId]);

  const handleAddTerminal = async () => {
    // Always upload SSH key before creating terminal to ensure key is up-to-date
    try {
      await uploadSSHKeyAndGetIP(agentId);
    } catch (error) {
      console.error(`[BottomTerminalPanel] Failed to upload SSH key for agent ${agentId}:`, error);
      // Continue anyway - maybe the key is already there
    }

    const machineIP = useAppStore.getState().getMachineIP(agentId);
    const sshUser = useAppStore.getState().getSSHUser(agentId) || 'ariana'; // Default to 'ariana' for backward compatibility
    const initialCommand = machineIP
      ? `ssh -i ~/.ssh/ariana_id_ed25519 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -t ${sshUser}@${machineIP} "cd ~/project && exec bash"`
      : undefined;

    const terminalId = createTerminal(agentId, initialCommand);
    setActiveTerminal(agentId, terminalId);
  };

  const handleCloseTerminal = async (terminalId: string) => {
    await deleteTerminal(terminalId);

    // If this was the active tab and there are remaining terminals, switch to first one
    if (activeTerminalId === terminalId && currentAgentTerminals.length > 1) {
      const remainingTerminal = currentAgentTerminals.find(t => t.id !== terminalId);
      if (remainingTerminal) {
        setActiveTerminal(agentId, remainingTerminal.id);
      }
    }

    // If no more terminals for this agent, close the panel
    if (currentAgentTerminals.length <= 1) {
      onClose();
    }
  };

  const handleTabClick = (terminalId: string) => {
    setActiveTerminal(agentId, terminalId);
  };

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "flex flex-col bg-lightest dark:bg-background-darker overflow-hidden relative h-full w-full",
        !vertical && "",
        vertical && ""
      )}
      style={{ height: !vertical ? "100%" : "calc(100% - 38px)" }}
    >

      {/* Tab Bar */}
      <div className="flex items-center justify-between h-10 p-1 w-full">
        {/* Add Terminal Button */}
        <button
          onClick={handleAddTerminal}
          className="flex items-center gap-1.5 rounded-md px-2 h-full hover:bg-secondary/50 transition-colors text-muted-foreground hover:text-foreground text-xs"
        >
          <Plus className="h-4 w-4" />
        </button>
        <div style={{ width: 'calc(100% - 119px)' }} className="flex gap-1 items-center h-full overflow-x-auto">
          {currentAgentTerminals.map((terminal, index) => (
            <div
              key={terminal.id}
              className={cn(
                "group flex items-center h-full relative min-w-fit",
                index > 0 && ""
              )}
            >
              <button
                onClick={() => handleTabClick(terminal.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 rounded-md pr-8 h-full hover:bg-secondary/50 transition-colors text-xs",
                  activeTerminalId === terminal.id
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <div className="w-4 h-4">
                  <TerminalUse className="max-w-full max-h-full text-inherit" />
                </div>
                <span className='px-3'>Term {index + 1}</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTerminal(terminal.id);
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 hover:bg-destructive/10 hover:text-destructive transition-colors text-muted-foreground rounded-sm"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex h-full">
          {/* Toggle Position Button */}
          {onTogglePosition && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onTogglePosition}
                  className="flex items-center rounded-md justify-center px-2 h-full hover:bg-secondary/50 transition-colors text-muted-foreground"
                >
                  {vertical ? <PanelBottom className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{vertical ? "Move to bottom" : "Move to right"}</TooltipContent>
            </Tooltip>
          )}

          {/* Close Panel Button */}
          <button
            onClick={onClose}
            className="flex items-center rounded-md justify-center px-2 h-full hover:bg-destructive/10 hover:text-destructive transition-colors text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Terminal Content - Render all terminals to prevent unmounting */}
      <div className="flex-1 relative">
        {allTerminals.map((terminal) => {
          const isCurrentAgent = terminal.agentId === agentId;
          const isActive = terminal.id === activeTerminalId;
          const shouldShow = isCurrentAgent && isActive;

          return (
            <div
              key={terminal.id}
              className="absolute inset-0"
              style={{
                display: shouldShow ? 'block' : 'none',
                zIndex: shouldShow ? 1 : 0
              }}
            >
              <TerminalComponent
                terminalId={terminal.id}
                initialCommand={terminal.initialCommand}
                className="h-full"
                isVisible={shouldShow}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}