import { cn } from '@/lib/utils';
import { ReactNode, useMemo } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { detectLanguageFromPath } from '@/components/ui/SyntaxHighlightedCode';
import { Highlight, themes, type PrismTheme } from 'prism-react-renderer';

interface ToolContentBlockProps {
  children: ReactNode;
  className?: string;
}

/**
 * Shared content block wrapper for tool expanded content
 */
export function ToolContentBlock({ children, className }: ToolContentBlockProps) {
  return (
    <div className="">
      {children}
    </div>
  );
}

interface CodeViewerProps {
  lines: Array<{ content: string; number?: number }>;
  language?: string;
  filePath?: string;
  maxHeight?: string;
}

/**
 * Code viewer with line numbers for displaying file content, bash output, etc.
 */
export function CodeViewer({ lines, language, filePath, maxHeight = "max-h-96" }: CodeViewerProps) {
  const { isDark } = useTheme();

  // Detect language from filePath if provided, otherwise use provided language or 'text'
  const detectedLanguage = filePath ? detectLanguageFromPath(filePath) : (language || 'text');

  // Reconstruct full code for proper context highlighting
  // Memoize to avoid re-computing on every render
  const fullCode = useMemo(
    () => lines.map(line => line.content).join('\n'),
    [lines] // Re-compute when lines array changes
  );

  // Create transparent theme
  const baseTheme = isDark ? themes.vsDark : themes.vsLight;
  const theme: PrismTheme = {
    ...baseTheme,
    plain: {
      ...baseTheme.plain,
      backgroundColor: 'transparent',
      background: 'transparent',
    }
  };

  return (
    <div className={cn(
      "rounded-md overflow-auto border-(length:--border-width) border-muted/10",
      maxHeight
    )}>
      <Highlight theme={theme} code={fullCode} language={detectedLanguage}>
        {({ tokens, getTokenProps }) => (
          <>
            {tokens.map((lineTokens, index) => {
              const line = lines[index];
              if (!line) return null;

              return (
                <div
                  key={index}
                  className="flex hover:bg-muted/30 transition-colors"
                >
                  <div className="w-11 flex-shrink-0 text-right px-2 py-0.5 text-xs text-muted-foreground/40 bg-muted/10 select-none font-mono">
                    {line.number ?? index + 1}
                  </div>
                  <div className="flex-1 px-3 py-0.5 whitespace-pre-wrap break-all text-xs font-mono">
                    {lineTokens.map((token, tokenIndex) => {
                      const props = getTokenProps({ token });
                      return (
                        <span
                          key={tokenIndex}
                          {...props}
                          style={{ ...props.style, backgroundColor: 'transparent' }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </Highlight>
    </div>
  );
}

interface ToolHeaderProps {
  children: ReactNode;
  className?: string;
}

/**
 * Header section for tool metadata
 */
export function ToolHeader({ children, className }: ToolHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-2 mb-3", className)}>
      {children}
    </div>
  );
}

interface ToolMetadataProps {
  label?: string;
  value: string;
  mono?: boolean;
}

/**
 * Metadata label/value pair
 */
export function ToolMetadata({ label, value, mono = false }: ToolMetadataProps) {
  return (
    <span className={cn("text-xs text-muted-foreground", mono && "font-mono")}>
      {label && `${label}: `}{value}
    </span>
  );
}
