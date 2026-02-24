import { useState, ReactNode, memo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BaseToolDisplayProps {
  icon: ReactNode;
  title: string;
  color: string;
  subtitle?: string;
  badges?: ReactNode[];
  pending: boolean;
  pendingText?: string;
  expandedContent?: ReactNode;
  collapsedPreview?: ReactNode;
  className?: string;
  /** When true, renders only the expanded content without any wrapper/header */
  contentOnly?: boolean;
}

function BaseToolDisplayComponent({
  icon,
  title,
  color,
  subtitle,
  badges = [],
  pending,
  pendingText = "Processing...",
  expandedContent,
  collapsedPreview,
  className
}: BaseToolDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasExpandableContent = !pending && expandedContent;

  return (
    <div className={cn(
      "rounded-lg flex flex-col w-full bg-background transition-all",
      className
    )}>
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 transition-colors",
          hasExpandableContent && "cursor-pointer hover:bg-muted/30",
          hasExpandableContent && "rounded-t-lg",
          isExpanded && ""
        )}
        onClick={() => hasExpandableContent && setIsExpanded(!isExpanded)}
      >
        <div className={"h-4 w-4 flex-shrink-0 " + color}>
          {icon}
        </div>

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className={"text-sm font-medium " + color}>{title}</span>
          {subtitle && (
            <span className="text-sm text-muted-foreground truncate">{subtitle}</span>
          )}
          {badges.map((badge, index) => (
            <div key={index}>{badge}</div>
          ))}
        </div>

        {pending && (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-chart-1 animate-pulse" />
            <span className="text-xs text-muted-foreground">{pendingText}</span>
          </div>
        )}

        {hasExpandableContent && (
          <div className="flex-shrink-0">
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </div>
        )}
      </div>

      {hasExpandableContent && isExpanded && (
        <div className="p-2.5">
          {expandedContent}
        </div>
      )}

      {!pending && !isExpanded && collapsedPreview && (
        <div className="p-4 py-2.5 opacity-70">
          {collapsedPreview}
        </div>
      )}
    </div>
  );
}

// Memoize to prevent re-renders when tool data hasn't changed
export const BaseToolDisplay = memo(BaseToolDisplayComponent, (prevProps, nextProps) => {
  // Compare all props (ReactNodes are compared by reference)
  return (
    prevProps.title === nextProps.title &&
    prevProps.subtitle === nextProps.subtitle &&
    prevProps.color === nextProps.color &&
    prevProps.pending === nextProps.pending &&
    prevProps.pendingText === nextProps.pendingText &&
    prevProps.className === nextProps.className &&
    // ReactNodes (icon, badges, expandedContent, collapsedPreview) - compare by reference
    prevProps.icon === nextProps.icon &&
    JSON.stringify(prevProps.badges) === JSON.stringify(nextProps.badges) &&
    prevProps.expandedContent === nextProps.expandedContent &&
    prevProps.collapsedPreview === nextProps.collapsedPreview
  );
});