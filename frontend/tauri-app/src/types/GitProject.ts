import { OsSession, osSessionGetWorkingDirectory } from "../bindings/os";
import type { CanvasElement } from "../canvas/types";
import { CanvasService } from "../services/CanvasService";
import { CopyPoolManager, CopyPoolEntry, CopyProgress } from "../services/CopyPoolManager";
import { TaskManager } from "./Task";
import { TextArea } from "../canvas/TextArea";
import { BackgroundAgent, BackgroundAgentState, MergeResult } from "./BackgroundAgent";
import { BackgroundAgentManager } from "../services/BackgroundAgentManager";
import { invoke } from "@tauri-apps/api/core";

export interface ProcessState {
	processId: string;
	terminalId: string;
	type: 'claude-code' | 'custom-terminal';
	status: 'running' | 'completed' | 'finished' | 'error';
	startTime: number;
	elementId: string; // Which canvas element owns this process
	prompt?: string; // For claude-code processes
}

export type CanvasLockState = 'normal' | 'loading' | 'merging' | 'merged';

export interface GitProjectCanvas {
	id: string;
	name: string;
	elements: CanvasElement[];
	osSession: OsSession | null; // Each canvas has its own OS session (branch), null until copy is ready
	taskManager: TaskManager; // Domain model for task management
	runningProcesses?: ProcessState[]; // Track processes running in this canvas
	createdAt: number;
	lastModified: number;
	lockState: CanvasLockState;
	lockingAgentId?: string; // ID of background agent that locked this canvas
	lockedAt?: number; // Timestamp when locked
	copyProgress?: CopyProgress; // Progress of copy operation if loading
	inProgressPrompts?: Map<string, string>; // Map of element ID to in-progress prompt text
}

export class GitProject {
	public id: string;
	public name: string;
	public root: OsSession; // The OsSession that led to this GitProject's creation
	public canvases: GitProjectCanvas[];
	public mergedCanvases: GitProjectCanvas[]; // Canvases that have been merged
	public currentCanvasIndex: number;
	public backgroundAgents: BackgroundAgent[];
	public createdAt: number;
	public lastModified: number;
	public gitOriginUrl: string | null = null; // Git origin URL for backlog filtering
	public repositoryId: string | null = null; // Repository random ID for secure API access
	
	// Track original root branch to prevent root corruption
	private originalRootBranch: string | null = null;
	private rootDirectoryPath: string;

	// Reactive state management
	private listeners: Map<string, Set<() => void>> = new Map();

	constructor(root: OsSession, name?: string, skipInitialization: boolean = false) {
		this.id = crypto.randomUUID();
		this.root = root;
		this.name = name || this.generateDefaultName();
		this.canvases = []; // Start with no canvases - user must create versions explicitly
		this.currentCanvasIndex = -1; // No canvas selected initially
		this.backgroundAgents = [];
		this.createdAt = Date.now();
		this.lastModified = Date.now();
		this.mergedCanvases = [];
		this.gitOriginUrl = null; // Will be set by initializeGitOriginUrl
		
		// Store root directory path for validation
		this.rootDirectoryPath = osSessionGetWorkingDirectory(root) || '';
		
		// Skip initialization if this is being called from fromJSON
		if (!skipInitialization) {
			// Initialize original root branch detection
			this.initializeOriginalRootBranch();
			
			// Initialize git origin URL detection, then repository ID detection
			console.log(`🚀 [GitProject] Constructor called for project: ${this.name}`);
			this.initializeGitOriginUrl().then(() => {
				// Only initialize repository ID after git origin URL is detected
				console.log(`🚀 [GitProject] Git origin URL initialized, now initializing repository ID`);
				this.initializeRepositoryId().catch(error => {
					console.error(`❌ [GitProject] Failed to initialize repository ID in constructor:`, error);
				});
			});
		}

		console.log(this.canvases)
	}


	// Initialize original root branch detection
	private async initializeOriginalRootBranch(): Promise<void> {
		try {
			this.originalRootBranch = await invoke<string>('git_get_current_branch', {
				directory: this.rootDirectoryPath,
				osSession: this.root
			});
			console.log(`GitProject: Original root branch detected: ${this.originalRootBranch}`);
		} catch (error) {
			console.warn(`GitProject: Failed to detect original root branch, using 'main' as fallback:`, error);
			this.originalRootBranch = 'main';
		}
	}

	// Initialize git origin URL detection
	private async initializeGitOriginUrl(): Promise<void> {
		console.log(`🔍 [GitProject] Starting git origin URL detection for path: ${this.rootDirectoryPath}`);
		try {
			const originUrl = await invoke<string>('git_get_origin_url', {
				directory: this.rootDirectoryPath,
				osSession: this.root
			});
			this.gitOriginUrl = originUrl;
			console.log(`✅ [GitProject] Git origin URL detected: ${this.gitOriginUrl}`);
		} catch (error) {
			console.warn(`❌ [GitProject] Failed to detect git origin URL:`, error);
			this.gitOriginUrl = null;
		}
		console.log(`🔍 [GitProject] Git origin URL detection completed. URL: ${this.gitOriginUrl}`);
	}

	// Initialize repository ID detection by calling backend
	private async initializeRepositoryId(): Promise<void> {
		console.log(`🔍 [GitProject] Starting repository ID detection for URL: ${this.gitOriginUrl}`);
		
		if (!this.gitOriginUrl) {
			console.warn('🚨 [GitProject] No git origin URL available for repository ID detection');
			return;
		}

		try {
			// Import AuthService and API config
			const { default: AuthService } = await import('../services/AuthService');
			const { getApiUrl, API_CONFIG } = await import('../services/ApiConfig');
			const authService = AuthService.getInstance();
			
			console.log(`🔑 [GitProject] Checking authentication state`);
			const authState = authService.getAuthState();
			console.log(`🔑 [GitProject] Auth state:`, authState.isAuthenticated);
			
			if (!authState.isAuthenticated) {
				console.warn('🚨 [GitProject] Not authenticated - will retry when auth becomes available');
				// Set up retry mechanism when auth becomes available
				const unsubscribe = authService.subscribe((state) => {
					if (state.isAuthenticated && !this.repositoryId) {
						console.log('🔄 [GitProject] Auth detected - retrying repository ID detection');
						this.initializeRepositoryId();
						unsubscribe();
					}
				});
				return;
			}
			
			const apiUrl = getApiUrl(API_CONFIG.ENDPOINTS.REPOSITORY_INITIALIZE);
			console.log(`🌐 [GitProject] Making API request to: ${apiUrl}`);
			
			// Call backend to get or create repository record
			const response = await authService.apiRequest<{ repository: { id: number, random_id: string } }>(
				apiUrl, 
				{
					method: 'POST',
					body: JSON.stringify({ repo_url: this.gitOriginUrl })
				}
			);
			
			this.repositoryId = response.repository.random_id;
			console.log(`✅ [GitProject] Repository ID detected: ${this.repositoryId}`);
			this.lastModified = Date.now();
			this.notifyListeners('repositoryId');
		} catch (error) {
			console.error(`❌ [GitProject] Failed to detect repository ID:`, error);
			this.repositoryId = null;
		}
	}

	// Get the original root branch for merge operations
	getOriginalRootBranch(): string {
		return this.originalRootBranch || 'main';
	}

	// Manual retry for repository ID detection
	async retryRepositoryIdDetection(): Promise<void> {
		console.log('🔄 [GitProject] Manual retry of repository ID detection');
		await this.initializeRepositoryId();
	}

	// Check and initialize repository ID if missing (for startup validation)
	async ensureRepositoryId(): Promise<void> {
		console.log(`🔍 [GitProject] Ensuring repository ID for project: ${this.name}`);
		if (this.gitOriginUrl && !this.repositoryId) {
			console.log(`🔄 [GitProject] Repository ID missing - initializing for ${this.gitOriginUrl}`);
			await this.initializeRepositoryId();
		} else if (this.repositoryId) {
			console.log(`✅ [GitProject] Repository ID already present: ${this.repositoryId}`);
		} else {
			console.log(`ℹ️ [GitProject] No git origin URL - skipping repository ID initialization`);
		}
	}

	// Validate that a directory path is not the root (to prevent root corruption)
	private isRootDirectory(directoryPath: string): boolean {
		const normalizedRoot = this.rootDirectoryPath.replace(/[\/\\]+$/, '');
		const normalizedPath = directoryPath.replace(/[\/\\]+$/, '');
		return normalizedRoot === normalizedPath;
	}



	// Reactive getters
	getCurrentCanvas(): GitProjectCanvas | null {
		return this.canvases[this.currentCanvasIndex] || null;
	}

	// Reactive setters
	setCurrentCanvasIndex(index: number): void {
		if (index >= -1 && index < this.canvases.length && index !== this.currentCanvasIndex) {
			this.currentCanvasIndex = index;
			this.lastModified = Date.now();
			
			// Check for running tasks with dead terminals when switching to a canvas
			if (index >= 0 && index < this.canvases.length) {
				this.checkAndFailOrphanedTasks(this.canvases[index]);
			}
			
			this.notifyListeners('currentCanvasIndex');
		}
	}

	// Background agent management
	addBackgroundAgent(agent: BackgroundAgent): void {
		this.backgroundAgents.push(agent);
		this.lastModified = Date.now();
		this.notifyListeners('backgroundAgents');
		
		// Set up automatic cleanup monitoring for this agent
		this.setupAgentCleanupMonitoring(agent);
	}

	public setupAgentCleanupMonitoring(agent: BackgroundAgent): void {
		// Import the BackgroundAgentManager to avoid circular imports
		import('../services/BackgroundAgentManager').then(({ BackgroundAgentManager }) => {
			// If agent is already in terminal state, handle cleanup and unlock
			if (['completed', 'failed', 'cancelled'].includes(agent.status)) {
				console.log(`[GitProject] Agent ${agent.id.slice(0, 8)} is already in terminal state (${agent.status}), scheduling cleanup`);
				
				// For failed/cancelled agents, unlock any canvases they may have locked
				if (['failed', 'cancelled'].includes(agent.status)) {
					this.canvases.forEach(canvas => {
						if (canvas.lockingAgentId === agent.id) {
							console.log(`[GitProject] Unlocking canvas ${canvas.id} from ${agent.status} agent ${agent.id.slice(0, 8)}`);
							this.unlockCanvas(canvas.id, agent.id);
						}
					});
				}
				
				BackgroundAgentManager.onAgentStatusChanged(agent, this);
			} else {
				// Subscribe to status changes for active agents
				const unsubscribe = agent.subscribe(() => {
					if (['completed', 'failed', 'cancelled'].includes(agent.status)) {
						console.log(`[GitProject] Agent ${agent.id.slice(0, 8)} reached terminal state (${agent.status}), scheduling cleanup`);
						BackgroundAgentManager.onAgentStatusChanged(agent, this);
						unsubscribe(); // Only need to detect the first terminal state
					}
				});
			}
		});
	}

	getBackgroundAgent(agentId: string): BackgroundAgent | undefined {
		return this.backgroundAgents.find(a => a.id === agentId);
	}


	updateBackgroundAgent(agentId: string, agent: BackgroundAgent): void {
		const index = this.backgroundAgents.findIndex(a => a.id === agentId);
		if (index !== -1) {
			this.backgroundAgents[index] = agent;
			this.lastModified = Date.now();
			this.notifyListeners('backgroundAgents');
		}
	}

	removeBackgroundAgent(agentId: string): void {
		const index = this.backgroundAgents.findIndex(a => a.id === agentId);
		if (index !== -1) {
			this.backgroundAgents.splice(index, 1);
			this.lastModified = Date.now();
			this.notifyListeners('backgroundAgents');
		}
	}

	addCanvas(canvas?: Partial<GitProjectCanvas>): string {
		const canvasOsSession = canvas?.osSession !== undefined ? canvas.osSession : this.root; // Use provided osSession or fallback to root
		
		const newCanvas: GitProjectCanvas = {
			id: crypto.randomUUID(),
			name: canvas?.name || "", // No automatic naming
			elements: canvas?.elements || [
				// Automatically add a TextArea element for new canvases
				TextArea.canvasElement(canvasOsSession || this.root, "")
			],
			osSession: canvasOsSession,
			taskManager: canvas?.taskManager || new TaskManager(),
			createdAt: Date.now(),
			lastModified: Date.now(),
			lockState: canvas?.lockState || 'normal',
			lockingAgentId: canvas?.lockingAgentId,
			lockedAt: canvas?.lockedAt,
			inProgressPrompts: canvas?.inProgressPrompts || new Map(),
		};

		this.canvases.push(newCanvas);
		
		// If this is the first canvas, automatically select it
		if (this.canvases.length === 1) {
			this.currentCanvasIndex = 0;
		}
		
		this.lastModified = Date.now();
		this.notifyListeners('canvases');
		if (this.canvases.length === 1) {
			this.notifyListeners('currentCanvasIndex');
		}
		return newCanvas.id;
	}

	/**
	 * Creates a new canvas immediately in loading state, then populates it asynchronously
	 */
	addCanvasCopy(onProgress?: (progress: CopyProgress) => void, canvas?: Partial<GitProjectCanvas>, initialPrompt?: string): { success: boolean; canvasId?: string; error?: string } {
		try {
			// Get the root working directory
			const rootDirectory = osSessionGetWorkingDirectory(this.root);
			if (!rootDirectory) {
				return { success: false, error: "Could not determine root directory" };
			}

			// Create the canvas immediately in loading state with null osSession
			const canvasId = this.addCanvas({
				name: `Canvas ${this.canvases.length + 1} (Loading...)`,
				osSession: null, // Will be set when copy is ready
				taskManager: new TaskManager(),
				lockState: 'loading',
				elements: initialPrompt ? [
					(() => {
						const textAreaElement = TextArea.canvasElement(null, "");
						if ('textArea' in textAreaElement.kind) {
							textAreaElement.kind.textArea.setContentAndTriggerAutoGo(initialPrompt);
						}
						return textAreaElement;
					})()
				] : undefined,
				...canvas
			});

			// Start the copy process asynchronously
			this.populateCanvasAsync(canvasId, rootDirectory, onProgress);

			return { success: true, canvasId };
		} catch (error) {
			return { 
				success: false, 
				error: `Unexpected error: ${error}` 
			};
		}
	}

	/**
	 * Populates a loading canvas with actual copy data asynchronously
	 */
	private async populateCanvasAsync(canvasId: string, rootDirectory: string, onProgress?: (progress: CopyProgress) => void): Promise<void> {
		try {
			const canvas = this.canvases.find(c => c.id === canvasId);
			if (!canvas) {
				console.error(`Canvas ${canvasId} not found for population`);
				return;
			}

			// Update progress on the canvas
			const progressHandler = (progress: CopyProgress) => {
				const canvas = this.canvases.find(c => c.id === canvasId);
				if (canvas) {
					canvas.copyProgress = progress;
					this.lastModified = Date.now();
					this.notifyListeners('canvases');
				}
				onProgress?.(progress);
			};

			// Get a copy from the pool (handles reuse and creation automatically)
			const copyPool = CopyPoolManager.getInstance();
			const copyEntry = await copyPool.getCopy(rootDirectory, this.root, progressHandler);
			
			// Update the canvas with the real copy data
			canvas.name = `Canvas ${this.canvases.indexOf(canvas) + 1} (${copyEntry.branchName})`;
			canvas.osSession = copyEntry.osSession;
			
			// Update all TextArea elements to use the new osSession
			canvas.elements.forEach(element => {
				if (element.kind && 'textArea' in element.kind) {
					element.kind.textArea.osSession = copyEntry.osSession;
				}
			});
			
			canvas.lockState = 'normal';
			canvas.copyProgress = undefined;
			this.lastModified = Date.now();
			this.notifyListeners('canvases');

			console.log(`Canvas ${canvasId} populated successfully`);
		} catch (error) {
			console.error(`Failed to populate canvas ${canvasId}:`, error);
			
			// Mark canvas as failed
			const canvas = this.canvases.find(c => c.id === canvasId);
			if (canvas) {
				canvas.name = `Canvas ${this.canvases.indexOf(canvas) + 1} (Failed)`;
				canvas.lockState = 'normal';
				canvas.copyProgress = undefined;
				this.lastModified = Date.now();
				this.notifyListeners('canvases');
			}
		}
	}


	/**
	 * Returns a canvas copy back to the pool for reuse
	 */
	async returnCanvasCopy(canvasId: string): Promise<void> {
		const canvas = this.canvases.find(c => c.id === canvasId);
		if (!canvas?.osSession) {
			return;
		}

		const rootDirectory = osSessionGetWorkingDirectory(this.root);
		if (!rootDirectory) {
			return;
		}

		const copyEntry: CopyPoolEntry = {
			id: canvasId,
			path: osSessionGetWorkingDirectory(canvas.osSession) || "",
			osSession: canvas.osSession,
			branchName: `canvas-${canvasId}`,
			createdAt: new Date()
		};

		const copyPool = CopyPoolManager.getInstance();
		await copyPool.returnCopy(copyEntry, rootDirectory, this.root);
	}

	/**
	 * Merges a canvas back to the root using background agent
	 */
	async mergeCanvasToRoot(canvasId: string): Promise<MergeResult> {
		const canvas = this.canvases.find(c => c.id === canvasId);
		if (!canvas) {
			return { success: false, error: "Canvas not found" };
		}

		if (!canvas.osSession) {
			return { success: false, error: "Canvas has no OS session" };
		}

		// Check if canvas is already locked
		if (canvas.lockState !== 'normal') {
			return { 
				success: false, 
				error: `Canvas is currently ${canvas.lockState}. Cannot start merge.` 
			};
		}

		// Validate that the canvas directory still exists
		const canvasDir = osSessionGetWorkingDirectory(canvas.osSession);
		try {
			await invoke('execute_command_with_os_session', {
				command: 'test',
				args: ['-d', canvasDir],
				directory: '/',
				osSession: canvas.osSession
			});
		} catch (error) {
			return { 
				success: false, 
				error: `Canvas directory no longer exists: ${canvasDir}. The canvas may have been deleted.` 
			};
		}

		try {
			// Collect all historical prompts
			const allPrompts = this.getAllHistoricalPrompts(canvasId);

			// Create merge background agent (agent is added to this GitProject automatically)
			const agentId = await BackgroundAgentManager.createMergeAgent(
				this.root,
				canvas.osSession,
				canvasId,
				allPrompts,
				this // Pass GitProject instance
			);

			return { success: true, agentId };

		} catch (error) {
			return { 
				success: false, 
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	/**
	 * Get all historical prompts from current canvas and previously merged canvases
	 */
	private getAllHistoricalPrompts(currentCanvasId: string): string[] {
		const prompts: string[] = [];
		
		// Get all tasks from current canvas
		const currentCanvas = this.canvases.find(c => c.id === currentCanvasId);
		if (currentCanvas) {
			const tasks = currentCanvas.taskManager.getTasks();
			prompts.push(...tasks.map(t => t.prompt));
		}
		
		// Get all completed background merge agents' prompts
		const completedMergeAgents = this.backgroundAgents.filter(
			a => a.type === 'merge' && a.status === 'completed'
		);
		
		for (const agent of completedMergeAgents) {
			const mergeContext = agent.context as any;
			if (mergeContext.allHistoricalPrompts) {
				prompts.push(...mergeContext.allHistoricalPrompts);
			}
		}
		
		return prompts;
	}

	removeCanvas(canvasId: string): boolean {
		const index = this.canvases.findIndex(c => c.id === canvasId);
		if (index === -1 || this.canvases.length <= 1) return false;

		this.canvases.splice(index, 1);
		
		// Adjust currentCanvasIndex if needed
		if (this.currentCanvasIndex >= this.canvases.length) {
			this.currentCanvasIndex = this.canvases.length - 1;
		} else if (this.currentCanvasIndex > index) {
			this.currentCanvasIndex--;
		}

		this.lastModified = Date.now();
		this.notifyListeners('canvases');
		this.notifyListeners('currentCanvasIndex');
		return true;
	}

	updateCanvasElements(canvasId: string, elements: CanvasElement[]): boolean {
		const canvas = this.canvases.find(c => c.id === canvasId);
		if (!canvas) return false;

		canvas.elements = elements;
		canvas.lastModified = Date.now();
		this.lastModified = Date.now();
		this.notifyListeners('canvases');
		return true;
	}

	addToCurrentCanvasElements(element: CanvasElement): boolean {
		const canvas = this.canvases[this.currentCanvasIndex];
		if (!canvas) return false;
		return this.updateCanvasElements(canvas.id, [...canvas.elements, element])
	}

	renameCanvas(canvasId: string, name: string): boolean {
		const canvas = this.canvases.find(c => c.id === canvasId);
		if (!canvas) return false;

		canvas.name = name;
		canvas.lastModified = Date.now();
		this.lastModified = Date.now();
		this.notifyListeners('canvases');
		return true;
	}

	// Reactive event system
	subscribe(property: 'canvases' | 'currentCanvasIndex' | 'backgroundAgents' | 'repositoryId', callback: () => void): () => void {
		if (!this.listeners.has(property)) {
			this.listeners.set(property, new Set());
		}
		this.listeners.get(property)!.add(callback);

		// Return unsubscribe function
		return () => {
			this.listeners.get(property)?.delete(callback);
		};
	}

	private notifyListeners(property: string): void {
		this.listeners.get(property)?.forEach(callback => callback());
	}

	// Canvas locking management
	lockCanvas(canvasId: string, lockState: CanvasLockState, agentId?: string): boolean {
		const canvas = this.canvases.find(c => c.id === canvasId);
		if (!canvas) return false;

		// Don't allow locking if already locked by different agent
		if (canvas.lockState !== 'normal' && canvas.lockingAgentId !== agentId) {
			return false;
		}

		console.log(`[GitProject] Locking canvas ${canvasId} to state: ${lockState}`);
		canvas.lockState = lockState;
		canvas.lockingAgentId = agentId;
		canvas.lockedAt = Date.now();
		this.lastModified = Date.now();
		this.notifyListeners('canvases');
		return true;
	}

	unlockCanvas(canvasId: string, agentId?: string): boolean {
		const canvas = this.canvases.find(c => c.id === canvasId);
		if (!canvas) return false;

		// Only allow unlocking by the same agent that locked it (or force unlock)
		if (agentId && canvas.lockingAgentId && canvas.lockingAgentId !== agentId) {
			return false;
		}

		console.log(`[GitProject] Unlocking canvas ${canvasId}`);
		canvas.lockState = 'normal';
		canvas.lockingAgentId = undefined;
		canvas.lockedAt = undefined;
		this.lastModified = Date.now();
		this.notifyListeners('canvases');
		return true;
	}

	getCanvasLockState(canvasId: string): CanvasLockState | null {
		const canvas = this.canvases.find(c => c.id === canvasId);
		return canvas ? canvas.lockState : null;
	}

	isCanvasLocked(canvasId: string): boolean {
		const canvas = this.canvases.find(c => c.id === canvasId);
		return canvas ? canvas.lockState !== 'normal' : false;
	}

	canEditCanvas(canvasId: string): boolean {
		return this.getCanvasLockState(canvasId) === 'normal';
	}

	// Serialization
	toJSON(): any {
		return {
			id: this.id,
			name: this.name,
			root: this.root,
			gitOriginUrl: this.gitOriginUrl,
			repositoryId: this.repositoryId, // SECURITY: Store repository ID for restoration
			canvases: this.canvases.map(canvas => ({
				...canvas,
				taskManager: canvas.taskManager.toJSON(),
				inProgressPrompts: canvas.inProgressPrompts ? Array.from(canvas.inProgressPrompts.entries()) : []
			})),
			currentCanvasIndex: this.currentCanvasIndex,
			backgroundAgents: this.backgroundAgents.map(agent => agent.toJSON()),
			createdAt: this.createdAt,
			lastModified: this.lastModified,
		};
	}

	/**
	 * Create a new GitProject and ensure it has an initial commit
	 * @param root - The OS session for the git repository
	 * @param name - Optional project name
	 * @returns Promise<GitProject> - The created project
	 */
	static async create(root: OsSession, name?: string): Promise<GitProject> {
		const project = new GitProject(root, name);
		
		try {
			// Ensure the repository has an initial commit
			await import('../services/GitService').then(({ GitService }) => 
				GitService.ensureInitialCommit(root)
			);
		} catch (error) {
			console.error('[GitProject] Failed to ensure initial commit:', error);
			// Don't throw - project is still usable, just without initial commit
		}
		
		return project;
	}

	static fromJSON(data: any): GitProject {
		console.log(`🔄 [GitProject] fromJSON called for project: ${data.name}`);
		console.log(`🔄 [GitProject] fromJSON - gitOriginUrl: ${data.gitOriginUrl}, repositoryId: ${data.repositoryId}`);
		const project = new GitProject(data.root, data.name, true); // Skip initialization during construction
		project.id = data.id;
		project.gitOriginUrl = data.gitOriginUrl || null;
		project.repositoryId = data.repositoryId || null; // SECURITY: Restore repository ID
		project.canvases = data.canvases || [];
		// Handle migration for canvases that don't have proper structure yet
		project.canvases = project.canvases.map(canvas => ({
			...canvas,
			osSession: canvas.osSession || data.root, // Fallback to project root
			taskManager: canvas.taskManager ? TaskManager.fromJSON(canvas.taskManager) : new TaskManager(),
			runningProcesses: canvas.runningProcesses || [],
			// Migration for new lock state fields
			lockState: canvas.lockState || 'normal',
			lockingAgentId: canvas.lockingAgentId,
			lockedAt: canvas.lockedAt,
			inProgressPrompts: canvas.inProgressPrompts ? new Map(canvas.inProgressPrompts) : new Map(),
		}));
		project.currentCanvasIndex = data.currentCanvasIndex >= 0 ? data.currentCanvasIndex : (project.canvases.length > 0 ? 0 : -1);
		
		// Restore background agents
		if (data.backgroundAgents && Array.isArray(data.backgroundAgents)) {
			const restoredAgents = data.backgroundAgents.map((agentData: BackgroundAgentState) => 
				BackgroundAgent.fromJSON(agentData)
			);
			
			// Set up cleanup monitoring for each restored agent
			restoredAgents.forEach((agent: BackgroundAgent) => {
				project.backgroundAgents.push(agent);
				project.setupAgentCleanupMonitoring(agent);
			});
		}
		
		project.createdAt = data.createdAt || Date.now();
		project.lastModified = data.lastModified || Date.now();
		
		// Initialize original root branch for restored projects
		project.initializeOriginalRootBranch();
		
		// SECURITY: Initialize repository ID for restored projects if not available
		// This is critical for secure backlog access
		console.log(`🔄 [GitProject] Restored project from JSON - repository ID: ${project.repositoryId}, URL: ${project.gitOriginUrl}`);
		if (project.gitOriginUrl && !project.repositoryId) {
			// Initialize repository ID since this was restored from JSON and no ID was stored
			console.log(`🔄 [GitProject] No repository ID found in storage - initializing from backend`);
			// Initialize immediately but asynchronously
			project.initializeRepositoryId().catch(error => {
				console.error(`❌ [GitProject] Failed to initialize repository ID during restoration:`, error);
			});
		} else if (project.gitOriginUrl && project.repositoryId) {
			console.log(`✅ [GitProject] Repository ID already available from storage: ${project.repositoryId}`);
		} else if (!project.gitOriginUrl) {
			console.log(`ℹ️ [GitProject] No git origin URL - repository ID detection skipped`);
		}
		
		// Check for orphaned running tasks after restoration
		// This handles the case where the app was closed while tasks were running
		if (project.currentCanvasIndex >= 0 && project.currentCanvasIndex < project.canvases.length) {
			// Use setTimeout to avoid blocking the restoration process
			setTimeout(() => {
				project.checkAndFailOrphanedTasks(project.canvases[project.currentCanvasIndex]);
			}, 100);
		}
		
		return project;
	}

	// Helper methods
	private generateDefaultName(): string {
		// Extract name from the root OsSession path
		if (this.root && typeof this.root === 'object') {
			if ('Local' in this.root) {
				const path = this.root.Local;
				return path.split('/').pop() || path.split('\\').pop() || 'Local Project';
			}
			if ('Wsl' in this.root) {
				const path = this.root.Wsl.working_directory;
				return path.split('/').pop() || 'WSL Project';
			}
		}
		return 'Untitled Project';
	}

	createDefaultCanvas(): GitProjectCanvas {
		return {
			id: crypto.randomUUID(),
			name: 'Initial version',
			elements: [
				// Automatically add a TextArea element for new canvases
				TextArea.canvasElement(this.root, "")
			],
			osSession: this.root, // Set the osSession to the root
			taskManager: new TaskManager(),
			createdAt: Date.now(),
			lastModified: Date.now(),
			lockState: 'normal',
			inProgressPrompts: new Map()
		};
	}

	// Utility methods
	get osSession(): OsSession {
		return this.root;
	}

	// Process management methods
	addProcessToCanvas(canvasId: string, process: ProcessState): boolean {
		const canvas = this.canvases.find(c => c.id === canvasId);
		if (!canvas) return false;

		if (!canvas.runningProcesses) {
			canvas.runningProcesses = [];
		}

		canvas.runningProcesses.push(process);
		canvas.lastModified = Date.now();
		this.lastModified = Date.now();
		this.notifyListeners('canvases');
		return true;
	}

	updateProcessInCanvas(canvasId: string, processId: string, updates: Partial<ProcessState>): boolean {
		const canvas = this.canvases.find(c => c.id === canvasId);
		if (!canvas?.runningProcesses) return false;

		const process = canvas.runningProcesses.find(p => p.processId === processId);
		if (!process) return false;

		Object.assign(process, updates);
		canvas.lastModified = Date.now();
		this.lastModified = Date.now();
		this.notifyListeners('canvases');
		return true;
	}

	removeProcessFromCanvas(canvasId: string, processId: string): boolean {
		const canvas = this.canvases.find(c => c.id === canvasId);
		if (!canvas?.runningProcesses) return false;

		const index = canvas.runningProcesses.findIndex(p => p.processId === processId);
		if (index === -1) return false;

		canvas.runningProcesses.splice(index, 1);
		canvas.lastModified = Date.now();
		this.lastModified = Date.now();
		this.notifyListeners('canvases');
		return true;
	}

	getCanvasProcesses(canvasId: string): ProcessState[] {
		const canvas = this.canvases.find(c => c.id === canvasId);
		return canvas?.runningProcesses || [];
	}

	getProcessByElementId(canvasId: string, elementId: string): ProcessState | undefined {
		const canvas = this.canvases.find(c => c.id === canvasId);
		return canvas?.runningProcesses?.find(p => p.elementId === elementId);
	}

	getElementIdByProcessId(canvasId: string, processId: string): string | undefined {
		const canvas = this.canvases.find(c => c.id === canvasId);
		return canvas?.runningProcesses?.find(p => p.processId === processId)?.elementId;
	}

	// In-progress prompt management
	setInProgressPrompt(canvasId: string, elementId: string, prompt: string): boolean {
		const canvas = this.canvases.find(c => c.id === canvasId);
		if (!canvas) return false;

		if (!canvas.inProgressPrompts) {
			canvas.inProgressPrompts = new Map();
		}

		if (prompt.trim()) {
			canvas.inProgressPrompts.set(elementId, prompt);
		} else {
			canvas.inProgressPrompts.delete(elementId);
		}

		canvas.lastModified = Date.now();
		this.lastModified = Date.now();
		this.notifyListeners('canvases');
		return true;
	}

	cleanupInProgressPrompt(canvasId: string, elementId: string): void {
		const canvas = this.canvases.find(c => c.id === canvasId);
		if (canvas?.inProgressPrompts?.has(elementId)) {
			canvas.inProgressPrompts.delete(elementId);
			canvas.lastModified = Date.now();
			this.lastModified = Date.now();
			this.notifyListeners('canvases');
		}
	}


	/**
	 * Check for running tasks with dead terminals and fail them
	 * Called when switching to a canvas to handle R15 requirement
	 */
	private async checkAndFailOrphanedTasks(canvas: GitProjectCanvas): Promise<void> {
		if (!canvas.taskManager) return;
		
		// ONLY check actually running tasks, not completed ones
		const runningTasks = canvas.taskManager.getRunningTasks();
		if (runningTasks.length === 0) return;
		
		console.log(`[GitProject] R15: Checking ${runningTasks.length} running tasks for dead terminals in canvas ${canvas.id}`);
		
		// Check if we need to stash (only once if any task needs to be failed)
		let needsStash = false;
		const tasksToFail: string[] = [];
		
		// Import ProcessManager to check terminal availability
		const { ProcessManager } = await import('../services/ProcessManager');
		
		for (const task of runningTasks) {
			if (task.processId) {
				// Check if the process/terminal is still alive
				const process = ProcessManager.getProcess(task.processId);
				if (!process) {
					console.log(`[GitProject] R15: Running task ${task.id} has dead terminal (process ${task.processId} not found)`);
					tasksToFail.push(task.id);
					needsStash = true;
				}
			} else {
				// No processId means the terminal was never created or already dead
				console.log(`[GitProject] R15: Running task ${task.id} has no process ID - marking as failed`);
				tasksToFail.push(task.id);
				needsStash = true;
			}
		}
		
		// Perform git stash if needed (R15, Q9)
		if (needsStash && canvas.osSession) {
			try {
				console.log(`[GitProject] R15: Performing git stash before marking ${tasksToFail.length} tasks as failed`);
				const { GitService } = await import('../services/GitService');
				await GitService.stashChanges(canvas.osSession);
				console.log(`[GitProject] R15: Git stash completed successfully`);
			} catch (error) {
				console.error(`[GitProject] R15: Git stash failed:`, error);
				// Continue with task failure even if stash fails
			}
		}
		
		// Mark tasks as failed
		for (const taskId of tasksToFail) {
			// Get task to find processId before failing
			const task = canvas.taskManager.getTask(taskId);
			const processId = (task as any)?.processId;
			
			canvas.taskManager.failTask(taskId, "Agent process terminated");
			
			// Cleanup in-progress prompt when task fails
			if (processId) {
				const elementId = this.getElementIdByProcessId(canvas.id, processId);
				if (elementId) {
					this.cleanupInProgressPrompt(canvas.id, elementId);
				}
			}
		}
		
		if (tasksToFail.length > 0) {
			console.log(`[GitProject] R15: Marked ${tasksToFail.length} tasks as failed due to dead terminals`);
			this.notifyListeners('canvases');
		}
	}
}