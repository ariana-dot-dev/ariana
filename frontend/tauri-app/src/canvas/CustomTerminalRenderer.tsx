import { motion, useInView } from "motion/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
	customTerminalAPI,
	defaultLineItem,
	type LineItem,
	type TerminalEvent,
	type CustomTerminalAPI,
} from "../services/CustomTerminalAPI";
import { useStore } from "../state";
import { cn } from "../utils";
import { OsSession } from "../bindings/os";

// Group consecutive spans with identical styles for better performance and copy/paste
function groupConsecutiveSpans(items: LineItem[]): LineItem[] {
	if (items.length === 0) return items;
	
	const grouped: LineItem[] = [];
	let currentGroup = { ...items[0] };
	
	for (let i = 1; i < items.length; i++) {
		const item = items[i];
		
		// Check if current item has identical styling to the group
		if (spansHaveSameStyle(currentGroup, item)) {
			// Merge the text - preserve exact whitespace
			currentGroup.lexeme += item.lexeme;
			// Width should be the sum of original widths to preserve terminal positioning
			currentGroup.width += item.width;
		} else {
			// Different style, push the current group and start a new one
			grouped.push(currentGroup);
			currentGroup = { ...item };
		}
	}
	
	// Push the final group
	grouped.push(currentGroup);
	
	// Filter out empty groups that have no content
	const filtered = grouped.filter(group => group.lexeme.length > 0 || group.width > 0);
	
	return filtered;
}

function spansHaveSameStyle(a: LineItem, b: LineItem): boolean {
	return a.is_bold === b.is_bold &&
		a.is_italic === b.is_italic &&
		a.is_underline === b.is_underline &&
		JSON.stringify(a.foreground_color) === JSON.stringify(b.foreground_color) &&
		JSON.stringify(a.background_color) === JSON.stringify(b.background_color);
}

interface CustomTerminalRendererProps {
	elementId: string;
	osSession?: OsSession;
	existingTerminalId?: string;
	terminalAPI?: CustomTerminalAPI;
	onTerminalReady?: (terminalId: string) => void;
	onTerminalError?: (error: string) => void;
	fontSize: "xs" | "sm" | "base" | "lg";
}

// Enhanced connection manager to reuse connections and persist screen state
class TerminalConnectionManager {
	private static connections = new Map<string, string>(); // elementId -> terminalId
	private static screenStates = new Map<string, {
		screen: LineItem[][];
		cursorPosition: { line: number; col: number };
		windowDimensions: { rows: number; cols: number };
		scrollPosition: { scrollTop: number; scrollHeight: number };
		autoScrollEnabled: boolean;
	}>(); // elementId -> terminal screen state
	private static memoryTrackingStarted = false;

	static getConnection(elementId: string): string | undefined {
		return TerminalConnectionManager.connections.get(elementId);
	}

	static setConnection(elementId: string, terminalId: string): void {
		TerminalConnectionManager.connections.set(elementId, terminalId);
		TerminalConnectionManager.startMemoryTracking();
	}

	static removeConnection(elementId: string): void {
		const hadConnection = TerminalConnectionManager.connections.has(elementId);
		const hadScreenState = TerminalConnectionManager.screenStates.has(elementId);
		
		TerminalConnectionManager.connections.delete(elementId);
		// Also remove screen state when connection is removed
		TerminalConnectionManager.screenStates.delete(elementId);
	}


	static hasConnection(elementId: string): boolean {
		return TerminalConnectionManager.connections.has(elementId);
	}

	// Screen state management
	static getScreenState(elementId: string) {
		return TerminalConnectionManager.screenStates.get(elementId);
	}

	static setScreenState(
		elementId: string, 
		screen: LineItem[][], 
		cursorPosition: { line: number; col: number },
		windowDimensions: { rows: number; cols: number },
		scrollPosition?: { scrollTop: number; scrollHeight: number },
		autoScrollEnabled?: boolean
	): void {
		// Deep copy screen with safety checks for undefined items
		const safeScreen = screen.map(line => 
			line ? [...line.filter(item => item !== undefined)] : []
		);
		
		TerminalConnectionManager.screenStates.set(elementId, {
			screen: safeScreen,
			cursorPosition: { ...cursorPosition },
			windowDimensions: { ...windowDimensions },
			scrollPosition: scrollPosition || { scrollTop: 0, scrollHeight: 0 },
			autoScrollEnabled: autoScrollEnabled ?? true
		});
	}

	static hasScreenState(elementId: string): boolean {
		return TerminalConnectionManager.screenStates.has(elementId);
	}

	static logMemoryUsage(): void {
		const connectionsSize = TerminalConnectionManager.connections.size;
		const screenStatesSize = TerminalConnectionManager.screenStates.size;
		const totalScreenLines = Array.from(TerminalConnectionManager.screenStates.values())
			.reduce((sum, state) => sum + state.screen.length, 0);
		const totalScreenItems = Array.from(TerminalConnectionManager.screenStates.values())
			.reduce((sum, state) => sum + state.screen.reduce((lineSum, line) => lineSum + line.length, 0), 0);
		
		const estimatedMemoryMB = (totalScreenItems * 100) / (1024 * 1024); // Rough estimate: 100 bytes per LineItem
		
		// Log individual large screen states
		TerminalConnectionManager.screenStates.forEach((state, elementId) => {
			if (state.screen.length > 10000) {
				console.log(`[MemoryTrack] Large screen state: ${elementId} has ${state.screen.length} lines`);
			}
		});
	}

	static startMemoryTracking(): void {
		if (TerminalConnectionManager.memoryTrackingStarted) return;
		TerminalConnectionManager.memoryTrackingStarted = true;
		
		// Log memory usage every 30 seconds
		const interval = setInterval(() => {
			TerminalConnectionManager.logMemoryUsage();
			
			// Stop tracking if no connections remain
			if (TerminalConnectionManager.connections.size === 0) {
				clearInterval(interval);
				TerminalConnectionManager.memoryTrackingStarted = false;
			}
		}, 30000);
	}
}

export const CustomTerminalRenderer: React.FC<CustomTerminalRendererProps> = ({
	elementId,
	osSession,
	existingTerminalId,
	terminalAPI,
	onTerminalReady,
	onTerminalError,
	fontSize,
}) => {
	const { isLightTheme } = useStore();
	const logPrefix = `[CustomTerminalRenderer-${elementId}]`;
	const api = terminalAPI || customTerminalAPI;

	// Add global styles for selection
	useEffect(() => {
		const style = document.createElement('style');
		style.textContent = `
			.terminal-selection-layer::selection {
				color: var(--whitest) !important;
				background-color: var(--acc-500-50) !important;
			}
			.terminal-selection-layer::-moz-selection {
				color: var(--whitest) !important;
				background-color: var(--acc-500-50) !important;
			}
		`;
		document.head.appendChild(style);
		return () => {
			document.head.removeChild(style);
		};
	}, []);

	// Initialize state from persistent storage if available
	const persistedState = TerminalConnectionManager.getScreenState(elementId);
	
	const [terminalId, setTerminalId] = useState<string | null>(null);
	const [screen, setScreen] = useState<LineItem[][]>(persistedState?.screen || []);
	const [cursorPosition, setCursorPosition] = useState(persistedState?.cursorPosition || { line: 0, col: 0 });
	const [isConnected, setIsConnected] = useState(false);
	const [windowDimensions, setWindowDimensions] = useState(
		persistedState?.windowDimensions || {
			rows: 24,
			cols: 60,
		}
	);
	const [autoScrollEnabled, setAutoScrollEnabled] = useState(persistedState?.autoScrollEnabled ?? true);
	const [charDimensions, setCharDimensions] = useState({
		width: 7.35,
		height: 16,
	});

	const phantomCharRef = useRef<HTMLSpanElement>(null);
	const terminalRef = useRef<HTMLDivElement>(null);
	const terminalInnerRef = useRef<HTMLDivElement>(null);
	const scrollableRef = useRef<HTMLDivElement>(null);
	const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const isResizingRef = useRef<boolean>(false);
	const userScrolledUpRef = useRef<boolean>(false);
	
	// Debug initial state (after refs are declared)


	// Persist state whenever it changes
	useEffect(() => {
		if (screen.length > 0 || cursorPosition.line > 0 || cursorPosition.col > 0) {
			const scrollableDiv = scrollableRef.current;
			const scrollPosition = scrollableDiv ? {
				scrollTop: scrollableDiv.scrollTop,
				scrollHeight: scrollableDiv.scrollHeight
			} : { scrollTop: 0, scrollHeight: 0 };
			
			TerminalConnectionManager.setScreenState(
				elementId,
				screen,
				cursorPosition,
				windowDimensions,
				scrollPosition,
				autoScrollEnabled
			);
		}
	}, [elementId, screen, cursorPosition, windowDimensions, autoScrollEnabled]);

	useEffect(() => {
		if (!phantomCharRef.current) return;

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const { width, height } = entry.contentRect;
				if (width > 0 && height > 0) {
					setCharDimensions({ width, height });
				}
			}
		});

		observer.observe(phantomCharRef.current);

		return () => {
			observer.disconnect();
		};
	}, []);

	// Initialize terminal connection
	useEffect(() => {
		const connectTerminal = async () => {
			// If we have an existing terminal ID passed in, use that
			if (existingTerminalId && !terminalId) {
				setTerminalId(existingTerminalId);
				setIsConnected(true);

				// Set up event listeners based on whether terminalAPI is provided
				if (terminalAPI) {
					// Register with the ClaudeCodeAgent for event forwarding
					if ('registerVisualEventHandler' in terminalAPI) {
						(terminalAPI as any).registerVisualEventHandler(handleTerminalEvent);
					}
				} else {
					await api.onTerminalEvent(existingTerminalId, handleTerminalEvent);
					await api.onTerminalDisconnect(existingTerminalId, handleTerminalDisconnect);
				}

				onTerminalReady?.(existingTerminalId);
				return;
			}

			// Check if we already have a connection for this element
			const managedTerminalId =
				TerminalConnectionManager.getConnection(elementId);

			if (managedTerminalId && !terminalId) {
				setTerminalId(managedTerminalId);
				setIsConnected(true);

				// Set up event listeners for existing connection
				await api.onTerminalEvent(managedTerminalId, handleTerminalEvent);
				await api.onTerminalDisconnect(
					managedTerminalId,
					handleTerminalDisconnect,
				);

				onTerminalReady?.(managedTerminalId);
				return;
			}

			// Don't create new connection if we already have one
			if (terminalId && isConnected) {
				return;
			}

			if (!osSession) {
				return;
			}

			try {
				const id = await api.connectTerminal(osSession);

				// Store the connection mapping
				TerminalConnectionManager.setConnection(elementId, id);

				setTerminalId(id);
				setIsConnected(true);

				// Set up event listeners
				await api.onTerminalEvent(id, handleTerminalEvent);
				await api.onTerminalDisconnect(id, handleTerminalDisconnect);

				onTerminalReady?.(id);
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err);
				onTerminalError?.(errorMessage);
			}
		};

		connectTerminal();
	}, [elementId, existingTerminalId, api]);

	const scrollDown = useCallback(() => {
		const scrollableDiv = scrollableRef.current;
		if (!scrollableDiv) return;

		scrollableDiv.scrollTop = scrollableDiv.scrollHeight;
	}, []);

	const isAtBottom = useCallback(() => {
		const scrollableDiv = scrollableRef.current;
		if (!scrollableDiv) return false;
		
		return scrollableDiv.scrollTop + scrollableDiv.clientHeight >= scrollableDiv.scrollHeight - 5;
	}, []);

	const shouldAutoScroll = useCallback(() => {
		// Only auto-scroll if enabled and user hasn't scrolled up
		return autoScrollEnabled && !userScrolledUpRef.current;
	}, [autoScrollEnabled]);

	const handleTerminalEvent = useCallback((events: TerminalEvent[]) => {
		// Batch multiple events together to reduce React renders
		const screenUpdates = events.filter((e) => {
			return (
				e.type == "screenUpdate" || e.type == "newLines" || e.type == "patch"
			);
		});
		const cursorUpdates = events.filter((e) => {
			return e.type == "cursorMove" || e.type == "screenUpdate";
		});

		if (screenUpdates.length > 0) {
			setScreen((oldScreen) => {
				const newScreen = screenUpdates.reduce((acc, event) => {
					if (event.type == "screenUpdate") {
						const lines = event.screen!;
						return lines;
					} else if (event.type == "newLines") {
						const lines = event.lines!;
						return [...acc, ...lines];
					} else if (event.type == "patch") {
						while (event.line! >= acc.length) {
							acc.push(
								Array.from({ length: windowDimensions.cols }, () =>
									defaultLineItem(),
								),
							);
						}
						acc[event.line!] = [...event.items!];
						return acc;
					}
					return acc;
				}, oldScreen);
				return newScreen;
			});
		}

		if (cursorUpdates.length > 0) {
			setCursorPosition((oldPosition) => {
				const newPosition = cursorUpdates.reduce((acc, event) => {
					if (event.type == "screenUpdate") {
						acc = { line: event.cursor_line!, col: event.cursor_col! };
					} else if (event.type == "cursorMove") {
						acc = { line: event.line!, col: event.col! };
					}
					return acc;
				}, oldPosition);

				return newPosition;
			});
		}

		// Simple auto-scroll logic: if not at bottom and user hasn't scrolled up, scroll down
		if (screenUpdates.length > 0) {
			// Always check if we should scroll after any screen update
			setTimeout(() => {
				const autoScrollAllowed = shouldAutoScroll();
				const currentlyAtBottom = isAtBottom();
				
				if (autoScrollAllowed && !currentlyAtBottom) {
					scrollDown();
				}
			}, 0);
		}
	}, [shouldAutoScroll, scrollDown, windowDimensions]);

	const handleTerminalDisconnect = useCallback(() => {
		TerminalConnectionManager.removeConnection(elementId);
		setIsConnected(false);
		setTerminalId(null);
	}, [elementId]);

	// Send raw input directly
	const sendRawInput = useCallback(
		async (input: string) => {
			if (!terminalId || !isConnected) return;

			try {
				await api.sendRawInput(terminalId, input);
			} catch (err) {
				console.error("Error sending input:", err);
			}
		},
		[terminalId, isConnected, api],
	);

	// Handle keyboard input - send each character immediately
	const handleKeyDown = useCallback(
		async (event: React.KeyboardEvent) => {
			if (!terminalId || !isConnected) return;

			try {
				if (event.ctrlKey) {
					if (event.key === "c") {
						// If text is selected, let the browser handle copy.
						const selection = window.getSelection()?.toString();
						if (selection && selection.length > 0) {
							return;
						}
						await api.sendCtrlC(terminalId);
						event.preventDefault();
						return;
					}
					if (event.key === "v") {
						// Handle paste by reading from clipboard
						try {
							const text = await navigator.clipboard.readText();
							if (text) {
								await sendRawInput(text);
							}
						} catch (clipboardErr) {
							console.error("Error reading clipboard:", clipboardErr);
						}
						event.preventDefault();
						return;
					}
					if (event.key === "d") {
						await api.sendCtrlD(terminalId);
						event.preventDefault();
						return;
					}
					// Handle Ctrl+Arrow keys for word-wise navigation
					if (event.key === "ArrowLeft") {
						await sendRawInput("\x1b[1;5D"); // Ctrl+Left
						event.preventDefault();
						return;
					}
					if (event.key === "ArrowRight") {
						await sendRawInput("\x1b[1;5C"); // Ctrl+Right
						event.preventDefault();
						return;
					}
				}

				if (event.key === "Enter") {
					await sendRawInput("\r");
					event.preventDefault();
					return;
				} else if (event.key === "Backspace") {
					// Handle backspace key - backward delete
					await sendRawInput("\x7f"); // Use DEL character (127) instead of \b for better compatibility
					event.preventDefault();
					return;
				} else if (event.key === "Tab") {
					await sendRawInput("\t");
					event.preventDefault();
					return;
				} else if (event.key === "Escape") {
					await sendRawInput("\x1b");
					event.preventDefault();
					return;
				} else if (event.key === "ArrowUp") {
					await sendRawInput("\x1b[A");
					event.preventDefault();
					return;
				} else if (event.key === "ArrowDown") {
					await sendRawInput("\x1b[B");
					event.preventDefault();
					return;
				} else if (event.key === "ArrowLeft") {
					await sendRawInput("\x1b[D");
					event.preventDefault();
					return;
				} else if (event.key === "ArrowRight") {
					await sendRawInput("\x1b[C");
					event.preventDefault();
					return;
				} else if (event.key === "PageUp") {
					await sendRawInput("\x1b[5~");
					event.preventDefault();
					return;
				} else if (event.key === "PageDown") {
					await sendRawInput("\x1b[6~");
					event.preventDefault();
					return;
				} else if (event.key === "Home") {
					await sendRawInput("\x1b[H");
					event.preventDefault();
					return;
				} else if (event.key === "End") {
					await sendRawInput("\x1b[F");
					event.preventDefault();
					return;
				} else if (event.key === "Insert") {
					await sendRawInput("\x1b[2~");
					event.preventDefault();
					return;
				} else if (event.key === "Delete") {
					// Handle delete key properly
					// On Mac: Delete key = forward delete (\x1b[3~)
					// On Mac: Backspace key = backward delete (\b) - handled above
					// On other platforms: Delete = forward delete (\x1b[3~)
					await sendRawInput("\x1b[3~");
					event.preventDefault();
					return;
				} else if (
					event.key.length === 1 &&
					!event.ctrlKey &&
					!event.altKey &&
					!event.metaKey
				) {
					// Send regular characters immediately
					await sendRawInput(event.key);
					event.preventDefault();
					return;
				}
			} catch (err) {
				console.error("Error handling key event:", err);
			}
		},
		[terminalId, isConnected, sendRawInput],
	);

	const debouncedResize = useCallback(() => {
		if (resizeTimeoutRef.current) {
			clearTimeout(resizeTimeoutRef.current);
		}

		resizeTimeoutRef.current = setTimeout(async () => {
			if (!terminalId || !terminalInnerRef.current || !isConnected) return;

			// Prevent concurrent resizes
			if (isResizingRef.current) {
				return;
			}

			const containerRect = terminalInnerRef.current.getBoundingClientRect();

			// Don't resize if container doesn't have proper dimensions yet
			if (containerRect.width < 100 || containerRect.height < 80) {
				return;
			}

			const { width: charWidth, height: charHeight } = charDimensions;

			const cols = Math.max(
				20,
				Math.floor(containerRect.width / (charWidth * 1.03)),
			);
			const lines = Math.max(
				5,
				Math.floor(containerRect.height / (charHeight * 1.0)),
			);

			// Only resize if dimensions actually changed
			if (windowDimensions.cols === cols && windowDimensions.rows === lines) {
				return;
			}

			isResizingRef.current = true;

			try {
				await api.resizeTerminal(terminalId, lines, cols);
				// Update our tracked dimensions only after successful resize
				setWindowDimensions({ rows: lines, cols });
			} catch (err) {
				console.error("Error resizing terminal:", err);
				// Don't update dimensions on error
			} finally {
				isResizingRef.current = false;
			}
		}, 150); // 150ms debounce
	}, [
		terminalId,
		windowDimensions.cols,
		windowDimensions.rows,
		isConnected,
		charDimensions,
		api,
		terminalAPI,
	]);

	const handleResize = debouncedResize;

	// Handle container and window resize
	useEffect(() => {
		let resizeObserver: ResizeObserver | null = null;

		// Watch for container size changes
		if (terminalInnerRef.current) {
			resizeObserver = new ResizeObserver(handleResize);
			resizeObserver.observe(terminalInnerRef.current);
		}

		// Also listen for window resize
		window.addEventListener("resize", handleResize);

		return () => {
			if (resizeObserver) {
				resizeObserver.disconnect();
			}
			if (resizeTimeoutRef.current) {
				clearTimeout(resizeTimeoutRef.current);
			}
			window.removeEventListener("resize", handleResize);
		};
	}, [handleResize, isConnected]);

	// Performance tracking refs


	// Track wheel events to detect user scroll and manage auto-scroll
	useEffect(() => {
		const scrollableDiv = scrollableRef.current;
		if (!scrollableDiv) return;

		const handleWheel = (e: WheelEvent) => {
			// If user scrolls up, disable auto-scroll
			if (e.deltaY < 0) {
				userScrolledUpRef.current = true;
				setAutoScrollEnabled(false);
			}
			// If user scrolls down and reaches bottom, re-enable auto-scroll
			else if (e.deltaY > 0) {
				setTimeout(() => {
					if (isAtBottom()) {
						userScrolledUpRef.current = false;
						setAutoScrollEnabled(true);
					}
				}, 100);
			}
		};

		const handleScroll = () => {
			// Check if user scrolled back to bottom, re-enable auto-scroll
			if (isAtBottom() && !autoScrollEnabled) {
				userScrolledUpRef.current = false;
				setAutoScrollEnabled(true);
			}
		};

		scrollableDiv.addEventListener("wheel", handleWheel);
		scrollableDiv.addEventListener("scroll", handleScroll);
		return () => {
			scrollableDiv.removeEventListener("wheel", handleWheel);
			scrollableDiv.removeEventListener("scroll", handleScroll);
		};
	}, [isConnected, autoScrollEnabled, isAtBottom]);

	// Restore scroll position when terminal first connects (only once)
	useEffect(() => {
		if (isConnected && screen.length > 0) {
			const scrollableDiv = scrollableRef.current;
			if (!scrollableDiv) return;

			// If auto-scroll is enabled (default behavior), scroll to bottom
			if (autoScrollEnabled) {
				// Auto-scroll to bottom after a short delay to ensure content is rendered
				setTimeout(() => {
					scrollDown();
				}, 100);
			} else if (persistedState?.scrollPosition) {
				// Restore exact scroll position if available
				setTimeout(() => {
					scrollableDiv.scrollTop = persistedState.scrollPosition.scrollTop;
				}, 100);
			}
		}
	}, [isConnected]); // Removed screen.length, scrollDown, autoScrollEnabled, persistedState dependencies

	// Auto-focus the terminal and set initial size
	useEffect(() => {
		if (terminalRef.current && isConnected) {
			terminalRef.current.focus();
			// Set initial terminal size with multiple attempts
			const scheduleResize = () => {
				handleResize();
				// Additional resize after a bit more time in case layout is still settling
				setTimeout(handleResize, 200);
			};

			// Immediate resize attempt
			scheduleResize();
			// Fallback resize after layout should be settled
			setTimeout(scheduleResize, 500);
		}
	}, [isConnected, handleResize]);

	useEffect(() => {
		// Cleanup function to unregister visual event handler
		return () => {
			if (terminalAPI && 'unregisterVisualEventHandler' in terminalAPI) {
				(terminalAPI as any).unregisterVisualEventHandler();
			}
		};
	}, [terminalAPI]);

	return (
		<div
			ref={terminalRef}
			className={cn(
				"rounded-md p-3 bg-[var(--base-200)]/10 text-[var(--blackest)] font-mono focus:outline-none relative overflow-hidden h-full max-h-full flex flex-col",
				fontSize === "xs" && "text-xs",
				fontSize === "sm" && "text-sm",
				fontSize === "base" && "text-base",
				fontSize === "lg" && "text-lg",
			)}
			tabIndex={-1}
			onKeyDown={handleKeyDown}
			onClick={() => terminalRef.current?.focus()}
		>
			<div
				ref={terminalInnerRef}
				className={cn(
					"terminal-screen relative rounded overflow-hidden max-h-full h-full font-mono cursor-text select-text",
				)}
			>
				<div
					ref={scrollableRef}
					className={cn(
						"absolute top-0 left-0 w-full h-full overflow-x-hidden overflow-y-auto flex flex-col",
					)}
				>
					{/* iterate windows of size 10 */}
					{Array.from({ length: Math.ceil(screen.length / 10) }, (_, i) => (
						<Chunk
							start={i * 10}
							key={i}
							lines={screen.slice(i * 10, (i + 1) * 10)}
							isLightTheme={isLightTheme}
							charDimensions={charDimensions}
						/>
					))}
					<motion.div
						className={cn("absolute whitespace-pre-wrap animate-pulse")}
						animate={{
							left: `${cursorPosition.col * charDimensions.width}px`,
							top: `${cursorPosition.line * charDimensions.height}px`,
							width: `${charDimensions.width}px`,
							height: `${charDimensions.height}px`,
							filter: "contrast(2)",
						}}
						transition={{
							ease: "easeInOut",
							duration: 0.1,
						}}
					>
						{/* <div className="h-[90%] w-full bg-[var(--blackest-70)] rounded-xs">
							{" "}
						</div> */}
						<div className="h-[90%] w-full bg-[var(--blackest)] opacity-70 rounded-sm animate-pulse">
							{" "}
						</div>
					</motion.div>
					<span ref={phantomCharRef} className="absolute -left-full -top-full">
						A
					</span>
				</div>
			</div>
		</div>
	);
};

export default CustomTerminalRenderer;

const Chunk = React.memo(
	({
		start,
		lines,
		isLightTheme,
		charDimensions,
	}: {
		start: number;
		lines: LineItem[][];
		isLightTheme: boolean;
		charDimensions: {
			width: number;
			height: number;
		};
	}) => {
		const ref = useRef<HTMLDivElement>(null);
		const isInView = useInView(ref);

		const result = (
			<div ref={ref} className={cn("flex flex-col w-full")}>
				{isInView ? (
					lines.map((line, index) => (
						<Row
							key={`row-${index + start}`}
							row={index + start}
							line={line}
							isLightTheme={isLightTheme}
							charDimensions={charDimensions}
						/>
					))
				) : (
					<div
						style={{ height: `${charDimensions.height * lines.length}px` }}
						className={cn("flex flex-col w-full")}
					></div>
				)}
			</div>
		);

		return result;
	},
			(prevProps, nextProps) => {
			// deep compare
			if (prevProps.start !== nextProps.start) return false;
			if (prevProps.lines.length !== nextProps.lines.length) return false;
			if (prevProps.isLightTheme !== nextProps.isLightTheme) return false;
			if (prevProps.charDimensions !== nextProps.charDimensions) return false;

			for (let i = 0; i < prevProps.lines.length; i++) {
				const prevLine = prevProps.lines[i];
				const nextLine = nextProps.lines[i];
				
				// Check if lines exist and have same length
				if (!prevLine || !nextLine || prevLine.length !== nextLine.length) {
					if (prevLine !== nextLine) return false;
					continue;
				}
				
				for (let j = 0; j < prevLine.length; j++) {
					const prevItem = prevLine[j];
					const nextItem = nextLine[j];
					
					// Check if items exist
					if (!prevItem || !nextItem) {
						if (prevItem !== nextItem) return false;
						continue;
					}
					
					if (
						prevItem.lexeme !== nextItem.lexeme ||
						prevItem.width !== nextItem.width ||
						prevItem.is_bold !== nextItem.is_bold ||
						prevItem.is_italic !== nextItem.is_italic ||
						prevItem.is_underline !== nextItem.is_underline ||
						prevItem.foreground_color !== nextItem.foreground_color ||
						prevItem.background_color !== nextItem.background_color
					) {
						return false;
					}
				}
			}

			return true;
		},
);

const Row = React.memo(
	({
		line,
		row,
		isLightTheme,
		charDimensions,
	}: {
		line: LineItem[];
		row: number;
		isLightTheme: boolean;
		charDimensions: {
			width: number;
			height: number;
		};
	}) => {
		const [hasAnimated, setHasAnimated] = useState(false);
		const [isMounted, setIsMounted] = useState(false);

		// Group consecutive spans with same styles for better performance
		const groupedLine = groupConsecutiveSpans(line);

		const isEmpty =
			line
				.map((l) => l.lexeme)
				.join("")
				.trim() === "";

		useEffect(() => {
			if (isEmpty) {
				setHasAnimated(false);
				setIsMounted(false);
			} else {
				const timer = setTimeout(() => setIsMounted(true), 10);
				return () => clearTimeout(timer);
			}
		}, [isEmpty]);

		const shouldAnimate = !isEmpty && !hasAnimated && isMounted;

		const lexemeMap: Record<string, string> = {
			"": " ",
		};

		return (
			<div
				style={{ 
					height: `${charDimensions.height}px`,
					position: "relative",
				}}
				className={cn(
					"font-mono",
					// A line is invisible if it's empty, or if it's new and hasn't finished animating.
					(isEmpty || (!hasAnimated && !isEmpty)) && "opacity-0",
					shouldAnimate && "animate-fade-in",
				)}
				onAnimationEnd={() => {
					if (shouldAnimate) {
						setHasAnimated(true);
					}
				}}
			>
				{/* Single text layer for perfect copy/paste */}
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						zIndex: 1,
						whiteSpace: "pre",
						color: "transparent",
						userSelect: "text",
						fontFamily: "inherit",
						fontSize: "inherit",
						lineHeight: `${charDimensions.height}px`,
						letterSpacing: "0",
						wordSpacing: "0",
						tabSize: 4,
						MozTabSize: 4,
					}}
					className="terminal-selection-layer"
					dangerouslySetInnerHTML={{
						__html: line.map(item => 
							item.lexeme.replace(/ /g, '&nbsp;')
						).join('')
					}}
				/>
				
				{/* Visual layer - grouped spans, positioned to match text layer exactly */}
				<div 
					style={{
						position: "relative",
						display: "flex",
						height: "100%",
						userSelect: "none",
						fontFamily: "inherit",
						fontSize: "inherit",
						lineHeight: `${charDimensions.height}px`,
						letterSpacing: "0",
						wordSpacing: "0",
					}}
				>
					{groupedLine.map((item, index) => {
						if (!item) {
							return (
								<span
									key={index}
									style={{
										width: `${charDimensions.width}px`,
										height: `${charDimensions.height}px`,
										display: "inline-block",
										whiteSpace: "pre",
										backgroundColor: "red", // DEBUG
									}}
								>
									{" "}
								</span>
							);
						}
						
						// Skip empty items with width 0
						if (item.width === 0) {
							return null;
						}
						
						const text = lexemeMap[item.lexeme] ? lexemeMap[item.lexeme] : item.lexeme;
						return (
							<span
								key={index}
								style={{
									backgroundColor: colorToCSS(item.background_color, isLightTheme),
									color: colorToCSS(item.foreground_color, isLightTheme),
									fontWeight: item.is_bold ? "bold" : "normal",
									textDecoration: item.is_underline ? "underline" : "none",
									fontStyle: item.is_italic ? "italic" : "normal",
									width: `${item.width * charDimensions.width}px`,
									height: `${charDimensions.height}px`,
									display: "inline-block",
									whiteSpace: "pre",
									overflow: "hidden",
									textOverflow: "clip",
								}}
								dangerouslySetInnerHTML={{
									__html: text.replace(/ /g, '&nbsp;')
								}}
							/>
						);
					})}
				</div>
			</div>
		);
	},
	(prevProps, nextProps) => {
		// deep compare
		if (prevProps.row !== nextProps.row) return false;
		if (prevProps.isLightTheme !== nextProps.isLightTheme) return false;
		if (prevProps.charDimensions !== nextProps.charDimensions) return false;

		// Check if arrays have different lengths
		if (prevProps.line.length !== nextProps.line.length) {
			return false;
		}

		for (let i = 0; i < prevProps.line.length; i++) {
			const prevItem = prevProps.line[i];
			const nextItem = nextProps.line[i];
			
			// Check if either item is undefined or null
			if (!prevItem || !nextItem) {
				if (prevItem !== nextItem) return false;
				continue;
			}
			
			if (
				prevItem.lexeme !== nextItem.lexeme ||
				prevItem.width !== nextItem.width ||
				prevItem.is_bold !== nextItem.is_bold ||
				prevItem.is_italic !== nextItem.is_italic ||
				prevItem.is_underline !== nextItem.is_underline ||
				prevItem.foreground_color !== nextItem.foreground_color ||
				prevItem.background_color !== nextItem.background_color
			) {
				return false;
			}
		}

		return true;
	},
);

const colorMap = (color: string, isLightTheme: boolean) => {
	const colors: Record<string, string> = {
		Black: isLightTheme ? "var(--blackest)" : "var(--blackest)",
		Red: isLightTheme ? "var(--negative-500-50)" : "var(--negative-500-50)",
		Green: isLightTheme ? "var(--positive-500-50)" : "var(--positive-500-50)",
		Yellow: isLightTheme ? "var(--acc-500-50)" : "var(--acc-500-50)",
		Blue: isLightTheme ? "var(--acc-500-50)" : "var(--acc-500-50)",
		Magenta: isLightTheme ? "var(--acc-500-50)" : "var(--acc-500-50)",
		Cyan: isLightTheme ? "var(--acc-500-50)" : "var(--acc-500-50)",
		White: isLightTheme ? "var(--whitest)" : "var(--whitest)",
		BrightBlack: isLightTheme ? "var(--blackest)" : "var(--blackest)",
		BrightRed: isLightTheme
			? "var(--negative-400-50)"
			: "var(--negative-400-50)",
		BrightGreen: isLightTheme
			? "var(--positive-400-50)"
			: "var(--positive-400-50)",
		BrightYellow: isLightTheme ? "var(--acc-400-50)" : "var(--acc-400-50)",
		BrightBlue: isLightTheme ? "var(--acc-400-50)" : "var(--acc-400-50)",
		BrightMagenta: isLightTheme ? "var(--acc-400-50)" : "var(--acc-400-50)",
		BrightCyan: isLightTheme ? "var(--acc-400-50)" : "var(--acc-400-50)",
		BrightWhite: isLightTheme ? "var(--whitest)" : "var(--whitest)",
	};

	return colors[color];
};

const getAnsiHex = (ansiName: string, isLightTheme: boolean): string => {
	if (ansiName === "Default") {
		return isLightTheme
			? colorMap("Black", isLightTheme)
			: colorMap("White", isLightTheme);
	}
	return colorMap(ansiName, isLightTheme);
};

const colorToCSS = (color: any, isLightTheme: boolean): string => {
	if (!color) return "";

	if (typeof color === "string") {
		return getAnsiHex(color, isLightTheme);
	}

	if (color.Extended !== undefined) {
		return ansi256ToHex(color.Extended, isLightTheme);
	}

	if (color.Rgb !== undefined) {
		const [r, g, b] = color.Rgb;
		return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
	}

	return isLightTheme ? "#334155" : "#d4d4d4";
};

// Convert ANSI 256-color codes to hex using the same helper for the first 16 colors
const ansi256ToHex = (code: number, _isLightTheme: boolean): string => {
	if (code < 16) {
		return "#ffffff";
	}
	if (code < 232) {
		const n = code - 16;
		const r = Math.floor(n / 36);
		const g = Math.floor((n % 36) / 6);
		const b = n % 6;

		const vals = [0, 95, 135, 175, 215, 255];
		const red = vals[r];
		const green = vals[g];
		const blue = vals[b];
		return `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
	}

	const level = code - 232;
	const gray = 8 + level * 10;
	const gHex = Math.min(238, gray).toString(16).padStart(2, "0");
	return `#${gHex}${gHex}${gHex}`;
};
