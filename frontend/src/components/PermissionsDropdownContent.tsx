import { ProjectRole } from '@/bindings/types';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { UserX } from 'lucide-react';
import CheckmarkCircle from './ui/icons/CheckmarkCircle';
import CrossCircle from './ui/icons/CrossCircle';

// Role permissions for tooltips
function getRolePermissions(role: ProjectRole): { canDo: string[]; cantDo: string[] } {
  switch (role) {
    case ProjectRole.VISITOR:
      return {
        canDo: [
          'Viewing shared agents',
          'Seeing their diffs',
          'Forking these agents'
        ],
        cantDo: [
          'Seeing repository on GitHub',
          'Sharing agents',
          'Creating agents',
          'Seeing & creating specifications'
        ]
      };
    case ProjectRole.READ:
      return {
        canDo: [
          'Viewing shared agents',
          'Seeing their diffs',
          'Forking these agents'
        ],
        cantDo: [
          'Creating agents',
          'Creating specifications',
          'Pushing commits'
        ]
      };
    case ProjectRole.TRIAGE:
      return {
        canDo: [
          'Creating agents',
          'Creating specifications',
          'Viewing shared agents',
          'Forking these agents',
        ],
        cantDo: [
          'Pushing commits'
        ]
      };
    case ProjectRole.WRITE:
      return {
        canDo: [
          'Creating agents',
          'Creating specifications',
          'Forking agents',
          'Pushing commits'
        ],
        cantDo: [
          'Editing others\' specs',
          'Deleting project',
        ]
      };
    case ProjectRole.MAINTAIN:
      return {
        canDo: [
          'Creating agents',
          'Seeing & editing all specifications',
          'Pushing commits'
        ],
        cantDo: [
          'Kick visitors'
        ]
      };
    case ProjectRole.ADMIN:
      return {
        canDo: [
          'Can do anything anyone can',
          'Can see & edit everyone\'s specifications',
          'Can kick visitors',
        ],
        cantDo: []
      };
    default:
      return { canDo: [], cantDo: [] };
  }
}

interface PermissionsDropdownContentProps {
  /** Name to display in the header */
  name: string;
  /** User's role in the project */
  role: ProjectRole;
  /** Whether this is for the current user (shows extended info) */
  isCurrentUser?: boolean;
  /** Whether the project has a linked repository */
  hasRepository?: boolean;
  /** Project name (to check for fork status) */
  projectName?: string | null;
  /** Whether to show the kick button and handler */
  onKick?: () => void;
  /** Whether currently removing this user */
  isRemoving?: boolean;
  /** Whether the current viewer is an admin */
  viewerIsAdmin?: boolean;
}

export function PermissionsDropdownContent({
  name,
  role,
  isCurrentUser = false,
  hasRepository = false,
  projectName = null,
  onKick,
  isRemoving = false,
  viewerIsAdmin = false,
}: PermissionsDropdownContentProps) {
  const permissions = getRolePermissions(role);
  const isFork = projectName?.includes('(fork');

  return (
    <div className="flex flex-col gap-2">
      {/* Header with name and role */}
      <div className="flex w-full gap-2 items-baseline-last">
        <div className="text-lg">
          Permissions
        </div>
        <span className=""> for {name}</span>
      </div>

      <span className="text-muted-foreground">
        <span className="opacity-50">Level:</span>
        <span className='ml-2'>{role}</span>
        {hasRepository && !isFork && role != ProjectRole.VISITOR && (
          <span className="opacity-50 ml-2">(synced w/ GitHub repository's roles)</span>
        )}
      </span>

      {/* Permissions grid */}
      <div className={cn(
        "grid gap-4",
        permissions.cantDo.length > 0 && "grid-cols-2",
        isCurrentUser && "mt-0",
        !isCurrentUser && "mt-1"
      )}>
        {/* Can do column */}
        <div className="flex flex-col gap-3 mt-2">
          <h4 className="text-xs font-medium">{isCurrentUser ? 'Project Rights:' : 'Rights:'}</h4>
          <div className="flex flex-col gap-1.5">
            {permissions.canDo.map((item) => (
              <div key={item} className="flex items-center gap-2">
                <div className="h-4 w-4 shrink-0">
                  <CheckmarkCircle className="max-h-full max-w-full text-constructive shrink-0" />
                </div>
                <span className="text-muted-foreground text-xs">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Can't do column */}
        {permissions.cantDo.length > 0 && (
          <div className="flex flex-col gap-3 mt-2">
            <h4 className="text-xs font-medium">Prevented from:</h4>
            <div className="flex flex-col gap-1.5">
              {permissions.cantDo.map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <div className="h-4 w-4 shrink-0">
                    <CrossCircle className="max-h-full max-w-full text-destructive shrink-0 mt-0.5" />
                  </div>
                  <span className="text-muted-foreground text-xs">{item}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Kick button - only for non-current users when viewer is admin */}
      {!isCurrentUser && viewerIsAdmin && (
        <div className="pt-2 border-t border-border">
          {role === ProjectRole.VISITOR ? (
            <Button
              variant="transparent"
              hoverVariant="destructive"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onKick?.();
              }}
              disabled={isRemoving}
              className="w-full flex items-center gap-2"
            >
              <UserX className="h-3.5 w-3.5" />
              {isRemoving ? 'Removing...' : 'Remove from project'}
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs px-2 opacity-50">Their access is managed through GitHub permissions</p>
            </div>
          )}
        </div>
      )}

      {/* FAQ sections - only for current user */}
      {(
        <>
          {hasRepository && !isFork && (!isCurrentUser || role != ProjectRole.VISITOR) && (
            <>
              <div className='w-full h-[var(--border-width)] bg-muted/30 my-2'></div>
              <details className='flex flex-col gap-1 text-muted-foreground'>
                <summary className="text-sm cursor-pointer">
                  How are project roles assigned?
                </summary>
                <div className='mt-2'>
                  - All your GitHub collaborators linking their GitHub account to Ariana get instant access to this Ariana project.
                </div>
                <div>
                  - Roles are synced as often as possible with the GitHub repository's roles
                </div>
                <div>
                  - Users with read-only access to this repository on GitHub are put in their own Ariana project, completely detached from this one. They can't see anything you and your team do here.
                </div>
              </details>
            </>
          )}
          <div className='w-full h-[var(--border-width)] bg-muted/30 my-2'></div>
          <details className='flex flex-col gap-1 text-muted-foreground'>
            <summary className="text-sm cursor-pointer">
              Who can access my agents?
            </summary>
            <div className="mt-2">- Agents are always private and can't be seen or used by anyone except their owner. </div>
            <div>- Agents can be shared with anyone by their owner via share links. </div>
            <div>- Users with whom an agent is shared, but who otherwise have no access to this project, get a very restrictive "visitor" role.</div>
            <div>- Visitors can fork the agent that was shared with them. They can't create agents without forking. They can't create and see specifications.</div>
          </details>
        </>
      )}
    </div>
  );
}
