export type SidebarTabs = 'agents' | 'environments' | 'automations';
export type BodyTab = {
  type: 'agent',
  agentId: string,
} | {
  type: 'environment',
  environmentId: string | null,
} | {
  type: 'automation',
  automationId: string | null,
  forEnvironmentId?: string, // Optional: if creating automation from an environment, auto-install on save
}
export type BodyTabs = BodyTab[];