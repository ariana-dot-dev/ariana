import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface SlopModeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (minutes: number, customPrompt?: string) => void;
}

export function SlopModeDialog({ open, onOpenChange, onConfirm }: SlopModeDialogProps) {
  const [minutes, setMinutes] = useState(15);
  const [customPrompt, setCustomPrompt] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = '2ch';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [customPrompt]);

  const handleConfirm = () => {
    onConfirm(minutes, customPrompt.trim() || undefined);
    onOpenChange(false);
  };

  const formatDuration = (mins: number) => {
    if (mins < 60) {
      return `${mins} min`;
    }
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    if (remainingMins === 0) {
      return `${hours}h`;
    }
    return `${hours}h ${remainingMins}min`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[60ch] p-6">
        <DialogHeader>
          <DialogTitle className='mb-2'>Slop Mode</DialogTitle>
          <DialogDescription className='mb-3'>
            The agent will automatically receive "keep going" prompts when it becomes idle, until the timer runs out.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-center gap-4">
            <Button
              size="lg"
              variant="default"
              disabled={minutes <= 15}
              onClick={() => setMinutes(Math.max(15, minutes - 15))}
              className="h-12 w-12 p-0 text-lg"
            >
              -
            </Button>
            <div className="flex flex-col items-center gap-1 w-[7.5rem] h-12 bg-background-darker rounded-md justify-center">
              <div className="text-2xl font-bold">
                {formatDuration(minutes)}
              </div>
            </div>
            <Button
              size="lg"
              variant="default"
              disabled={minutes >= 1440}
              onClick={() => setMinutes(Math.min(1440, minutes + 15))}
              className="h-12 w-12 p-0 text-lg"
            >
              +
            </Button>
          </div>
          <p className="text-sm text-muted-foreground text-center">
            The agent will work autonomously for up to {formatDuration(minutes)}.
          </p>
        </div>

        {/* Custom prompt textarea */}
        <div className="relative h-fit rounded-lg bg-background-darker mb-2">
          <div className="pt-2.5 pb-1.5 px-3 h-fit min-h-[8ch] max-h-[12ch] overflow-y-auto">
            <textarea
              ref={textareaRef}
              value={customPrompt}
              spellCheck={false}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Optional: Add instructions to append to the keep going prompt..."
              className="min-h-[2ch] w-full bg-transparent border-none outline-none resize-none text-sm placeholder:text-muted-foreground/50"
              rows={1}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="default" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="default" onClick={handleConfirm}>
            Start Slop Mode
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
