import { ExternalLink, Lock, Unlock } from 'lucide-react';
import type { InstallationRepository } from '@/bindings/types';
import LockClosed from './ui/icons/LockClosed';
import LockOpen from './ui/icons/LockOpen';
import LinkSquare from './ui/icons/LinkSquare';

interface RepositoryInstallationCardProps {
  repository: InstallationRepository;
}

export function RepositoryInstallationCard({ repository }: RepositoryInstallationCardProps) {
  const getPermissionsLabel = () => {
    return repository.permissions === 'write' ? 'Write' : 'Read';
  };

  const permissionsLabel = getPermissionsLabel();

  return (
    <div className="flex items-center gap-3 py-4 pl-8 pr-4 transition-colors not-last:border-b-(length:--border-width) border-muted-foreground/10">
      {/* Repository name and link */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {repository.name}
          </span>
          <a
            href={repository.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground transition-colors"
          >
            <div className="h-4 w-4"><LinkSquare className="max-h-full max-w-full text-inherit hover:text-accent" /></div>
          </a>
        </div>
        <p className="text-xs text-muted-foreground mt-1 truncate max-w-[200px]">
          {repository.description || 'No description provided'}
        </p>
      </div>

      {/* Privacy label */}
      <div className="flex items-center gap-2">
        {repository.private ? (
          <div className="flex items-center gap-1 px-2 py-1 bg-muted/10 text-muted-foreground rounded-md text-xs">
            <div className="h-3 w-3"><LockClosed className="max-h-full max-w-full text-muted-foreground" /></div>
            <span>Private, access granted</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 px-2 py-1 bg-constructive/10 text-constructive-foreground rounded-md text-xs">
            <div className="h-3 w-3"><LockOpen className="max-h-full max-w-full text-constructive-foreground" /></div>
            <span>Public</span>
          </div>
        )}

      </div>
    </div>
  );
}