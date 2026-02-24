import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentTip } from './tips';

interface TipDialogProps {
  tip: AgentTip | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TipDialog({ tip, open, onOpenChange }: TipDialogProps) {
  if (!tip) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[50ch] max-w-[98vw] p-4 md:p-6">
        <DialogHeader>
          <DialogTitle>{tip.title}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-foreground">
          <article className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <Markdown remarkPlugins={[remarkGfm]}>
              {tip.body}
            </Markdown>
          </article>
        </div>
      </DialogContent>
    </Dialog>
  );
}
