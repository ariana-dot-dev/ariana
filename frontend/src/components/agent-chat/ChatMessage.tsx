import { Badge } from '@/components/ui/badge';
import type { ChatEvent, Agent } from '@/bindings/types';
import { AgentState } from '@/bindings/types';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { memo, useCallback, useMemo, useState, type ComponentPropsWithoutRef } from 'react';
import { useAnimatedContent } from '@/hooks/useAnimatedContent';
import { ClaudeProviderConfig } from '../ClaudeProviderConfig';
import { useAppStore } from '@/stores/useAppStore';
import { useIsBrowser } from '@/hooks/useIsBrowser';
import { useTheme } from '@/hooks/useTheme';
import { openUrl } from '@tauri-apps/plugin-opener';
import { SyntaxHighlightedCode } from '@/components/ui/SyntaxHighlightedCode';
import { MermaidDiagram } from '@/components/ui/MermaidDiagram';
import { ToolRow } from './ToolEventsGroup';
import type { ToolWithResult } from './tools/ToolSummary';

interface ChatMessageProps {
  event: ChatEvent;
  compact: boolean;
  agent?: Agent;
  onCancelPrompt?: (promptId: string) => Promise<void>;
  onSkipQueue?: (promptId: string) => Promise<void>;
  isFirstQueued?: boolean;
}

// Helper function to render "ultrathink" with rainbow colors
const renderWithRainbowUltrathink = (text: string) => {
  const rainbowColors = [
    'var(--chart-1)', // red
    'var(--constructive)',
    'var(--chart-2)', // orange
    'var(--chart-5)', // yellow
    'var(--chart-3)', // green
    'var(--destructive)',
    'var(--chart-4)', // blue
  ];

  // Find all occurrences of "ultrathink" (case-insensitive)
  const regex = /ultrathink/gi;
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    // Add rainbow "ultrathink"
    const word = match[0];
    const rainbowLetters = word.split('').map((letter, i) => (
      <span key={`${match!.index}-${i}`} style={{ color: rainbowColors[i % rainbowColors.length] }}>
        {letter}
      </span>
    ));
    parts.push(<span key={match.index}>{rainbowLetters}</span>);

    lastIndex = match.index + word.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
};

function InlineToolsList({ tools }: { tools: ToolWithResult[] }) {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  const toggleTool = (toolId: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  };

  return (
    <div className="mt-1 rounded-lg opacity-70 dark:opacity-50 hover:opacity-100">
      {tools.map((tool, i) => (
        <ToolRow
          key={tool.use.id}
          tool={tool}
          isExpanded={expandedTools.has(tool.use.id)}
          onToggle={() => toggleTool(tool.use.id)}
          showConnectorAfter={i < tools.length - 1}
        />
      ))}
    </div>
  );
}

function ChatMessageComponent({ event, compact, agent, onCancelPrompt, onSkipQueue, isFirstQueued }: ChatMessageProps) {
  const isReverted = event.type !== 'git_checkpoint' && (event.data as any).is_reverted;
  const containerClasses = isReverted ? "opacity-50" : "";
  const isBrowser = useIsBrowser();
  const { isDark } = useTheme();

  // Typewriter animation for response messages (streaming and newly-arrived)
  const responseContent = event.type === 'response' ? event.data.content : '';
  const isStreamingResponse = event.type === 'response' && !!event.data.is_streaming;
  const animatedContent = useAnimatedContent(responseContent, isStreamingResponse, event.timestamp);

  const largePrompt = event.type === 'prompt' && event.data.prompt.split('\n').length > 1;

  const handleOpenBugReport = async () => {
    if (isBrowser) {
      window.open('https://github.com/ariana-dot-dev/ariana/issues', '_blank');
    } else {
      await openUrl('https://github.com/ariana-dot-dev/ariana/issues');
    }
  };

  const handleOpenLink = useCallback(async (url: string) => {
    if (isBrowser) {
      window.open(url, '_blank');
    } else {
      await openUrl(url);
    }
  }, [isBrowser]);

  // Custom markdown components for code highlighting and proper link handling
  // Memoized with isDark dependency to re-render when theme changes
  const markdownComponents: ComponentPropsWithoutRef<typeof Markdown>['components'] = useMemo(() => ({
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : undefined;
      const codeString = String(children).replace(/\n$/, '');

      // Check if it's an inline code (no language specified and single line)
      const isInline = !match && !codeString.includes('\n');

      if (isInline) {
        const text = Array.isArray(children) 
          ? children.join('') 
          : String(children);
        const cleanedCode = text.replace(/`/g, '');

        return (
          <code className={cn(" bg-lightest dark:bg-background-darker px-1.5 py-0.5 rounded text-sm font-mono", className)} {...props}>
            {cleanedCode}
          </code>
        );
      }

      if (language === 'mermaid') {
        return <MermaidDiagram code={codeString} />;
      }

      return (
        <div className="my-2 overflow-hidden rounded-lg bg-lightest dark:bg-background-darker">
          <SyntaxHighlightedCode
            code={codeString}
            language={language || 'text'}
            isDark={isDark}
            className="text-sm"
          />
        </div>
      );
    },
    pre({ children }) {
      // Just pass through children - the code component handles everything
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      return (
        <a
          {...props}
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (href) {
              handleOpenLink(href);
            }
          }}
          className="text-accent hover:underline cursor-pointer"
        >
          {children}
        </a>
      );
    },
  }), [isDark, handleOpenLink]);

  if (event.type === 'prompt') {
    const hasUltrathink = /ultrathink/i.test(event.data.prompt);

    // Custom text renderer that handles "ultrathink" with rainbow colors
    const ultrathinkComponents = {
      // Handle text nodes to apply rainbow coloring to "ultrathink"
      p: ({ children, ...props }: any) => {
        if (typeof children === 'string') {
          return <p {...props}>{renderWithRainbowUltrathink(children)}</p>;
        }
        // If children is an array, map over each child
        if (Array.isArray(children)) {
          return (
            <p {...props}>
              {children.map((child, i) =>
                typeof child === 'string'
                  ? <span key={i}>{renderWithRainbowUltrathink(child)}</span>
                  : child
              )}
            </p>
          );
        }
        return <p {...props}>{children}</p>;
      },
      // Handle other inline elements
      text: ({ children, ...props }: any) => {
        if (typeof children === 'string') {
          return <>{renderWithRainbowUltrathink(children)}</>;
        }
        return <>{children}</>;
      },
    };

    // Merge base components with ultrathink-specific ones if needed
    const promptComponents = hasUltrathink
      ? { ...markdownComponents, ...ultrathinkComponents }
      : markdownComponents;

    return (
      <div className={cn(
        `bg-background rounded-2xl rounded-tl-sm w-fit px-4 py-2 my-6 lg:px-6 lg:py-4 max-w-full overflow-hidden ${containerClasses} flex flex-col gap-1`,
      )}>
        <div className="flex-1 min-w-0 flex-col flex gap-0">
          <div className={cn(
            "text-base text-foreground",
          )}>
            <article className="prose prose-pink">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={promptComponents}
              >
                {event.data.prompt}
              </Markdown>
            </article>
          </div>
          {event.data.status === 'sending' && (
            <div className="ml-auto text-xs opacity-50 animate-pulse">
              {event.data.status}
            </div>
          )}
          {event.data.status === 'queued' && event.taskId && (
            <div className="ml-auto flex items-center gap-2 text-xs">
              <span className="opacity-50 animate-pulse">queued</span>
              {onSkipQueue && agent?.state === AgentState.RUNNING && isFirstQueued && (
                <button
                  onClick={() => onSkipQueue(event.taskId!)}
                  className="text-accent hover:text-accent/80 hover:underline transition-colors"
                >
                  skip queue
                </button>
              )}
              {onCancelPrompt && (
                <button
                  onClick={() => onCancelPrompt(event.taskId!)}
                  className="text-destructive-foreground/50 hover:text-destructive-foreground/80 hover:underline transition-colors"
                >
                  cancel
                </button>
              )}
            </div>
          )}
          {['failed'].includes(event.data.status) && (
            <div className="ml-auto text-xs text-destructive-foreground">
              {event.data.status}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (event.type === 'response' && event.data.content.includes('/login') && event.data.model === '<synthetic>') {
    return (
      <div className={`flex flex-col items-start gap-6 space-x-2 px-2 lg:px-4 text-muted-foreground ${containerClasses}`}>
        <div className="flex-1 min-w-0">
          Claude Code responded that your API key or OAuth token is invalid. You need to setup new ones:
        </div>
        <ClaudeProviderConfig/>
      </div>
    );
  }

  if (event.type === 'response' && event.data.content.includes('Credit balance is too low') && event.data.model === '<synthetic>') {
    return (
      <div className={`flex flex-col items-start gap-6 space-x-2 px-2 lg:px-4 text-muted-foreground ${containerClasses}`}>
        <div className="flex-1 min-w-0">
          Claude Code responded that your API credit balance is too low. Please top up your account or switch to the Claude Code subscription login.
        </div>
        <ClaudeProviderConfig/>
      </div>
    );
  }

  if (
    event.type === 'response' 
    && event.data.content.includes('This credential is only authorized for use with Claude Code and cannot be used for other API requests.') 
    && event.data.model === '<synthetic>'
  ) {
    return (
      <div className={`flex flex-col items-start gap-6 space-x-2 px-2 lg:px-4 text-muted-foreground ${containerClasses}`}>
        <div className="flex-1 min-w-0">
          Claude Code responded that you cannot use this model with your current subscription plan. Please pick another model in the selector.
          If you have an API key configured instead, this is an issue from our end, please <span className='cursor-pointer hover:underline text-accent' onClick={() => handleOpenBugReport()}>report</span>.
        </div>
        <ClaudeProviderConfig/>
      </div>
    );
  }

  if (event.type === 'response' && (event.data.content || event.data.tools)) {
    const inlineTools: ToolWithResult[] = event.data.content && event.data.tools ? event.data.tools : [];

    return (
      <div className={`flex items-start space-x-2 px-2 lg:px-4 text-muted-foreground ${containerClasses}`}>
        <div className="flex-1 min-w-0">
          {event.data.content && (
            <div className="text-sm my-0 w-fit max-w-full">
              <article className="prose prose-pink">
                <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{animatedContent}</Markdown>
              </article>
              {event.data.is_streaming && (
                <span className="inline-block w-1.5 h-3.5 bg-accent animate-pulse ml-0.5 -mb-0.5 rounded-sm" />
              )}
            </div>
          )}
          {inlineTools.length > 0 && (
            <InlineToolsList tools={inlineTools} />
          )}
        </div>
      </div>
    );
  }

  return null;
}

// Memoize to prevent re-renders when event data hasn't changed
// Note: Using default memo comparison to allow re-renders when hooks (like useTheme) change
export const ChatMessage = memo(ChatMessageComponent);