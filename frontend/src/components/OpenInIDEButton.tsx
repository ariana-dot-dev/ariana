import { useState, useCallback } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import CodeFolder from './ui/icons/CodeFolder';
import { useIDEIntegration, type AvailableIDE } from '@/hooks/useIDEIntegration';

interface OpenInIDEButtonProps {
  /** Project ID for IDE preference storage */
  projectId: string;
  /** Size variant - small for inline usage, large for header buttons */
  size: 'small' | 'large';
  /**
   * Called when user wants to open in IDE.
   * Receives the ideId to use - the component handles preference storage.
   * Return a promise to show loading state.
   */
  onOpen: (ideId: string) => void | Promise<void> | Promise<boolean>;
  /** Whether the button is disabled */
  disabled?: boolean;
  /**
   * Optional filter function to restrict which IDEs are shown.
   * Useful for SSH mode which only supports certain IDEs.
   */
  filterIDEs?: (ide: AvailableIDE) => boolean;
  /**
   * Custom function to generate button text.
   * Receives the IDE name (or null if no preferred IDE).
   */
  getButtonText?: (ideName: string | null) => React.ReactNode;
  /** Tooltip text when hovering the button (only for large size) */
  tooltipText?: string;
  /** Whether to show the CodeFolder icon (default: true for large, false for small) */
  showIcon?: boolean;
  /** Additional className for the container */
  className?: string;
  /** Whether this is rendered inside a dropdown menu (affects styling) */
  inDropdown?: boolean;
}

/**
 * A reusable button component for opening projects in an IDE.
 *
 * Encapsulates IDE selection logic and preference management internally.
 *
 * Has two modes:
 * - With preferred IDE: Shows button with IDE name + dropdown to change
 * - Without preferred IDE: Shows dropdown to select IDE first
 *
 * Supports small (inline) and large (header) sizes.
 */
export function OpenInIDEButton({
  projectId,
  size,
  onOpen,
  disabled = false,
  filterIDEs,
  getButtonText,
  tooltipText,
  showIcon,
  className,
  inDropdown = false,
}: OpenInIDEButtonProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Use the IDE integration hook internally
  const {
    availableIDEs: allAvailableIDEs,
    loading: idesLoading,
    preferredIDE,
    preferredIDEInfo: rawPreferredIDEInfo,
    setPreferredIDE,
  } = useIDEIntegration(projectId);

  // Apply filter if provided
  const availableIDEs = filterIDEs
    ? allAvailableIDEs.filter(filterIDEs)
    : allAvailableIDEs;

  // Check if preferred IDE is in the filtered list
  const preferredIDEInList = preferredIDE && availableIDEs.some(ide => ide.id === preferredIDE);
  const effectivePreferredIDE = preferredIDEInList ? preferredIDE : null;
  const preferredIDEInfo = preferredIDEInList ? rawPreferredIDEInfo : undefined;

  // Default icon visibility based on size
  const shouldShowIcon = showIcon ?? (size === 'large');

  // Size-specific styling
  const sizeStyles = {
    small: {
      container: 'h-5',
      button: 'h-full text-xs px-2',
      dropdownTrigger: 'h-full px-2',
      icon: 'h-4 w-4',
      chevron: 'size-3.5',
    },
    large: {
      container: 'h-full',
      button: 'h-full text-xs px-2 py-1',
      dropdownTrigger: 'h-full px-0.5 py-1',
      icon: 'h-4 w-4',
      chevron: 'size-3.5',
    },
  };

  const styles = sizeStyles[size];

  // Default button text generator
  const defaultGetButtonText = (ideName: string | null): React.ReactNode => {
    if (ideName) {
      return <>Open in {ideName}</>;
    }
    return <>Open in your IDE</>;
  };

  const buttonTextFn = getButtonText || defaultGetButtonText;

  // Handle opening in IDE
  const handleOpen = useCallback(async (ideId?: string) => {
    const targetIdeId = ideId || effectivePreferredIDE;
    if (!targetIdeId) return;

    // Save preference if user selected a specific IDE
    if (ideId) {
      setPreferredIDE(ideId);
    }

    setIsLoading(true);
    try {
      await onOpen(targetIdeId);
    } finally {
      setIsLoading(false);
    }
  }, [effectivePreferredIDE, onOpen, setPreferredIDE]);

  // Don't render if no IDEs available (only after loading completes to avoid flicker)
  if (!idesLoading && availableIDEs.length === 0) {
    return null;
  }

  const isDisabled = disabled || isLoading;

  const buttonContent = (
    <div className={cn(
      "flex w-fit",
      styles.container,
      inDropdown ? "w-full" : "",
      className
    )}>
      {effectivePreferredIDE ? (
        /* Hybrid button with preferred IDE */
        <div className={cn(
          "flex w-fit items-stretch h-full rounded-md hover:bg-background transition-all opacity-90 hover:opacity-100",
          inDropdown && "w-full",
          size === 'large' && "bg-transparent"
        )}>
          <button
            onClick={() => handleOpen()}
            disabled={isDisabled}
            className={cn(
              "inline-flex w-full h-full items-center justify-center gap-2 rounded-l-md text-muted-foreground outline-none whitespace-nowrap transition-all",
              styles.button,
              isDisabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {isLoading ? (
              <Loader2 className={cn(styles.icon, "animate-spin")} />
            ) : (
              <>
                {shouldShowIcon && (
                  <div className={styles.icon}>
                    <CodeFolder className="max-h-full max-w-full text-inherit" />
                  </div>
                )}
                {buttonTextFn(preferredIDEInfo?.name || null)}
              </>
            )}
          </button>
          <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "inline-flex h-full items-center justify-center rounded-r-md hover:bg-muted/20 text-foreground outline-none transition-all",
                  styles.dropdownTrigger
                )}
                disabled={isDisabled}
              >
                <ChevronDown className={cn(styles.chevron, isDropdownOpen && "rotate-180 transition-transform")} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-background border-(length:--border-width) border-muted/40 z-50" align="end">
              {availableIDEs.map((ide) => (
                <DropdownMenuItem
                  key={ide.id}
                  variant="transparent"
                  hoverVariant="default"
                  className="cursor-pointer text-foreground"
                  onClick={() => handleOpen(ide.id)}
                >
                  <span>{ide.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        /* Dropdown-only (no preferred IDE yet) */
        <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "inline-flex w-full h-full items-center justify-center gap-2 rounded-md hover:bg-background text-muted-foreground outline-none whitespace-nowrap transition-all",
                styles.button,
                isDisabled && "opacity-50 cursor-not-allowed"
              )}
              disabled={isDisabled}
            >
              {isLoading ? (
                <Loader2 className={cn(styles.icon, "animate-spin")} />
              ) : (
                <>
                  {shouldShowIcon && (
                    <div className={styles.icon}>
                      <CodeFolder className="max-h-full max-w-full text-inherit" />
                    </div>
                  )}
                  <span>{buttonTextFn(null)}</span>
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-background border-(length:--border-width) border-muted/40 z-50" align="end">
            {availableIDEs.map((ide) => (
              <DropdownMenuItem
                key={ide.id}
                variant="transparent"
                hoverVariant="default"
                className="cursor-pointer"
                onClick={() => handleOpen(ide.id)}
              >
                <span>{ide.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  // Wrap in tooltip for large size if tooltip text provided
  if (size === 'large' && tooltipText) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {buttonContent}
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{tooltipText}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return buttonContent;
}
