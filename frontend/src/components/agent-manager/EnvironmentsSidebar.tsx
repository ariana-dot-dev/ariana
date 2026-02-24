import { cn } from '@/lib/utils';
import { Plus, MoreHorizontalIcon, Trash2, Star, Copy } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PersonalEnvironment } from '@/hooks/useEnvironments';
import LockClosed from '../ui/icons/LockClosed';
import { MachineSpecsDialog } from '@/components/shared/MachineSpecsDialog';

interface EnvironmentsSidebarProps {
  environments: PersonalEnvironment[];
  onEdit: (environment: PersonalEnvironment) => void;
  onDelete: (environmentId: string) => void;
  onDuplicate: (environmentId: string) => void;
  onSetDefault: (environmentId: string) => void;
  onAdd: () => void;
}

function EnvironmentItem({
  environment,
  onEdit,
  onDelete,
  onDuplicate,
  onSetDefault,
}: {
  environment: PersonalEnvironment;
  onEdit: (env: PersonalEnvironment) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onSetDefault: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "group transition-all rounded-lg"
      )}
    >
      <div className={cn(
        "flex items-stretch transition-colors rounded-lg hover:bg-lightest dark:hover:bg-darkest bg-background dark:bg-background-darker"
      )}
    >
      <div
        className="flex-1 flex items-center gap-3 pl-4 py-3 text-sm cursor-pointer"
        onClick={() => onEdit(environment)}
      >
        <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
          <span className="truncate text-sm">{environment.name}</span>
          {environment.isDefault && (
            <Star className="h-3 w-3 fill-yellow-500 text-yellow-500 shrink-0" />
          )}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="px-3 text-foreground/50 md:text-muted-foreground/0 md:group-hover:text-foreground/50"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontalIcon className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px] border-(length:--border-width) border-muted/30">
          {!environment.isDefault && (
            <DropdownMenuItem
              variant="transparent"
              onClick={() => onSetDefault(environment.id)}
            >
              <Star className="h-4 w-4 mr-2" />
              Set as Default
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="transparent"
            onClick={() => onDuplicate(environment.id)}
          >
            <Copy className="h-4 w-4 mr-2" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="transparent"
            hoverVariant="destructive"
            onClick={() => onDelete(environment.id)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </div>
  );
}

export function EnvironmentsSidebar({
  environments,
  onEdit,
  onDelete,
  onDuplicate,
  onSetDefault,
  onAdd
}: EnvironmentsSidebarProps) {
  return (
    <div className="w-full flex-2 min-h-0 flex flex-col gap-2 pt-3 md:pt-2">
      {/* Machine Specs Button */}
      <div className="w-full">
        <MachineSpecsDialog />
      </div>

      {/* Environments List */}
      <div className="flex flex-col gap-2 h-full overflow-y-auto min-h-0 w-full">
        <button
          className={cn(
            "flex items-center gap-2 pl-3 pr-4 py-2 text-xs rounded-lg text-muted-foreground hover:text-constructive-foreground hover:bg-constructive/30 transition-colors w-fit",
          )}
          onClick={onAdd}
        >
          <Plus className="h-4 w-4 flex-shrink-0" />
          <span>Add Environment</span>
        </button>
        {environments.map((environment) => (
          <EnvironmentItem
            key={environment.id}
            environment={environment}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onSetDefault={onSetDefault}
          />
        ))}
      </div>
    </div>
  );
}
