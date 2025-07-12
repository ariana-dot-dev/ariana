import React from 'react';
import { Task } from '../types/Task';

interface TaskLinkingActionsProps {
	tasks: Task[];
	selectedAgents: string[];
	hasSelectedAgents: boolean;
	onAddToNewAgent: (taskId: string) => void;
	onAddToSelectedAgents: (taskId: string, agentIds: string[]) => void;
}

export const TaskLinkingActions: React.FC<TaskLinkingActionsProps> = ({
	tasks,
	selectedAgents,
	hasSelectedAgents,
	onAddToNewAgent,
	onAddToSelectedAgents
}) => {
	if (tasks.length === 0) {
		return null;
	}

	return (
		<div className="bg-[var(--base-100)] rounded-lg p-4 border border-[var(--base-300)]">
			<h3 className="text-lg font-medium text-[var(--base-800)] mb-4">Link Tasks to Agents</h3>
			<div className="space-y-3">
				{tasks.map((task) => (
					<div key={task.id} className="flex items-center justify-between p-3 bg-[var(--base-50)] rounded border">
						<div className="flex-1 mr-4">
							<div className="text-sm font-medium text-[var(--base-800)]">
								{task.prompt.length > 80 ? `${task.prompt.substring(0, 80)}...` : task.prompt}
							</div>
							<div className="text-xs text-[var(--base-600)] mt-1">
								Status: {task.status}
								{task.linkedAgents && task.linkedAgents.length > 0 && (
									<span className="ml-2">• Linked to {task.linkedAgents.length} agent{task.linkedAgents.length !== 1 ? 's' : ''}</span>
								)}
							</div>
						</div>
						<div className="flex gap-2">
							<button
								onClick={() => {
									console.log('Add to New Agent button clicked for task:', task.id);
									onAddToNewAgent(task.id);
								}}
								className="px-3 py-1 text-xs bg-[var(--positive-500)] text-white rounded hover:bg-[var(--positive-600)] transition-colors"
								title="Create new agent and add this task"
							>
								Add to New Agent
							</button>
							{hasSelectedAgents && (
								<button
									onClick={() => onAddToSelectedAgents(task.id, selectedAgents)}
									className="px-3 py-1 text-xs bg-[var(--acc-500)] text-white rounded hover:bg-[var(--acc-600)] transition-colors"
									title={`Add to ${selectedAgents.length} selected agent${selectedAgents.length !== 1 ? 's' : ''}`}
								>
									Add to Selection ({selectedAgents.length})
								</button>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
};