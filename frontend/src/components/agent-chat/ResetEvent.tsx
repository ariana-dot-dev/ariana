import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const formatTimestamp = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString();
};

interface ResetEventProps {
  timestamp: number;
}

export function ResetEvent({ timestamp }: ResetEventProps) {
  return (
    <div className="flex flex-col gap-0 items-center">
      <div className="flex justify-center select-none">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="px-2 py-1 w-fit h-auto text-xs rounded-t-md opacity-70 hover:opacity-100 transition-opacity text-accent">
                conversation reset • {formatTimestamp(timestamp)}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>The agent has been reset to allow it to work longer.</p>
              <p>No memory of what happened before this point has been kept.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
