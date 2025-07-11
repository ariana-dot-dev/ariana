import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, PanInfo } from "framer-motion";
import { cn } from "../utils";
import { CanvasElement, ElementLayout, TextAreaKind } from "./types";
import { CustomTerminalRenderer } from "./CustomTerminalRenderer";
import { ClaudeCodeAgent } from "../services/ClaudeCodeAgent";
import { useGitProject } from "../contexts/GitProjectContext";
import { ProcessManager } from "../services/ProcessManager";
import { ProcessState } from "../types/GitProject";
import { TaskComponent } from "./TaskComponent";
import { TerminalControls } from "./TerminalControls";

interface TextAreaOnCanvasProps {
	layout: ElementLayout;
	onDragStart: (element: CanvasElement) => void;
	onDragEnd: (element: CanvasElement) => void;
	onDrag: (
		event: MouseEvent | TouchEvent | PointerEvent,
		info: PanInfo,
	) => void;
	isDragTarget: boolean;
	isDragging: boolean;
}

const TextAreaOnCanvas: React.FC<TextAreaOnCanvasProps> = ({
	layout,
	onDragStart: propOnDragStart,
	onDragEnd: propOnDragEnd,
	onDrag: propOnDrag,
	isDragTarget,
	isDragging
}) => {
	const { cell, element } = layout;
	const { 
		getProcessByElementId, 
		addProcess, 
		updateProcess, 
		removeProcess,
		getCurrentTaskManager,
		createTask,
		startTask,
		completeTask,
		updateTaskPrompt,
		currentCanvas,
		getCanvasLockState,
		canEditCanvas,
		getInProgressPrompt,
		clearInProgressPrompt,
		setInProgressPrompt
	} = useGitProject();
	
	const taskManager = getCurrentTaskManager();
	const canvasLockState = currentCanvas ? getCanvasLockState(currentCanvas.id) : 'normal';
	const isCanvasLocked = canvasLockState !== 'normal';
	const canEdit = currentCanvas ? canEditCanvas(currentCanvas.id) : false;
	
	// Multi-task state
	const [showTerminal, setShowTerminal] = useState(false);
	const [terminalId, setTerminalId] = useState<string | null>(null);
	const [claudeAgent, setClaudeAgent] = useState<ClaudeCodeAgent | null>(null);
	const [dragging, setDragging] = useState(false);
	// Terminal control state
	const [isTerminalMaximized, setIsTerminalMaximized] = useState(false);
	const [isAgentPaused, setIsAgentPaused] = useState(false);
	
	// Get all tasks for multi-task support
	const allTasks = taskManager?.getTasks() || [];
	const runningTasks = taskManager?.getRunningTasks() || [];
	const hasRunningTasks = runningTasks.length > 0;
	const elementId = element.id;
	const canControlTerminal = canEdit && canvasLockState === 'normal';
	const canStartTasks = canEdit && canvasLockState === 'normal';
	
	// Force re-render when TaskManager state changes
	const [taskManagerUpdateTrigger, setTaskManagerUpdateTrigger] = useState(0);
	
	// Subscribe to TaskManager changes
	useEffect(() => {
		if (!taskManager) return;
		
		const unsubscribe = taskManager.subscribe(() => {
			setTaskManagerUpdateTrigger(prev => prev + 1);
		});
		
		return unsubscribe;
	}, [taskManager]);
	
	// Auto-create empty task when needed
	useEffect(() => {
		if (taskManager && currentCanvas) {
			const textAreaObj = (layout.element.kind as TextAreaKind).textArea;
			taskManager.ensureEmptyTask();
		}
	}, [allTasks.length, taskManager, currentCanvas, layout]);
	const textAreaRef = useRef<HTMLTextAreaElement>(null);
	const textAreaOsSession = (element.kind as TextAreaKind).textArea.osSession; 
	
	const handleDragStartInternal = () => propOnDragStart(element);
	const handleDragEndInternal = () => propOnDragEnd(element);

	const startTaskWithPrompt = async (prompt: string) => {
		if (!canEdit || hasRunningTasks || !prompt.trim()) return false;
		
		// CRITICAL FIX: Prevent multiple agents - check if one is already running
		if (claudeAgent && claudeAgent.isTaskRunning()) {
			console.warn(`[TextAreaOnCanvas] Agent already running for element ${elementId}, ignoring new request`);
			return false;
		}
		
		// Clean up any existing agent first
		if (claudeAgent) {
			console.log(`[TextAreaOnCanvas] Cleaning up existing agent for element ${elementId}`);
			await claudeAgent.cleanup();
			setClaudeAgent(null);
		}
		
		// Create a new task for this prompt
		const taskId = createTask(prompt.trim()) || '';
		if (!taskId) return false;

		try {
			console.log(`[TextAreaOnCanvas] Creating new agent for element ${elementId}`);
			const agent = new ClaudeCodeAgent();
			setClaudeAgent(agent);
			setShowTerminal(true);

			await agent.startTask(
				textAreaOsSession || { Local: "." },
				prompt.trim(),
				(newTerminalId: string) => {
					setTerminalId(newTerminalId);
					setShowTerminal(true);
					
					const processId = crypto.randomUUID();
					const processState: ProcessState = {
						processId,
						terminalId: newTerminalId,
						type: 'claude-code',
						status: 'running',
						startTime: Date.now(),
						elementId,
						prompt: prompt.trim()
					};
					
					ProcessManager.registerProcess(processId, agent);
					ProcessManager.setTerminalConnection(elementId, newTerminalId);
					addProcess(processState);
					startTask(taskId, processId);
				},
			);

			return true;
		} catch (error) {
			setShowTerminal(false);
			setTerminalId(null);
			return false;
		}
	};

	const handleGoClick = async () => {
		const success = await startTaskWithPrompt(currentPrompt);
		if (success && autoGoRemaining > 0) {
			setAutoGoRemaining(prev => Math.max(0, prev - 1));
		}
	};

	useEffect(() => {
		(layout.element.kind as TextAreaKind).textArea.content = text;
	}, [text]);

	// Memoize textArea object to prevent re-render loops
	const textAreaObj = useMemo(() => (layout.element.kind as TextAreaKind).textArea, [layout.element.id]);

	useEffect(() => {
		if (currentPromptingTask) {
			setCurrentPrompt(currentPromptingTask.prompt);
			setText(currentPromptingTask.prompt);
		} else if (!currentPrompt && text) {
			setCurrentPrompt(text);
			if (textAreaObj.shouldTriggerAutoGo) {
				setAutoGoRemaining(1);
				textAreaObj.shouldTriggerAutoGo = false;
			}
		}
	}, [text, currentPrompt, currentPromptingTask, textAreaObj]);

	useEffect(() => {
		if (autoGoRemaining > 0 && currentPrompt.trim() && !currentInProgressTask && !currentPromptingTask && canEdit && !claudeAgent) {
			const autoPress = async () => {
				const success = await startTaskWithPrompt(currentPrompt);
				if (success) {
					setAutoGoRemaining(prev => Math.max(0, prev - 1));
				}
			};
			const timeoutId = setTimeout(autoPress, 1500);
			return () => clearTimeout(timeoutId); // IMPORTANT: Clear timeout on cleanup
		}
	}, [autoGoRemaining, currentPrompt, currentInProgressTask, currentPromptingTask, canEdit, claudeAgent]);

	useEffect(() => {
		if (!currentInProgressTask && !claudeAgent) {
			const timeoutId = setTimeout(() => {
				setShowTerminal(false);
				setTerminalId(null);
			}, 1000);
			return () => clearTimeout(timeoutId);
		}
	}, [currentInProgressTask, claudeAgent]);

	useEffect(() => {
		const existingProcess = getProcessByElementId(elementId);
		
		if (existingProcess) {
			if (existingProcess.status === 'running') {
				setShowTerminal(true);
				setTerminalId(existingProcess.terminalId);
				
				const restoredAgent = ProcessManager.getProcess(existingProcess.processId);
				if (restoredAgent) {
					setClaudeAgent(restoredAgent);
				} else {
					updateProcess(existingProcess.processId, { status: 'finished' });
					// Mark all running tasks associated with this process as failed
					const runningTasksForProcess = taskManager?.getRunningTasks().filter(t => t.processId === existingProcess.processId);
					runningTasksForProcess?.forEach(task => {
						taskManager?.failTask(task.id, "Agent process terminated");
					});
				}
			} else if (existingProcess.status === 'finished' || existingProcess.status === 'completed') {
				removeProcess(existingProcess.processId);
			}
		}
	}, [elementId, getProcessByElementId, updateProcess]);

	useEffect(() => {
		if (!claudeAgent) return;

		const handleTaskComplete = async (result: any) => {
			// In the new system, task completion is handled manually via commit button
			// This event is no longer used for auto-completion
			console.log(`[TextAreaOnCanvas] Received taskCompleted event (ignored in manual mode):`, result);
		};

		const handleTaskError = (error: string) => {
			const existingProcess = getProcessByElementId(elementId);
			if (existingProcess) {
				updateProcess(existingProcess.processId, { status: 'error' });
				ProcessManager.unregisterProcess(existingProcess.processId);
			}
			setClaudeAgent(null);
		};

		const handleTaskStarted = (data: any) => {};
		const handleScreenUpdate = (tuiLines: any) => {};
		const handleAgentPaused = () => {
			console.log(`[TextAreaOnCanvas] Agent paused`);
			setIsAgentPaused(true);
		};
		const handleAgentResumed = () => {
			console.log(`[TextAreaOnCanvas] Agent resumed`);
			setIsAgentPaused(false);
		};
		const handlePromptQueued = (data: { prompt: string }) => {
			console.log(`[TextAreaOnCanvas] Prompt queued:`, data.prompt.substring(0, 50));
		};

		claudeAgent.on("taskCompleted", handleTaskComplete);
		claudeAgent.on("taskError", handleTaskError);
		claudeAgent.on("taskStarted", handleTaskStarted);
		claudeAgent.on("screenUpdate", handleScreenUpdate);
		claudeAgent.on("agentPaused", handleAgentPaused);
		claudeAgent.on("agentResumed", handleAgentResumed);
		claudeAgent.on("promptQueued", handlePromptQueued);

		return () => {
			claudeAgent.off("taskCompleted", handleTaskComplete);
			claudeAgent.off("taskError", handleTaskError);
			claudeAgent.off("taskStarted", handleTaskStarted);
			claudeAgent.off("screenUpdate", handleScreenUpdate);
			claudeAgent.off("agentPaused", handleAgentPaused);
			claudeAgent.off("agentResumed", handleAgentResumed);
			claudeAgent.off("promptQueued", handlePromptQueued);
		};
	}, [claudeAgent]);

	// CRITICAL: Clean up agent on component unmount
	useEffect(() => {
		return () => {
			if (claudeAgent) {
				console.log(`[TextAreaOnCanvas] Component unmounting, cleaning up agent for element ${elementId}`);
				claudeAgent.cleanup();
			}
		};
	}, [elementId]); // Only depend on elementId, not claudeAgent

	const handleRevertTask = async (taskId: string) => {
		if (!taskManager) return;
		
		try {
			const success = await taskManager.performRevert(taskId, textAreaOsSession || { Local: "." });
			if (!success) {
				alert("Failed to revert: No target commit available or invalid task state");
			}
		} catch (error) {
			alert(`Failed to revert: ${error}`);
		}
	};

	const handleRestoreTask = async (taskId: string) => {
		if (!taskManager) return;
		
		try {
			const success = await taskManager.performRestore(taskId, textAreaOsSession || { Local: "." });
			if (!success) {
				alert("Failed to restore: Invalid task state");
			}
		} catch (error) {
			alert(`Failed to restore: ${error}`);
		}
	};

	// Multi-task control handlers
	const handleStartTask = async (taskId: string) => {
		const task = taskManager?.getTask(taskId);
		if (!task || !task.prompt.trim() || !canEdit) return;

		try {
			if (!claudeAgent || !claudeAgent.isTaskRunning()) {
				// Start new agent if none exists
				console.log(`[TextAreaOnCanvas] Starting new agent for task ${taskId}`);
				const success = await startTaskWithPrompt(task.prompt);
				if (success) {
					taskManager?.startTask(taskId);
				}
			} else {
				// Queue prompt in existing agent
				console.log(`[TextAreaOnCanvas] Queuing prompt in existing agent for task ${taskId}`);
				await claudeAgent.queuePrompt(task.prompt);
				taskManager?.startTask(taskId);
			}
		} catch (error) {
			console.error('Failed to start task:', error);
		}
	};

	const handleStopCommitStart = async (taskId: string) => {
		if (!claudeAgent || !taskManager || !canEdit) return;

		try {
			console.log(`[TextAreaOnCanvas] Stop, commit and start for task ${taskId}`);

			// 1. Send escape until interrupted
			await claudeAgent.pauseAgent();

			// 2. Fusion and commit running tasks
			if (hasRunningTasks) {
				const fusedTask = taskManager.fuseRunningTasks();
				const { GitService } = await import('../services/GitService');
				const commitHash = await GitService.createCommit(
					textAreaOsSession || { Local: "." },
					fusedTask.prompt
				);

				// Update fused task with commit hash
				fusedTask.commitHash = commitHash;
				taskManager.completeTask(fusedTask.id, commitHash);
			}

			// 3. Start new task
			await handleStartTask(taskId);
		} catch (error) {
			console.error('Stop, commit and start failed:', error);
		}
	};

	const handleCommit = async () => {
		if (!claudeAgent || !taskManager || !hasRunningTasks) return;

		try {
			console.log(`[TextAreaOnCanvas] Manual commit of ${runningTasks.length} running tasks`);

			const fusedTask = taskManager.fuseRunningTasks();
			const { GitService } = await import('../services/GitService');
			const commitHash = await GitService.createCommit(
				textAreaOsSession || { Local: "." },
				fusedTask.prompt
			);

			fusedTask.commitHash = commitHash;
			taskManager.completeTask(fusedTask.id, commitHash);

			console.log(`[TextAreaOnCanvas] Successfully committed fused task with hash: ${commitHash}`);
			// Keep agent and terminal running - don't cleanup
		} catch (error) {
			console.error('Manual commit failed:', error);
		}
	};

	const handleTaskPromptUpdate = (taskId: string, prompt: string) => {
		taskManager?.updateTaskPrompt(taskId, prompt);

		// Persist to GitProject immediately
		if (currentCanvas) {
			setInProgressPrompt(currentCanvas.id, elementId, prompt);
		}
	};

	return (
		<motion.div
			className={cn(
				"absolute select-none w-full overflow-hidden p-1",
				isDragging ? "z-30" : "z-10",
			)}
			initial={{
				x: cell.x,
				y: cell.y,
				width: cell.width,
				height: cell.height,
			}}
			animate={
				!dragging
					? {
							x: cell.x,
							y: cell.y,
							width: cell.width,
							height: cell.height,
						}
					: undefined
			}
			transition={{
				type: "tween",
				duration: 0.2,
			}}
			layout
		>
			<div className={cn("w-full h-full flex p-3")}>
				<div
					className={cn(
						"relative flex flex-col rounded-md gap-0 h-full",
						showTerminal ? "w-2/5" : "w-full",
					)}
					style={{
						backgroundImage:
							"radial-gradient(circle at 3px 3px, var(--base-400-30) 1px, transparent 0)",
						backgroundSize: "24px 24px",
						backgroundPosition: "10px 20px",
					}}
				>
					<div className="h-full overflow-y-auto">
						{/* Render all tasks */}
						{allTasks.map((task) => (
							<TaskComponent
								key={task.id}
								task={task}
								isRunning={runningTasks.some(rt => rt.id === task.id)}
								hasOtherRunningTasks={hasRunningTasks && !runningTasks.some(rt => rt.id === task.id)}
								canEdit={canEdit}
								canStartTasks={canStartTasks}
								onStart={() => handleStartTask(task.id)}
								onStopCommitStart={() => handleStopCommitStart(task.id)}
								onUpdatePrompt={(prompt) => handleTaskPromptUpdate(task.id, prompt)}
								onRevert={handleRevertTask}
								onRestore={handleRestoreTask}
							/>
						))}
					</div>
				</div>

				{/* Terminal with controls */}
				{showTerminal && terminalId && (
					<div className={cn(
						"relative h-full mt-2",
						isTerminalMaximized ? "w-full" : "w-3/5"
					)}>
						<TerminalControls
							isTerminalMaximized={isTerminalMaximized}
							isTerminalVisible={showTerminal}
							isAgentPaused={isAgentPaused}
							isAgentRunning={!!claudeAgent && claudeAgent.isTaskRunning()}
							hasRunningTasks={hasRunningTasks}
							canControlTerminal={canControlTerminal}
							onToggleVisibility={() => setShowTerminal(!showTerminal)}
							onToggleMaximize={() => setIsTerminalMaximized(!isTerminalMaximized)}
							onPause={() => claudeAgent?.pauseAgent()}
							onResume={() => claudeAgent?.resumeAgent()}
							onCommit={handleCommit}
						/>

						<div className="w-full h-full opacity-70">
							<CustomTerminalRenderer
								elementId={`claude-terminal-${terminalId}`}
								existingTerminalId={terminalId}
								terminalAPI={claudeAgent || undefined}
								onTerminalReady={(id) => console.log("Claude terminal ready:", id)}
								onTerminalError={(error) => console.error("Claude terminal error:", error)}
								fontSize="xs"
							/>
						</div>
					</div>
				)}
			</div>
		</motion.div>
	);
};

export default TextAreaOnCanvas;
