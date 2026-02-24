import { useState } from 'react';
import Copy from '../ui/icons/Copy';
import CheckmarkCircle from '../ui/icons/CheckmarkCircle';
import DownloadIcon from '../ui/icons/DownloadIcon';
import Fork from '../ui/icons/Fork';
import { toast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface DiffActionButtonsProps {
  diff: string;
  onCreateAgentWithPrompt?: (prompt: string) => void;
}

export function DiffActionButtons({ diff, onCreateAgentWithPrompt }: DiffActionButtonsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!diff) return;
    try {
      await navigator.clipboard.writeText(diff);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy diff:', error);
      toast({
        title: 'Error',
        description: 'Failed to copy diff to clipboard',
        variant: 'destructive',
      });
    }
  };

  const handleDownload = () => {
    if (!diff) return;
    const blob = new Blob([diff], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'changes.diff';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleHandoff = () => {
    if (!diff || !onCreateAgentWithPrompt) return;
    onCreateAgentWithPrompt(`check this out:\n${diff}`);
  };

  if (!diff) return null;

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleCopy}
            className="h-5 w-5 hover:text-accent transition-colors"
          >
            {copied ? (
              <CheckmarkCircle className="max-h-full max-w-full text-inherit" />
            ) : (
              <Copy className="max-h-full max-w-full text-inherit" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>Copy diff</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleDownload}
            className="h-5 w-5 hover:text-accent transition-colors"
          >
            <DownloadIcon className="max-h-full max-w-full text-inherit" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Download as .diff file</TooltipContent>
      </Tooltip>

      {onCreateAgentWithPrompt && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleHandoff}
              className="h-5 w-5 hover:text-accent transition-colors"
            >
              <Fork className="max-h-full max-w-full text-inherit" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Hand off to new agent</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
