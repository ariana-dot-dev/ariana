import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, PanInfo } from "framer-motion";
import { cn } from "../utils";
import { CanvasElement, ElementLayout, TextAreaKind } from "./types";
import { CustomTerminalRenderer } from "./CustomTerminalRenderer";
import { ClaudeCodeAgent } from "../services/ClaudeCodeAgent";
import { useGitProject } from "../contexts/GitProjectContext";
import { ProcessManager } from "../services/ProcessManager";
import { ProcessState } from "../types/GitProject";

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
	
	const [text, setText] = useState((layout.element.kind as TextAreaKind).textArea.content);
	const [currentPrompt, setCurrentPrompt] = useState("");
	const [showTerminal, setShowTerminal] = useState(false);
	const [terminalId, setTerminalId] = useState<string | null>(null);
	const [claudeAgent, setClaudeAgent] = useState<ClaudeCodeAgent | null>(null);
	const [autoGoRemaining, setAutoGoRemaining] = useState(0);
	const [dragging, setDragging] = useState(false);
	
	const currentPromptingTask = taskManager?.getCurrentPromptingTask();
	const currentInProgressTask = taskManager?.getCurrentInProgressTask();
	const completedTasks = taskManager?.getCompletedTasks() || [];
	const elementId = element.id;
	
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
	
	// Initialize prompt from persistent storage
	useEffect(() => {
		if (currentCanvas && !currentPrompt) {
			const persistedPrompt = getInProgressPrompt(currentCanvas.id, elementId);
			if (persistedPrompt) {
				setCurrentPrompt(persistedPrompt);
				setText(persistedPrompt);
			}
		}
	}, [currentCanvas, elementId, getInProgressPrompt, currentPrompt]);
	const textAreaRef = useRef<HTMLTextAreaElement>(null);
	const textAreaOsSession = (element.kind as TextAreaKind).textArea.osSession; 
	
	const handleDragStartInternal = () => propOnDragStart(element);
	const handleDragEndInternal = () => propOnDragEnd(element);

	const startTaskWithPrompt = async (prompt: string) => {
		if (!canEdit || currentInProgressTask || !prompt.trim()) return false;
		
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
		
		let taskId: string;
		if (currentPromptingTask) {
			updateTaskPrompt(currentPromptingTask.id, prompt.trim());
			taskId = currentPromptingTask.id;
		} else {
			taskId = createTask(prompt.trim()) || '';
			if (!taskId) return false;
		}

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
					const inProgressTask = taskManager?.getInProgressTasks().find(t => t.processId === existingProcess.processId);
					if (inProgressTask) {
						completeTask(inProgressTask.id, "");
					}
				}
			} else if (existingProcess.status === 'finished' || existingProcess.status === 'completed') {
				removeProcess(existingProcess.processId);
			}
		}
	}, [elementId, getProcessByElementId, updateProcess]);

	useEffect(() => {
		if (!claudeAgent) return;

		const handleTaskComplete = async (result: any) => {
			const inProgressTask = taskManager?.getCurrentInProgressTask();
			if (!inProgressTask) return;
			
			// Commit hash is now provided by ClaudeCodeAgent
			const commitHash = result.commitHash || "NO_CHANGES";
			
			completeTask(inProgressTask.id, commitHash);
			setCurrentPrompt("");
			setText("");
			
			// Clear the persistent prompt
			if (currentCanvas) {
				clearInProgressPrompt(currentCanvas.id, elementId);
			}
			
			const existingProcess = getProcessByElementId(elementId);
			if (existingProcess) {
				updateProcess(existingProcess.processId, { status: 'finished' });
				ProcessManager.unregisterProcess(existingProcess.processId);
			}
			
			setTimeout(() => setClaudeAgent(null), 500);
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

		claudeAgent.on("taskCompleted", handleTaskComplete);
		claudeAgent.on("taskError", handleTaskError);
		claudeAgent.on("taskStarted", handleTaskStarted);
		claudeAgent.on("screenUpdate", handleScreenUpdate);

		return () => {
			claudeAgent.off("taskCompleted", handleTaskComplete);
			claudeAgent.off("taskError", handleTaskError);
			claudeAgent.off("taskStarted", handleTaskStarted);
			claudeAgent.off("screenUpdate", handleScreenUpdate);
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
						{completedTasks.map((task, index, array) => (
							<div key={task.id} className="relative not-last:mb-2 group">
								<div className="relative">
									<textarea
										value={task.prompt}
										readOnly
										spellCheck={false}
										className={cn(
											"w-[calc(100%-40px)] font-mono border-none text-base resize-none bg-transparent",
											task.isReverted 
												? "text-[var(--base-500-50)] line-through" 
												: task.commitHash 
													? "text-[var(--positive-500-50)]"
													: "text-[var(--base-600-50)]",
											"cursor-default",
											"whitespace-pre-wrap break-words overflow-wrap-anywhere",
											"scrollbar-thin scrollbar-thumb-[var(--base-400)] scrollbar-track-transparent",
										)}
										rows={Math.max(1, task.prompt.split("\n").length+2)}
									/>
									<div className="absolute flex items-center gap-1" style={{
										left: `${Math.min(task.prompt.split("\n").reduce((max, line) => Math.max(max, line.length), 0) * 9.7 + 10, cell.width - 120)}px`,
										top: `${Math.max(0, task.prompt.split("\n").length - 1) * 24 + 2}px`
									}}>
										<span className="text-base">
											{task.isReverted 
												? '❌' 
												: task.commitHash === "NO_CHANGES"
													? '⚠️'
													: task.commitHash 
														? '✅' 
														: '❌'
											}
										</span>
										
										{/* Only show revert/restore button when:
										    1. Task has a valid commit hash (not NO_CHANGES, GIT_ERROR, or empty)
										    2. Canvas is not locked (no merging, merged state)
										    3. No task is currently running
										    4. User can edit the canvas */}
										{task.commitHash && 
										 task.commitHash !== "NO_CHANGES" && 
										 task.commitHash !== "GIT_ERROR" &&
										 task.commitHash.length > 0 &&
										 canEdit && 
										 canvasLockState === 'normal' &&
										 !currentInProgressTask && (
											<button
												onClick={() => task.isReverted ? handleRestoreTask(task.id) : handleRevertTask(task.id)}
												className={cn(
													"px-2 py-0.5 text-xs rounded transition-all",
													"opacity-0 group-hover:opacity-100",
													"cursor-pointer",
													task.isReverted
														? "bg-[var(--positive-400)] text-[var(--blackest)] hover:bg-[var(--positive-300)]"
														: "bg-[var(--base-400)] text-[var(--blackest)] hover:bg-[var(--base-300)]"
												)}
											>
												{task.isReverted ? 'Restore' : 'Revert'}
											</button>
										)}
									</div>
								</div>
							</div>
						))}

						{currentInProgressTask && (
							<div className="relative">
								<textarea
									value={`${currentInProgressTask.prompt} 🔄`}
									readOnly
									spellCheck={false}
									className={cn(
										"w-[calc(100%-40px)] font-mono border-none text-base resize-none bg-transparent",
										"text-[var(--base-500-50)] animate-pulse",
										"cursor-default",
										"whitespace-pre-wrap break-words overflow-wrap-anywhere",
										"scrollbar-thin scrollbar-thumb-[var(--base-400)] scrollbar-track-transparent",
									)}
									rows={Math.max(1, currentInProgressTask.prompt.split("\n").length+2)}
								/>
							</div>
						)}
						<div className="relative">
							<textarea
								ref={textAreaRef}
								value={currentInProgressTask ? "" : currentPrompt}
								onChange={(e) => {
									if (!currentInProgressTask && canEdit) {
										setCurrentPrompt(e.target.value);
										setText(e.target.value);
										
										// Persist prompt to GitProject immediately
										if (currentCanvas) {
											setInProgressPrompt(currentCanvas.id, elementId, e.target.value);
										}
										
										if (autoGoRemaining > 0) {
											setAutoGoRemaining(0);
										}
										
										if (currentPromptingTask) {
											updateTaskPrompt(currentPromptingTask.id, e.target.value);
										}
									}
								}}
								disabled={!canEdit || !!currentInProgressTask}
								placeholder={
									!canEdit 
										? `Agent's work is ${canvasLockState} - cannot edit`
										: currentInProgressTask 
											? "Task in progress..." 
											: completedTasks.length === 0 
											? "Describe to the agent what to do..." 
											: "Describe to the agent another thing to do..."
								}
								spellCheck={false}
								className={cn(
									"w-[calc(100%-40px)] h-fit font-bl font-mono border-none text-base resize-none",
									"text-[var(--base-500)]",
									"focus:text-[var(--base-500)]",
									"placeholder:text-[var(--base-600-50)]",
									"whitespace-pre-wrap break-words overflow-wrap-anywhere",
									(currentInProgressTask || !canEdit) && "opacity-60 cursor-not-allowed",
									!canEdit && "bg-[var(--base-200-20)]",
									"scrollbar-thin scrollbar-thumb-[var(--base-400)] scrollbar-track-transparent",
								)}
								rows={Math.max(1, currentPrompt.split("\n").length+2)}
							/>
							{!currentInProgressTask && currentPrompt.trim().length > 0 && (
								<motion.div
									className="absolute left-0 flex justify-end"
									animate={{
										left: `${Math.min(currentPrompt.split("\n").reduce((max, line) => (line.length > max ? line.length : max), 0) * 9.7, cell.width - 120)}px`,
										top: `${(currentPrompt.split("\n").length + 0.6) * 24}px`,
									}}
									transition={{ type: "tween", duration: 0.05, ease: "linear" }}
								>
									<button
										onClick={handleGoClick}
										disabled={!currentPrompt.trim() || !canEdit}
										className={cn(
											"group rounded-lg rounded-br-2xl transition-all p-0.5 bg-[var(--base-200)]",
											currentPrompt.trim() && canEdit
												? "cursor-pointer hover:rounded-3xl hover:bg-[var(--acc-200)] opacity-50 hover:opacity-100"
												: "opacity-30 pointer-events-auto cursor-not-allowed",
										)}
									>
										<div className="flex overflow-hidden relative p-0.5 bg-[var(--whitest)] rounded-lg group-hover:rounded-3xl rounded-br-2xl transition-all">
											<div
												className={cn(
													"px-5 py-1 rounded-lg group-hover:rounded-3xl rounded-br-2xl bg-[var(--base-300)] group-hover:bg-[var(--acc-300)]  transition-all text-[var(--whitest)] z-10",
												)}
											>
												Go
											</div>
											<div className="group-hover:block hidden absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1em] h-[400%] animate-spin bg-[var(--acc-500)] blur-[1px]"></div>
										</div>
									</button>
								</motion.div>
							)}
						</div>
					</div>
				</div>

				{showTerminal && terminalId && (
					<div className="w-3/5 h-full mt-2 opacity-70">
						<CustomTerminalRenderer
							elementId={`claude-terminal-${terminalId}`}
							existingTerminalId={terminalId}
							terminalAPI={claudeAgent || undefined}
							onTerminalReady={(id) => {
								console.log("Claude terminal ready:", id);
							}}
							onTerminalError={(error) => {
								console.error("Claude terminal error:", error);
							}}
							fontSize="xs"
						/>
					</div>
				)}
			</div>
		</motion.div>
	);
};

export default TextAreaOnCanvas;
