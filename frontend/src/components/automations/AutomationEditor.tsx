import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { X, Check, ChevronDown, PlayCircle, GitCommit, FileEdit, FileSearch, Command, Upload, RotateCcw, Zap, BookOpen, HelpCircle } from 'lucide-react';
import HelpCircleIcon from '@/components/ui/icons/HelpCircle';
import { SiPython, SiJavascript, SiGnubash } from 'react-icons/si';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Automation, useAutomations } from '@/hooks/useAutomations';
import type { AutomationTriggerType, AutomationScriptLanguage } from '@shared/types/automation.types';
import { SelectGroupRoot, SelectGroupOption } from '@/components/ui/select-group';
import { AutomationPicker } from './AutomationPicker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { JsonEditor } from '../environments/JsonEditor';
import { useAppStore } from '@/stores/useAppStore';
import { Input } from '@/components/ui/input';
import { CodeEditor } from './CodeEditor';
import { validateAutomationJSON } from '@/utils/validateAutomationJSON';
import { useAutomationEditorState } from '@/hooks/useAutomationEditorState';
import { SaveErrorDialog } from '@/components/SaveErrorDialog';

interface AutomationEditorProps {
  automation?: Automation;
  projectId: string;
  onBack: () => void;
  onSave: (data: {
    name: string;
    trigger: { type: AutomationTriggerType; fileGlob?: string; commandRegex?: string; automationId?: string };
    scriptLanguage: AutomationScriptLanguage;
    scriptContent: string;
    blocking: boolean;
    feedOutput: boolean;
  }) => Promise<void> | void;
  onDiscard: () => void;
  isFocused?: boolean;
}

const TRIGGER_OPTIONS = [
  { value: 'manual' as AutomationTriggerType, label: 'Manual', icon: PlayCircle, description: 'Run manually via command palette or automation list' },
  { value: 'on_agent_ready' as AutomationTriggerType, label: 'On agent ready', icon: Zap, description: 'Runs when agent is ready and waiting for user input' },
  { value: 'on_after_edit_files' as AutomationTriggerType, label: 'After edit files', icon: FileEdit, description: 'Runs when agent edits matching files' },
  { value: 'on_after_read_files' as AutomationTriggerType, label: 'After read files', icon: FileSearch, description: 'Runs when agent reads matching files' },
  { value: 'on_after_run_command' as AutomationTriggerType, label: 'After run command', icon: Command, description: 'Runs when agent executes matching bash commands' },
  { value: 'on_before_commit' as AutomationTriggerType, label: 'Before commit', icon: GitCommit, description: 'Runs before agent creates a git commit (pre-commit hook)' },
  { value: 'on_after_commit' as AutomationTriggerType, label: 'After commit', icon: Upload, description: 'Runs after agent creates a git commit (post-commit hook)' },
  { value: 'on_after_reset' as AutomationTriggerType, label: 'After reset', icon: RotateCcw, description: 'Runs after agent is reset' },
  { value: 'on_automation_finishes' as AutomationTriggerType, label: 'After automation finishes', icon: Zap, description: 'Runs after another automation finishes (provide automation ID)' },
];

const VARIABLE_DOCS = {
  bash: {
    title: 'Available Variables (Bash)',
    variables: [
      { name: '$INPUT_FILE_PATH', description: 'Path to the file being edited/read (for file-based triggers)', example: 'echo "File: $INPUT_FILE_PATH"' },
      { name: '$INPUT_COMMAND', description: 'Command being executed (for command-based triggers)', example: 'echo "Command: $INPUT_COMMAND"' },
      { name: '$CURRENT_COMMIT_SHA', description: 'Current git commit SHA', example: 'echo "Commit: $CURRENT_COMMIT_SHA"' },
      { name: '$CURRENT_COMMIT_CHANGES', description: 'Changes in the current commit', example: 'echo "$CURRENT_COMMIT_CHANGES" | head -10' },
      { name: '$CURRENT_PENDING_CHANGES', description: 'Uncommitted changes in working directory', example: 'echo "$CURRENT_PENDING_CHANGES"' },
      { name: '$ENTIRE_AGENT_DIFF', description: 'All changes made by agent since start', example: 'echo "$ENTIRE_AGENT_DIFF" | grep "^+"' },
      { name: '$LAST_PROMPT', description: 'Last user prompt sent to agent', example: 'echo "Last prompt: $LAST_PROMPT"' },
      { name: '$ALL_LAST_PROMPTS', description: 'All recent user prompts (newline-separated)', example: 'echo "$ALL_LAST_PROMPTS"' },
      { name: '$GITHUB_TOKEN', description: 'GitHub token if available', example: 'gh auth login --with-token <<< "$GITHUB_TOKEN"' },
      { name: '$CONVERSATION_TRANSCRIPT', description: 'Full conversation as JSON string', example: 'echo "$CONVERSATION_TRANSCRIPT" | jq \'.[-1]\''},
      { name: '$LAST_SCRIPT_OUTPUT', description: 'Output from previous automation (if chained)', example: 'echo "Previous output: $LAST_SCRIPT_OUTPUT"' },
    ],
    functions: [
      { name: 'stopAgent', description: 'Stop the agent immediately', example: 'stopAgent' },
      { name: 'queuePrompt', description: 'Queue a prompt for the agent', example: 'queuePrompt "Please fix the linting errors"' },
    ]
  },
  javascript: {
    title: 'Available Variables (JavaScript)',
    variables: [
      { name: 'variables.inputFilePath', description: 'Path to the file being edited/read (for file-based triggers)', example: 'console.log(variables.inputFilePath); // "/workspace/src/index.ts"' },
      { name: 'variables.inputCommand', description: 'Command being executed (for command-based triggers)', example: 'console.log(variables.inputCommand); // "npm test"' },
      { name: 'variables.currentCommitSha', description: 'Current git commit SHA', example: 'console.log(variables.currentCommitSha); // "a1b2c3d4e5f6..."' },
      { name: 'variables.currentCommitChanges', description: 'Changes in the current commit', example: 'console.log(variables.currentCommitChanges); // "diff --git a/file.ts..."' },
      { name: 'variables.currentPendingChanges', description: 'Uncommitted changes in working directory', example: 'console.log(variables.currentPendingChanges); // "M  src/index.ts\\n..."' },
      { name: 'variables.entireAgentDiff', description: 'All changes made by agent since start', example: 'console.log(variables.entireAgentDiff); // "diff --git a/..."' },
      { name: 'variables.lastPrompt', description: 'Last user prompt sent to agent', example: 'console.log(variables.lastPrompt); // "Fix the login bug"' },
      { name: 'variables.allLastPrompts', description: 'All recent user prompts (array)', example: 'console.log(variables.allLastPrompts); // ["Prompt 1", "Prompt 2"]' },
      { name: 'variables.githubToken', description: 'GitHub token if available', example: 'console.log(variables.githubToken); // "ghp_..."' },
      { name: 'variables.conversationTranscript', description: 'Full conversation as array', example: 'console.log(variables.conversationTranscript); // [{role:"user",content:"..."}]' },
      { name: 'variables.lastScriptOutput', description: 'Output from previous automation (if chained)', example: 'console.log(variables.lastScriptOutput); // "Tests passed: 42"' },
    ],
    functions: [
      { name: 'stopAgent()', description: 'Stop the agent immediately', example: 'stopAgent();' },
      { name: 'queuePrompt(text)', description: 'Queue a prompt for the agent', example: 'queuePrompt("Please fix the linting errors");' },
    ]
  },
  python: {
    title: 'Available Variables (Python)',
    variables: [
      { name: 'variables["inputFilePath"]', description: 'Path to the file being edited/read (for file-based triggers)', example: 'print(variables["inputFilePath"])  # "/workspace/src/index.ts"' },
      { name: 'variables["inputCommand"]', description: 'Command being executed (for command-based triggers)', example: 'print(variables["inputCommand"])  # "npm test"' },
      { name: 'variables["currentCommitSha"]', description: 'Current git commit SHA', example: 'print(variables["currentCommitSha"])  # "a1b2c3d4e5f6..."' },
      { name: 'variables["currentCommitChanges"]', description: 'Changes in the current commit', example: 'print(variables["currentCommitChanges"])  # "diff --git a/file.ts..."' },
      { name: 'variables["currentPendingChanges"]', description: 'Uncommitted changes in working directory', example: 'print(variables["currentPendingChanges"])  # "M  src/index.ts\\n..."' },
      { name: 'variables["entireAgentDiff"]', description: 'All changes made by agent since start', example: 'print(variables["entireAgentDiff"])  # "diff --git a/..."' },
      { name: 'variables["lastPrompt"]', description: 'Last user prompt sent to agent', example: 'print(variables["lastPrompt"])  # "Fix the login bug"' },
      { name: 'variables["allLastPrompts"]', description: 'All recent user prompts (list)', example: 'print(variables["allLastPrompts"])  # ["Prompt 1", "Prompt 2"]' },
      { name: 'variables["githubToken"]', description: 'GitHub token if available', example: 'print(variables["githubToken"])  # "ghp_..."' },
      { name: 'variables["conversationTranscript"]', description: 'Full conversation as list', example: 'print(variables["conversationTranscript"])  # [{"role":"user","content":"..."}]' },
      { name: 'variables["lastScriptOutput"]', description: 'Output from previous automation (if chained)', example: 'print(variables["lastScriptOutput"])  # "Tests passed: 42"' },
    ],
    functions: [
      { name: 'stopAgent()', description: 'Stop the agent immediately', example: 'stopAgent()' },
      { name: 'queuePrompt(text)', description: 'Queue a prompt for the agent', example: 'queuePrompt("Please fix the linting errors")' },
    ]
  }
};

export const AutomationEditor = memo(function AutomationEditor({
  automation,
  projectId,
  onBack,
  onSave,
  onDiscard,
  isFocused = true
}: AutomationEditorProps) {
  console.log("AutomationEditor", automation)
  console.log("projectId", projectId)

  const editorMode = useAppStore(state => state.environmentEditorMode);
  const setEditorMode = useAppStore(state => state.setEnvironmentEditorMode);

  // Get all automations for the picker
  const { automations } = useAutomations(projectId);

  // Use the hook - fetches its own automation, each field is reactive
  const {
    name,
    triggerType,
    fileGlob,
    commandRegex,
    automationIdValue,
    scriptLanguage,
    scriptContent,
    blocking,
    feedOutput,
    updateName,
    updateTriggerType,
    updateTriggerField,
    updateScriptLanguage,
    updateScriptContent,
    updateBlocking,
    updateFeedOutput,
    updateFromRawJson,
    save,
    discard,
  } = useAutomationEditorState(projectId, automation?.id || null);

  // Filter out current automation from picker (can't trigger on itself)
  const availableAutomations = useMemo(() => {
    return automations.filter(a => a.id !== automation?.id);
  }, [automations, automation?.id]);

  const [saveError, setSaveError] = useState<string | null>(null);

  const requiresBlocking = ['on_after_edit_files', 'on_after_read_files', 'on_after_run_command', 'on_before_commit'].includes(triggerType);

  // Auto-enable blocking if required
  useEffect(() => {
    if (requiresBlocking && !blocking) {
      updateBlocking(true);
    }
  }, [requiresBlocking, blocking, updateBlocking]);

  const handleSaveWithErrorHandling = useCallback(async () => {
    if (!name.trim()) return;
    try {
      await save(onSave);
    } catch (error) {
      console.error('[AutomationEditor] Save failed:', error);
      setSaveError(error instanceof Error ? error.message : 'An unexpected error occurred');
    }
  }, [name, save, onSave]);

  // Keyboard shortcut with stable ref to avoid re-renders
  const handleSave = handleSaveWithErrorHandling;

  useEffect(() => {
    if (!isFocused) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFocused, handleSave]);

  const showFileGlob = ['on_after_edit_files', 'on_after_read_files'].includes(triggerType);
  const showCommandRegex = ['on_after_run_command'].includes(triggerType);
  const showAutomationId = triggerType === 'on_automation_finishes';

  return (
    <div className="flex flex-col h-full items-center md:border-2 md:border-t-0 border-lightest dark:border-background-darker box-border">
      <div className="flex flex-col h-full w-full">
        <div className="md:hidden flex items-center justify-between gap-3 p-6">
          <div className="text-base font-medium">{automation ? 'Edit Automation' : 'New Automation'}</div>
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground flex items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-6 overflow-y-auto items-center flex-1 px-2 p-6">
          {editorMode === 'form' ? (
            <div className='max-w-[65ch] w-full flex flex-col gap-6'>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="name-input" className="text-sm font-medium">Automation Name</Label>
                  {name && <Check className="h-4 w-4 text-constructive" />}
                </div>
                <input
                  id="name-input"
                  type="text"
                  value={name}
                  onChange={(e) => updateName(e.target.value)}
                  placeholder="e.g., Run linter, Check types"
                  className={cn("w-full px-3 py-2 text-sm rounded-md bg-muted/30", "focus:outline-none focus:ring-2 focus:ring-ring", "placeholder:text-muted-foreground/50")}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Trigger</Label>
                <TooltipProvider>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className={cn("w-full px-3 py-2 text-sm rounded-md bg-muted/30 text-left", "flex items-center justify-between gap-2", "focus:outline-none focus:ring-2 focus:ring-ring")}>
                        <div className="flex items-center gap-2">
                          {(() => {
                            const selectedOption = TRIGGER_OPTIONS.find(opt => opt.value === triggerType);
                            const Icon = selectedOption?.icon;
                            return (<>{Icon && <Icon className="h-4 w-4 opacity-70" />}<span>{selectedOption?.label || 'Select trigger'}</span></>);
                          })()}
                        </div>
                        <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[420px] max-h-[320px] overflow-y-auto">
                      {TRIGGER_OPTIONS.map(option => {
                        const Icon = option.icon;
                        return (
                          <Tooltip key={option.value} delayDuration={300}>
                            <TooltipTrigger asChild>
                              <DropdownMenuItem
                                onClick={() => updateTriggerType(option.value)}
                                className="flex items-center gap-2 cursor-pointer"
                              >
                                <Icon className="h-4 w-4 opacity-70 flex-shrink-0" />
                                <span className="flex-1">{option.label}</span>
                                <HelpCircle className="h-3 w-3 opacity-40 flex-shrink-0" />
                              </DropdownMenuItem>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-[300px]">
                              <p className="text-xs">{option.description}</p>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TooltipProvider>
              </div>

              {showFileGlob && (
                <div className="space-y-2">
                  <Label htmlFor="fileGlob" className="text-sm font-medium">File Glob (optional)</Label>
                  <Input
                    id="fileGlob"
                    value={fileGlob || ''}
                    onChange={(e) => updateTriggerField('fileGlob', e.target.value)}
                    placeholder="e.g., **/*.ts"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">Only trigger for files matching this pattern</p>
                </div>
              )}

              {showCommandRegex && (
                <div className="space-y-2">
                  <Label htmlFor="commandRegex" className="text-sm font-medium">Command Regex (optional)</Label>
                  <Input
                    id="commandRegex"
                    value={commandRegex || ''}
                    onChange={(e) => updateTriggerField('commandRegex', e.target.value)}
                    placeholder="e.g., ^npm (test|build)"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">Only trigger for commands matching this regex</p>
                </div>
              )}

              {showAutomationId && (
                <AutomationPicker
                  automations={availableAutomations}
                  selectedId={automationIdValue || null}
                  onSelect={(id) => updateTriggerField('automationId', id)}
                  label="Target Automation"
                  placeholder="Select automation"
                  helpText="Trigger after this automation finishes"
                />
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Script Language</Label>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="transparent" size="sm" className="h-7 gap-1.5 text-xs">
                        <BookOpen className="h-3.5 w-3.5" />
                        Scripts Documentation
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto p-0">
                      <div className="p-6 space-y-6">
                        <DialogHeader className="p-0">
                          <DialogTitle>{VARIABLE_DOCS[scriptLanguage].title}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                          <h3 className="text-sm font-semibold">
                            {scriptLanguage === 'bash' ? 'Environment Variables' : 'Available Variables'}
                          </h3>
                          {scriptLanguage === 'javascript' && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">
                              <div className="h-4 w-4">
                                <HelpCircleIcon className="max-h-full max-w-full text-inherit" />
                              </div>
                              <p>Variables are available in a <code className="font-mono font-semibold">variables</code> object</p>
                            </div>
                          )}
                          {scriptLanguage === 'python' && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">
                              <div className="h-4 w-4">
                                <HelpCircleIcon className="max-h-full max-w-full text-inherit" />
                              </div>
                              <p>Variables are available in a <code className="font-mono font-semibold">variables</code> dictionary</p>
                            </div>
                          )}
                          <div className="space-y-3">
                            {VARIABLE_DOCS[scriptLanguage].variables.map((v) => (
                              <div key={v.name} className="space-y-1.5 p-3 bg-muted/10 rounded-lg">
                                <div className="flex flex-col gap-1">
                                  <code className="text-sm font-mono font-semibold">{v.name}</code>
                                  <span className="text-xs text-muted-foreground">{v.description}</span>
                                </div>
                                <div className="mt-2">
                                  <pre className="text-xs bg-background/50 p-2 rounded-md overflow-x-auto">
                                    <code className={`language-${scriptLanguage === 'bash' ? 'bash' : scriptLanguage}`}>
                                      {v.example}
                                    </code>
                                  </pre>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-3">
                          <h3 className="text-sm font-semibold">Helper Functions</h3>
                          <div className="space-y-3">
                            {VARIABLE_DOCS[scriptLanguage].functions.map((f) => (
                              <div key={f.name} className="space-y-1.5 p-3 bg-muted/10 rounded-lg">
                                <div className="flex flex-col gap-1">
                                  <code className="text-sm font-mono font-semibold">{f.name}</code>
                                  <span className="text-xs text-muted-foreground">{f.description}</span>
                                </div>
                                <div className="mt-2">
                                  <pre className="text-xs bg-background/50 p-2 rounded-md overflow-x-auto">
                                    <code className={`language-${scriptLanguage === 'bash' ? 'bash' : scriptLanguage}`}>
                                      {f.example}
                                    </code>
                                  </pre>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                <SelectGroupRoot
                  value={scriptLanguage}
                  onValueChange={(v) => updateScriptLanguage(v as AutomationScriptLanguage)}
                  orientation="horizontal"
                  rounded={false}
                  className="w-full"
                >
                  <SelectGroupOption value="bash" className="flex-1 h-10 flex items-center justify-center gap-1.5">
                    <SiGnubash className="h-4 w-4" />Bash
                  </SelectGroupOption>
                  <SelectGroupOption value="javascript" className="flex-1 h-10 flex items-center justify-center gap-1.5">
                    <SiJavascript className="h-4 w-4" />JavaScript
                  </SelectGroupOption>
                  <SelectGroupOption value="python" className="flex-1 h-10 flex items-center justify-center gap-1.5">
                    <SiPython className="h-4 w-4" />Python
                  </SelectGroupOption>
                </SelectGroupRoot>
              </div>

              <div className="space-y-2 flex flex-col flex-1">
                <Label className="text-sm font-medium">Script</Label>
                <CodeEditor
                  value={scriptContent}
                  onChange={updateScriptContent}
                  language={scriptLanguage}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between py-2">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Blocking</Label>
                    <p className="text-xs text-muted-foreground">
                      {requiresBlocking ? 'This trigger must be blocking' : 'Wait for automation to finish before continuing'}
                    </p>
                  </div>
                  <Switch
                    checked={blocking}
                    onCheckedChange={(v) => updateBlocking(v)}
                    disabled={requiresBlocking}
                  />
                </div>
                <div className="flex items-center justify-between py-2">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Feed Output</Label>
                    <p className="text-xs text-muted-foreground">Add stdout/stderr to agent's context when finished</p>
                  </div>
                  <Switch
                    checked={feedOutput}
                    onCheckedChange={(v) => updateFeedOutput(v)}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className='max-w-[65ch] w-full flex flex-col gap-6'>
              <JsonEditor
                value={JSON.stringify({
                  name,
                  trigger: { type: triggerType, fileGlob, commandRegex, automationId: automationIdValue },
                  scriptLanguage,
                  scriptContent,
                  blocking,
                  feedOutput,
                }, null, 2)}
                onChange={updateFromRawJson}
                validate={validateAutomationJSON}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-4 md:p-6 border-t-(length:--border-width) border-muted/10">
          <Button variant="transparent" size="sm" onClick={() => setEditorMode(editorMode === 'form' ? 'json' : 'form')}>
            {editorMode === 'form' ? 'See/Edit as Raw' : 'Exit Raw Mode'}
          </Button>
          <div className="flex items-center gap-3">
            <Button variant="background" onClick={() => { discard(); onDiscard(); }}>Discard</Button>
            <Button variant="background" hoverVariant="accent" onClick={handleSaveWithErrorHandling} disabled={!name.trim()}>Save</Button>
          </div>
        </div>
      </div>
      <SaveErrorDialog
        open={saveError !== null}
        onOpenChange={(open) => { if (!open) setSaveError(null); }}
        resourceType="automation"
        errorMessage={saveError || ''}
      />
    </div>
  );
});
