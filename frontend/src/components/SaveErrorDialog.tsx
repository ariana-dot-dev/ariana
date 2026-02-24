import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import AlertIcon from '@/components/ui/icons/AlertIcon';

interface SaveErrorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceType: 'environment' | 'automation';
  errorMessage: string;
}

export function SaveErrorDialog({ open, onOpenChange, resourceType, errorMessage }: SaveErrorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[55ch] max-w-[95vw] p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <div className="h-5 w-5">
              <AlertIcon className="max-w-full max-h-full text-amber-500" />
            </div>
            <span>Could not save {resourceType}</span>
          </DialogTitle>
          <DialogDescription className="flex flex-col gap-2">
            <p>
              The {resourceType} could not be saved. Your changes are still in the editor and have not been lost.
            </p>
            <p className="text-amber-500/80 mt-1 text-xs font-mono bg-muted/50 rounded px-2 py-1.5 break-all">
              {errorMessage}
            </p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex items-center justify-end mt-4">
          <Button variant="default" onClick={() => onOpenChange(false)}>
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
