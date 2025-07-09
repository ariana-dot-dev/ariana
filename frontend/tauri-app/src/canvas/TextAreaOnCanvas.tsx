import React, { useState, useEffect, useRef } from "react";
import { motion, PanInfo } from "framer-motion";
import { cn } from "../utils";
import { CanvasElement, ElementLayout, TextAreaKind } from "./types";
import { CustomTerminalRenderer } from "./CustomTerminalRenderer";
import { ClaudeCodeAgent } from "../services/ClaudeCodeAgent";
import { useGitProject } from "../contexts/GitProjectContext";
import { ProcessManager } from "../services/ProcessManager";
import { ProcessState } from "../types/GitProject";
import { GitService } from "../services/GitService";

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
		revertTask,
		restoreTask,
		currentCanvas,
		getCanvasLockState,
		canEditCanvas
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
	const textAreaRef = useRef<HTMLTextAreaElement>(null);
	const textAreaOsSession = (element.kind as TextAreaKind).textArea.osSession; 
	
	const handleDragStartInternal = () => propOnDragStart(element);
	const handleDragEndInternal = () => propOnDragEnd(element);

	const startTaskWithPrompt = async (prompt: string) => {
		if (!canEdit || currentInProgressTask || !prompt.trim()) return false;
		
		let taskId: string;
		if (currentPromptingTask) {
			updateTaskPrompt(currentPromptingTask.id, prompt.trim());
			taskId = currentPromptingTask.id;
		} else {
			taskId = createTask(prompt.trim()) || '';
			if (!taskId) return false;
		}

		try {
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

	useEffect(() => {
		if (currentPromptingTask) {
			setCurrentPrompt(currentPromptingTask.prompt);
			setText(currentPromptingTask.prompt);
		} else if (!currentPrompt && text) {
			setCurrentPrompt(text);
			const textAreaObj = (layout.element.kind as TextAreaKind).textArea;
			if (textAreaObj.shouldTriggerAutoGo) {
				setAutoGoRemaining(1);
				textAreaObj.shouldTriggerAutoGo = false;
			}
		}
	}, [text, currentPrompt, currentPromptingTask, layout.element.kind]);

	useEffect(() => {
		if (autoGoRemaining > 0 && currentPrompt.trim() && !currentInProgressTask && !currentPromptingTask && canEdit) {
			const autoPress = async () => {
				const success = await startTaskWithPrompt(currentPrompt);
				if (success) {
					setAutoGoRemaining(prev => Math.max(0, prev - 1));
				}
			};
			setTimeout(autoPress, 1500);
		}
	}, [autoGoRemaining, currentPrompt, currentInProgressTask, currentPromptingTask, canEdit]);

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
			
			let commitHash = "";
			
			try {
				commitHash = await GitService.createCommit(
					textAreaOsSession || { Local: "." },
					inProgressTask.prompt
				);
			} catch (error) {
				const errorString = String(error);
				if (errorString === "NO_CHANGES_TO_COMMIT" || errorString.toLowerCase().includes("nothing to commit")) {
					commitHash = "NO_CHANGES";
				}
			}
			
			completeTask(inProgressTask.id, commitHash);
			setCurrentPrompt("");
			setText("");
			
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

	const handleStopClick = async () => {
		if (claudeAgent) {
			await claudeAgent.stopTask();
			setClaudeAgent(null);
		}
		
		const existingProcess = getProcessByElementId(elementId);
		if (existingProcess) {
			removeProcess(existingProcess.processId);
			ProcessManager.unregisterProcess(existingProcess.processId);
			ProcessManager.removeTerminalConnection(elementId);
		}
		
		setShowTerminal(false);
		setTerminalId(null);
	};

	const handleRevertTask = async (taskId: string) => {
		try {
			const task = taskManager?.getTask(taskId);
			if (!task || task.status !== 'completed' || !task.commitHash || task.commitHash === "NO_CHANGES") {
				return;
			}

			const targetCommitHash = taskManager?.getRevertTargetCommit(taskId);
			if (!targetCommitHash) return;
			
			await GitService.revertToCommit(textAreaOsSession || { Local: "." }, targetCommitHash);
			revertTask(taskId);
		} catch (error) {
			alert(`Failed to revert: ${error}`);
		}
	};

	const handleRestoreTask = async (taskId: string) => {
		try {
			const task = taskManager?.getTask(taskId);
			if (!task || task.status !== 'completed' || !task.commitHash || task.commitHash === "NO_CHANGES") {
				return;
			}

			await GitService.revertToCommit(textAreaOsSession || { Local: "." }, task.commitHash);
			restoreTask(taskId);
		} catch (error) {
			alert(`Failed to restore: ${error}`);
		}
	};

	return (
		<motion.div
			className={cn(
				"absolute select-none overflow-hidden p-1",
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
			<div className={cn("w-full h-full flex flex-col p-3")}>
				<div
					className={cn(
						"relative flex flex-col rounded-md gap-0",
						showTerminal ? "h-1/3" : "h-full",
					)}
					style={{
						backgroundImage:
							"radial-gradient(circle at 3px 3px, var(--base-400-30) 1.4px, transparent 0)",
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
											"w-full font-mono border-none text-base resize-none bg-transparent",
											task.isReverted 
												? "text-[var(--base-500-50)] line-through" 
												: task.commitHash 
													? "text-[var(--positive-500-50)]"
													: "text-[var(--base-600-50)]", // Different color for no-change tasks
											"cursor-default",
											"scrollbar-thin scrollbar-thumb-[var(--base-400)] scrollbar-track-transparent",
										)}
										rows={Math.max(1, task.prompt.split("\n").length)}
									/>
									<div className="absolute flex items-center gap-1" style={{
										left: `${task.prompt.split("\n").reduce((max, line) => Math.max(max, line.length), 0) * 9.7 + 10}px`,
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
										
										{task.commitHash && task.commitHash !== "NO_CHANGES" && (
											<button
												onClick={() => task.isReverted ? handleRestoreTask(task.id) : handleRevertTask(task.id)}
												disabled={!canEdit}
												className={cn(
													"px-2 py-0.5 text-xs rounded transition-all",
													"opacity-0 group-hover:opacity-100",
													!canEdit 
														? "cursor-not-allowed opacity-10"
														: "cursor-pointer",
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
										"w-full font-mono border-none text-base resize-none bg-transparent",
										"text-[var(--base-500-50)] animate-pulse",
										"cursor-default",
										"scrollbar-thin scrollbar-thumb-[var(--base-400)] scrollbar-track-transparent",
									)}
									rows={Math.max(1, currentInProgressTask.prompt.split("\n").length)}
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
									"w-full h-fit font-bl font-mono border-none text-base resize-none",
									"text-[var(--base-500)]",
									"focus:text-[var(--base-500)]",
									"placeholder:text-[var(--base-600-50)]",
									(currentInProgressTask || !canEdit) && "opacity-60 cursor-not-allowed",
									!canEdit && "bg-[var(--base-200-20)]",
									"scrollbar-thin scrollbar-thumb-[var(--base-400)] scrollbar-track-transparent",
								)}
								rows={Math.max(1, currentPrompt.split("\n").length)}
							/>

							{isCanvasLocked && (
								<div className="absolute right-5 top-5 flex items-center gap-1 text-base text-[var(--base-600)] bg-[var(--base-100)] px-3 py-1.5 rounded-lg">
									{canvasLockState === 'merging' && (
										<>
											<div className="w-3 h-3 border border-[var(--acc-400)] border-t-transparent rounded-full animate-spin"></div>
											<span>Merging</span>
										</>
									)}
									{canvasLockState === 'merged' && (
										<>
											<span className="">✓</span>
											<span>Merged</span>
										</>
									)}
								</div>
							)}
							{!currentInProgressTask && currentPrompt.trim().length > 0 && (
								<motion.div
									className="absolute left-0 flex justify-end"
									animate={{
										left: `${currentPrompt.split("\n").reduce((max, line) => (line.length > max ? line.length : max), 0) * 9.7}px`,
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
					<div className="h-2/3 mt-2 opacity-70">
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
							fontSize="base"
						/>
					</div>
				)}
			</div>
		</motion.div>
	);
};

export default TextAreaOnCanvas;
