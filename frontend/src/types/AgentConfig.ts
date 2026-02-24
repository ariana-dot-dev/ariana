import type { MachineConfig } from '@/bindings/types';

export type AgentSource =
  | { from: 'local' }
  | { from: 'branch'; branch: string }
  | { from: 'clone-url'; url: string; branch: string };

export type AgentProvider = 'claude-code' | 'codex' | 'cursor' | 'amp';

export interface AgentConfig {
  source: AgentSource;
  machine: MachineConfig;
  provider: AgentProvider;
  environmentId?: string | null;
}
