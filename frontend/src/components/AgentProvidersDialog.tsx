import { Bot } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProviderSettings } from '@/components/settings/ProviderSettings';

interface AgentProvidersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentProvidersDialog({ open, onOpenChange }: AgentProvidersDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-2 flex flex-col w-[50ch] max-w-[97%]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pl-2">
            Agent Providers
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col space-y-6 m-4">
          <ProviderSettings />
        </div>
      </DialogContent>
    </Dialog>
  );
}
