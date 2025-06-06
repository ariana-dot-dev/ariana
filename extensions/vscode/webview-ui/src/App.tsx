import { useEffect } from 'react';
import { Tabs, TabsContent } from './components/ui/tabs';
import TracesTab from './components/TracesTab';
import ThemeColorsTab from './components/ThemeColorsTab';
import MainTab from './components/MainTab';
import { postMessageToExtension } from './utils/vscode';
import Footer from './components/Footer';
import stateManager from './utils/stateManager';
import { setCurrentRenderNonce } from './utils/timerManagement';
import { useCliStatus } from './hooks/useCliStatus';

const LEGAL_TABS = ['main'];

const App = () => {
    const [activeTab, setActiveTab] = stateManager.usePersistedState<string>('activeTab', 'main');
    const cliStatus = useCliStatus();

    useEffect(() => {
        window.addEventListener('message', handleMessage);

        // Calls to getArianaCliStatus and refreshFocusableVaults are now in their respective hooks

        // Clean up
        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    useEffect(() => {
        if (!LEGAL_TABS.includes(activeTab)) {
            handleTabChange('main');
        }
    }, [activeTab]);

    const handleMessage = (event: MessageEvent) => {
        const message = event.data;
        console.log('Received message from extension:', message);

        switch (message.type) {
            case 'hotReload':
                console.log('This render was triggered by a hot reload.');
                break;
            case 'renderNonce':
                console.log('Received new render nonce:', message.value);
                setCurrentRenderNonce(message.value);
                break;
        }
    };

    const handleUpdate = () => {
        postMessageToExtension({ command: 'updateArianaCli' });
    };

    // Handle tab change and persist in state manager
    const handleTabChange = (value: string) => {
        setActiveTab(value);

        console.log('Tab changed to:', value);
    };

    return (
        <div className={`flex flex-col h-screen max-h-screen w-screen max-w-screen text-base`}>
            <div className="flex flex-col h-full max-h-full w-full max-w-full">
                <Tabs
                    defaultValue="main"
                    value={activeTab}
                    onValueChange={handleTabChange}
                    className="flex flex-col w-full max-w-full h-full max-h-full"
                >   
                    <TabsContent value="main" className="max-h-full h-full overflow-y-auto scrollbar-w-2 border-r-[1.5px] border-[var(--bg-base)]">
                        <MainTab />
                    </TabsContent>
                    <Footer cliStatus={cliStatus} onUpdate={handleUpdate} />
                </Tabs>
            </div> 
        </div>
    );
};

export default App;