import { useState } from 'react';
import { Users, User, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import type { TemplateVisibility } from '@/services/agent.service';
import TemplateIcon from './ui/icons/TemplateIcon';

interface TemplateVisibilityPickerProps {
  value: TemplateVisibility;
  onChange: (visibility: TemplateVisibility) => void;
  disabled?: boolean;
  className?: string;
  /**
   * Mode of the picker:
   * - 'select': Shows current selection with chevron (for editing existing templates)
   * - 'create': Shows "Make a Template" button without chevron (for creating new templates)
   */
  mode?: 'select' | 'create';
}

const VISIBILITY_OPTIONS: { value: TemplateVisibility; label: string; description: string; icon: typeof Users }[] = [
  {
    value: 'shared',
    label: 'Project Members',
    description: 'Visible to all project collaborators',
    icon: Users
  },
  {
    value: 'personal',
    label: 'Only Me',
    description: 'Only visible to you',
    icon: User
  }
];

const CREATE_MODE_OPTIONS: { value: TemplateVisibility; label: string; icon: typeof Users }[] = [
  {
    value: 'personal',
    label: 'Only myself',
    icon: User
  },
  {
    value: 'shared',
    label: 'Everyone on the repo',
    icon: Users
  }
];

export function TemplateVisibilityPicker({
  value,
  onChange,
  disabled,
  className,
  mode = 'select'
}: TemplateVisibilityPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = VISIBILITY_OPTIONS.find(opt => opt.value === value) || VISIBILITY_OPTIONS[0];
  const Icon = selectedOption.icon;

  const handleSelect = (visibility: TemplateVisibility) => {
    onChange(visibility);
    setIsOpen(false);
  };

  if (mode === 'create') {
    return (
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="transparent"
            hoverVariant="default"
            size="sm"
            disabled={disabled}
            className={cn(
              "flex items-center gap-2 px-2 justify-start w-full",
              className
            )}
          >
            <div className="h-4 w-4 mr-1.5">
              <TemplateIcon className="max-w-full max-h-full text-inherit" />
            </div>
            <span className="text-sm">Set as Template</span>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          className="w-[200px] bg-background border-(length:--border-width) border-muted/30 p-1"
          align="start"
          side="bottom"
        >
          <div className="px-2 py-1.5 text-xs text-muted-foreground font-medium">
            Visibility
          </div>
          {CREATE_MODE_OPTIONS.map((option) => {
            const OptionIcon = option.icon;
            return (
              <DropdownMenuItem
                key={option.value}
                variant="transparent"
                hoverVariant="default"
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => handleSelect(option.value)}
              >
                <OptionIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{option.label}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="transparent"
          hoverVariant="default"
          size="sm"
          disabled={disabled}
          className={cn(
            "flex items-center gap-2 px-3 min-w-[140px] justify-between",
            disabled && "opacity-50 cursor-not-allowed",
            className
          )}
        >
          <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5" />
            <span className="text-sm">{selectedOption.label}</span>
          </div>
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="w-[220px] bg-background border-(length:--border-width) border-muted/30 p-1"
        align="start"
        side="bottom"
      >
        {VISIBILITY_OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          const isSelected = option.value === value;
          return (
            <DropdownMenuItem
              key={option.value}
              className={cn(
                "flex flex-col items-start gap-0.5 p-3 cursor-pointer",
                isSelected && "bg-muted/30"
              )}
              onClick={() => handleSelect(option.value)}
            >
              <div className="flex items-center gap-2">
                <OptionIcon className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{option.label}</span>
              </div>
              <span className="text-xs text-muted-foreground pl-6">
                {option.description}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
