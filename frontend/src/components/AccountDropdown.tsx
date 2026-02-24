import { useState, useEffect } from 'react';
import { LogOut, Settings, RotateCcw, Download, Bot, Palette, Plug, User } from 'lucide-react';
import ServerBulk from '@/components/ui/icons/ServerBulk';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { signOut } from '@/lib/auth';
import { openUrl } from '@tauri-apps/plugin-opener';

import { useAppStore } from '@/stores/useAppStore';
import { AgentProvidersDialog } from '@/components/AgentProvidersDialog';
import { AppearanceDialog } from '@/components/AppearanceDialog';
import { UpdatesDialog } from '@/components/UpdatesDialog';
import { MachinesDialog } from '@/components/MachinesDialog';
import { GitHubPermissionsDialog } from '@/components/GitHubPermissionsDialog';
import { cn } from '@/lib/utils';
import { FRONTEND_URL } from '@/config';
import { routerService } from '@/services/router.service';
import { useUpdateAvailabilityStore } from '@/stores/useUpdateAvailabilityStore';
import { usePermissionsDialogStore } from '@/stores/usePermissionsDialogStore';
import UserSettings from './ui/icons/usersettings';
import ProfileIdCard from './ui/icons/ProfileIdCard';
import TextColor from './ui/icons/TextColor';
import AiScan from './ui/icons/AiScan';
import Logout from './ui/icons/Logout';
import Clean from './ui/icons/Clean';
import UpdateIcon from './ui/icons/UpdateIcon';
import GithubLogo from './ui/icons/GithubLogo';
import Discord from './ui/icons/Discord';
import Bug from './ui/icons/Bug';
import LinkSquare from './ui/icons/LinkSquare';
import { useIsBrowser } from '@/hooks/useIsBrowser';

export function AccountDropdown() {
  const user = useAppStore(state => state.user);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [agentProvidersOpen, setAgentProvidersOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const availableUpdate = useUpdateAvailabilityStore(state => state.availableUpdate);
  const shouldOpenDialog = useUpdateAvailabilityStore(state => state.shouldOpenDialog);
  const closeDialog = useUpdateAvailabilityStore(state => state.closeDialog);

  // Listen to store trigger to open dialog
  useEffect(() => {
    if (shouldOpenDialog) {
      setUpdatesOpen(true);
      closeDialog(); // Reset the trigger
    }
  }, [shouldOpenDialog, closeDialog]);
  const [machinesOpen, setMachinesOpen] = useState(false);
  const permissionsOpen = usePermissionsDialogStore(state => state.isOpen);
  const setPermissionsOpen = usePermissionsDialogStore(state => state.setOpen);

  const displayName = user?.name;
  const displayEmail = user?.email;
  const isBrowser = useIsBrowser();

  const handleOpenCommunity = async () => {
    if (isBrowser) {
      window.open('https://discord.gg/Y3TFTmE89g', '_blank');
    } else {
      await openUrl('https://discord.gg/Y3TFTmE89g');
    }
  };

  const handleOpenBugReport = async () => {
    if (isBrowser) {
      window.open('https://discord.gg/Y3TFTmE89g', '_blank');
    } else {
      await openUrl('https://discord.gg/Y3TFTmE89g');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();

      window.location.reload();
    } catch (error) {
      console.error('Sign out failed:', error);
    }
  };

  const handleResetStore = async () => {
    try {
      await useAppStore.getState().reset();
      window.location.reload();
    } catch (error) {
      console.error('Failed to reset store:', error);
    }
  };

  const handleOpenProfile = () => {
    routerService.navigateTo({ type: 'profile' })
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div className="w-9 h-9 flex items-center justify-center">
            <button className={cn(
              "relative hover:text-foreground flex items-center justify-center md:h-7 md:w-7 h-6 w-6 p-0.5 rounded-full",
              // docked ? 'rounded-tl-lg' : 'rounded-lg'
            )}>
              {user?.image ? (
                <img
                  src={user.image}
                  alt={user.name || 'Profile'}
                  className="h-full w-full object-cover rounded-full"
                />
              ) : (
                <UserSettings classNames="text-foreground" />
              )}
              {availableUpdate && (
                <div className="absolute border-(length:--border-width) border-background bottom-0 right-0 h-2 w-2 rounded-full bg-accent" />
              )}
            </button>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56 border-(length:--border-width) border-muted/40 shadow-lg z-50" align="end" forceMount>
          <DropdownMenuLabel className="font-normal">
            {user ? (
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{displayName}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {displayEmail}
                </p>
              </div>
            ) : (
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">Not logged in</p>
              </div>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground/50 font-normal">
            Settings
          </DropdownMenuLabel>
          {user && (
            <DropdownMenuItem
              variant="transparent"
              hoverVariant="default"
              className="cursor-pointer"
              onClick={handleOpenProfile}
            >
              <ProfileIdCard className="!min-h-4 !min-w-4 text-foreground" />
              <span>Profile & Subscription</span>
            </DropdownMenuItem>
          )}
          {user && (
            <DropdownMenuItem
              variant="transparent"
              hoverVariant="default"
              className="cursor-pointer"
              onClick={() => setAgentProvidersOpen(true)}
            >
              <AiScan className="!min-h-4 !min-w-4 text-foreground" />
              <span>Agent Providers</span>
            </DropdownMenuItem>
          )}
          {user && (
            <DropdownMenuItem
              variant="transparent"
              hoverVariant="default"
              className="cursor-pointer"
              onClick={() => setPermissionsOpen(true)}
            >
              <GithubLogo className="!min-h-4 !min-w-4 text-foreground" />
              <span>GitHub Permissions</span>
            </DropdownMenuItem>
          )}
          {user && (
            <DropdownMenuItem
              variant="transparent"
              hoverVariant="default"
              className="cursor-pointer"
              onClick={() => setMachinesOpen(true)}
            >
              <div className="h-4 w-4 text-foreground">
                <ServerBulk className="min-h-full min-w-full text-inherit" />
              </div>
              <span>Custom Machines <span className='text-[9px] opacity-50'>BETA</span></span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="transparent"
            hoverVariant="default"
            className="cursor-pointer"
            onClick={() => setAppearanceOpen(true)}
          >
            <TextColor className="!min-h-4 !min-w-4 text-foreground" />
            <span>Appearance</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="transparent"
            hoverVariant="default"
            className="cursor-pointer"
            onClick={() => setUpdatesOpen(true)}
          >
            <UpdateIcon className="!min-h-4 !min-w-4 text-foreground" />
            <span>Updates</span>
            {availableUpdate && (
              <span className="ml-auto h-2 w-2 rounded-full bg-accent mr-2" />
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground/50 font-normal">
            Links
          </DropdownMenuLabel>
          <DropdownMenuItem
            variant="transparent"
            hoverVariant="default"
            className="cursor-pointer"
            onClick={handleOpenCommunity}
          >
            <div className="h-4 w-4 text-foreground">
              <Discord className="min-h-full min-w-full text-inherit" />
            </div>
            <span>Community</span>
            <div className="h-4 w-4 ml-auto text-muted-foreground mr-1">
              <LinkSquare className="min-h-full min-w-full text-inherit" />
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="transparent"
            hoverVariant="default"
            className="cursor-pointer"
            onClick={handleOpenBugReport}
          >
            <div className="h-4 w-4 text-foreground">
              <Bug className="min-h-full min-w-full text-inherit" />
            </div>
            <span>Bug Report</span>
            <div className="h-4 w-4 ml-auto text-muted-foreground mr-1">
              <LinkSquare className="min-h-full min-w-full text-inherit" />
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground/50 font-normal">
            Danger Zone
          </DropdownMenuLabel>
          {user && (
            <DropdownMenuItem
              variant="transparent" hoverVariant="default"
              className="cursor-pointer"
              onClick={handleSignOut}
            >
              <Logout className="!min-h-4 !min-w-4 text-foreground"/>
              <span>Sign Out</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="transparent"
            hoverVariant='destructive'
            className="cursor-pointer"
            onClick={() => setResetDialogOpen(true)}
          >
            <Clean className="!min-h-4 !min-w-4 text-foreground" />
            <span>Reset Local Data</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className='p-5 w-[97vw] md:max-w-[65ch]'>
          <DialogHeader>
            <DialogTitle>Reset Local Data</DialogTitle>
            <DialogDescription>
              Are you sure you want to reset all locally stored data? This will sign you out and clear all local settings including some credentials and preferences.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="default" onClick={() => setResetDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleResetStore}>
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AppearanceDialog
        open={appearanceOpen}
        onOpenChange={setAppearanceOpen}
      />
      <AgentProvidersDialog
        open={agentProvidersOpen}
        onOpenChange={setAgentProvidersOpen}
      />
      <UpdatesDialog
        open={updatesOpen}
        onOpenChange={setUpdatesOpen}
      />
      <MachinesDialog
        open={machinesOpen}
        onOpenChange={setMachinesOpen}
      />
      <GitHubPermissionsDialog
        open={permissionsOpen}
        onOpenChange={setPermissionsOpen}
      />
    </>
  );
}