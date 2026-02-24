import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Loader2, Trash2, Plus, Copy, Check, Circle, AlertCircle } from 'lucide-react';
import { machinesService, type CustomMachine } from '@/services/machines.service';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import Clock from './ui/icons/Clock';
import { SelectGroupRoot, SelectGroupOption } from '@/components/ui/select-group';
import { useAppStore } from '@/stores/useAppStore';

interface MachinesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MachinesDialog({ open, onOpenChange }: MachinesDialogProps) {
  const [machines, setMachines] = useState<CustomMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingMachine, setAddingMachine] = useState(false);
  const [installCommand, setInstallCommand] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [deletingMachineId, setDeletingMachineId] = useState<string | null>(null);
  const [machineCountBeforeAdd, setMachineCountBeforeAdd] = useState(0);

  // OS preference from store
  const machineInstallOS = useAppStore((state) => state.machineInstallOS);
  const setMachineInstallOS = useAppStore((state) => state.setMachineInstallOS);

  // Compute the display command based on selected OS
  // Backend returns command with "sudo bash", we adjust based on OS
  const displayCommand = useMemo(() => {
    if (!installCommand) return null;
    if (machineInstallOS === 'macos') {
      // macOS doesn't need sudo for the bash part
      return installCommand.replace('| sudo bash -s --', '| bash -s --');
    }
    // Linux keeps sudo
    return installCommand;
  }, [installCommand, machineInstallOS]);

  // Load machines on dialog open
  useEffect(() => {
    if (open) {
      loadMachines();
    }
  }, [open]);

  // Poll for health checks every 5 seconds while dialog is open
  useEffect(() => {
    if (!open) return;

    const healthCheckInterval = setInterval(async () => {
      try {
        const response = await machinesService.checkMachinesHealth();
        setMachines(response.machines);
      } catch (error) {
        console.error('Failed to check machines health:', error);
      }
    }, 5000);

    return () => clearInterval(healthCheckInterval);
  }, [open]);

  // Poll for new machines when install command is shown (faster polling)
  useEffect(() => {
    if (!installCommand) return;

    // Poll every 3 seconds when waiting for new machine
    const pollInterval = setInterval(async () => {
      try {
        const response = await machinesService.checkMachinesHealth();
        setMachines(response.machines);

        // Check if new machine was added
        if (response.machines.length > machineCountBeforeAdd) {
          // New machine detected! Clear install command UI
          setInstallCommand(null);
          setToken(null);
          setTokenExpiresAt(null);
          setCopiedCommand(false);
          setCopiedToken(false);
          clearInterval(pollInterval);
        }
      } catch (error) {
        console.error('Failed to poll machines:', error);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [installCommand, machineCountBeforeAdd]);

  const loadMachines = async () => {
    try {
      setLoading(true);
      const response = await machinesService.getMachines();
      setMachines(response.machines);
    } catch (error) {
      console.error('Failed to load machines:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMachine = async () => {
    try {
      setAddingMachine(true);
      // Capture current machine count
      setMachineCountBeforeAdd(machines.length);
      const response = await machinesService.generateRegistrationToken();
      setInstallCommand(response.installCommand);
      setToken(response.token);
      setTokenExpiresAt(response.expiresAt);
    } catch (error) {
      console.error('Failed to generate token:', error);
    } finally {
      setAddingMachine(false);
    }
  };

  const handleCopyCommand = async () => {
    if (displayCommand) {
      await navigator.clipboard.writeText(displayCommand);
      setCopiedCommand(true);
      setTimeout(() => setCopiedCommand(false), 2000);
    }
  };

  const handleCopyToken = async () => {
    if (token) {
      await navigator.clipboard.writeText(token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  const handleDeleteMachine = async (machineId: string) => {
    try {
      setDeletingMachineId(machineId);
      await machinesService.deleteMachine(machineId);
      // Reload machines list
      await loadMachines();
      // Clear installation command if shown
      setInstallCommand(null);
      setToken(null);
      setTokenExpiresAt(null);
      setCopiedCommand(false);
      setCopiedToken(false);
    } catch (error) {
      console.error('Failed to delete machine:', error);
      alert('Failed to delete machine. It might be in use by an agent.');
    } finally {
      setDeletingMachineId(null);
    }
  };

  const getStatusColor = (status: CustomMachine['status']) => {
    switch (status) {
      case 'online':
        return 'text-green-500';
      case 'offline':
        return 'text-gray-400';
      case 'in_use':
        return 'text-blue-500';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusLabel = (status: CustomMachine['status']) => {
    switch (status) {
      case 'online':
        return 'Available';
      case 'offline':
        return 'Offline';
      case 'in_use':
        return 'In Use';
      default:
        return 'Unknown';
    }
  };

  const formatLastSeen = (lastSeenAt: string) => {
    const date = new Date(lastSeenAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-2 flex flex-col w-[70ch] max-w-[97%] max-h-[90svh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pl-2">
            <div>Custom Machines</div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5 p-2 lg:p-4 overflow-y-auto overflow-x-hidden w-full">
          {/* Add Machine Section */}
          {!installCommand ? (
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium">Add New Machine</Label>
              <Button
                variant="default"
                onClick={handleAddMachine}
                disabled={addingMachine}
                className="w-full"
              >
                {addingMachine ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Machine
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-4 bg-muted/20 rounded-lg border border-border">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Installation Instructions</Label>
                <Button
                  variant="transparent"
                  size="sm"
                  onClick={() => {
                    setInstallCommand(null);
                    setToken(null);
                    setTokenExpiresAt(null);
                    setCopiedCommand(false);
                    setCopiedToken(false);
                  }}
                >
                  Cancel
                </Button>
              </div>

              {/* Installation Command */}
              <div className="flex flex-col gap-2">
                {/* OS Selector */}
                <SelectGroupRoot
                  className="w-fit"
                  rounded={false}
                  value={machineInstallOS}
                  onValueChange={(value) => setMachineInstallOS(value as 'linux' | 'macos')}
                  orientation="horizontal"
                >
                  <SelectGroupOption value="linux" className="h-6">Linux</SelectGroupOption>
                  <SelectGroupOption value="macos" className="h-6">macOS</SelectGroupOption>
                </SelectGroupRoot>

                <p className="text-xs text-muted-foreground">
                  Run this command on your {machineInstallOS === 'linux' ? 'Linux' : 'macOS'} machine to install the Ariana agent server on it:
                </p>

                <div className="relative">
                  <Input
                    value={displayCommand || ''}
                    readOnly
                    className="font-mono text-xs pr-20"
                  />
                  <div className='absolute right-1 top-1/2 -translate-y-1/2'>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleCopyCommand}
                    >
                      {copiedCommand ? (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 mr-1" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {tokenExpiresAt && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3">
                    <Clock className="max-h-full max-w-full text-inherit" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Token expires in {Math.floor((new Date(tokenExpiresAt).getTime() - Date.now()) / 60000)} minutes
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground animate-pulse">
                Waiting for the machine to be connected...
              </p>
              <Button variant="default" size="sm" onClick={loadMachines}>
                Refresh List
              </Button>
            </div>
          )}

          {/* Machines List */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">
              Your Machines ({machines.length})
            </Label>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : machines.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                <p className="text-sm">No machines added yet</p>
                <p className="text-xs">Click "Add Machine" to get started</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {machines.map((machine) => (
                  <div
                    key={machine.id}
                    className="flex flex-col gap-2 p-3 bg-muted/10 rounded-lg border border-border hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Circle className={cn('h-2 w-2 fill-current', getStatusColor(machine.status))} />
                          <span className="font-medium text-sm">{machine.name}</span>
                          <Badge variant="secondary" className="text-xs">
                            {getStatusLabel(machine.status)}
                          </Badge>
                        </div>
                        <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                          <div>{machine.ipv4}</div>
                          <div>{machine.os} • {machine.arch}</div>
                          <div>{machine.cpuCount} CPU cores • {machine.memoryGB}GB RAM</div>
                          {machine.status !== 'online' && (
                            <div>Last seen: {formatLastSeen(machine.lastSeenAt)}</div>
                          )}
                          {machine.currentAgent && (
                            <div className="flex items-center gap-1 text-blue-500">
                              <AlertCircle className="h-3 w-3" />
                              In use by agent: {machine.currentAgent.name}
                            </div>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="default"
                        size="icon"
                        onClick={() => handleDeleteMachine(machine.id)}
                        disabled={deletingMachineId === machine.id}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        {deletingMachineId === machine.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
