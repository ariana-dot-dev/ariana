import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { signOut } from '@/lib/auth';
import AlertIcon from './ui/icons/AlertIcon';

interface UsernameMismatchDialogProps {
  open: boolean;
  expectedUsername: string;
  currentUsername: string;
}

export function UsernameMismatchDialog({
  open,
  expectedUsername,
  currentUsername
}: UsernameMismatchDialogProps) {
  const handleLogout = async () => {
    await signOut();
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="w-[95vw] md:w-[40ch] overflow-hidden flex flex-col p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="h-5 w-5 text-amber-500"><AlertIcon className="max-w-full max-h-full text-inherit"/></div>
            Username Mismatch
          </DialogTitle>
          <DialogDescription>
            This project was opened for a different user
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1">
          <p className="text-sm text-muted-foreground">
            You are currently logged in as <span className="font-semibold text-foreground">{currentUsername}</span>,
            but this project was intended to be opened by <span className="font-semibold text-foreground">{expectedUsername}</span>.
          </p>
          <p className="text-sm text-muted-foreground">
            To access this project properly, please log out and sign in as <span className="font-semibold text-foreground">{expectedUsername}</span>.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="default"
            hoverVariant="destructive"
            onClick={handleLogout}
            className="w-full"
          >
            Log out and sign in as {expectedUsername}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
