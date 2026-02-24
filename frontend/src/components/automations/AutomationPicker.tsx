import { useState, useMemo } from 'react';
import { ChevronDown, Zap, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Automation {
  id: string;
  name: string;
  trigger: { type: string };
  scriptLanguage: string;
}

interface AutomationPickerProps {
  automations: Automation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  label?: string;
  placeholder?: string;
  helpText?: string;
  filterFn?: (automation: Automation, searchTerm: string) => boolean;
}

export function AutomationPicker({
  automations,
  selectedId,
  onSelect,
  label = 'Automation',
  placeholder = 'Select automation',
  helpText,
  filterFn = (automation, searchTerm) => automation.name.toLowerCase().includes(searchTerm.toLowerCase())
}: AutomationPickerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  // Filter automations by search term using custom filter function
  const filteredAutomations = useMemo(() => {
    if (!searchTerm.trim()) {
      return automations;
    }
    return automations.filter(auto => filterFn(auto, searchTerm.toLowerCase()));
  }, [searchTerm, automations, filterFn]);

  const selectedAutomation = automations.find(a => a.id === selectedId);

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="background"
            className="group flex items-center gap-2 px-3 transition-colors justify-between w-full"
          >
            <div className="flex items-center gap-2">
              <Zap className="h-3 w-3 transition-colors opacity-80" />
              <span className="truncate">
                {selectedAutomation?.name || placeholder}
              </span>
            </div>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-[280px] max-h-[300px] bg-background border-(length:--border-width) border-muted/30 p-2"
          align="start"
          side="bottom"
        >
          {/* Search Input */}
          <div className="p-1 border-b border-background" onClick={(e) => e.stopPropagation()}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search automations..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-8 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsOpen(false);
                  }
                  e.stopPropagation();
                }}
              />
            </div>
          </div>

          {/* Automation List */}
          <div className="max-h-[200px] overflow-y-auto flex flex-col gap-1">
            {filteredAutomations.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground text-center">
                {searchTerm ? 'No matching automations' : 'No automations available'}
              </div>
            ) : (
              filteredAutomations.map((auto) => (
                <DropdownMenuItem
                  key={auto.id}
                  className="flex flex-col items-start gap-1 p-3 cursor-pointer"
                  onClick={() => {
                    onSelect(auto.id);
                    setIsOpen(false);
                    setSearchTerm('');
                  }}
                >
                  <div className="flex items-center gap-2 w-full">
                    <span className="flex-1 truncate font-medium">{auto.name}</span>
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
    </div>
  );
}
