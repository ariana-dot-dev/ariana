import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';
import { useToast } from '@/hooks/use-toast';
import CheckmarkCircle from '../ui/icons/CheckmarkCircle';
import CrossCircle from '../ui/icons/CrossCircle';
import Copy from '../ui/icons/Copy';
import Refresh from '../ui/icons/Refresh';
import { QRCodeSVG } from 'qrcode.react';
import { posthog } from '@/lib/posthog';

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
}

export function ShareDialog({ isOpen, onClose, agentId }: ShareDialogProps) {
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const hasGeneratedRef = useRef(false);

  const handleGenerateLink = async () => {
    setLoading(true);
    try {
      posthog.capture('share_link_generation_started', {
        agent_id: agentId
      });

      const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/share-link`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to generate share link');
      }

      const data = await response.json();
      setShareUrl(data.shareUrl);

      posthog.capture('share_link_generation_succeeded', {
        agent_id: agentId,
        share_url_length: data.shareUrl?.length || 0
      });
    } catch (error) {
      console.error('Failed to generate share link:', error);
      posthog.capture('share_link_generation_failed', {
        agent_id: agentId,
        error: error instanceof Error ? error.message : 'unknown_error'
      });
      toast({
        title: 'Error',
        description: 'Failed to generate share link',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;

    try {
      await navigator.clipboard.writeText(shareUrl);
      posthog.capture('share_link_copied', {
        agent_id: agentId
      });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      toast({
        title: 'Error',
        description: 'Failed to copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  // Auto-generate link when dialog opens
  useEffect(() => {
    if (isOpen && !shareUrl && !loading && !hasGeneratedRef.current) {
      hasGeneratedRef.current = true;
      handleGenerateLink();
    }

    // Reset when dialog closes
    if (!isOpen) {
      hasGeneratedRef.current = false;
      setShareUrl(null);
    }
  }, [isOpen]);

  const canDo = [
    'Read conversation',
    'See diffs',
    'Forward ports to themselves',
  ];

  const cantDo = [
    'Send prompts',
    'Open network to public',
    'Use files sync',
    'Open terminals',
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-[55ch] p-6">
        <DialogHeader>
          <DialogTitle className='mb-2'>Share Agent</DialogTitle>
          <DialogDescription className='mb-3'>
            Generate a share link to give others read-only access to this agent
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            Loading...
          </div>
        ) : shareUrl ? (
          <div className="flex flex-col gap-4">
            {/* Share link input with copy button */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={shareUrl}
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

            {/* QR Code */}
            <div className="flex flex-col items-center gap-3 p-4 rounded-lg bg-background-darker">
              <div className="p-3 bg-white rounded-lg">
                <QRCodeSVG
                  value={shareUrl}
                  size={160}
                  level="M"
                  includeMargin={false}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Scan this QR code with your phone's camera
              </p>
            </div>

            {/* Permissions grid */}
            <div className="grid grid-cols-2 gap-4 mt-2">
              {/* Can do column */}
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-medium">Shared users can:</h4>
                <div className="flex flex-col gap-1.5">
                  {canDo.map((item) => (
                    <div key={item} className="flex items-center gap-2 text-sm">
                      <div className="h-4 w-4 shrink-0"><CheckmarkCircle className="max-h-full max-w-full text-constructive shrink-0 mt-0.5" /></div>
                      <span className="text-muted-foreground">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Can't do column */}
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-medium">Shared users can't:</h4>
                <div className="flex flex-col gap-1.5">
                  {cantDo.map((item) => (
                    <div key={item} className="flex items-center gap-2 text-sm">
                      <div className="h-4 w-4 shrink-0"><CrossCircle className="max-h-full max-w-full text-destructive shrink-0 mt-0.5" /></div>
                      <span className="text-muted-foreground">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="default" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
