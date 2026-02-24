import { TerminalService } from '@/terminal/TerminalService';
import { create } from 'zustand';
import { posthog } from '@/lib/posthog';

interface Terminal {
  id: string;
  agentId: string;
  initialCommand?: string;
}

interface TerminalStore {
  terminals: Terminal[];
  activeTerminalIds: Record<string, string | null>; // agentId -> terminalId
  terminalPanelOpen: Record<string, boolean>; // agentId -> isOpen
  creatingTerminalForAgent: Record<string, boolean>; // agentId -> isCreating (prevents duplicate creation)
  createTerminal: (agentId: string, initialCommand?: string) => string;
  deleteTerminal: (terminalId: string) => Promise<void>;
  setActiveTerminal: (agentId: string, terminalId: string | null) => void;
  setTerminalPanelOpen: (agentId: string, isOpen: boolean) => void;
  getActiveTerminalId: (agentId: string) => string | null;
  isTerminalPanelOpen: (agentId: string) => boolean;
  clearAll: () => Promise<void>;
  clearAgentTerminals: (agentId: string) => Promise<void>;
  setCreatingTerminal: (agentId: string, isCreating: boolean) => void;
  isCreatingTerminal: (agentId: string) => boolean;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  terminals: [],
  activeTerminalIds: {},
  terminalPanelOpen: {},
  creatingTerminalForAgent: {},

  createTerminal: (agentId: string, initialCommand?: string) => {
    const randomId = Math.random().toString(36).substr(2, 9);
    const terminalCount = get().terminals.filter(t => t.agentId === agentId).length;
    posthog.capture('terminal_created', {
      agent_id: agentId,
      has_initial_command: Boolean(initialCommand),
      terminal_count_for_agent: terminalCount + 1
    });
    set(prev => ({
      terminals: [...prev.terminals, { id: randomId, agentId, initialCommand }]
    }));
    return randomId;
  },

  deleteTerminal: async (terminalId: string) => {
    const terminal = get().terminals.find(t => t.id === terminalId);
    await TerminalService.closeConnectionByTerminalId(terminalId);

    set(prev => {
      const newActiveTerminalIds = { ...prev.activeTerminalIds };
      if (terminal && newActiveTerminalIds[terminal.agentId] === terminalId) {
        newActiveTerminalIds[terminal.agentId] = null;
      }

      return {
        terminals: prev.terminals.filter(t => t.id !== terminalId),
        activeTerminalIds: newActiveTerminalIds
      };
    });
  },

  setActiveTerminal: (agentId: string, terminalId: string | null) => {
    set(prev => ({
      activeTerminalIds: { ...prev.activeTerminalIds, [agentId]: terminalId }
    }));
  },

  setTerminalPanelOpen: (agentId: string, isOpen: boolean) => {
    const terminalCount = get().terminals.filter(t => t.agentId === agentId).length;
    posthog.capture(isOpen ? 'terminal_panel_opened' : 'terminal_panel_closed', {
      agent_id: agentId,
      terminal_count: terminalCount
    });
    set(prev => ({
      terminalPanelOpen: { ...prev.terminalPanelOpen, [agentId]: isOpen }
    }));
  },

  getActiveTerminalId: (agentId: string) => {
    return get().activeTerminalIds[agentId] || null;
  },

  isTerminalPanelOpen: (agentId: string) => {
    return get().terminalPanelOpen[agentId] || false;
  },

  clearAll: async () => {
    for (const terminal of get().terminals) {
      await TerminalService.closeConnectionByTerminalId(terminal.id);
    }
    set({ terminals: [], activeTerminalIds: {}, terminalPanelOpen: {}, creatingTerminalForAgent: {} });
  },

  clearAgentTerminals: async (agentId: string) => {
    const terminalsToClose = get().terminals.filter(t => t.agentId === agentId);
    for (const terminal of terminalsToClose) {
      await TerminalService.closeConnectionByTerminalId(terminal.id);
    }

    set(prev => {
      const newActiveTerminalIds = { ...prev.activeTerminalIds };
      const newTerminalPanelOpen = { ...prev.terminalPanelOpen };
      const newCreatingTerminalForAgent = { ...prev.creatingTerminalForAgent };
      delete newActiveTerminalIds[agentId];
      delete newTerminalPanelOpen[agentId];
      delete newCreatingTerminalForAgent[agentId];

      return {
        terminals: prev.terminals.filter(t => t.agentId !== agentId),
        activeTerminalIds: newActiveTerminalIds,
        terminalPanelOpen: newTerminalPanelOpen,
        creatingTerminalForAgent: newCreatingTerminalForAgent
      };
    });
  },

  setCreatingTerminal: (agentId: string, isCreating: boolean) => {
    set(prev => ({
      creatingTerminalForAgent: { ...prev.creatingTerminalForAgent, [agentId]: isCreating }
    }));
  },

  isCreatingTerminal: (agentId: string) => {
    return get().creatingTerminalForAgent[agentId] || false;
  }
}));