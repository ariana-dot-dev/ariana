import React from 'react';
import { Task, TaskManager } from '../types/Task';
import { GitProjectCanvas } from '../types/GitProject';

interface TaskLinkDisplayProps {
	taskManager: TaskManager;
	canvases: GitProjectCanvas[];
	onUnlinkTask?: (taskId: string, agentId: string) => void;
}

export const TaskLinkDisplay: React.FC<TaskLinkDisplayProps> = ({
	taskManager,
	canvases,
	onUnlinkTask
}) => {
	const allTasks = taskManager.getTasks();
	const linkedTasks = allTasks.filter(task => task.linkedAgents && task.linkedAgents.length > 0);

	if (linkedTasks.length === 0) {
		return (
			<div className="bg-[var(--base-100)] rounded-lg p-4 border border-[var(--base-300)]">
				<h3 className="text-lg font-medium text-[var(--base-800)] mb-2">Task-Agent Links</h3>
				<p className="text-sm text-[var(--base-600)]">No tasks are currently linked to agents.</p>
			</div>
		);
	}

	const getAgentName = (agentId: string) => {
		const canvas = canvases.find(c => c.id === agentId);
		if (canvas) {
			// Get agent name similar to how it's done in AgentOverview
			try {
				const tasks = canvas.taskManager.getTasks();
				if (canvas.inProgressPrompts && canvas.inProgressPrompts.size > 0) {
					for (const prompt of canvas.inProgressPrompts.values()) {
						if (prompt.trim()) {
							let cleanPrompt = prompt.trim();
							cleanPrompt = cleanPrompt.replace(/\([^)]*\)/g, '').trim();
							const words = cleanPrompt.split(/\s+/).filter(word => word.length > 0);
							const firstThreeWords = words.slice(0, 3).join(' ');
							if (firstThreeWords) {
								return firstThreeWords;
							}
						}
					}
				}
				
				if (tasks.length === 0) {
					const canvasIndex = canvases.findIndex(c => c.id === agentId);
					return `Agent ${canvasIndex + 1}`;
				}

				const lastTask = tasks[tasks.length - 1];
				let prompt = lastTask.prompt.trim();
				prompt = prompt.replace(/\([^)]*\)/g, '').trim();
				const words = prompt.split(/\s+/).filter(word => word.length > 0);
				const firstThreeWords = words.slice(0, 3).join(' ');
				return firstThreeWords || `Agent ${canvases.findIndex(c => c.id === agentId) + 1}`;
			} catch (error) {
				const canvasIndex = canvases.findIndex(c => c.id === agentId);
				return `Agent ${canvasIndex + 1}`;
			}
		}
		return `Unknown Agent (${agentId.substring(0, 8)})`;
	};

	return (
		<div className="bg-[var(--base-100)] rounded-lg p-4 border border-[var(--base-300)]">
			<h3 className="text-lg font-medium text-[var(--base-800)] mb-4">Task-Agent Links</h3>
			<div className="space-y-3">
				{linkedTasks.map((task) => (
					<div key={task.id} className="p-3 bg-[var(--base-50)] rounded border">
						<div className="flex items-start justify-between">
							<div className="flex-1 mr-4">
								<div className="text-sm font-medium text-[var(--base-800)] mb-2">
									{task.prompt.length > 60 ? `${task.prompt.substring(0, 60)}...` : task.prompt}
								</div>
								<div className="text-xs text-[var(--base-600)]">
									Status: <span className="capitalize">{task.status}</span>
								</div>
							</div>
							<div className="text-xs">
								<div className="text-[var(--base-600)] mb-1">Linked to:</div>
								<div className="space-y-1">
									{task.linkedAgents?.map((agentId) => (
										<div key={agentId} className="flex items-center justify-between bg-[var(--base-200)] px-2 py-1 rounded">
											<span className="text-[var(--base-800)]">{getAgentName(agentId)}</span>
											{onUnlinkTask && (
												<button
													onClick={() => onUnlinkTask(task.id, agentId)}
													className="ml-2 text-[var(--negative-600)] hover:text-[var(--negative-700)] text-xs"
													title="Unlink from this agent"
												>
													×
												</button>
											)}
										</div>
									))}
								</div>
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
};