import React, { useEffect, useState } from 'react';
import { BackgroundAgent } from '../types/BackgroundAgent';
import { ProcessManager } from '../services/ProcessManager';
import CustomTerminalOnCanvas from '../canvas/CustomTerminalOnCanvas';
import { CanvasElement } from '../canvas/types';

interface BackgroundAgentTerminalViewProps {
	agent: BackgroundAgent;
	onClose: () => void;
}

export const BackgroundAgentTerminalView: React.FC<BackgroundAgentTerminalViewProps> = ({
	agent,
	onClose
}) => {
	const [terminalElement, setTerminalElement] = useState<CanvasElement | null>(null);

	useEffect(() => {
		// Create a terminal element for the background agent
		if (agent.claudeCodeProcessId) {
			const claudeCodeAgent = ProcessManager.getProcess(agent.claudeCodeProcessId);
			if (claudeCodeAgent && claudeCodeAgent.terminalId) {
				// Create a terminal element that connects to the existing terminal
				const element: CanvasElement = {
					id: `agent-terminal-${agent.id}`,
					kind: {
						customTerminal: {
							terminalId: claudeCodeAgent.terminalId,
							osSession: agent.osSession
						}
					},
					targets: {
						center: { x: 0.5, y: 0.5 },
						width: 1.0,
						height: 1.0
					},
					weight: 1
				};
				setTerminalElement(element);
			}
		}
	}, [agent]);

	const getStatusMessage = () => {
		switch (agent.status) {
			case 'initializing':
				return 'Setting up merge environment...';
			case 'checking':
				return 'Checking for merge conflicts...';
			case 'running':
				return 'Claude Code is resolving merge conflicts...';
			case 'completed':
				return 'Merge completed successfully!';
			case 'failed':
				return `Merge failed: ${agent.errorMessage || 'Unknown error'}`;
			default:
				return 'Unknown status';
		}
	};

	const getStatusColor = () => {
		switch (agent.status) {
			case 'initializing':
			case 'checking':
				return 'text-[var(--acc-600)]';
			case 'running':
				return 'text-[var(--positive-600)]';
			case 'completed':
				return 'text-[var(--positive-700)]';
			case 'failed':
				return 'text-[var(--negative-600)]';
			default:
				return 'text-[var(--base-600)]';
		}
	};

	return (
		<div className="w-full h-full flex flex-col bg-[var(--base-100)]">
			{/* Header */}
			<div className="flex items-center justify-between p-4 border-b border-[var(--base-300)]">
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-2">
						<span className="text-lg font-medium text-[var(--base-700)] capitalize">
							{agent.type} Agent
						</span>
						{agent.status === 'running' && (
							<div className="w-4 h-4 border-(length:--border) border-[var(--acc-400)] border-t-transparent rounded-full animate-spin"></div>
						)}
					</div>
					<div className={`text-sm ${getStatusColor()}`}>
						{getStatusMessage()}
					</div>
				</div>
				
				<button
					onClick={onClose}
					className="px-3 py-1 text-sm bg-[var(--base-200)] text-[var(--base-600)] hover:bg-[var(--base-300)] rounded transition-colors"
				>
					← Back to Canvases
				</button>
			</div>

			{/* Terminal Content */}
			<div className="flex-1 flex flex-col">
				{terminalElement && agent.status === 'running' ? (
					<div className="flex-1 p-4">
						<CustomTerminalOnCanvas 
							layout={{
								element: terminalElement,
								cell: { x: 0, y: 0, width: 800, height: 600 },
								score: 1,
								previousCell: null
							}}
							onDragStart={() => {}}
							onDragEnd={() => {}}
							onDrag={() => {}}
							isDragTarget={false}
							isDragging={false}
						/>
					</div>
				) : (
					<div className="flex-1 flex items-center justify-center">
						<div className="text-center max-w-md">
							<div className="text-6xl mb-4">
								{agent.status === 'completed' ? '✅' : 
								 agent.status === 'failed' ? '❌' :
								 agent.status === 'checking' ? '🔍' : '⚡'}
							</div>
							<div className={`text-lg mb-2 ${getStatusColor()}`}>
								{getStatusMessage()}
							</div>
							{agent.progress && (
								<div className="text-sm text-[var(--base-500)]">
									{agent.progress}
								</div>
							)}
							{agent.status === 'initializing' || agent.status === 'checking' ? (
								<div className="text-sm text-[var(--base-500)] mt-2">
									Terminal will appear when Claude Code starts running...
								</div>
							) : null}
						</div>
					</div>
				)}
			</div>

			{/* Progress Footer */}
			{agent.status !== 'completed' && agent.status !== 'failed' && (
				<div className="p-4 border-t border-[var(--base-300)] bg-[var(--base-50)]">
					<div className="flex items-center justify-between text-sm">
						<div className="text-[var(--base-600)]">
							Attempt {(agent.context as any)?.mergeAttempts + 1 || 1} of {(agent.context as any)?.maxAttempts || 3}
						</div>
						<div className="text-[var(--base-500)]">
							Started: {new Date(agent.createdAt).toLocaleTimeString()}
						</div>
					</div>
				</div>
			)}
		</div>
	);
};