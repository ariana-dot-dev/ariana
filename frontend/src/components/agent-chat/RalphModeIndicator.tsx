import { Button } from '@/components/ui/button';
import { Bot } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface RalphModeIndicatorProps {
  onStop: () => void;
}

export function RalphModeIndicator({ onStop }: RalphModeIndicatorProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <Button
              variant="transparent"
              hoverVariant="accent"
              className="px-2 py-0.5 flex items-center gap-2 not-hover:text-foreground/50"
              onClick={onStop}
            >
              <div className="h-5 w-5">
                <Bot className="max-h-full max-w-full text-inherit" />
              </div>
              <div className="font-mono text-xs">Ralph</div>
            </Button>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="max-w-xs">
            <p className="font-semibold">Ralph Mode Active</p>
            <p className="text-xs mt-1">Agent works autonomously until task complete or stuck. Click to stop.</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
