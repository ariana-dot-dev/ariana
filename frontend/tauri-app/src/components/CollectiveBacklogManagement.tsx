import React, { useState, useEffect, useMemo } from 'react';
import BacklogService, { BacklogItem, BacklogFilters } from '../services/BacklogService';
import AuthService from '../services/AuthService';
import { GitProject } from '../types/GitProject';

interface CollectiveBacklogManagementProps {
	project?: GitProject;
	onClose?: () => void;
	onCreateAgent?: () => string | undefined;
	onAddPrompt?: (canvasId: string, prompt: string) => void;
	selectedAgents?: string[];
	canvases?: { id: string, lockState?: string }[]; // To track merged canvases
	onPromptDeleted?: (promptId: string, agentId: string) => void; // Callback for prompt deletion
}

export const CollectiveBacklogManagement: React.FC<CollectiveBacklogManagementProps> = ({ 
	project, 
	onClose, 
	onCreateAgent, 
	onAddPrompt, 
	selectedAgents,
	canvases,
	onPromptDeleted 
}) => {
	const [backlogItems, setBacklogItems] = useState<BacklogItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [editingCell, setEditingCell] = useState<{itemId: number, field: string} | null>(null);
	const [editValues, setEditValues] = useState<Partial<BacklogItem>>({});
	const [filters, setFilters] = useState({
		status: '',
		priority: '',
		owner: '',
		overdue: false
	});
	const [sortConfig, setSortConfig] = useState<{
		key: keyof BacklogItem;
		direction: 'asc' | 'desc';
	}>({ key: 'priority', direction: 'asc' });
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [newTaskData, setNewTaskData] = useState({
		task: '',
		priority: 3,
		status: 'open' as const,
		owner: null
	});

	const backlogService = useMemo(() => new BacklogService(), []);
	const authService = useMemo(() => AuthService.getInstance(), []);
	const [currentUser, setCurrentUser] = useState<any>(null);
	const [availableUsers, setAvailableUsers] = useState<{id: string, name: string, email: string}[]>([]);
	const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set());
	
	// Task-Prompt mapping with status tracking - persist across re-renders
	// Structure: { taskId: { promptId: { agentId: string, status: 'in_progress' | 'merged' } } }
	const getStorageKey = () => `taskPromptMappings_${project?.gitOriginUrl || 'default'}`;
	
	const [taskPromptMappings, setTaskPromptMappings] = useState<Record<number, Record<string, { agentId: string, status: 'in_progress' | 'merged' }>>>(() => {
		// Initialize from localStorage if available
		try {
			const stored = localStorage.getItem(getStorageKey());
			if (stored) {
				const parsed = JSON.parse(stored);
				console.log('🔄 [STORAGE] Loaded task prompt mappings from localStorage:', parsed);
				return parsed;
			}
		} catch (error) {
			console.error('❌ [STORAGE] Failed to load task prompt mappings from localStorage:', error);
		}
		return {};
	});
	
	// Save to localStorage whenever taskPromptMappings changes
	useEffect(() => {
		try {
			const storageKey = getStorageKey();
			localStorage.setItem(storageKey, JSON.stringify(taskPromptMappings));
			console.log('💾 [STORAGE] Saved task prompt mappings to localStorage with key:', storageKey, 'data:', taskPromptMappings);
		} catch (error) {
			console.error('❌ [STORAGE] Failed to save task prompt mappings to localStorage:', error);
		}
	}, [taskPromptMappings, project?.gitOriginUrl]);
	
	// Keep track of previous canvas state to detect prompt deletions
	const [previousCanvasData, setPreviousCanvasData] = useState<{ id: string, lockState?: string, promptCount?: number }[]>([]);

	// Calculate task status based on prompt mappings
	const calculateTaskStatus = (taskId: number, mappings?: Record<number, Record<string, { agentId: string, status: 'in_progress' | 'merged' }>>): 'open' | 'in_progress' | 'completed' => {
		console.log('🧮 [STATUS] Calculating status for task:', taskId);
		// Use provided mappings or fall back to state
		const allMappings = mappings || taskPromptMappings;
		const prompts = allMappings[taskId];
		console.log('🧮 [STATUS] Task prompt mappings for task', taskId, ':', prompts);
		
		if (!prompts || Object.keys(prompts).length === 0) {
			console.log('🧮 [STATUS] No prompts found for task', taskId, '-> status: open');
			return 'open'; // No prompts linked
		}
		
		const promptStatuses = Object.values(prompts).map(p => p.status);
		console.log('🧮 [STATUS] Prompt statuses for task', taskId, ':', promptStatuses);
		
		const allMerged = promptStatuses.every(status => status === 'merged');
		console.log('🧮 [STATUS] All prompts merged for task', taskId, ':', allMerged);
		
		if (allMerged) {
			console.log('🧮 [STATUS] Task', taskId, '-> status: completed (all prompts merged)');
			return 'completed'; // All prompts are merged
		}
		
		console.log('🧮 [STATUS] Task', taskId, '-> status: in_progress (some prompts exist but not all merged)');
		return 'in_progress'; // Some prompts exist but not all are merged
	};

	// Update task status in backend and local state
	const updateTaskStatus = async (taskId: number, mappings?: Record<number, Record<string, { agentId: string, status: 'in_progress' | 'merged' }>>) => {
		console.log('🔄 [UPDATE] Starting status update for task:', taskId);
		const calculatedStatus = calculateTaskStatus(taskId, mappings);
		console.log('🔄 [UPDATE] Calculated status for task', taskId, ':', calculatedStatus);
		
		const currentItem = backlogItems.find(item => item.id === taskId);
		console.log('🔄 [UPDATE] Current item for task', taskId, ':', currentItem ? currentItem.status : 'not found');
		
		if (currentItem && currentItem.status !== calculatedStatus) {
			console.log('🔄 [UPDATE] Status change detected for task', taskId, ':', currentItem.status, '->', calculatedStatus);
			try {
				// Update in backend
				console.log('💾 [UPDATE] Updating backend for task', taskId, 'with status:', calculatedStatus);
				await backlogService.updateBacklogItem(taskId, { status: calculatedStatus });
				
				// Update local state
				console.log('🔄 [UPDATE] Updating local state for task', taskId);
				setBacklogItems(prev => prev.map(item => 
					item.id === taskId ? { ...item, status: calculatedStatus } : item
				));
				
				console.log(`✅ [UPDATE] Successfully updated task ${taskId} status to ${calculatedStatus}`);
			} catch (error) {
				console.error(`❌ [UPDATE] Failed to update task ${taskId} status:`, error);
			}
		} else if (currentItem) {
			console.log('🔄 [UPDATE] No status change needed for task', taskId, '(already', currentItem.status, ')');
		} else {
			console.log('❌ [UPDATE] Task', taskId, 'not found in backlogItems');
		}
	};

	// Ensure localStorage is loaded on every initialization/re-initialization
	useEffect(() => {
		console.log('🔧 [INIT] CollectiveBacklogManagement initialized with props:');
		console.log('🔧 [INIT] - onCreateAgent:', !!onCreateAgent);
		console.log('🔧 [INIT] - onAddPrompt:', !!onAddPrompt);
		console.log('🔧 [INIT] - selectedAgents:', selectedAgents);
		console.log('🔧 [INIT] - canvases:', canvases?.length || 0, 'canvases');
		console.log('🔧 [INIT] - project:', !!project);
		
		// Force reload from localStorage on every initialization
		try {
			const storageKey = getStorageKey();
			console.log('🔧 [INIT-STORAGE] Using storage key:', storageKey, 'for project:', project?.gitOriginUrl);
			const stored = localStorage.getItem(storageKey);
			if (stored) {
				const parsed = JSON.parse(stored);
				console.log('🔄 [INIT-STORAGE] Force loading task prompt mappings from localStorage:', parsed);
				setTaskPromptMappings(parsed);
			} else {
				console.log('🔄 [INIT-STORAGE] No stored mappings found in localStorage for key:', storageKey);
				// List all localStorage keys for debugging
				console.log('🔧 [INIT-STORAGE] Available localStorage keys:', Object.keys(localStorage));
			}
		} catch (error) {
			console.error('❌ [INIT-STORAGE] Failed to load task prompt mappings during init:', error);
		}
	}, [onCreateAgent, onAddPrompt, selectedAgents, canvases, project]);

	// Check authentication status
	useEffect(() => {
		console.log('🔍 [CollectiveBacklog] Authentication useEffect triggered');
		const authState = authService.getAuthState();
		console.log('🔍 [CollectiveBacklog] Auth state:', { isAuthenticated: authState.isAuthenticated, hasUser: !!authState.user });
		setIsAuthenticated(authState.isAuthenticated);
		setCurrentUser(authState.user);
		
		// SECURITY: Initial check - trigger repository ID detection if authenticated
		console.log('🔍 [CollectiveBacklog] Checking fallback conditions:', {
			isAuthenticated: authState.isAuthenticated,
			hasProject: !!project,
			hasGitOriginUrl: !!project?.gitOriginUrl,
			hasRepositoryId: !!project?.repositoryId,
			gitOriginUrl: project?.gitOriginUrl
		});
		
		if (authState.isAuthenticated && project && project.gitOriginUrl && !project.repositoryId) {
			console.log('🔑 [CollectiveBacklog] Initial auth check - triggering repository ID detection');
			console.log('🔄 [CollectiveBacklog] Automatic fallback: Repository ID is null, retrying detection...');
			project.retryRepositoryIdDetection().catch(error => {
				console.error('❌ [CollectiveBacklog] Failed to retry repository ID detection:', error);
			});
		} else {
			console.log('🔍 [CollectiveBacklog] Fallback conditions not met - skipping automatic retry');
		}

		// Subscribe to auth state changes
		const unsubscribe = authService.subscribe((state) => {
			setIsAuthenticated(state.isAuthenticated);
			setCurrentUser(state.user);
			
			// SECURITY: Trigger repository ID detection when authentication becomes available
			if (state.isAuthenticated && project && project.gitOriginUrl && !project.repositoryId) {
				console.log('🔑 [CollectiveBacklog] Authentication detected - triggering repository ID detection');
				console.log('🔄 [CollectiveBacklog] Automatic fallback: Authentication changed, retrying repository ID detection...');
				project.retryRepositoryIdDetection().catch(error => {
					console.error('❌ [CollectiveBacklog] Failed to retry repository ID detection on auth change:', error);
				});
			}
		});

		return unsubscribe;
	}, [authService, project]);

	// Watch for repository ID changes and refetch when it becomes available
	useEffect(() => {
		if (!project) return;
		
		// Subscribe to repository ID changes
		const unsubscribe = project.subscribe('repositoryId', () => {
			console.log('🔄 [CollectiveBacklog] Repository ID changed notification received');
			if (project.repositoryId && isAuthenticated) {
				console.log('🔄 [CollectiveBacklog] Repository ID detected/changed - fetching backlog items');
				fetchBacklogItems();
			}
		});
		
		// Initial check - call fetchBacklogItems even when repositoryId is null to trigger fallback
		if (isAuthenticated) {
			if (project.repositoryId) {
				console.log('🔄 [CollectiveBacklog] Initial repository ID detected - fetching backlog items');
			} else {
				console.log('🔄 [CollectiveBacklog] No repository ID detected - calling fetchBacklogItems to trigger fallback');
			}
			fetchBacklogItems();
		}
		
		return unsubscribe;
	}, [project, isAuthenticated]);

	// Fetch backlog items
	const fetchBacklogItems = async () => {
		try {
			setLoading(true);
			setError(null);

			// Check if user is authenticated
			const authState = authService.getAuthState();
			if (!authState.isAuthenticated) {
				setError('Authentication required. Please log in to view backlog items.');
				return;
			}

			let items: BacklogItem[] = [];

			// SECURITY: Use repository ID for secure, filtered access
			console.log(`🔍 [CollectiveBacklog] Project state:`, {
				hasProject: !!project,
				gitOriginUrl: project?.gitOriginUrl,
				repositoryId: project?.repositoryId
			});
			
			// IMMEDIATE FALLBACK: Trigger repository ID detection right when we detect null
			console.log('🔧 [CollectiveBacklog] IMMEDIATE FALLBACK condition check:');
			console.log('🔧 [CollectiveBacklog] - project?.gitOriginUrl:', project?.gitOriginUrl);
			console.log('🔧 [CollectiveBacklog] - !project?.repositoryId:', !project?.repositoryId);
			console.log('🔧 [CollectiveBacklog] - project?.repositoryId === null:', project?.repositoryId === null);
			console.log('🔧 [CollectiveBacklog] - project?.repositoryId === undefined:', project?.repositoryId === undefined);
			console.log('🔧 [CollectiveBacklog] - typeof project?.repositoryId:', typeof project?.repositoryId);
			console.log('🔧 [CollectiveBacklog] - project?.repositoryId value:', project?.repositoryId);
			
			if (project?.gitOriginUrl && !project?.repositoryId) {
				console.log('🔄 [CollectiveBacklog] IMMEDIATE FALLBACK: Detected repositoryId null - triggering detection right now');
				try {
					await project.retryRepositoryIdDetection();
					console.log(`🔄 [CollectiveBacklog] IMMEDIATE FALLBACK: Detection completed, new repositoryId: ${project.repositoryId}`);
				} catch (error) {
					console.error('❌ [CollectiveBacklog] IMMEDIATE FALLBACK failed:', error);
				}
			} else {
				console.log('🚨 [CollectiveBacklog] IMMEDIATE FALLBACK: Condition not met - no fallback triggered');
			}
			
			if (project?.repositoryId) {
				console.log(`✅ [CollectiveBacklog] Fetching backlog items for repository ID: ${project.repositoryId}`);
				items = await backlogService.getBacklogByRepositoryRandomId(project.repositoryId);
				console.log(`✅ [CollectiveBacklog] Successfully fetched ${items.length} items for repository`);
			} else if (project?.gitOriginUrl && !project?.repositoryId) {
				// AUTOMATIC FALLBACK: Try to get repository ID if missing
				console.warn('🚨 [CollectiveBacklog] No repository ID available but git URL exists - triggering automatic fallback');
				console.log('🔄 [CollectiveBacklog] Automatic fallback: Attempting to detect repository ID...');
				try {
					await project.retryRepositoryIdDetection();
					// After successful detection, try fetching again
					if (project.repositoryId) {
						console.log(`✅ [CollectiveBacklog] Repository ID detected after fallback: ${project.repositoryId}`);
						items = await backlogService.getBacklogByRepositoryRandomId(project.repositoryId);
						console.log(`✅ [CollectiveBacklog] Successfully fetched ${items.length} items after fallback`);
					} else {
						console.warn('🚨 [CollectiveBacklog] Repository ID detection failed - showing no items');
						items = [];
					}
				} catch (error) {
					console.error('❌ [CollectiveBacklog] Automatic fallback failed:', error);
					items = [];
				}
			} else {
				console.warn('🚨 [CollectiveBacklog] No repository ID or git URL available - showing no items');
				console.log('🔍 [CollectiveBacklog] Debug info:', {
					hasProject: !!project,
					gitOriginUrl: project?.gitOriginUrl,
					repositoryId: project?.repositoryId
				});
				items = [];
			}
			
			setBacklogItems(items);

			// Extract unique users from backlog items for owner selection
			const uniqueUsers = Array.from(
				new Map(items.map(item => [item.owner, { id: item.owner, name: item.owner_name, email: item.owner_email }]))
					.values()
			);
			setAvailableUsers(uniqueUsers);
		} catch (err) {
			console.error('Failed to fetch backlog items:', err);
			if (err instanceof Error) {
				if (err.message.includes('Authentication required')) {
					setError('Authentication required. Please log in to view backlog items.');
				} else {
					setError(`Failed to fetch backlog items: ${err.message}`);
				}
			} else {
				setError('Failed to fetch backlog items. Please try again.');
			}
		} finally {
			setLoading(false);
		}
	};

	// Update backlog item
	const updateBacklogItem = async (id: number, updates: Partial<BacklogItem>) => {
		try {
			// Prepare updates for the API (only include allowed fields)
			const apiUpdates: any = {};
			if (updates.task !== undefined) apiUpdates.task = updates.task;
			if (updates.status !== undefined) apiUpdates.status = updates.status;
			if (updates.priority !== undefined) apiUpdates.priority = updates.priority;
			if (updates.due_date !== undefined) apiUpdates.due_date = updates.due_date;
			if (updates.owner !== undefined) apiUpdates.owner = updates.owner;

			const updatedItem = await backlogService.updateBacklogItem(id, apiUpdates);
			
			console.log('Updated item from server:', updatedItem);
			console.log('Updates sent:', updates);
			console.log('Available users:', availableUsers);
			
			// Update local state with the response from server
			setBacklogItems(prev => 
				prev.map(item => {
					if (item.id === id) {
						// If owner was changed, make sure to update owner info from available users
						if (updates.owner) {
							const newOwner = availableUsers.find(user => user.id === updates.owner);
							console.log('Found new owner:', newOwner);
							if (newOwner) {
								const finalItem = {
									...updatedItem,
									owner: updates.owner,
									owner_name: newOwner.name,
									owner_email: newOwner.email
								};
								console.log('Final item:', finalItem);
								return finalItem;
							}
						}
						return updatedItem;
					}
					return item;
				})
			);
			
			// Clear editing state - note: this is handled by saveCellEdit() now
			// setEditingCell(null);
			// setEditValues({});
		} catch (err) {
			console.error('Failed to update backlog item:', err);
			setError(err instanceof Error ? err.message : 'Failed to update item');
		}
	};

	// Delete backlog item
	const deleteBacklogItem = async (id: number) => {
		if (!window.confirm('Are you sure you want to delete this backlog item?')) {
			return;
		}
		
		try {
			await backlogService.deleteBacklogItem(id);
			
			// Remove from local state
			setBacklogItems(prev => prev.filter(item => item.id !== id));
		} catch (err) {
			console.error('Failed to delete backlog item:', err);
			setError(err instanceof Error ? err.message : 'Failed to delete item');
		}
	};

	// Handle cell click to start editing
	const startCellEdit = (item: BacklogItem, field: string) => {
		// Only allow editing of specific fields
		if (!['task', 'status', 'priority', 'due_date', 'owner'].includes(field)) return;
		
		setEditingCell({ itemId: item.id, field });
		setEditValues({ [field]: item[field as keyof BacklogItem] });
	};

	// Handle save when clicking outside or pressing Enter
	const saveCellEdit = () => {
		if (editingCell && Object.keys(editValues).length > 0) {
			let updates = { ...editValues };
			
			// If owner is being changed, automatically reset status to "open"
			if (editingCell.field === 'owner') {
				updates.status = 'open';
			}
			
			updateBacklogItem(editingCell.itemId, updates);
		}
		setEditingCell(null);
		setEditValues({});
	};

	// Handle cancel edit
	const cancelCellEdit = () => {
		setEditingCell(null);
		setEditValues({});
	};

	// Handle key press in edit mode
	const handleKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			saveCellEdit();
		} else if (e.key === 'Escape') {
			cancelCellEdit();
		}
	};

	// Handle create new task
	const createNewTask = async () => {
		if (!newTaskData.task.trim()) {
			setError('Task description is required');
			return;
		}
		
		if (!project?.gitOriginUrl) {
			setError('No .git URL detected, cannot create backlog tasks.');
			return;
		}

		try {
			// SECURITY: Direct task creation without URL-based repository lookup
			// The backend will handle repository association through authentication
			const taskData = {
				...newTaskData,
				git_repository_url: project.gitOriginUrl // Backend still expects this for now
			};
			
			const newItem = await backlogService.createBacklogItem(taskData);
			setBacklogItems(prev => [newItem, ...prev]);
			setNewTaskData({
				task: '',
				priority: 3,
				status: 'open',
				owner: null
			});
			setShowCreateForm(false);
			setError(null);
		} catch (err) {
			console.error('Failed to create backlog item:', err);
			setError(err instanceof Error ? err.message : 'Failed to create task');
		}
	};

	// Handle cancel create
	const cancelCreate = () => {
		setShowCreateForm(false);
		setNewTaskData({
			task: '',
			priority: 3,
			status: 'open',
			owner: null
		});
		setError(null);
	};

	// Handle add to new agent
	const handleAddToNewAgent = (item: BacklogItem) => {
		console.log('🚀 [LINK] Starting handleAddToNewAgent for task:', item.id, item.task);
		
		if (!onCreateAgent || !onAddPrompt) {
			console.error('❌ [LINK] Missing onCreateAgent or onAddPrompt functions');
			return;
		}
		
		// Create new agent
		const newAgentId = onCreateAgent();
		console.log('✅ [LINK] Created new agent:', newAgentId);
		
		if (newAgentId) {
			// Add the task as a prompt to the new agent
			console.log('📝 [LINK] Adding prompt to agent:', newAgentId, 'Prompt:', item.task);
			onAddPrompt(newAgentId, item.task);
			
			// Create prompt mapping with initial status 'in_progress'
			const promptId = `${newAgentId}-${Date.now()}`; // Generate unique prompt ID
			console.log('🔗 [LINK] Creating prompt mapping - Task ID:', item.id, 'Prompt ID:', promptId, 'Agent ID:', newAgentId);
			
			const newMapping = {
				...taskPromptMappings,
				[item.id]: {
					...taskPromptMappings[item.id],
					[promptId]: {
						agentId: newAgentId,
						status: 'in_progress' as const
					}
				}
			};
			
			console.log('📊 [LINK] New task prompt mappings:', newMapping);
			
			// Update state
			setTaskPromptMappings(newMapping);
			
			// Update task status immediately with the new mappings
			console.log('🔄 [LINK] Updating task status immediately with new mappings for task:', item.id);
			updateTaskStatus(item.id, newMapping);
			
			// Also schedule a delayed update as backup in case of re-initialization
			console.log('⏰ [LINK] Scheduling backup task status update for task:', item.id);
			setTimeout(() => {
				console.log('🔄 [LINK] Executing backup scheduled task status update for task:', item.id);
				updateTaskStatus(item.id);
			}, 1000);
			
			console.log(`✅ [LINK] Successfully added task "${item.task}" to new agent ${newAgentId} with prompt ID ${promptId}`);
		} else {
			console.error('❌ [LINK] Failed to create new agent');
		}
	};

	// Handle add to selected agents
	const handleAddToSelectedAgents = (item: BacklogItem) => {
		console.log('🚀 [MULTI-LINK] Starting handleAddToSelectedAgents for task:', item.id, item.task, 'Selected agents:', selectedAgents);
		
		if (!onAddPrompt || !selectedAgents || selectedAgents.length === 0) {
			console.error('❌ [MULTI-LINK] Missing onAddPrompt function or no agents selected');
			return;
		}
		
		// Add the task as a prompt to each selected agent
		const newMappings: Record<string, { agentId: string, status: 'in_progress' | 'merged' }> = {};
		
		selectedAgents.forEach(agentId => {
			console.log('📝 [MULTI-LINK] Adding prompt to agent:', agentId, 'Prompt:', item.task);
			onAddPrompt(agentId, item.task);
			
			// Create prompt mapping for each agent
			const promptId = `${agentId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
			newMappings[promptId] = {
				agentId: agentId,
				status: 'in_progress'
			};
			
			console.log(`🔗 [MULTI-LINK] Created mapping - Task ID: ${item.id}, Prompt ID: ${promptId}, Agent ID: ${agentId}`);
		});
		
		console.log('📊 [MULTI-LINK] All new mappings created:', newMappings);
		
		// Update task prompt mappings
		const updatedMapping = {
			...taskPromptMappings,
			[item.id]: {
				...taskPromptMappings[item.id],
				...newMappings
			}
		};
		
		console.log('📊 [MULTI-LINK] Updated task prompt mappings:', updatedMapping);
		
		// Update state
		setTaskPromptMappings(updatedMapping);
		
		// Update task status immediately with the new mappings
		console.log('🔄 [MULTI-LINK] Updating task status immediately with new mappings for task:', item.id);
		updateTaskStatus(item.id, updatedMapping);
		
		// Also schedule a delayed update as backup
		console.log('⏰ [MULTI-LINK] Scheduling backup task status update for task:', item.id);
		setTimeout(() => {
			console.log('🔄 [MULTI-LINK] Executing backup scheduled task status update for task:', item.id);
			updateTaskStatus(item.id);
		}, 1000);
	};

	// Task selection helper functions
	const toggleTaskSelection = (taskId: number) => {
		setSelectedTasks(prev => {
			const newSet = new Set(prev);
			if (newSet.has(taskId)) {
				newSet.delete(taskId);
			} else {
				newSet.add(taskId);
			}
			return newSet;
		});
	};

	const toggleAllTasks = () => {
		if (selectedTasks.size === sortedAndFilteredItems.length) {
			setSelectedTasks(new Set());
		} else {
			setSelectedTasks(new Set(sortedAndFilteredItems.map(item => item.id)));
		}
	};

	const clearTaskSelection = () => {
		setSelectedTasks(new Set());
	};

	// Bulk actions for selected tasks
	const handleAddSelectedTasksToNewAgent = () => {
		if (selectedTasks.size === 0 || !onCreateAgent || !onAddPrompt) return;
		
		// Create new agent
		const newAgentId = onCreateAgent();
		console.log('Created new agent for bulk tasks:', newAgentId);
		
		if (newAgentId) {
			// Add all selected tasks to the new agent
			selectedTasks.forEach(taskId => {
				const item = backlogItems.find(item => item.id === taskId);
				if (item) {
					onAddPrompt(newAgentId, item.task);
					
					// Create prompt mapping
					const promptId = `${newAgentId}-${Date.now()}-${taskId}`;
					setTaskPromptMappings(prev => ({
						...prev,
						[taskId]: {
							...prev[taskId],
							[promptId]: {
								agentId: newAgentId,
								status: 'in_progress'
							}
						}
					}));
					
					// Update task status
					setTimeout(() => updateTaskStatus(taskId), 100);
					
					console.log(`Added task "${item.task}" to new agent ${newAgentId} with prompt ID ${promptId}`);
				}
			});
			clearTaskSelection();
		}
	};

	const handleAddSelectedTasksToSelectedAgents = () => {
		if (selectedTasks.size === 0 || !onAddPrompt || !selectedAgents || selectedAgents.length === 0) return;
		
		// Add all selected tasks to each selected agent
		selectedTasks.forEach(taskId => {
			const item = backlogItems.find(item => item.id === taskId);
			if (item) {
				selectedAgents.forEach(agentId => {
					onAddPrompt(agentId, item.task);
					
					// Create prompt mapping
					const promptId = `${agentId}-${Date.now()}-${taskId}-${Math.random().toString(36).substr(2, 9)}`;
					setTaskPromptMappings(prev => ({
						...prev,
						[taskId]: {
							...prev[taskId],
							[promptId]: {
								agentId: agentId,
								status: 'in_progress'
							}
						}
					}));
					
					console.log(`Added task "${item.task}" to agent ${agentId} with prompt ID ${promptId}`);
				});
				
				// Update task status
				setTimeout(() => updateTaskStatus(taskId), 100);
			}
		});
		clearTaskSelection();
	};

	const handleDeleteSelectedTasks = async () => {
		if (selectedTasks.size === 0) return;
		
		// Confirm deletion
		const confirmDelete = window.confirm(
			`Are you sure you want to delete ${selectedTasks.size} task${selectedTasks.size !== 1 ? 's' : ''}? This action cannot be undone.`
		);
		
		if (!confirmDelete) return;
		
		try {
			// Delete all selected tasks
			const deletePromises = Array.from(selectedTasks).map(taskId => 
				backlogService.deleteBacklogItem(taskId)
			);
			
			await Promise.all(deletePromises);
			
			// Remove deleted tasks from local state
			setBacklogItems(prev => prev.filter(item => !selectedTasks.has(item.id)));
			clearTaskSelection();
			
			console.log(`Successfully deleted ${selectedTasks.size} tasks`);
		} catch (err) {
			console.error('Failed to delete selected tasks:', err);
			setError(err instanceof Error ? err.message : 'Failed to delete selected tasks');
		}
	};

	// Sort and filter data
	const sortedAndFilteredItems = useMemo(() => {
		let filtered = [...backlogItems];
		
		// Apply filters
		if (filters.status) {
			filtered = filtered.filter(item => item.status === filters.status);
		}
		if (filters.priority) {
			filtered = filtered.filter(item => item.priority.toString() === filters.priority);
		}
		if (filters.owner) {
			filtered = filtered.filter(item => 
				item.owner_name.toLowerCase().includes(filters.owner.toLowerCase()) ||
				item.owner_email.toLowerCase().includes(filters.owner.toLowerCase())
			);
		}
		if (filters.overdue) {
			filtered = filtered.filter(item => 
				new Date(item.due_date) < new Date() && item.status !== 'completed'
			);
		}
		
		// Apply sorting
		filtered.sort((a, b) => {
			const aValue = a[sortConfig.key];
			const bValue = b[sortConfig.key];
			
			if (aValue < bValue) {
				return sortConfig.direction === 'asc' ? -1 : 1;
			}
			if (aValue > bValue) {
				return sortConfig.direction === 'asc' ? 1 : -1;
			}
			return 0;
		});
		
		return filtered;
	}, [backlogItems, filters, sortConfig]);

	// Handle sort
	const handleSort = (key: keyof BacklogItem) => {
		setSortConfig(prev => ({
			key,
			direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
		}));
	};

	// Get priority label
	const getPriorityLabel = (priority: number) => {
		const labels = {
			1: '1 Day',
			2: '2 Days',
			3: '3 Days',
			4: '1 Week',
			5: '2 Weeks',
			6: '1 Month',
			7: '1 Year'
		};
		return labels[priority as keyof typeof labels] || `Priority ${priority}`;
	};

	// Get status color
	const getStatusColor = (status: string) => {
		switch (status) {
			case 'completed':
				return 'bg-[var(--positive-100)] text-[var(--positive-700)] border-[var(--positive-300)]';
			case 'in_progress':
				return 'bg-[var(--acc-100)] text-[var(--acc-700)] border-[var(--acc-300)]';
			default:
				return 'bg-[var(--base-200)] text-[var(--base-700)] border-[var(--base-300)]';
		}
	};

	// Get priority color
	const getPriorityColor = (priority: number) => {
		if (priority <= 2) return 'bg-[var(--negative-100)] text-[var(--negative-700)]'; // High priority
		if (priority <= 4) return 'bg-[var(--acc-100)] text-[var(--acc-700)]'; // Medium priority
		return 'bg-[var(--base-200)] text-[var(--base-700)]'; // Low priority
	};

	// Check if item is overdue
	const isOverdue = (dueDate: string, status: string) => {
		return new Date(dueDate) < new Date() && status !== 'completed';
	};

	// For collective backlog management, all authenticated users should be able to edit items
	// This represents project-level permissions rather than owner-level permissions
	const canEditItem = (item: BacklogItem) => {
		return isAuthenticated; // All authenticated users can edit in collective management
	};

	// Format date
	const formatDate = (dateString: string) => {
		return new Date(dateString).toLocaleDateString('en-US', {
			month: 'numeric',
			day: 'numeric',
			year: '2-digit'
		});
	};

	// Get unique owners for filter
	const uniqueOwners = useMemo(() => {
		const owners = new Set(backlogItems.map(item => item.owner_name));
		return Array.from(owners).sort();
	}, [backlogItems]);

	useEffect(() => {
		console.log('🔍 [CollectiveBacklog] FetchBacklogItems useEffect triggered');
		console.log('🔍 [CollectiveBacklog] Dependencies:', { 
			isAuthenticated, 
			hasFilters: !!filters, 
			gitOriginUrl: project?.gitOriginUrl,
			repositoryId: project?.repositoryId
		});
		
		if (isAuthenticated) {
			console.log('🔄 [CollectiveBacklog] User is authenticated - calling fetchBacklogItems');
			fetchBacklogItems();
		} else {
			console.log('🔍 [CollectiveBacklog] User not authenticated - skipping fetchBacklogItems');
		}
	}, [filters, isAuthenticated, project?.gitOriginUrl, project?.repositoryId]);

	// Handle prompt deletion - removes task-prompt mapping and recalculates task status
	const handlePromptDeletion = (promptId: string, agentId: string) => {
		console.log(`Handling prompt deletion: ${promptId} from agent ${agentId}`);
		
		setTaskPromptMappings(prev => {
			const updated = { ...prev };
			let hasChanges = false;
			
			// Find and remove the prompt mapping
			Object.keys(updated).forEach(taskIdStr => {
				const taskId = parseInt(taskIdStr);
				const prompts = updated[taskId];
				
				if (prompts && prompts[promptId]) {
					delete prompts[promptId];
					hasChanges = true;
					console.log(`Removed prompt ${promptId} mapping from task ${taskId}`);
					
					// Recalculate task status after prompt removal
					setTimeout(() => updateTaskStatus(taskId), 100);
				}
			});
			
			return hasChanges ? updated : prev;
		});
	};

	// Monitor canvas changes to detect prompt deletions and status updates
	useEffect(() => {
		if (!canvases) return;
		
		// Detect deleted canvases and clean up orphaned prompts
		const cleanupOrphanedPrompts = () => {
			setTaskPromptMappings(prev => {
				const updated = { ...prev };
				let hasChanges = false;
				const tasksToUpdate = new Set<number>();
				
				// Check each task's prompts for orphaned entries
				Object.keys(updated).forEach(taskIdStr => {
					const taskId = parseInt(taskIdStr);
					const prompts = updated[taskId];
					
					Object.keys(prompts).forEach(promptId => {
						const prompt = prompts[promptId];
						const canvas = canvases.find(c => c.id === prompt.agentId);
						
						if (!canvas) {
							// Canvas not found - prompt is orphaned, remove it
							delete prompts[promptId];
							hasChanges = true;
							tasksToUpdate.add(taskId);
							console.log(`🗑️ [CLEANUP] Removed orphaned prompt ${promptId} for deleted canvas ${prompt.agentId} from task ${taskId}`);
						}
					});
					
					// If this task has no more prompts, remove the task entry entirely
					if (Object.keys(prompts).length === 0) {
						delete updated[taskId];
						console.log(`🗑️ [CLEANUP] Removed empty task entry for task ${taskId}`);
					}
				});
				
				// Return updated mappings
				if (hasChanges) {
					// Update task statuses immediately with the cleaned mappings
					setTimeout(() => {
						tasksToUpdate.forEach(taskId => {
							console.log(`🔄 [CLEANUP] Updating status immediately for affected task: ${taskId} with cleaned mappings`);
							updateTaskStatus(taskId, updated);
						});
					}, 0);
				}
				
				return hasChanges ? updated : prev;
			});
		};
		
		// Update prompt statuses based on canvas lock states
		const updatePromptStatuses = () => {
			setTaskPromptMappings(prev => {
				const updated = { ...prev };
				let hasChanges = false;
				
				// Check each task's prompts
				Object.keys(updated).forEach(taskIdStr => {
					const taskId = parseInt(taskIdStr);
					const prompts = updated[taskId];
					
					Object.keys(prompts).forEach(promptId => {
						const prompt = prompts[promptId];
						const canvas = canvases.find(c => c.id === prompt.agentId);
						
						if (canvas) {
							const newStatus = canvas.lockState === 'merged' ? 'merged' : 'in_progress';
							if (prompt.status !== newStatus) {
								prompts[promptId] = { ...prompt, status: newStatus };
								hasChanges = true;
								console.log(`Updated prompt ${promptId} status to ${newStatus} for canvas ${canvas.id}`);
							}
						}
					});
					
					// Update task status if prompts changed
					if (hasChanges) {
						setTimeout(() => updateTaskStatus(taskId), 100);
					}
				});
				
				return hasChanges ? updated : prev;
			});
		};
		
		// First clean up orphaned prompts, then update statuses
		cleanupOrphanedPrompts();
		updatePromptStatuses();
		
		// Update previous canvas data for next comparison
		setPreviousCanvasData(canvases.map(c => ({ 
			id: c.id, 
			lockState: c.lockState 
		})));
	}, [canvases]);

	// Monitor task prompt mappings changes
	useEffect(() => {
		console.log('📊 [MAPPINGS] Task prompt mappings changed:', taskPromptMappings);
		console.log('📊 [MAPPINGS] Number of tasks with mappings:', Object.keys(taskPromptMappings).length);
		Object.keys(taskPromptMappings).forEach(taskId => {
			const prompts = taskPromptMappings[parseInt(taskId)];
			console.log(`📊 [MAPPINGS] Task ${taskId} has ${Object.keys(prompts).length} prompt(s):`, prompts);
		});
	}, [taskPromptMappings]);

	// Expose the prompt deletion handler
	useEffect(() => {
		if (onPromptDeleted) {
			// This makes the handlePromptDeletion function available
			// In a real implementation, you would expose this through a ref or other mechanism
			console.log('Prompt deletion handler is available');
		}
	}, [onPromptDeleted]);

	// Show authentication required message if not logged in
	if (!isAuthenticated) {
		return (
			<div className="w-full h-full bg-[var(--base-50)] overflow-y-auto">
				<div className="sticky top-0 bg-[var(--base-100)] border-b border-[var(--base-300)] p-4">
					<div className="flex items-center justify-between">
						<div>
							<h1 className="text-xl font-semibold text-[var(--base-800)]">Collective Backlog Management</h1>
							<p className="text-sm text-[var(--base-600)] mt-1">
								Manage all backlog items across repositories
							</p>
						</div>
						{onClose && (
							<button
								onClick={onClose}
								className="text-[var(--base-500)] hover:text-[var(--base-700)] text-xl"
							>
								×
							</button>
						)}
					</div>
				</div>
				<div className="flex items-center justify-center py-12">
					<div className="text-center">
						<div className="text-lg text-[var(--base-800)] mb-2">Authentication Required</div>
						<div className="text-sm text-[var(--base-600)]">
							Please log in to view and manage backlog items.
						</div>
					</div>
				</div>
			</div>
		);
	}

	// REPOSITORY ID RENDER CHECK: Trigger API call when repositoryId is null
	if (isAuthenticated && project?.gitOriginUrl && !project?.repositoryId) {
		console.log('🔍 [CollectiveBacklog] RENDER CHECK: Project state detected during render:', {
			hasProject: !!project,
			gitOriginUrl: project?.gitOriginUrl,
			repositoryId: project?.repositoryId
		});
		console.warn('🚨 [CollectiveBacklog] No repository ID available - showing no items');
		console.log('🔍 [CollectiveBacklog] Debug info:', {
			hasProject: !!project,
			gitOriginUrl: project?.gitOriginUrl,
			repositoryId: project?.repositoryId
		});
		
		// Trigger API call to detect repository ID
		console.log('🔄 [CollectiveBacklog] RENDER CHECK: Triggering API call to detect repository ID');
		console.log('🔄 [CollectiveBacklog] RENDER CHECK: Calling project.retryRepositoryIdDetection()');
		
		// Use setTimeout to avoid calling async function during render
		setTimeout(() => {
			console.log('🔄 [CollectiveBacklog] RENDER CHECK: Executing repository ID detection API call');
			project.retryRepositoryIdDetection().then(() => {
				console.log('🔄 [CollectiveBacklog] RENDER CHECK: Repository ID detection completed');
				console.log('🔄 [CollectiveBacklog] RENDER CHECK: New repositoryId:', project.repositoryId);
				if (project.repositoryId) {
					console.log('🔄 [CollectiveBacklog] RENDER CHECK: Repository ID detected - triggering fetchBacklogItems');
					fetchBacklogItems();
				}
			}).catch(error => {
				console.error('❌ [CollectiveBacklog] RENDER CHECK: Repository ID detection failed:', error);
			});
		}, 0);
	}

	// Show no git URL message if project has no git origin URL
	if (!project?.gitOriginUrl) {
		return (
			<div className="w-full h-full bg-[var(--base-50)] overflow-y-auto">
				<div className="sticky top-0 bg-[var(--base-100)] border-b border-[var(--base-300)] p-4">
					<div className="flex items-center justify-between">
						<div>
							<h1 className="text-xl font-semibold text-[var(--base-800)]">Collective Backlog Management</h1>
							<p className="text-sm text-[var(--base-600)] mt-1">
								Manage all backlog items across repositories
							</p>
						</div>
						{onClose && (
							<button
								onClick={onClose}
								className="text-[var(--base-500)] hover:text-[var(--base-700)] text-xl"
							>
								×
							</button>
						)}
					</div>
				</div>
				<div className="flex items-center justify-center py-12">
					<div className="text-center">
						<div className="text-lg text-[var(--base-800)] mb-2">No .git URL detected</div>
						<div className="text-sm text-[var(--base-600)]">
							Cannot provide backlog. Please open a project with a valid git repository.
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="w-full h-full bg-[var(--base-50)] overflow-y-auto">
			{/* Header */}
			<div className="sticky top-0 bg-[var(--base-100)] border-b border-[var(--base-300)] p-4">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-xl font-semibold text-[var(--base-800)]">Collective Backlog Management</h1>
						<p className="text-sm text-[var(--base-600)] mt-1">
							Manage all backlog items across repositories
						</p>
					</div>
					<div className="flex items-center gap-2">
						{/* Refresh Button */}
						<button
							onClick={() => {
								console.log('🔄 [CollectiveBacklog] Manual refresh triggered');
								console.log('🔄 [CollectiveBacklog] Automatic fallback: Manual refresh - retrying repository ID detection if needed...');
								fetchBacklogItems();
							}}
							disabled={loading}
							className="px-3 py-1 text-sm bg-[var(--acc-500)] text-white rounded hover:bg-[var(--acc-600)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" className={loading ? 'animate-spin' : ''}>
								<path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
								<path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
							</svg>
							Refresh
						</button>
						{onClose && (
							<button
								onClick={onClose}
								className="text-[var(--base-500)] hover:text-[var(--base-700)] text-xl"
							>
								×
							</button>
						)}
					</div>
				</div>
			</div>

			<div className="p-4 space-y-4">
				{/* Filters and Controls */}
				<div className="bg-[var(--base-100)] rounded-lg p-4 border border-[var(--base-300)]">
					<div className="flex flex-wrap gap-4 items-center">
						<h3 className="text-sm font-medium text-[var(--base-700)]">Filters:</h3>
						
						{/* Status Filter */}
						<select
							value={filters.status}
							onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
							className="px-3 py-1 text-sm border border-[var(--base-300)] rounded focus:outline-none focus:border-[var(--acc-500)]"
						>
							<option key="all-statuses" value="">All Statuses</option>
							<option key="open" value="open">Open</option>
							<option key="in_progress" value="in_progress">In Progress</option>
							<option key="completed" value="completed">Completed</option>
						</select>

						{/* Priority Filter */}
						<select
							value={filters.priority}
							onChange={(e) => setFilters(prev => ({ ...prev, priority: e.target.value }))}
							className="px-3 py-1 text-sm border border-[var(--base-300)] rounded focus:outline-none focus:border-[var(--acc-500)]"
						>
							<option value="">All Priorities</option>
							{[1, 2, 3, 4, 5, 6, 7].map(p => (
								<option key={p} value={p}>{getPriorityLabel(p)}</option>
							))}
						</select>

						{/* Owner Filter */}
						<select
							value={filters.owner}
							onChange={(e) => setFilters(prev => ({ ...prev, owner: e.target.value }))}
							className="px-3 py-1 text-sm border border-[var(--base-300)] rounded focus:outline-none focus:border-[var(--acc-500)]"
						>
							<option value="">All Owners</option>
							{uniqueOwners.map(owner => (
								<option key={owner} value={owner}>{owner}</option>
							))}
						</select>

						{/* Overdue Filter */}
						<label className="flex items-center gap-2 text-sm text-[var(--base-700)]">
							<input
								type="checkbox"
								checked={filters.overdue}
								onChange={(e) => setFilters(prev => ({ ...prev, overdue: e.target.checked }))}
								className="rounded"
							/>
							Overdue Only
						</label>

						{/* Refresh Button */}
						<button
							onClick={fetchBacklogItems}
							className="px-3 py-1 text-sm bg-[var(--acc-500)] text-white rounded hover:bg-[var(--acc-600)] transition-colors"
						>
							<svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
								<path fillRule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z"/>
								<path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466"/>
							</svg>
						</button>
					</div>
				</div>

				{/* Error Display */}
				{error && (
					<div className="bg-[var(--negative-100)] border border-[var(--negative-300)] text-[var(--negative-700)] px-4 py-3 rounded">
						{error}
					</div>
				)}

				{/* Loading State */}
				{loading ? (
					<div className="flex items-center justify-center py-12">
						<div className="text-[var(--base-600)]">Loading backlog items...</div>
					</div>
				) : (
					<>
					{/* Bulk Actions */}
					{selectedTasks.size > 0 && (
						<div className="bg-[var(--acc-100)] border border-[var(--acc-300)] rounded-lg p-4 mb-4">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-4">
									<span className="text-sm font-medium text-[var(--acc-800)]">
										{selectedTasks.size} task{selectedTasks.size !== 1 ? 's' : ''} selected
									</span>
									<button
										onClick={clearTaskSelection}
										className="text-xs px-2 py-1 bg-[var(--base-200)] text-[var(--base-700)] rounded hover:bg-[var(--base-300)] transition-colors"
									>
										Clear Selection
									</button>
								</div>
								<div className="flex items-center gap-2">
									<button
										onClick={handleAddSelectedTasksToNewAgent}
										className="px-3 py-1 text-xs bg-[var(--acc-500)] text-white rounded hover:bg-[var(--acc-600)] transition-colors flex items-center gap-1"
										title="Create new agent and add all selected tasks"
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
											<path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
										</svg>
										Add to New Agent
									</button>
									{selectedAgents && selectedAgents.length > 0 && (
										<button
											onClick={handleAddSelectedTasksToSelectedAgents}
											className="px-3 py-1 text-xs bg-[var(--positive-500)] text-white rounded hover:bg-[var(--positive-600)] transition-colors flex items-center gap-1"
											title={`Add all selected tasks to ${selectedAgents.length} selected agent${selectedAgents.length !== 1 ? 's' : ''}`}
										>
											<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
												<path d="M9.5 0a.5.5 0 0 1 .5.5.5.5 0 0 0 .5.5.5.5 0 0 1 .5.5V2a.5.5 0 0 1-.5.5h-5A.5.5 0 0 1 5 2v-.5a.5.5 0 0 1 .5-.5.5.5 0 0 0 .5-.5.5.5 0 0 1 .5-.5h3Z"/>
												<path d="M3 2.5a.5.5 0 0 1 .5-.5H4a.5.5 0 0 0 0-1h-.5A1.5 1.5 0 0 0 2 2.5v12A1.5 1.5 0 0 0 3.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 12.5 1H12a.5.5 0 0 0 0 1h.5a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-12Z"/>
												<path d="M8.5 6.5a.5.5 0 0 0-1 0V8H6a.5.5 0 0 0 0 1h1.5v1.5a.5.5 0 0 0 1 0V9H10a.5.5 0 0 0 0-1H8.5V6.5Z"/>
											</svg>
											Add to Selection ({selectedAgents.length})
										</button>
									)}
									<button
										onClick={handleDeleteSelectedTasks}
										className="px-3 py-1 text-xs bg-[var(--negative-500)] text-white rounded hover:bg-[var(--negative-600)] transition-colors flex items-center gap-1"
										title={`Delete ${selectedTasks.size} selected task${selectedTasks.size !== 1 ? 's' : ''}`}
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
											<path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
										</svg>
										Delete ({selectedTasks.size})
									</button>
								</div>
							</div>
						</div>
					)}

					{/* Backlog Table */}
					<div className="bg-[var(--base-100)] rounded-lg border border-[var(--base-300)] overflow-hidden">
						<div className="overflow-x-auto">
							<table className="w-full text-sm table-fixed">
								<thead className="bg-[var(--base-200)] border-b border-[var(--base-300)]">
									<tr>
										<th className="px-4 py-3 text-left font-medium text-[var(--base-700)]" style={{ width: '3%' }}>
											<input
												type="checkbox"
												checked={sortedAndFilteredItems.length > 0 && selectedTasks.size === sortedAndFilteredItems.length}
												onChange={toggleAllTasks}
												className="rounded border-[var(--base-400)]"
											/>
										</th>
										<th 
											className="px-4 py-3 text-left font-medium text-[var(--base-700)] cursor-pointer hover:bg-[var(--base-300)] transition-colors"
											onClick={() => handleSort('task')}
											style={{ width: '40%' }}
										>
											Task {sortConfig.key === 'task' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
										</th>
										<th 
											className="px-4 py-3 text-left font-medium text-[var(--base-700)] cursor-pointer hover:bg-[var(--base-300)] transition-colors"
											onClick={() => handleSort('status')}
											style={{ width: '10%' }}
										>
											Status {sortConfig.key === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
										</th>
										<th 
											className="px-4 py-3 text-left font-medium text-[var(--base-700)] cursor-pointer hover:bg-[var(--base-300)] transition-colors"
											onClick={() => handleSort('owner_name')}
											style={{ width: '15%' }}
										>
											Owner {sortConfig.key === 'owner_name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
										</th>
										<th 
											className="px-4 py-3 text-left font-medium text-[var(--base-700)] cursor-pointer hover:bg-[var(--base-300)] transition-colors"
											onClick={() => handleSort('created_at')}
											style={{ width: '8%' }}
										>
											Created {sortConfig.key === 'created_at' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
										</th>
										<th 
											className="px-4 py-3 text-left font-medium text-[var(--base-700)] cursor-pointer hover:bg-[var(--base-300)] transition-colors"
											onClick={() => handleSort('priority')}
											style={{ width: '8%' }}
										>
											Priority {sortConfig.key === 'priority' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
										</th>
										<th 
											className="px-4 py-3 text-left font-medium text-[var(--base-700)] cursor-pointer hover:bg-[var(--base-300)] transition-colors"
											onClick={() => handleSort('due_date')}
											style={{ width: '8%' }}
										>
											Due Date {sortConfig.key === 'due_date' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
										</th>
										<th className="px-4 py-3 text-left font-medium text-[var(--base-700)]" style={{ width: '8%' }}>
											Actions
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-[var(--base-200)]">
									{sortedAndFilteredItems.length === 0 ? (
										<tr>
											<td colSpan={7} className="px-4 py-8 text-center text-[var(--base-500)]">
												No backlog items found matching the current filters.
											</td>
										</tr>
									) : (
										sortedAndFilteredItems.map((item) => (
											<tr key={item.id} className={`hover:bg-[var(--base-50)] transition-colors ${selectedTasks.has(item.id) ? 'bg-[var(--acc-100)]' : ''}`}>
												{/* Checkbox */}
												<td className="px-4 py-3">
													<input
														type="checkbox"
														checked={selectedTasks.has(item.id)}
														onChange={() => toggleTaskSelection(item.id)}
														className="rounded border-[var(--base-400)]"
													/>
												</td>
												
												{/* Task */}
												<td className="px-4 py-3">
													{editingCell?.itemId === item.id && editingCell?.field === 'task' ? (
														<input
															type="text"
															value={editValues.task || ''}
															onChange={(e) => setEditValues(prev => ({ ...prev, task: e.target.value }))}
															onBlur={saveCellEdit}
															onKeyDown={handleKeyPress}
															className="w-full px-2 py-1 text-sm border border-[var(--base-300)] rounded focus:outline-none focus:border-[var(--acc-500)]"
															autoFocus
														/>
													) : (
														<div 
															className="cursor-pointer hover:bg-[var(--base-100)] rounded px-2 py-1 -mx-2 -my-1"
															onClick={() => startCellEdit(item, 'task')}
														>
															<div className="font-medium text-[var(--base-800)] break-words line-clamp-4">
																{item.task}
															</div>
														</div>
													)}
												</td>

												{/* Status */}
												<td className="px-4 py-3">
													{editingCell?.itemId === item.id && editingCell?.field === 'status' ? (
														<select
															value={editValues.status || ''}
															onChange={(e) => setEditValues(prev => ({ ...prev, status: e.target.value as any }))}
															onBlur={saveCellEdit}
															onKeyDown={handleKeyPress}
															className="px-2 py-1 text-sm border border-[var(--base-300)] rounded focus:outline-none focus:border-[var(--acc-500)]"
															autoFocus
														>
															<option key="edit-open" value="open">Open</option>
															<option key="edit-in_progress" value="in_progress">In Progress</option>
															<option key="edit-completed" value="completed">Completed</option>
														</select>
													) : (
														<span 
															className={`px-2 py-1 rounded text-xs font-medium border cursor-pointer hover:opacity-80 ${getStatusColor(item.status)}`}
															onClick={() => startCellEdit(item, 'status')}
														>
															{item.status.replace('_', ' ').toUpperCase()}
														</span>
													)}
												</td>

												{/* Owner */}
												<td className="px-4 py-3">
													{editingCell?.itemId === item.id && editingCell?.field === 'owner' ? (
														<select
															value={editValues.owner || ''}
															onChange={(e) => setEditValues(prev => ({ ...prev, owner: e.target.value }))}
															onBlur={saveCellEdit}
															onKeyDown={handleKeyPress}
															className="w-full px-2 py-1 text-sm border border-[var(--base-300)] rounded focus:outline-none focus:border-[var(--acc-500)]"
															autoFocus
														>
															{availableUsers.map(user => (
																<option key={user.id} value={user.id}>
																	{user.name} ({user.email})
																</option>
															))}
														</select>
													) : (
														<div 
															className="cursor-pointer hover:bg-[var(--base-100)] rounded px-2 py-1 -mx-2 -my-1"
															onClick={() => startCellEdit(item, 'owner')}
														>
															<div className="font-medium text-[var(--base-800)] break-words line-clamp-2">
																{item.owner_name}
																{currentUser && item.owner === currentUser.id && <span className="ml-1 text-xs text-[var(--acc-600)]">(You)</span>}
															</div>
															<div className="text-xs text-[var(--base-500)] break-words line-clamp-1">
																{item.owner_email}
															</div>
														</div>
													)}
												</td>

												{/* Created Date */}
												<td className="px-4 py-3 text-[var(--base-600)]">
													{formatDate(item.created_at)}
												</td>

												{/* Priority */}
												<td className="px-4 py-3">
													{editingCell?.itemId === item.id && editingCell?.field === 'priority' ? (
														<select
															value={editValues.priority || ''}
															onChange={(e) => setEditValues(prev => ({ ...prev, priority: parseInt(e.target.value) }))}
															onBlur={saveCellEdit}
															onKeyDown={handleKeyPress}
															className="px-2 py-1 text-sm border border-[var(--base-300)] rounded focus:outline-none focus:border-[var(--acc-500)]"
															autoFocus
														>
															{[1, 2, 3, 4, 5, 6, 7].map(p => (
																<option key={p} value={p}>{getPriorityLabel(p)}</option>
															))}
														</select>
													) : (
														<span 
															className={`px-2 py-1 rounded text-xs font-medium cursor-pointer hover:opacity-80 ${getPriorityColor(item.priority)}`}
															onClick={() => startCellEdit(item, 'priority')}
														>
															{getPriorityLabel(item.priority)}
														</span>
													)}
												</td>

												{/* Due Date */}
												<td className="px-4 py-3">
													{editingCell?.itemId === item.id && editingCell?.field === 'due_date' ? (
														<input
															type="datetime-local"
															value={editValues.due_date ? new Date(editValues.due_date).toISOString().slice(0, 16) : ''}
															onChange={(e) => setEditValues(prev => ({ ...prev, due_date: e.target.value }))}
															onBlur={saveCellEdit}
															onKeyDown={handleKeyPress}
															className="px-2 py-1 text-sm border border-[var(--base-300)] rounded focus:outline-none focus:border-[var(--acc-500)]"
															autoFocus
														/>
													) : (
														<div 
															className={`text-sm cursor-pointer hover:bg-[var(--base-100)] rounded px-2 py-1 -mx-2 -my-1 ${isOverdue(item.due_date, item.status) ? 'text-[var(--negative-600)] font-medium' : 'text-[var(--base-600)]'}`}
															onClick={() => startCellEdit(item, 'due_date')}
														>
															{formatDate(item.due_date)}
															{isOverdue(item.due_date, item.status) && (
																<span className="ml-1 text-xs bg-[var(--negative-100)] text-[var(--negative-700)] px-1 rounded">
																	OVERDUE
																</span>
															)}
														</div>
													)}
												</td>

												{/* Actions */}
												<td className="px-4 py-3">
													<div className="flex gap-2">
														<button
															onClick={() => {
																console.log('🖱️ [BUTTON] Add to New Agent button clicked for task:', item.id, item.task);
																handleAddToNewAgent(item);
															}}
															className="w-6 h-6 flex items-center justify-center bg-[var(--acc-500)] hover:bg-[var(--acc-600)] text-white rounded transition-colors"
															title="Add to new agent"
														>
															<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
																<path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
															</svg>
														</button>
														<button
															onClick={() => {
																console.log('🖱️ [BUTTON] Add to Selected Agents button clicked for task:', item.id, item.task, 'Selected agents:', selectedAgents);
																handleAddToSelectedAgents(item);
															}}
															className="w-6 h-6 flex items-center justify-center bg-[var(--positive-500)] hover:bg-[var(--positive-600)] text-white rounded transition-colors"
															title="Add to agents selection"
															disabled={!selectedAgents || selectedAgents.length === 0}
														>
															<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
																<path d="M9.5 0a.5.5 0 0 1 .5.5.5.5 0 0 0 .5.5.5.5 0 0 1 .5.5V2a.5.5 0 0 1-.5.5h-5A.5.5 0 0 1 5 2v-.5a.5.5 0 0 1 .5-.5.5.5 0 0 0 .5-.5.5.5 0 0 1 .5-.5h3Z"/>
																<path d="M3 2.5a.5.5 0 0 1 .5-.5H4a.5.5 0 0 0 0-1h-.5A1.5 1.5 0 0 0 2 2.5v12A1.5 1.5 0 0 0 3.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 12.5 1H12a.5.5 0 0 0 0 1h.5a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-12Z"/>
																<path d="M8.5 6.5a.5.5 0 0 0-1 0V8H6a.5.5 0 0 0 0 1h1.5v1.5a.5.5 0 0 0 1 0V9H10a.5.5 0 0 0 0-1H8.5V6.5Z"/>
															</svg>
														</button>
														<button
															onClick={() => deleteBacklogItem(item.id)}
															className="w-6 h-6 flex items-center justify-center bg-[var(--negative-500)] hover:bg-[var(--negative-600)] text-white rounded transition-colors"
															title="Delete item"
														>
															<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
																<path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
															</svg>
														</button>
													</div>
												</td>
											</tr>
										))
									)}
								</tbody>
							</table>
						</div>
					</div>
					</>
				)}

				{/* Create New Task */}
				{!loading && (
					<div className="mt-4 flex justify-end">
						{!showCreateForm ? (
							<button
								onClick={() => setShowCreateForm(true)}
								className="flex items-center gap-2 px-4 py-2 bg-[var(--positive-500)] hover:bg-[var(--positive-600)] text-white rounded transition-colors text-sm font-medium"
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
									<path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
									<path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
								</svg>
								Create New Task
							</button>
						) : (
							<div className="space-y-3 w-full max-w-4xl">
								<div className="flex gap-2 items-start">
									<textarea
										value={newTaskData.task}
										onChange={(e) => setNewTaskData(prev => ({ ...prev, task: e.target.value }))}
										placeholder="Enter task description..."
										className="flex-1 px-2 py-1 text-sm border border-[var(--base-300)] rounded focus:outline-none focus:border-[var(--acc-500)] resize-none"
										rows={2}
									/>
									<button
										onClick={cancelCreate}
										className="px-2 py-1 text-sm text-[var(--base-500)] hover:text-[var(--base-700)]"
									>
										×
									</button>
								</div>
								
								<div className="flex gap-2 items-center justify-between">
									{/* Repository detection logic preserved for filtering - no display */}
									{!project?.gitOriginUrl && (
										<div className="flex-1 text-xs text-[var(--negative-600)] bg-[var(--negative-50)] px-2 py-1 rounded border">
											No .git URL detected, cannot provide backlog
										</div>
									)}
									
									<div className="flex gap-2 items-center">
										<select
											value={newTaskData.priority}
											onChange={(e) => setNewTaskData(prev => ({ ...prev, priority: parseInt(e.target.value) }))}
											className="px-2 py-1 text-sm border border-[var(--base-300)] rounded focus:outline-none focus:border-[var(--acc-500)] w-24"
										>
											{[1, 2, 3, 4, 5, 6, 7].map(p => (
												<option key={p} value={p}>{getPriorityLabel(p)}</option>
											))}
										</select>
										<select
											value={newTaskData.status}
											onChange={(e) => setNewTaskData(prev => ({ ...prev, status: e.target.value as any }))}
											className="px-2 py-1 text-sm border border-[var(--base-300)] rounded focus:outline-none focus:border-[var(--acc-500)] w-24"
										>
											<option key="create-open" value="open">Open</option>
											<option key="create-in_progress" value="in_progress">In Progress</option>
											<option key="create-completed" value="completed">Completed</option>
										</select>
										<button
											onClick={createNewTask}
											className="px-2 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors w-16 text-center"
										>
											Create
										</button>
									</div>
								</div>
							</div>
						)}
					</div>
				)}

				{/* Summary Stats */}
				{!loading && (
					<div className="bg-[var(--base-100)] rounded-lg p-4 border border-[var(--base-300)]">
						<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
							<div>
								<div className="text-2xl font-semibold text-[var(--base-800)]">
									{sortedAndFilteredItems.length}
								</div>
								<div className="text-sm text-[var(--base-600)]">Total Items</div>
							</div>
							<div>
								<div className="text-2xl font-semibold text-[var(--negative-600)]">
									{sortedAndFilteredItems.filter(item => isOverdue(item.due_date, item.status)).length}
								</div>
								<div className="text-sm text-[var(--base-600)]">Overdue</div>
							</div>
							<div>
								<div className="text-2xl font-semibold text-[var(--acc-600)]">
									{sortedAndFilteredItems.filter(item => item.status === 'in_progress').length}
								</div>
								<div className="text-sm text-[var(--base-600)]">In Progress</div>
							</div>
							<div>
								<div className="text-2xl font-semibold text-[var(--positive-600)]">
									{sortedAndFilteredItems.filter(item => item.status === 'completed').length}
								</div>
								<div className="text-sm text-[var(--base-600)]">Completed</div>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};