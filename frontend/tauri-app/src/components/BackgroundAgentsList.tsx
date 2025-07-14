import React from 'react';
import { UnifiedListItem, isBackgroundAgentItem } from '../types/UnifiedListTypes';
import { BackgroundAgentStatus } from '../types/BackgroundAgent';

const StatusIndicator: React.FC<{ status: BackgroundAgentStatus }> = ({ status }) => {
	const getStatusDisplay = () => {
		switch (status) {
			case 'queued': return { text: 'Queued', color: 'text-[var(--base-600)]' };
			case 'preparation': return { text: 'Preparing...', color: 'text-[var(--acc-600)]' };
			case 'running': return { text: 'Running...', color: 'text-[var(--positive-600)]' };
			case 'completed': return { text: 'Completed', color: 'text-[var(--positive-600)]' };
			case 'failed': return { text: 'Failed', color: 'text-[var(--negative-600)]' };
			case 'cancelled': return { text: 'Cancelled', color: 'text-[var(--base-500)]' };
			default: return { text: 'Unknown', color: 'text-[var(--base-500)]' };
		}
	};

	const { text, color } = getStatusDisplay();
	return <span className={`text-xs ${color}`}>{text}</span>;
};

interface BackgroundAgentTypeGroupProps {
	type: string;
	typeItems: UnifiedListItem[];
	requiresSerialization: boolean;
	onContextMenu: (e: React.MouseEvent, itemId: string) => void;
}

const BackgroundAgentTypeGroup: React.FC<BackgroundAgentTypeGroupProps> = ({
	type,
	typeItems,
	requiresSerialization,
	onContextMenu
}) => {
	return (
		<div className="flex flex-col w-full max-w-full">
			<div className="flex flex-col w-full max-w-full">
				{typeItems.map((item, index) => {
					if (isBackgroundAgentItem(item)) {
						const agent = item.data;
						const isFirst = index === 0;
						const isLast = index === typeItems.length - 1;

						return (
							<div 
								key={item.id}
								className={`group relative w-full flex flex-col text-left px-4 py-3 text-sm border-(length:--border) not-last:border-b-transparent not-first:border-t-transparent opacity-100 bg-[var(--base-100-50)] border-[var(--base-300-50)] first:rounded-t-xl last:rounded-b-xl`}
								onContextMenu={(e) => onContextMenu(e, item.id)}
							>
								<div className="flex items-center justify-between">
									<span className="text-xs text-[var(--base-600)] capitalize">
										{agent.type} Agent
									</span>
									<div className="flex items-center gap-2">
										<StatusIndicator status={agent.status} />
										{agent.status === 'completed' && (
											<span className="text-[var(--positive-600)] text-xs">✓</span>
										)}
										{agent.status === 'failed' && (
											<span className="text-[var(--negative-600)] text-xs">✗</span>
										)}
										{agent.status === 'cancelled' && (
											<span className="text-[var(--base-500)] text-xs">⊗</span>
										)}
									</div>
								</div>

								{agent.progress && !['completed', 'failed', 'cancelled'].includes(agent.status) && (
									<div className="text-xs text-[var(--base-500-70)] flex items-center gap-1">
										{agent.status === 'queued' && <span>⏳</span>}
										{agent.progress}
									</div>
								)}

								{agent.errorMessage && (
									<div className="text-xs text-[var(--negative-600)] bg-[var(--negative-100-20)] p-1 rounded">
										Error: {agent.errorMessage}
									</div>
								)}
							</div>
						);
					}
					return null;
				})}
			</div>
		</div>
	);
};

interface BackgroundAgentsListProps {
	agentItems: UnifiedListItem[];
	onContextMenu: (e: React.MouseEvent, itemId: string) => void;
}

export const BackgroundAgentsList: React.FC<BackgroundAgentsListProps> = ({
	agentItems,
	onContextMenu
}) => {
	if (agentItems.length === 0) {
		return null;
	}

	// Group agents by type
	const agentsByType = new Map<string, UnifiedListItem[]>();
	agentItems.forEach(item => {
		if (isBackgroundAgentItem(item)) {
			const agent = item.data;
			const type = agent.type;
			if (!agentsByType.has(type)) {
				agentsByType.set(type, []);
			}
			agentsByType.get(type)!.push(item);
		}
	});

	// Sort types to show serialized agents first
	const sortedTypes = Array.from(agentsByType.keys()).sort((a, b) => {
		const aItems = agentsByType.get(a)!;
		const bItems = agentsByType.get(b)!;
		const aRequiresSerialization = aItems.length > 0 && isBackgroundAgentItem(aItems[0]) && aItems[0].data.requiresSerialization;
		const bRequiresSerialization = bItems.length > 0 && isBackgroundAgentItem(bItems[0]) && bItems[0].data.requiresSerialization;
		
		if (aRequiresSerialization && !bRequiresSerialization) return -1;
		if (!aRequiresSerialization && bRequiresSerialization) return 1;
		return a.localeCompare(b);
	});

	return (
		<div className="flex flex-col gap-2">
			{sortedTypes.map(type => {
				const typeItems = agentsByType.get(type)!;
				const firstAgent = isBackgroundAgentItem(typeItems[0]) ? typeItems[0].data : null;
				const requiresSerialization = firstAgent?.requiresSerialization || false;

				return (
					<BackgroundAgentTypeGroup
						key={type}
						type={type}
						typeItems={typeItems}
						requiresSerialization={requiresSerialization}
						onContextMenu={onContextMenu}
					/>
				);
			})}
		</div>
	);
};