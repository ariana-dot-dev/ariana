import { CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TodoWriteResult } from '@/bindings/types';
import { BaseToolDisplay } from './BaseToolDisplay';
import { ToolContentBlock } from './shared/ToolContentBlock';

interface TodoWriteDisplayProps {
  structuredResult: TodoWriteResult;
}

export function TodoWriteDisplay({ structuredResult }: TodoWriteDisplayProps) {
  const badges = [
    <Badge key="count" variant="default" className="text-xs h-4">
      {structuredResult.todos.length} todos
    </Badge>
  ];

  const expandedContent = (
    <ToolContentBlock>
      <div className="rounded-md border-(length:--border-width) border-background/50 overflow-auto max-h-96 bg-background">
        <div className="p-2 space-y-2">
          {structuredResult.todos.map((todo, index) => (
            <div key={index} className="flex items-center gap-2 p-1.5 bg-muted/30 rounded">
              <span className={cn(
                "w-2 h-2 rounded-full flex-shrink-0",
                todo.state === 'completed' ? "bg-constructive" : "bg-yellow-500"
              )} />
              <span className="flex-1 text-xs">{todo.content}</span>
              <Badge variant="outline" className="text-xs h-4">
                {todo.state}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </ToolContentBlock>
  );

  const collapsedPreview = !structuredResult.pending ? (
    <div className="text-xs text-muted-foreground truncate">
      Updated {structuredResult.todos.length} todos
    </div>
  ) : null;

  return (
    <BaseToolDisplay
      icon={<CheckCircle2 className="h-3 w-3" />}
      title="TodoWrite"
      color="text-muted-foreground"
      subtitle=""
      badges={badges}
      pending={structuredResult.pending}
      pendingText="Updating..."
      expandedContent={expandedContent}
      collapsedPreview={collapsedPreview}
    />
  );
}