import type { ToolResult } from '@/bindings/types';

interface SkillDisplayProps {
  skillName: string;
  input: Record<string, unknown>;
  toolResult?: ToolResult;
}

export function SkillDisplay({ skillName, input, toolResult }: SkillDisplayProps) {
  return (
    <div className="rounded-md border border-border/50 overflow-auto max-h-96 bg-muted/30 p-3">
      <div className="text-xs font-mono text-foreground whitespace-pre-wrap break-words">
        {toolResult?.content || `[No content] skill=${skillName} hasResult=${!!toolResult}`}
      </div>
    </div>
  );
}
