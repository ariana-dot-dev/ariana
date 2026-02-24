import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Loader2, Download } from 'lucide-react';
import { authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/stores/useAppStore';
import { useIsBrowser } from '@/hooks/useIsBrowser';
import { routerService } from '@/services/router.service';
import { useProjectsStore } from '@/stores/useProjectsStore';
import Computer from './ui/icons/Computer';
import GithubLogo from './ui/icons/GithubLogo';

interface AccessAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  projectId: string;
  agentId: string;
}

export function AccessAgentDialog({
  isOpen,
  onClose,
  token,
  projectId,
  agentId,
}: AccessAgentDialogProps) {
  const [grantingAccess, setGrantingAccess] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const { toast } = useToast();
  const user = useAppStore(state => state.user);
  const isBrowser = useIsBrowser();

  // In desktop mode, automatically grant access on mount
  useEffect(() => {
    if (!isBrowser && isOpen) {
      handleGrantAccess();
    }
  }, [isBrowser, isOpen]);

  const handleGrantAccess = async () => {
    setGrantingAccess(true);
    try {
      const response = await authenticatedFetch(`${API_URL}/api/agents/grant-access`, {
        method: 'POST',
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        throw new Error('Failed to grant access');
      }

      const data = await response.json();

      // Clear pending access agent from session storage
      sessionStorage.removeItem('pendingAccessAgent');

      // Fetch projects to get the new project (with VISITOR role) - polling will handle it
      await useProjectsStore.getState().fetchProjects();

      // Navigate to the agent
      setTimeout(() => {
        routerService.navigateTo({
          type: 'agent',
          projectId: data.projectId,
          agentId: data.agentId,
        });
      }, 2000)

      // Close dialog AFTER navigation (so it doesn't redirect to main-menu)
      onClose();
    } catch (error) {
      console.error('Failed to grant access:', error);
      toast({
        title: 'Error',
        description: 'Failed to access agent. The link may be invalid or expired.',
        variant: 'destructive',
      });
      setGrantingAccess(false);
    }
  };

  const handleOpenInDesktop = () => {
    // Create deep link to open in desktop app
    const deepLink = `ariana-ide://access-agent?token=${encodeURIComponent(token)}&projectId=${projectId}&agentId=${agentId}`;
    window.location.href = deepLink;
  };

  const handleGitHubLogin = async () => {
    if (githubLoading) return;

    setGithubLoading(true);
    try {
      // Save the pending access agent so it's restored after login
      sessionStorage.setItem('pendingAccessAgent', JSON.stringify({
        token,
        projectId,
        agentId
      }));

      // Build OAuth URL with redirect back to /app/auth
      const url = `${API_URL}/api/auth/sign-in/github?redirect=${encodeURIComponent('/app/auth')}`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.url) {
        // Navigate to OAuth in same window
        // Will redirect back to /app/auth?token=... after auth
        // Then app will check pendingAccessAgent and show this dialog again
        window.location.href = data.url;
      } else {
        setGithubLoading(false);
      }
    } catch (error) {
      console.error('Failed to initiate GitHub login:', error);
      setGithubLoading(false);
      toast({
        title: 'Error',
        description: 'Failed to initiate GitHub login. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="!w-[40ch] max-w-[95vw] p-6">
        <DialogHeader>
          <DialogTitle>Open Shared Agent</DialogTitle>
          <DialogDescription>
            Choose how you'd like to open this shared agent
          </DialogDescription>
        </DialogHeader>

        {isBrowser ? (
          <div className="flex flex-col gap-3 mt-4 w-full">
            {user ? (
              // User is authenticated - show "Open as <name>"
              <>
                <Button
                  onClick={handleGrantAccess}
                  variant="default"
                  wFull
                  disabled={grantingAccess}
                  className="w-full justify-start max-w-full text-wrap"
                >
                  {grantingAccess ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Opening...
                    </>
                  ) : (
                    <>
                      Open as {user.name}
                    </>
                  )}
                </Button>

                <div className='md:block hidden w-full text-xs py-2 text-center'>or</div>

                <div className="w-full md:block hidden">
                  {/* Open in desktop */}
                  <Button
                    onClick={handleOpenInDesktop}
                    variant="default"
                    wFull
                    className="w-full justify-start"
                  >
                    <div className="h-4 w-4 mr-1">
                      <Computer className="max-h-full max-w-full text-inherit" />
                    </div>
                    Open in the Desktop App
                  </Button>
                  {/* Download desktop app */}
                  <div className="text-xs text-muted-foreground text-center mt-2">
                    Don't have the desktop app?{' '}
                    <a
                      href="https://ariana.dev/download"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline inline-flex items-center gap-1"
                    >
                      <Download className="h-3 w-3" />
                      Download
                    </a>
                  </div>
                </div>
              </>
            ) : (
              // User is NOT authenticated - show GitHub login
              <>
                <Button
                  onClick={handleGitHubLogin}
                  variant="accent"
                  wFull
                  disabled={githubLoading}
                  className="w-full"
                >
                  {githubLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Opening GitHub...
                    </>
                  ) : (
                    <>
                      <div className="h-5 w-5">
                        <GithubLogo className="mr-2 text-inherit" />
                      </div>
                      <div>Continue with GitHub</div>
                    </>
                  )}
                </Button>

                <div className='md:block hidden w-full text-xs py-2 text-center'>or</div>

                <div className="w-full md:block hidden">
                  {/* Open in desktop */}
                  <Button
                    onClick={handleOpenInDesktop}
                    variant="default"
                    wFull
                    className="w-full justify-start"
                  >
                    <div className="h-4 w-4 mr-1">
                      <Computer className="max-h-full max-w-full text-inherit" />
                    </div>
                    Open in the Desktop App
                  </Button>
                  {/* Download desktop app */}
                  <div className="text-xs text-muted-foreground text-center mt-2">
                    Don't have the desktop app?{' '}
                    <a
                      href="https://ariana.dev/download"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline inline-flex items-center gap-1"
                    >
                      <Download className="h-3 w-3" />
                      Download
                    </a>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Granting access...</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
