import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Plus, Trash2, Check, Play, Key, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PersonalEnvironment, EnvironmentSecretFile, SshKeyPair } from '@/hooks/useEnvironments';
import { getTauriAPI } from '@/lib/tauri-api';
import { useIsBrowser } from '@/hooks/useIsBrowser';
import { validateSecretFilePath } from '@/utils/secretPathValidation';
import { validateEnvironmentJSON } from '@/utils/validateEnvironmentJSON';
import { JsonEditor } from './JsonEditor';
import { EnvEditor } from './EnvEditor';
import { useAppStore } from '@/stores/useAppStore';
import { useEnvironmentEditorState } from '@/hooks/useEnvironmentEditorState';
import { useAutomationsStore } from '@/hooks/useAutomations';
import { SaveErrorDialog } from '@/components/SaveErrorDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface EnvironmentEditorProps {
  environment?: PersonalEnvironment;
  projectId: string;
  onBack: () => void;
  onSave: (name: string, envContents: string, secretFiles: EnvironmentSecretFile[], automationIds?: string[], sshKeyPair?: SshKeyPair | null) => Promise<void> | void;
  onDiscard: () => void;
  isFocused?: boolean;
  onCreateAutomation?: (environmentId: string) => void;
  onEditAutomation?: (automationId: string) => void;
  onUninstallAutomation?: (automationId: string, environmentId: string) => void;
  onInstallAutomation?: (automationId: string, environmentId: string) => void;
  availableAutomations?: Array<{ id: string; name: string; trigger: { type: string }; scriptLanguage: string }>;
  onGenerateSshKey?: () => Promise<SshKeyPair>;
}

interface SecretFileEdit {
  path: string;
  contents: string;
}

export function EnvironmentEditor({
  environment,
  projectId,
  onBack,
  onSave,
  onDiscard,
  isFocused = true,
  onCreateAutomation,
  onEditAutomation,
  onUninstallAutomation,
  onInstallAutomation,
  availableAutomations = [],
  onGenerateSshKey
}: EnvironmentEditorProps) {
  const editorMode = useAppStore(state => state.environmentEditorMode);
  const setEditorMode = useAppStore(state => state.setEnvironmentEditorMode);
  const isBrowser = useIsBrowser();

  // Use the hook for all draft state management
  const {
    name,
    envContents,
    secretFiles,
    sshKeyPair,
    automationIds,
    updateName,
    updateEnvContents,
    updateSecretFiles,
    updateSshKeyPair,
    updateAutomationIds,
    updateFromRawJson,
    save,
    discard
  } = useEnvironmentEditorState(projectId, environment?.id || null, environment);

  // UI-only state
  const [expandedSecretFiles, setExpandedSecretFiles] = useState<Set<number>>(new Set());
  const [availableSshKeys, setAvailableSshKeys] = useState<Array<{ name: string; publicKeyPath: string; privateKeyPath: string; keyType: string }>>([]);
  const [filteredSshKeys, setFilteredSshKeys] = useState<Array<{ name: string; publicKeyPath: string; privateKeyPath: string; keyType: string }>>([]);
  const [sshKeySearchTerm, setSshKeySearchTerm] = useState('');
  const [isSshKeyDropdownOpen, setIsSshKeyDropdownOpen] = useState(false);
  const [isLoadingSshKeys, setIsLoadingSshKeys] = useState(false);
  const [isGeneratingSshKey, setIsGeneratingSshKey] = useState(false);
  const [automationSearchTerm, setAutomationSearchTerm] = useState('');
  const [isAutomationDropdownOpen, setIsAutomationDropdownOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load available SSH keys from system (Desktop only)
  useEffect(() => {
    if (!isBrowser) {
      loadAvailableSshKeys();
    }
  }, [isBrowser]);

  const loadAvailableSshKeys = async () => {
    setIsLoadingSshKeys(true);
    try {
      const tauriAPI = getTauriAPI();
      const keys = await tauriAPI.listAvailableSshKeys();
      setAvailableSshKeys(keys || []);
      setFilteredSshKeys(keys || []);
    } catch (error) {
      console.error('Failed to load SSH keys:', error);
      setAvailableSshKeys([]);
      setFilteredSshKeys([]);
    } finally {
      setIsLoadingSshKeys(false);
    }
  };

  // Filter SSH keys based on search term
  useEffect(() => {
    if (!sshKeySearchTerm.trim()) {
      setFilteredSshKeys(availableSshKeys);
    } else {
      const filtered = availableSshKeys.filter(key =>
        key.name?.toLowerCase().includes(sshKeySearchTerm.toLowerCase()) ||
        key.keyType?.toLowerCase().includes(sshKeySearchTerm.toLowerCase())
      );
      setFilteredSshKeys(filtered);
    }
  }, [sshKeySearchTerm, availableSshKeys]);

  // Filter automations - show only those not already selected/installed
  const uninstalledAutomations = useMemo(() => {
    const installedIds = new Set(
      environment?.id
        ? (environment.automations?.map(a => a.id) || [])
        : automationIds
    );
    return availableAutomations.filter(a => !installedIds.has(a.id));
  }, [availableAutomations, environment?.automations, environment?.id, automationIds]);

  // Filter automations by search term
  const filteredAutomations = useMemo(() => {
    if (!automationSearchTerm.trim()) {
      return uninstalledAutomations;
    }
    return uninstalledAutomations.filter(automation =>
      automation.name.toLowerCase().includes(automationSearchTerm.toLowerCase()) ||
      automation.trigger.type.toLowerCase().includes(automationSearchTerm.toLowerCase()) ||
      automation.scriptLanguage.toLowerCase().includes(automationSearchTerm.toLowerCase())
    );
  }, [automationSearchTerm, uninstalledAutomations]);

  // Get list of selected automations for display
  const selectedAutomations = useMemo(() => {
    return availableAutomations.filter(a => automationIds.includes(a.id));
  }, [availableAutomations, automationIds]);

  // Create name->id mapping for automations (used to reconstruct IDs from raw JSON)
  const automationNameToIdMap = useMemo(() => {
    const map = new Map<string, string>();
    selectedAutomations.forEach(a => {
      map.set(a.name, a.id);
    });
    return map;
  }, [selectedAutomations]);

  // Compute JSON value from current state (for JSON mode)
  // Shows automations WITHOUT IDs and extra fields for portability
  const jsonValue = useMemo(() => {
    const data: any = {
      name,
      envContents,
      secretFiles: secretFiles.map(sf => ({
        path: sf.path,
        contents: sf.contents
      }))
    };
    if (sshKeyPair) {
      data.sshKeyPair = sshKeyPair;
    }

    // Get automations from environment if it exists, otherwise use selectedAutomations
    const automationsToShow = environment?.id ? environment.automations : selectedAutomations;

    if (automationsToShow && automationsToShow.length > 0) {
      data.automations = automationsToShow.map(automation => ({
        name: automation.name,
        trigger: automation.trigger,
        scriptLanguage: automation.scriptLanguage,
        scriptContent: automation.scriptContent,
        blocking: automation.blocking,
        feedOutput: automation.feedOutput
      }));
    }
    return JSON.stringify(data, null, 2);
  }, [name, envContents, secretFiles, sshKeyPair, selectedAutomations, environment]);

  // Handle raw JSON changes with automation mapping
  const handleRawJsonChange = useCallback((rawJson: string) => {
    try {
      const parsed = JSON.parse(rawJson);

      // Map automations from raw JSON back to IDs and detect changes
      const automationsFromJson = parsed.automations || [];
      const currentAutomationIds = automationIds;

      const mappedAutomationIds: string[] = [];
      const toUninstall: string[] = [];
      const toUpdate: Array<{ id: string; data: any }> = [];
      const toCreate: any[] = [];

      // Process automations from JSON
      automationsFromJson.forEach((auto: any) => {
        // Try to find existing automation in THIS environment by name
        const existingId = automationNameToIdMap.get(auto.name);

        if (existingId) {
          // Known automation that was already installed
          mappedAutomationIds.push(existingId);

          // Check if it was modified (we'll update it)
          const originalAuto = selectedAutomations.find(a => a.id === existingId);
          if (originalAuto) {
            // Deep compare to see if changed
            const { id: _id, ...originalData } = originalAuto;
            const changed = JSON.stringify(originalData) !== JSON.stringify(auto);
            if (changed) {
              toUpdate.push({ id: existingId, data: auto });
            }
          }
        } else {
          // Check if automation exists in project but not installed to this env
          const existingInProject = availableAutomations.find(a => a.name === auto.name);
          if (existingInProject) {
            // Exists in project, just install it
            mappedAutomationIds.push(existingInProject.id);
          } else {
            // Completely new automation - create it
            toCreate.push(auto);
          }
        }
      });

      // Find automations that were removed (were installed before, not in JSON now)
      currentAutomationIds.forEach(id => {
        if (!mappedAutomationIds.includes(id)) {
          toUninstall.push(id);
        }
      });

      // Update draft with changes
      useAppStore.getState().setEnvironmentDraft(projectId, environment?.id || 'new', {
        name: parsed.name || '',
        envContents: parsed.envContents || '',
        secretFiles: parsed.secretFiles || [],
        sshKeyPair: parsed.sshKeyPair || null,
        automationIds: mappedAutomationIds,
        pendingAutomationChanges: {
          toUninstall,
          toUpdate,
          toCreate
        }
      });
    } catch (e) {
      // Invalid JSON, ignore
    }
  }, [automationIds, automationNameToIdMap, selectedAutomations, availableAutomations, projectId, environment?.id]);

  // Handle mode toggle
  const handleToggleMode = () => {
    if (editorMode === 'form') {
      setEditorMode('json');
    } else {
      const validation = validateEnvironmentJSON(jsonValue);
      if (validation.isValid) {
        setEditorMode('form');
      } else {
        alert(`Cannot switch to form mode: ${validation.error}`);
      }
    }
  };

  const handleSave = useCallback(async () => {
    try {
      // First, handle pending automation changes from raw JSON editing
      const draft = useAppStore.getState().getEnvironmentDraft(projectId, environment?.id || 'new');
      const changes = draft?.pendingAutomationChanges;

      // Save the environment first
      await save(onSave);

      // If there are automation changes and this is an existing environment, apply them
      if (changes && environment?.id) {
        // 1. Create new automations
        for (const autoData of changes.toCreate) {
          const newAuto = await useAutomationsStore.getState().createAutomation(projectId, autoData);
          if (newAuto && onInstallAutomation) {
            await onInstallAutomation(newAuto.id, environment.id);
          }
        }

        // 2. Update existing automations
        for (const { id, data } of changes.toUpdate) {
          await useAutomationsStore.getState().updateAutomation(projectId, id, data);
        }

        // 3. Uninstall removed automations
        for (const autoId of changes.toUninstall) {
          if (onUninstallAutomation) {
            await onUninstallAutomation(autoId, environment.id);
          }
        }
      }

      setEditorMode('form');
    } catch (error) {
      console.error('[EnvironmentEditor] Save failed:', error);
      setSaveError(error instanceof Error ? error.message : 'An unexpected error occurred');
    }
  }, [save, onSave, setEditorMode, projectId, environment, onInstallAutomation, onUninstallAutomation]);

  // Handle Ctrl+S to save - ONLY when this tab is focused
  useEffect(() => {
    if (!isFocused) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (name.trim()) {
          handleSave();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, isFocused, name]);

  const handleAddSecretFile = () => {
    const newSecret: SecretFileEdit = {
      path: '',
      contents: ''
    };
    updateSecretFiles([...secretFiles, newSecret]);
    // Auto-expand the new secret file
    setExpandedSecretFiles(new Set([...expandedSecretFiles, secretFiles.length]));
  };

  const handleUpdateSecretFile = (index: number, updates: Partial<Pick<SecretFileEdit, 'path' | 'contents'>>) => {
    const newSecretFiles = [...secretFiles];
    newSecretFiles[index] = { ...newSecretFiles[index], ...updates };
    updateSecretFiles(newSecretFiles);
  };

  const handleDeleteSecretFile = (index: number) => {
    const newSecretFiles = secretFiles.filter((_, i) => i !== index);
    updateSecretFiles(newSecretFiles);
    // Clean up expanded state
    const newExpanded = new Set(expandedSecretFiles);
    newExpanded.delete(index);
    // Adjust indices for items after the deleted one
    const adjustedExpanded = new Set<number>();
    newExpanded.forEach(i => {
      if (i > index) {
        adjustedExpanded.add(i - 1);
      } else {
        adjustedExpanded.add(i);
      }
    });
    setExpandedSecretFiles(adjustedExpanded);
  };

  const toggleSecretFileExpanded = (index: number) => {
    const newExpanded = new Set(expandedSecretFiles);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedSecretFiles(newExpanded);
  };

  const handleSelectSshKey = async (keyName: string) => {
    if (keyName === 'none') {
      updateSshKeyPair(null);
      setIsSshKeyDropdownOpen(false);
      setSshKeySearchTerm('');
      return;
    }

    try {
      const tauriAPI = getTauriAPI();
      const [publicKey, privateKey] = await tauriAPI.readSshKeyPair(keyName);
      updateSshKeyPair({ publicKey, privateKey, keyName });
      setIsSshKeyDropdownOpen(false);
      setSshKeySearchTerm('');
    } catch (error) {
      console.error('Failed to read SSH key pair:', error);
      alert('Failed to read SSH key pair');
    }
  };

  const handleSshKeyDropdownOpenChange = (open: boolean) => {
    setIsSshKeyDropdownOpen(open);
    if (!open) {
      setSshKeySearchTerm('');
    }
  };

  const handleGenerateSshKey = async () => {
    if (!onGenerateSshKey) {
      alert('SSH key generation is not available');
      return;
    }

    setIsGeneratingSshKey(true);
    try {
      const newKeyPair = await onGenerateSshKey();
      updateSshKeyPair(newKeyPair);
    } catch (error) {
      console.error('Failed to generate SSH key:', error);
      alert('Failed to generate SSH key');
    } finally {
      setIsGeneratingSshKey(false);
    }
  };

  const handleRemoveSshKey = () => {
    updateSshKeyPair(null);
  };

  return (
    <div className="flex flex-col h-full items-center md:border-2 md:border-t-0 border-lightest dark:border-background-darker box-border">
      <div className="flex flex-col h-full w-full">
        {/* Header */}
        <div className="md:hidden flex items-center justify-between gap-3 p-6">
          <div className="text-base font-medium">{environment ? 'Edit Environment' : 'New Environment'}</div>
          <button
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Editor content */}
        <div className="flex flex-col gap-6 overflow-y-auto items-center flex-1 p-6">
          {editorMode === 'form' ? (
            <div className='max-w-[65ch] w-full flex flex-col gap-6'>
              {/* Name input */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="name-input" className="text-sm font-medium">
                    Environment Name
                  </Label>
                  {name && (
                    <Check className="h-4 w-4 text-constructive" />
                  )}
                </div>
                <input
                  id="name-input"
                  type="text"
                  value={name}
                  onChange={(e) => updateName(e.target.value)}
                  placeholder="e.g., Production, Development, Testing"
                  className={cn(
                    "w-full px-3 py-2 text-sm rounded-md bg-muted/30",
                    "focus:outline-none focus:ring-2 focus:ring-ring",
                    "placeholder:text-muted-foreground/50"
                  )}
                />
              </div>

              {/* Separator */}
              <div className="h-px border-t-(length:--border-width) border-dashed border-muted/30 shrink-0 my-2" />

              {/* Environment Variables */}
              <div className="space-y-2 flex flex-col  px-3">
                <Label htmlFor="env-textarea" className="text-sm font-medium">
                  Environment Variables (.env format)
                </Label>
                <EnvEditor value={envContents} onChange={updateEnvContents} />
              </div>


              {/* Separator */}
              <div className="h-px border-t-(length:--border-width) border-dashed border-muted/30 shrink-0 my-2" />

              {/* Automations Section */}
              <div className="space-y-3 px-3 mb-10">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Automations</Label>
                  {environment?.id && (
                    <button
                      onClick={() => onCreateAutomation?.(environment.id)}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <Plus className="h-3 w-3" />
                      Create for {name || 'this environment'}
                    </button>
                  )}
                </div>

                {/* Automations List */}
                <div className="flex flex-col gap-2">
                  {environment?.id ? (
                    // For existing environments, show environment.automations and allow edit
                    !environment.automations || environment.automations.length === 0 ? (
                      <div className="text-sm text-muted-foreground text-center py-4">
                        No automations installed
                      </div>
                    ) : (
                      environment.automations.map((automation) => (
                        <div key={automation.id} className="group flex items-center gap-2 p-3 rounded-md bg-muted/30 hover:bg-muted/50">
                          <div
                            className="flex-1 cursor-pointer"
                            onClick={() => onEditAutomation?.(automation.id)}
                          >
                            <div className="text-sm font-medium">{automation.name}</div>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => onUninstallAutomation?.(automation.id, environment.id)}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Uninstall automation</TooltipContent>
                          </Tooltip>
                        </div>
                      ))
                    )
                  ) : (
                    // For new environments, show selectedAutomations
                    selectedAutomations.length === 0 ? (
                      <div className="text-sm text-muted-foreground text-center py-4">
                        No automations selected
                      </div>
                    ) : (
                      selectedAutomations.map((automation) => (
                        <div key={automation.id} className="group flex items-center gap-2 p-3 rounded-md bg-muted/30 hover:bg-muted/50">
                          <div className="flex-1">
                            <div className="text-sm font-medium">{automation.name}</div>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => {
                                  updateAutomationIds(automationIds.filter(id => id !== automation.id));
                                }}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Remove automation</TooltipContent>
                          </Tooltip>
                        </div>
                      ))
                    )
                  )}
                </div>

                {/* Install/Select automation dropdown - show if there are uninstalled automations */}
                {uninstalledAutomations.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      {environment?.id ? 'Install existing' : 'Select automations'}
                    </Label>
                    <DropdownMenu open={isAutomationDropdownOpen} onOpenChange={setIsAutomationDropdownOpen}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="background"
                          className="group flex items-center gap-2 px-3 transition-colors justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <Play className="h-3 w-3 transition-colors opacity-80" />
                            <span className="truncate">Select automation</span>
                          </div>
                          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isAutomationDropdownOpen && "rotate-180")} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        className="w-[280px] max-h-[300px] bg-background border-(length:--border-width) border-muted/30 p-2"
                        align="start"
                        side="bottom"
                      >
                        {/* Search Input */}
                        <div className="p-1 border-b border-background" onClick={(e) => e.stopPropagation()}>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                              placeholder="Search automations..."
                              value={automationSearchTerm}
                              onChange={(e) => setAutomationSearchTerm(e.target.value)}
                              className="pl-9 h-8 text-sm"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  setIsAutomationDropdownOpen(false);
                                }
                                e.stopPropagation();
                              }}
                            />
                          </div>
                        </div>

                        {/* Automation List */}
                        <div className="max-h-[200px] overflow-y-auto flex flex-col gap-1">
                          {filteredAutomations.length === 0 ? (
                            <div className="p-3 text-sm text-muted-foreground text-center">
                              {automationSearchTerm ? 'No matching automations' : 'All automations selected'}
                            </div>
                          ) : (
                            filteredAutomations.map((automation) => (
                              <DropdownMenuItem
                                key={automation.id}
                                className="flex flex-col items-start gap-1 p-3 cursor-pointer"
                                onClick={() => {
                                  if (environment?.id) {
                                    onInstallAutomation?.(automation.id, environment.id);
                                  } else {
                                    updateAutomationIds([...automationIds, automation.id]);
                                  }
                                  setIsAutomationDropdownOpen(false);
                                  setAutomationSearchTerm('');
                                }}
                              >
                                <div className="flex items-center gap-2 w-full">
                                  <span className="flex-1 truncate font-medium">{automation.name}</span>
                                </div>
                              </DropdownMenuItem>
                            ))
                          )}
                        </div>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>

              {/* Separator */}
              <div className="h-px border-t-(length:--border-width) border-dashed border-muted/30 shrink-0 my-2" />

              {/* Secret Files Section */}
              <div className="space-y-3  px-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Secret Files</Label>
                  <button
                    onClick={handleAddSecretFile}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" />
                    Add File
                  </button>
                </div>

                {/* Secret Files List */}
                <div className="flex flex-col gap-2">
                  {secretFiles.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-4">
                      No secret files yet
                    </div>
                  ) : (
                    secretFiles.map((secret, index) => (
                      <SecretFileItem
                        key={index}
                        secret={secret}
                        index={index}
                        isExpanded={expandedSecretFiles.has(index)}
                        onToggleExpanded={() => toggleSecretFileExpanded(index)}
                        onChange={(updates) => handleUpdateSecretFile(index, updates)}
                        onDelete={() => handleDeleteSecretFile(index)}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Separator */}
              <div className="h-px border-t-(length:--border-width) border-dashed border-muted/30 shrink-0 my-2" />

              {/* SSH Identity Key Section */}
              <div className="space-y-3 px-3">
                <div className="flex items-center gap-5 justify-between">
                  <Label className="text-sm min-w-fit font-medium flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    SSH Identity Key
                  </Label>
                  <div className='text-xs text-muted-foreground/70'>Public/private key pair installed on the server's ~/.ssh to let your agent connect via SSH to your services</div>
                </div>

                <div className="flex flex-col gap-3">
                  {/* Current key display or selection */}
                  {sshKeyPair ? (
                    <div className="p-3 rounded-md bg-muted/30 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">{sshKeyPair.keyName}</div>
                        <button
                          onClick={handleRemoveSshKey}
                          className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
                        >
                          <Trash2 className="h-3 w-3" />
                          Remove
                        </button>
                      </div>
                      <div className="text-xs max-w-[75ch] text-muted-foreground font-mono break-all">
                        {sshKeyPair.publicKey}
                      </div>
                    </div>
                  ) : (
                    <></>
                  )}

                  <div className="flex gap-3 items-end justify-between">
                    {/* Desktop: SSH key selector */}
                    {!isBrowser && availableSshKeys.length > 0 && (
                      <>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Select from your local machine</Label>
                        <DropdownMenu open={isSshKeyDropdownOpen} onOpenChange={handleSshKeyDropdownOpenChange}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="background"
                              wFull
                              size="sm"
                              disabled={isLoadingSshKeys}
                              className={cn(
                                "group flex items-center gap-2 px-3 transition-colors justify-between",
                                isLoadingSshKeys && "opacity-50 cursor-not-allowed pointer-events-none"
                              )}
                            >
                              <div className="flex items-center gap-2">
                                <Key className="h-2 w-2 transition-colors opacity-80" />
                                <span className="truncate">
                                  {sshKeyPair?.keyName ?
                                    (sshKeyPair.keyName.substring(0, 14) + (sshKeyPair.keyName.length > 14 ? '...' : '')) :
                                    'None'
                                  }
                                </span>
                              </div>
                              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isSshKeyDropdownOpen && "rotate-180")} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            className="w-[280px] max-h-[300px] bg-background border-(length:--border-width) border-muted/30 p-2"
                            align="start"
                            side="bottom"
                          >
                            {/* Search Input */}
                            <div className="p-1 border-b border-background" onClick={(e) => e.stopPropagation()}>
                              <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                <Input
                                  placeholder="Search SSH keys..."
                                  value={sshKeySearchTerm}
                                  onChange={(e) => setSshKeySearchTerm(e.target.value)}
                                  className="pl-9 h-8 text-sm"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                      setIsSshKeyDropdownOpen(false);
                                    }
                                    e.stopPropagation();
                                  }}
                                />
                              </div>
                            </div>

                            {/* SSH Key List */}
                            <div className="max-h-[200px] overflow-y-auto flex flex-col gap-1">
                              <DropdownMenuItem
                                className="flex items-center gap-2 p-3 cursor-pointer"
                                onClick={() => handleSelectSshKey('none')}
                              >
                                <Key className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="flex-1 truncate">None</span>
                                {!sshKeyPair && (
                                  <Badge variant="default" className="text-xs">
                                    Current
                                  </Badge>
                                )}
                              </DropdownMenuItem>
                              {filteredSshKeys.length === 0 ? (
                                <div className="p-3 text-sm text-muted-foreground text-center">
                                  No SSH keys found
                                </div>
                              ) : (
                                filteredSshKeys.map((key) => (
                                  <DropdownMenuItem
                                    key={key.name}
                                    className="flex items-center gap-2 p-3 cursor-pointer"
                                    onClick={() => handleSelectSshKey(key.name)}
                                  >
                                    <Key className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="flex-1 truncate">{key.name}</span>
                                    <div className="flex items-center gap-2">
                                      {key.name === sshKeyPair?.keyName && (
                                        <Badge variant="default" className="text-xs">
                                          Current
                                        </Badge>
                                      )}
                                    </div>
                                  </DropdownMenuItem>
                                ))
                              )}
                            </div>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="text-xs text-muted-foreground/70 pb-2">or</div>
                      </>
                    )}


                    {/* Generate new key button */}
                    <Button
                      variant="background"
                      size="sm"
                      onClick={handleGenerateSshKey}
                      disabled={isGeneratingSshKey}
                      className="w-full"
                    >
                      {isGeneratingSshKey ? 'Generating...' : 'Generate New SSH Key'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className='max-w-[65ch] w-full h-full flex flex-col gap-6'>
              <JsonEditor value={jsonValue} onChange={handleRawJsonChange} />
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between gap-3 pt-4 md:p-6 border-t-(length:--border-width) border-muted/10">
          {/* Toggle button */}
          <Button
            variant="transparent"
            size="sm"
            onClick={handleToggleMode}
          >
            {editorMode === 'form' ? 'See/Edit as Raw' : 'Exit Raw Mode'}
          </Button>

          {/* Save/Discard buttons */}
          <div className="flex items-center gap-3">
            <Button
              variant="background"
              onClick={() => { discard(); onDiscard(); }}
            >
              Discard
            </Button>
            <Button
              variant="background"
              hoverVariant="accent"
              onClick={handleSave}
              disabled={editorMode === 'json' ? !validateEnvironmentJSON(jsonValue).isValid : !name.trim()}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
      <SaveErrorDialog
        open={saveError !== null}
        onOpenChange={(open) => { if (!open) setSaveError(null); }}
        resourceType="environment"
        errorMessage={saveError || ''}
      />
    </div>
  );
}

// Sub-component for secret file items with collapsible editing
function SecretFileItem({
  secret,
  index,
  isExpanded,
  onToggleExpanded,
  onChange,
  onDelete
}: {
  secret: SecretFileEdit;
  index: number;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onChange: (updates: Partial<Pick<SecretFileEdit, 'path' | 'contents'>>) => void;
  onDelete: () => void;
}) {
  const pathValidation = validateSecretFilePath(secret.path);

  return (
    <div className="flex flex-col rounded-md bg-muted/30 hover:bg-muted/50 transition-colors">
      {/* Header - Always visible */}
      <div className="group flex items-center gap-2 p-3">
        <button
          onClick={onToggleExpanded}
          className="flex-1 flex items-center gap-2 cursor-pointer text-left"
        >
          <div className="flex items-center justify-center w-4 h-4">
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1">
            <div className="text-sm font-mono">
              {secret.path || '(no path)'}
              {!pathValidation.isValid && secret.path && (
                <span className="text-destructive ml-2 text-xs">(invalid path)</span>
              )}
            </div>
            {!isExpanded && (
              <div className="text-xs text-muted-foreground truncate">
                {secret.contents ? `${secret.contents.length} characters` : 'Empty'}
              </div>
            )}
          </div>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onDelete}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Delete secret file</TooltipContent>
        </Tooltip>
      </div>

      {/* Expandable Content - Edit fields */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          <div className="space-y-2">
            <Label className="text-xs">File Path</Label>
            <input
              type="text"
              value={secret.path}
              onChange={(e) => onChange({ path: e.target.value })}
              placeholder="e.g., .env, src/config.json"
              className={cn(
                "w-full px-3 py-2 text-sm rounded-md bg-background",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "placeholder:text-muted-foreground/50",
                !pathValidation.isValid && secret.path && "ring-2 ring-destructive focus:ring-destructive"
              )}
            />
            {!pathValidation.isValid && secret.path && (
              <p className="text-xs text-destructive">{pathValidation.error}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Contents</Label>
            <textarea
              value={secret.contents}
              onChange={(e) => onChange({ contents: e.target.value })}
              placeholder="File contents..."
              className={cn(
                "w-full px-3 py-2 text-sm rounded-md bg-background resize-none font-mono",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "placeholder:text-muted-foreground/50",
                "min-h-[120px]"
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
}
