import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';

interface CopyableCommandProps {
  command: string;
  className?: string;
}

export function CopyableCommand({ command, className = '' }: CopyableCommandProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className={`flex items-center gap-2 pl-4 pr-2 py-2 rounded-md dark:bg-darkest/70 bg-lightest/70 font-mono text-xs ${className}`}>
      <code className="flex-1 overflow-x-auto whitespace-nowrap">{command}</code>
      <Button
        variant="transparent"
        size="sm"
        onClick={handleCopy}
        className="h-6 w-6 p-0 flex-shrink-0"
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-500" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </Button>
    </div>
  );
}
