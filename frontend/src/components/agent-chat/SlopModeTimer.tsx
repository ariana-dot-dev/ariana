import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Zap } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface SlopModeTimerProps {
  inSlopModeUntil: Date;
  onStop: () => void;
}

export function SlopModeTimer({ inSlopModeUntil, onStop }: SlopModeTimerProps) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const diff = inSlopModeUntil.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft('Expired');
        return;
      }

      const totalMinutes = Math.floor(diff / (1000 * 60));
      const totalSeconds = Math.floor(diff / 1000);

      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}min`);
      } else if (minutes > 0) {
        setTimeLeft(`${minutes}min ${seconds}s`);
      } else {
        setTimeLeft(`${seconds}s`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [inSlopModeUntil]);

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
                <Zap className="max-h-full max-w-full text-inherit" />
              </div>
              <div className="font-mono text-xs">{timeLeft}</div>
            </Button>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="max-w-xs">
            <p className="font-semibold">Slop Mode Active</p>
            <p className="text-xs mt-1">Agent will receive "keep going" prompts when idle. Click to stop.</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
