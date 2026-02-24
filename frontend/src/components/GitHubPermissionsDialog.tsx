import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { RepositoryInstallationCard } from '@/components/RepositoryInstallationCard';
import { InstallationType } from '@/bindings/types';
import { useGitHubPermissions } from '@/hooks/useGitHubPermissions';
import type { Installation } from '@/bindings/types';
import Access from './ui/icons/Access';
import Refresh from './ui/icons/Refresh';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface GitHubPermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GitHubPermissionsDialog({ open, onOpenChange }: GitHubPermissionsDialogProps) {
  const {
    installations,
    loading,
    error,
    expandedSections,
    isRefreshing,
    toggleSection,
    openChangePermissions,
    refresh
  } = useGitHubPermissions();

  const getSectionTitle = (installation: Installation) => {
    return installation.type === InstallationType.User
      ? 'Personal Repositories'
      : installation.accountLogin;
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">Loading installations...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center justify-center py-8">
          <p className="text-destructive">Error: {error}</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button
            variant="transparent"
            hoverVariant="default"
            size="default"
            onClick={openChangePermissions}
            className="flex items-center gap-2"
          >
            <Access className="!min-h-3.5 !min-w-3.5 text-inherit" />
            Change Permissions
          </Button>
          <Button
            variant="transparent"
            hoverVariant="default"
            size="default"
            onClick={refresh}
            disabled={isRefreshing}
            className="flex items-center gap-2"
          >
            <Refresh className={`!min-h-3.5 !min-w-3.5 text-inherit ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <div className="max-h-[400px] overflow-y-auto rounded-md">
          <div className="h-fit overflow-y-auto flex flex-col bg-muted/20 rounded-md">
          {installations.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No installations found with Ariana access</p>
            </div>
          ) : (
            installations.map((installation) => (
              <div key={installation.accountLogin} className="flex flex-col not-last:border-b-8 border-background-darker/80">
                {/* Section Header */}
                <button
                  onClick={() => toggleSection(installation.accountLogin)}
                  className="flex items-center gap-2 text-left w-full p-4 bg-background-darker/80 hover:text-foreground text-muted-foreground"
                >
                  {expandedSections.has(installation.accountLogin) ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  {installation.accountAvatarUrl && (
                    <img
                      src={installation.accountAvatarUrl}
                      alt={installation.accountLogin}
                      className="h-6 w-6 rounded-md"
                    />
                  )}
                  <h4 className="text-sm font-medium text-foreground">
                    {getSectionTitle(installation)}
                  </h4>
                </button>

                {/* Repository List */}
                {expandedSections.has(installation.accountLogin) && (
                  <div className="flex flex-col">
                    {installation.repositories.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">
                        No repositories in this installation
                      </p>
                    ) : (
                      installation.repositories.map((repository) => (
                        <RepositoryInstallationCard
                          key={repository.id}
                          repository={repository}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            ))
          )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[55ch] max-w-[95vw] p-6">
        <DialogHeader>
          <DialogTitle>GitHub Permissions</DialogTitle>
          <DialogDescription>
            Repositories that Ariana can see despite being private and/or push to, through GitHub App installations
          </DialogDescription>
        </DialogHeader>

        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}
