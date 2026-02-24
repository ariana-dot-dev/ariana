import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface RalphModeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (taskDescription: string) => void;
}

export function RalphModeDialog({ open, onOpenChange, onConfirm }: RalphModeDialogProps) {
  const [taskDescription, setTaskDescription] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = '6ch';
      textarea.style.height = `${Math.max(textarea.scrollHeight, 96)}px`;
    }
  }, [taskDescription]);

  // Focus textarea when dialog opens
  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  const handleConfirm = () => {
    if (!taskDescription.trim()) return;
    onConfirm(taskDescription.trim());
    onOpenChange(false);
    setTaskDescription('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[70ch] p-6">
        <DialogHeader>
          <DialogTitle className='mb-2'>Ralph Mode</DialogTitle>
          <DialogDescription className='mb-3 space-y-2'>
            <span className="block">
              The agent will work autonomously until the task is complete or it gets stuck.
              Each iteration starts fresh with cleared memory, using documentation in <code className="text-xs bg-background-darker px-1 py-0.5 rounded">~/.ariana-ralph-notes/</code> for continuity.
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Task description textarea */}
        <div className="relative h-fit rounded-lg bg-background-darker">
          <div className="pt-2.5 pb-1.5 px-3 h-fit min-h-[12ch] max-h-[24ch] overflow-y-auto">
            <textarea
              ref={textareaRef}
              value={taskDescription}
              spellCheck={false}
              onChange={(e) => setTaskDescription(e.target.value)}
              placeholder="Describe the task..."
              className="min-h-[6ch] w-full bg-transparent border-none outline-none resize-none text-sm placeholder:text-muted-foreground/50"
              rows={4}
            />
          </div>
        </div>

        {/* Guidelines */}
        <div className="text-xs text-muted-foreground space-y-1.5 mt-1">
          <p className="font-medium text-foreground/70">For best results:</p>
          <ul className="list-disc list-inside space-y-0.5 pl-1">
            <li>Define clear validation criteria (tests passing, performance goals, etc.)</li>
            <li>If you already gave the agent a task, you can just reference it briefly here</li>
            <li>The agent will delete <code className="bg-background-darker px-1 py-0.5 rounded">.task-lock</code> when done or stuck</li>
          </ul>
        </div>

        <div className="flex justify-end gap-2 mt-3">
          <Button variant="default" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={handleConfirm}
            disabled={!taskDescription.trim()}
          >
            Start Ralph Mode
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
