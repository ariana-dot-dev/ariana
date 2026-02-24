import Logo from '../ui/logo';
import { ProjectsTab } from './ProjectsTab.tsx';
import { Button } from '../ui/button.tsx';
import { AllAgentsPanel } from '../AllAgentsPanel.tsx';
import { QuickLaunchTab } from './QuickLaunchTab.tsx';
import { cn } from '@/lib/utils.ts';
import type { UseAgentCreationReturn } from '@/hooks/useAgentCreation';
import { ProjectWorkspace } from '@/stores/useAppStore';
import { useRouter } from '@/hooks/useRouter';
import type { MainMenuTab } from '@/types/Route';
import ChatPlus from '../ui/icons/chatplus.tsx';
import Developer from '../ui/icons/Developer.tsx';
import CodeFolder from '../ui/icons/CodeFolder.tsx';
import { useIsBrowser } from '@/hooks/useIsBrowser.ts';
import { openUrl } from '@tauri-apps/plugin-opener';
import Discord from '../ui/icons/Discord.tsx';
import LinkSquare from '../ui/icons/LinkSquare.tsx';
import Bug from '../ui/icons/Bug.tsx';
import { usePermissionsDialogStore } from '@/stores/usePermissionsDialogStore';

type TabType = MainMenuTab | 'changelog';

type PostAuthScreenProps = {
  onProjectWorkspaceSelected: (projectWorkspace: ProjectWorkspace, agentId?: string) => void;
  agentCreation: UseAgentCreationReturn;
};

export function MainMenu({ onProjectWorkspaceSelected, agentCreation }: PostAuthScreenProps) {
  const { route, navigateTo } = useRouter();
  const isBrowser = useIsBrowser();
  const openPermissionsDialog = usePermissionsDialogStore(state => state.openDialog);

  // Get active tab from route (only if we're on main-menu route)
  const activeTab: TabType = route.type === 'main-menu' && route.tab ? route.tab : 'quick-launch';

  const tabs = [
    { id: 'quick-launch' as const, label: 'Quick Launch', icon: (<ChatPlus className='text-inherit'/>) },
    { id: 'agents' as const, label: 'Agents', icon: (<Developer className='text-inherit'/>) },
    { id: 'projects' as const, label: 'Projects', icon: (<CodeFolder className='text-inherit'/>) },
  ];

  const handleTabChange = (tab: MainMenuTab) => {
    navigateTo({ type: 'main-menu', tab });
  };

  const handleNavigateToPermissions = () => {
    openPermissionsDialog();
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'quick-launch':
        return (
          <div className="flex w-[50ch] max-w-full h-full">
            <QuickLaunchTab
              onProjectWorkspaceSelected={onProjectWorkspaceSelected}
              onNavigateToPermissions={handleNavigateToPermissions}
              agentCreation={agentCreation}
            />
          </div>
        );
      case 'projects':
        return <ProjectsTab
          onProjectWorkspaceSelected={onProjectWorkspaceSelected}
          onNavigateToPermissions={handleNavigateToPermissions}
        />;
      case 'agents':
        return <AllAgentsPanel onAgentSelected={onProjectWorkspaceSelected} />;
      default:
        return null;
    }
  };

  const handleOpenBugReport = async () => {
    if (isBrowser) {
      window.open('https://discord.gg/Y3TFTmE89g', '_blank');
    } else {
      await openUrl('https://discord.gg/Y3TFTmE89g');
    }
  };

  const handleOpenCommunity = async () => {
    if (isBrowser) {
      window.open('https://discord.gg/Y3TFTmE89g', '_blank');
    } else {
      await openUrl('https://discord.gg/Y3TFTmE89g');
    }
  };

  return (
    <>
    <div className="hidden h-screen md:flex flex-col items-center justify-center md:p-0.5">
      <div className="w-fit flex h-[650px] xl:h-[800px] opacity-100 transition-all overflow-hidden rounded-lg gap-0">
        <div className="w-fit flex h-fit min-h-[500px] max-h-full bg-background overflow-hidden rounded-lg gap-0">
          {/* Left sidebar with tabs */}
          <div className="w-80 flex-shrink-0 p-10 pr-0 bg-background-darker/50 pb-20">
            <div className="space-y-2">
              <div className="flex items-center gap-1 mb-5">
                <Logo className=" h-16 w-16 text-accent"/>
                <div className="flex flex-col items-center">
                  <h2 className="
                    text-4xl mb-3 text-accent font-bold">ARIANA</h2>
                </div>
              </div>
              {tabs.map((tab) => (
                <Button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    variant='transparent'
                    className={cn(
                      "relative px-4 flex items-center",
                      activeTab === tab.id ? 'text-foreground' : 'text-muted-foreground/50 hover:text-foreground'
                    )}
                    wFull
                    size="lg"
                    textLeft
                >
                  <div className={cn(
                    "h-5 w-5",
                    activeTab === tab.id ? 'block' : 'hidden'
                  )}>
                    {tab.icon}
                  </div>
                  <div className="flex items-center">
                    <span className="font-normal text-lg">{tab.label}</span>
                  </div>
                </Button>
              ))}
              <div className="pr-10 py-4">
                <div className="w-full h-[var(--border-width)] bg-muted/20">
                </div>
              </div>
              <Button
                  onClick={() => handleOpenCommunity()}
                  variant='transparent'
                  className={cn(
                    "px-4 flex items-center",
                    'text-muted-foreground/50 hover:text-foreground'
                  )}
                  wFull
                  size="lg"
                  textLeft
              >
                <div className="h-5 w-5">
                  <Discord className='max-w-full max-h-full text-inherit'/>
                </div>
                <span className="font-normal text-lg">Community</span>
                <div className="h-4 w-4">
                  <LinkSquare className='max-w-full max-h-full text-inherit'/>
                </div>
              </Button>
              <Button
                onClick={() => handleOpenBugReport()}
                variant='transparent'
                className={cn(
                  "px-4 flex items-center",
                  'text-muted-foreground/50 hover:text-foreground'
                )}
                wFull
                size="lg"
                textLeft
              >
                <div className="h-5 w-5">
                  <Bug className='max-w-full max-h-full text-inherit'/>
                </div>
                <span className="font-normal text-lg">Bug Report</span>
                <div className="h-4 w-4">
                  <LinkSquare className='max-w-full max-h-full text-inherit'/>
                </div>
              </Button>
            </div>
          </div>

          <div className="w-[50ch] flex-1 min-h-0 p-10 bg-background-darker/50">
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
    <div className="flex md:hidden gap-2 flex-col pt-10 p-2 h-screen overflow-y-auto overflow-x-hidden">
      <div className="flex items-center w-full justify-center gap-1 mb-8">
        <Logo className=" h-16 w-16 text-accent"/>
        <div className="flex flex-col items-center">
          <h2 className="
            text-4xl mb-3 text-accent font-bold">ARIANA</h2>
        </div>
      </div>
      <div className="flex flex-col bg-background p-5 py-6 rounded-xl gap-10">
        <div className="w-full h-full">
          <QuickLaunchTab
            onProjectWorkspaceSelected={onProjectWorkspaceSelected}
            onNavigateToPermissions={handleNavigateToPermissions}
            agentCreation={agentCreation}
          />
        </div>
        <div className="w-full h-[var(--border-width)] bg-muted/30"></div>
        <div className="flex flex-col gap-3 w-full h-full">
          <div className="text-lg">Agents</div>
          <AllAgentsPanel onAgentSelected={onProjectWorkspaceSelected} />
        </div>
        <div className="w-full h-[var(--border-width)] bg-muted/30"></div>
        <div className="flex flex-col gap-3 w-full h-full">
          <div className="text-lg">Projects</div>
          <ProjectsTab
            onProjectWorkspaceSelected={onProjectWorkspaceSelected}
            onNavigateToPermissions={handleNavigateToPermissions}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => handleOpenCommunity()}
            variant='transparent'
            className={cn(
              "px-4 flex items-center",
              'text-muted-foreground/50 hover:text-foreground'
            )}
            size="lg"
            textLeft
          >
            <div className="h-5 w-5">
              <Discord className='max-w-full max-h-full text-inherit'/>
            </div>
            <span className="font-normal text-lg">Community</span>
            <div className="h-4 w-4">
              <LinkSquare className='max-w-full max-h-full text-inherit'/>
            </div>
          </Button>
          <Button
            onClick={() => handleOpenBugReport()}
            variant='transparent'
            className={cn(
              "px-4 flex items-center",
              'text-muted-foreground/50 hover:text-foreground'
            )}
            size="lg"
            textLeft
          >
            <div className="h-5 w-5">
              <Bug className='max-w-full max-h-full text-inherit'/>
            </div>
            <span className="font-normal text-lg">Bug Report</span>
            <div className="h-4 w-4">
              <LinkSquare className='max-w-full max-h-full text-inherit'/>
            </div>
          </Button>
        </div>
      </div>
    </div>
    </>
  );
}