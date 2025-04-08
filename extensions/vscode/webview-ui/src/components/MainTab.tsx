import React, { useState, useEffect } from 'react';
import { postMessageToExtension } from '../utils/vscode';
import stateManager from '../utils/stateManager';
import RunCommandsPanel from './RunCommandsPanel';
import { ArianaCliStatus } from '../lib/cli';
import OnboardingPanel from './OnboardingPanel';

interface MainTabProps {
}

const MainTab: React.FC<MainTabProps> = ({  }) => {
	const [renderKey, setRenderKey] = useState(0);
	const [cliStatus, setCliStatus] = stateManager.usePersistedState<ArianaCliStatus | null>('cliStatus', null);
	
	// Request Ariana CLI status on mount
	useEffect(() => {
		postMessageToExtension({ command: 'getArianaCliStatus' });
	}, []);

	// Force rerender when theme changes
	useEffect(() => {
		const handleThemeChange = () => {
			setRenderKey(prev => prev + 1);
		};

		const handleMessage = (event: MessageEvent) => {
			const message = event.data;
			if (message.type === 'themeChange') {
				handleThemeChange();
			} else if (message.type === 'arianaCliStatus') {
				setCliStatus(message.value);
			}
		};

		window.addEventListener('message', handleMessage);

		return () => {
			window.removeEventListener('message', handleMessage);
		};
	}, []);

	return (
		<div key={renderKey} className="flex flex-col px-4 py-4 max-w-full mx-auto h-full overflow-y-auto scrollbar-w-2" style={{ maxHeight: 'calc(100% - 10px)' }}>
			<div className="flex flex-col gap-2 h-full">
				<OnboardingPanel cliStatus={cliStatus} />
				<RunCommandsPanel isInstalled={cliStatus?.isInstalled || false} />
			</div>
		</div>
	);
};

export default MainTab;
