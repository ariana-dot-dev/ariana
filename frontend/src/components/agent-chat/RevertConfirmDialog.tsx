import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Undo } from 'lucide-react';
import AlertIcon from '@/components/ui/icons/AlertIcon';

interface RevertConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  commitSha: string;
  commitMessage: string;
  localDontShow: boolean;
  onDontShowChange: (checked: boolean) => void;
}

export function RevertConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  commitSha,
  commitMessage,
  localDontShow,
  onDontShowChange
}: RevertConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[55ch] max-w-[95vw] p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <div className="h-5 w-5">
              <AlertIcon className="max-w-full max-h-full text-amber-500" />
            </div>
            <span>Confirm Destructive Revert</span>
          </DialogTitle>
          <DialogDescription className="flex flex-col gap-2">
            <p>
              You are about to revert to git commit <code className="bg-muted px-1 py-0.5 rounded text-xs ml-1">{commitSha?.substring(0, 7)}</code>
            </p>
            <p className="font-medium">"{commitMessage}"</p>
            <p className="text-amber-500/80 mt-3">
              This will permanently delete all work done after this git commit.
              The git history will be reset and cannot be recovered.
            </p>
            <div className="flex items-center space-x-2 mt-2">
              <Switch
                id="dont-show-again"
                checked={localDontShow}
                onCheckedChange={onDontShowChange}
              />
              <Label htmlFor="dont-show-again" className="text-sm cursor-pointer">
                Don't show this again
              </Label>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex items-center justify-end mt-4">
          <div className="flex items-center space-x-2">
            <Button variant="default" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirm}>
              <Undo className="h-4 w-4 mr-2" />
              Yes, Revert Permanently
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
