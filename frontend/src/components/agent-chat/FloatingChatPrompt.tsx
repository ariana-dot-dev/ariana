import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import Chat from '../ui/icons/Chat';

interface FloatingChatPromptProps {
  viewMode: 'diffs' | 'desktop' | 'web-previews';
  sendPrompt: (prompt: string) => Promise<boolean>;
  interruptAgent?: () => Promise<void>;
  canInterrupt: boolean;
  canSendPrompts: boolean;
  activePreviewInfo?: string; // e.g. "port 3000 - /dashboard"
}

function buildContextPrefix(viewMode: string, activePreviewInfo?: string): string {
  switch (viewMode) {
    case 'diffs':
      return '[Looking at code diffs] ';
    case 'desktop':
      return '[Looking at the desktop] ';
    case 'web-previews':
      if (activePreviewInfo) {
        return `[Looking at web preview of ${activePreviewInfo}] `;
      }
      return '[Looking at web preview] ';
    default:
      return '';
  }
}

export function FloatingChatPrompt({
  viewMode,
  sendPrompt,
  interruptAgent,
  canInterrupt,
  canSendPrompts,
  activePreviewInfo,
}: FloatingChatPromptProps) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when expanded
  useEffect(() => {
    if (expanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [expanded]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      // Interrupt if agent is running
      if (canInterrupt && interruptAgent) {
        await interruptAgent();
      }

      const contextPrefix = buildContextPrefix(viewMode, activePreviewInfo);
      const success = await sendPrompt(contextPrefix + trimmed);
      if (success) {
        setText('');
        setExpanded(false);
      }
    } finally {
      setSending(false);
    }
  }, [text, sending, canInterrupt, interruptAgent, viewMode, activePreviewInfo, sendPrompt]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      setExpanded(false);
    }
  }, [handleSend]);

  if (!canSendPrompts) return null;

  if (!expanded) {
    return (
      <div className="sticky bottom-4 z-20 flex justify-center pointer-events-none">
        <button
          onClick={() => setExpanded(true)}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full pointer-events-auto",
            "bg-background/80 backdrop-blur-sm border-(length:--border-width) border-border",
            "text-sm text-muted-foreground hover:text-foreground hover:border-foreground/10",
            "transition-colors shadow-sm",
          )}
        >
          <div className="w-4 h-4">
            <Chat className="max-w-full max-h-full text-inherit" />
          </div>
          <span className="text-xs">Send a comment to the agent</span>
        </button>
      </div>
    );
  }

  return (
    <div className="sticky bottom-4 z-20 flex justify-center pointer-events-none w-full">
      <div className="bg-background/95 backdrop-blur-sm border-(length:--border-width) border-border rounded-lg shadow-lg p-2 pointer-events-auto w-full max-w-md">
        <div className="flex items-start gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={2}
            className={cn(
              "flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 p-2",
              "focus:outline-none min-h-[3rem] max-h-[8rem]",
            )}
          />
          <div className="flex flex-col gap-1 shrink-0">
            <button
              onClick={handleSend}
              disabled={!text.trim() || sending}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                text.trim() && !sending
                  ? "text-accent hover:bg-accent/10"
                  : "text-muted-foreground/30",
              )}
            >
              <Send className="w-4 h-4" />
            </button>
            <button
              onClick={() => setExpanded(false)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {canInterrupt && (
          <div className="text-[10px] text-muted-foreground/50 mt-1 px-0.5">
            Will interrupt agent before sending
          </div>
        )}
      </div>
    </div>
  );
}
