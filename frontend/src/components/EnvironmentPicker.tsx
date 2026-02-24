import { useState, useEffect } from 'react';
import { ChevronDown, Search, Loader2, Package } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { PersonalEnvironment } from '@/hooks/useEnvironments';
import EnvironmentIcon from './ui/icons/EnvironmentIcon';

interface EnvironmentPickerProps {
  currentEnvironmentId?: string | null;
  currentEnvironmentName?: string | null;
  environments: PersonalEnvironment[];
  onEnvironmentSelect: (environmentId: string) => void;
  className?: string;
  disabled?: boolean;
  variant: Variant;
  loading?: boolean;
  currentUserId?: string | null;
}

export type Variant = 'in-list' | 'in-form';

export function EnvironmentPicker({
  currentEnvironmentId,
  currentEnvironmentName,
  environments,
  onEnvironmentSelect,
  className,
  disabled,
  variant = 'in-list',
  loading = false,
  currentUserId
}: EnvironmentPickerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredEnvironments, setFilteredEnvironments] = useState<PersonalEnvironment[]>(environments);
  const [isOpen, setIsOpen] = useState(false);

  // Filter environments based on search term
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredEnvironments(environments);
    } else {
      const filtered = environments.filter(env =>
        env.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredEnvironments(filtered);
    }
  }, [searchTerm, environments]);

  const handleEnvironmentSelect = (environmentId: string) => {
    onEnvironmentSelect(environmentId);
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setSearchTerm('');
    }
  };

  // Get display name for the current environment
  const displayName = currentEnvironmentName ||
    (currentEnvironmentId ? environments.find(e => e.id === currentEnvironmentId)?.name : null) ||
    'None';

  return (
    <div className={cn("flex items-center gap-2 w-full", className)}>
      <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button 
          variant={variant === 'in-list' ? "transparent" : 'default'}
          hoverVariant={variant === 'in-list' ? 'default' : undefined}
          wFull={variant === 'in-list'}
          size={variant === 'in-list' ? 'sm' : undefined} disabled={disabled} className={cn(
            "group flex items-center gap-2 transition-colors justify-between w-fit",
            variant === 'in-list' ? "px-2" : 'px-4',
            disabled && "opacity-50 cursor-not-allowed pointer-events-none"
          )}>
            <div className={cn(
              "flex items-center",
              variant === 'in-list' ? "gap-4" : 'gap-2',
            )}>
              <div className="h-4 w-4">
                <EnvironmentIcon className='max-w-full max-h-full text-inherit'/>
              </div>
              <span className="truncate">Env: {displayName.substring(0, 14) + (displayName.length > 14 ? '...' : '')}</span>
            </div>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          className="w-[280px] max-h-[300px] bg-background border-(length:--border-width) border-muted/30 p-2 gap-2"
          align="start"
          side="bottom"
        >
          {/* Search Input */}
          <div className="" onClick={(e) => e.stopPropagation()}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search environments..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-8 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  // Prevent dropdown from closing on certain key presses
                  if (e.key === 'Escape') {
                    setIsOpen(false);
                  }
                  e.stopPropagation();
                }}
              />
            </div>
          </div>

          {/* Environment List */}
          <div className="max-h-[200px] overflow-y-auto flex flex-col gap-1">
            {filteredEnvironments.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground text-center">
                No environments found
              </div>
            ) : (
              filteredEnvironments.map((environment) => {
                const isOtherOwner = currentUserId && environment.owner && environment.owner.id !== currentUserId;
                return (
                  <DropdownMenuItem
                    key={environment.id}
                    className="flex items-center gap-2 p-3 cursor-pointer"
                    onClick={() => handleEnvironmentSelect(environment.id)}
                  >
                    <div className="h-4 w-4">
                      <EnvironmentIcon className="max-w-full max-h-full text-inherit" />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col">
                      <span className="truncate">{environment.name}</span>
                      {isOtherOwner && (
                        <span className="text-xs text-muted-foreground truncate">
                          from {environment.owner?.name || 'Anonymous'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {environment.id === currentEnvironmentId && (
                        <Badge variant="default" className="text-xs">
                          Current
                        </Badge>
                      )}
                    </div>
                  </DropdownMenuItem>
                );
              })
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
