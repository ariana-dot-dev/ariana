import { CreditCard } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/useAppStore';
import type { LimitExceededInfo } from '@/types/UsageLimits';
import AlertIcon from './ui/icons/AlertIcon';
import { routerService } from '@/services/router.service';

interface LimitExceededDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limitInfo: LimitExceededInfo | null;
}

export function LimitExceededDialog({ open, onOpenChange, limitInfo }: LimitExceededDialogProps) {
  const lifetimeUnitMinutes = useAppStore(state => state.agentLifetimeUnitMinutes);

  if (!limitInfo) return null;

  const handleUpgradePlan = () => {
    routerService.navigateTo({ type: 'profile' })
    onOpenChange(false);
  };

  const getResourceName = () => {
    switch (limitInfo.resourceType) {
      case 'agent':
        return 'agents';
      case 'project':
        return 'projects';
      case 'specification':
        return 'specifications';
      case 'prompt':
        return 'prompts';
      default:
        return 'resources';
    }
  };

  const getLimitDescription = () => {
    const resourceName = getResourceName();
    const limit = limitInfo.max;

    if (limitInfo.limitType === 'per_month') {
      return `You've reached your monthly limit of ${limit} ${resourceName}.`;
    } else if (limitInfo.limitType === 'total') {
      return `You've reached your total limit of ${limit} ${resourceName}.`;
    } else if (limitInfo.limitType === 'per_day') {
      return `You've reached your daily limit of ${limit} ${resourceName}.`;
    } else if (limitInfo.limitType === 'per_minute') {
      return `You've reached your rate limit of ${limit} ${resourceName} per minute.`;
    }

    return `You've reached your monthly quota of ${limitInfo.max} agent hours.`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[97vw] md:max-w-[50ch] p-5">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-5 w-5"><AlertIcon className="max-h-full max-w-full text-amber-500" /></div>
            <DialogTitle className='mb-3.5'>Usage Limit Reached</DialogTitle>
          </div>

        </DialogHeader>
          <DialogDescription className="pt-2">
            {getLimitDescription()}
          </DialogDescription>
          <div className="pt-3 pb-1">
            <p className="text-sm text-muted-foreground">
              Upgrade your plan to get significantly more usage.
            </p>
          </div>

        <DialogFooter className="mt-4">
          <Button
            variant="default"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button
            variant="accent"
            onClick={handleUpgradePlan}
            className="flex items-center gap-2"
          >
            <CreditCard className="h-4 w-4" />
            Upgrade Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
