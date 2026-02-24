export type MachineType = 'cx43';

export type MachineSource = 'hetzner' | 'custom';

export interface MachineConfig {
  machine: MachineType;
  machineSource?: MachineSource;  // 'hetzner' (default) or 'custom'
  customMachineId?: string;       // Required when machineSource is 'custom'
}

export interface MachineSpec {
  type: MachineType;
  label: string;
  specs: string;
  os: string;
}

export const MACHINE_SPECS: MachineSpec[] = [
  {
    type: 'cx43',
    label: 'Cloud VPS',
    specs: '2 shared vCPU, 4GB RAM, 40 GB NVME SSD',
    os: 'Linux (Ubuntu)',
  },
];
