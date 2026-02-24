import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useIsBrowser } from '@/hooks/useIsBrowser';
import { FRONTEND_URL } from '@/config';
import { QRCodeSVG } from 'qrcode.react';
import { useAppStore } from '@/stores/useAppStore';
import { ExternalLink, Smartphone } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Copy from '@/components/ui/icons/Copy';
import CheckmarkCircle from '@/components/ui/icons/CheckmarkCircle';

interface OpenInBrowserDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

export function OpenInBrowserDialog({ open, onClose, projectId }: OpenInBrowserDialogProps) {
  const isBrowser = useIsBrowser();
  const user = useAppStore(state => state.user);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  // Build the URL to open the project in browser
  const projectUrl = `${FRONTEND_URL}/app/project/${projectId}${user?.name ? `?username=${encodeURIComponent(user.name)}` : ''}`;

  const handleOpenOnComputer = async () => {
    if (isBrowser) {
      window.open(projectUrl, '_blank');
    } else {
      await openUrl(projectUrl);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(projectUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: 'Copied!',
        description: 'Link copied to clipboard',
      });
    } catch (error) {
      console.error('Failed to copy:', error);
      toast({
        title: 'Error',
        description: 'Failed to copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] md:w-[40ch] overflow-hidden flex flex-col p-6">
        <DialogHeader>
          <DialogTitle>Open {isBrowser ? '' : 'in Browser or'} on Mobile</DialogTitle>
          <DialogDescription>
            Open this project in your browser on any device
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 flex-1">
          {/* Open on this computer */}
          {!isBrowser && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <ExternalLink className="h-4 w-4" />
                Open on this computer
              </h3>
              <Button
                variant="default"
                hoverVariant="accent"
                onClick={handleOpenOnComputer}
                className="w-full"
              >
                Open in Browser
              </Button>
            </div>
          )}

          {/* Open on mobile */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Smartphone className="h-4 w-4" />
              Open on mobile
            </h3>

            {/* Link with copy button */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={projectUrl}
                readOnly
                className="flex-1 px-3 py-2 text-sm text-foreground/50 bg-muted/30 rounded-md focus:outline-none"
              />
              <button
                onClick={handleCopy}
                className="h-5 w-5 ml-1 hover:text-accent"
              >
                {copied ? (
                  <CheckmarkCircle className="max-h-full max-w-full text-inherit" />
                ) : (
                  <Copy className="max-h-full max-w-full text-inherit" />
                )}
              </button>
            </div>

            <div className="flex flex-col items-center gap-3 p-4 rounded-lg bg-background-darker">
              <div className="p-3 bg-white rounded-lg">
                <QRCodeSVG
                  value={projectUrl}
                  size={200}
                  level="M"
                  includeMargin={false}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Scan this QR code with your phone's camera
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
