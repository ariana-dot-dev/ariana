import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import CheckmarkCircle from '../ui/icons/CheckmarkCircle';
import Copy from '../ui/icons/Copy';
import { toast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface CheckoutCommandDialogProps {
  open: boolean;
  onClose: () => void;
  branchName: string;
}

export function CheckoutCommandDialog({ open, onClose, branchName }: CheckoutCommandDialogProps) {
  const [copied, setCopied] = useState(false);
  const command = `git fetch -a && git checkout ${branchName}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      toast({
        title: 'Error',
        description: 'Failed to copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-[60ch] p-6">
        <DialogHeader>
          <DialogTitle className='mb-2'>Checkout Agent Branch</DialogTitle>
          <DialogDescription className='mb-3'>
            Use this command to checkout the agent's branch locally
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Command display with copy button */}
          <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-md">
            <code className="flex-1 text-sm font-mono text-foreground select-all">
              {command}
            </code>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleCopy}
                  className="h-5 w-5 ml-1 hover:text-accent shrink-0"
                >
                  {copied ? (
                    <CheckmarkCircle className="max-h-full max-w-full text-inherit" />
                  ) : (
                    <Copy className="max-h-full max-w-full text-inherit" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>Copy to clipboard</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="default" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
