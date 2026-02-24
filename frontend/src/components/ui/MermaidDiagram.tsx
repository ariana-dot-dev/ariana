import { useMemo } from 'react';
import { renderMermaidSVG } from 'beautiful-mermaid';

interface MermaidDiagramProps {
  code: string;
}

export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const { svg, error } = useMemo(() => {
    try {
      return {
        svg: renderMermaidSVG(code, {
          bg: 'var(--background)',
          fg: 'var(--foreground)',
          accent: 'var(--accent)',
          transparent: true,
        }),
        error: null,
      };
    } catch (err) {
      return { svg: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }, [code]);

  if (error) {
    return (
      <pre className="text-xs text-destructive-foreground/70 bg-lightest dark:bg-background-darker rounded-lg p-3 my-2 overflow-auto">
        {error.message}
      </pre>
    );
  }

  return (
    <div
      className="my-2 overflow-auto rounded-lg [&_svg]:max-w-full [&_svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: svg! }}
    />
  );
}
