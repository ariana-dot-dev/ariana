import React, { useState, useEffect, useMemo } from 'react';
import BacklogService, { BacklogItem, BacklogFilters } from '../services/BacklogService';
import AuthService from '../services/AuthService';
import { GitProject } from '../types/GitProject';
import { BacklogTaskStatus, PromptMappingStatus } from '../types/StatusTypes';

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
		owner: ''
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
		status: 'open' as BacklogTaskStatus,
		owner: null
	});

	const backlogService = useMemo(() => new BacklogService(), []);
	const authService = useMemo(() => AuthService.getInstance(), []);
	const [currentUser, setCurrentUser] = useState<any>(null);
	const [availableUsers, setAvailableUsers] = useState<{id: string, name: string, email: string}[]>([]);
	const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set());
	
	// Task-Prompt mapping with status tracking - persist across re-renders
	// Structure: { taskId: { promptId: { agentId: string, status: PromptMappingStatus } } }
	const getStorageKey = () => `taskPromptMappings_${project?.gitOriginUrl || 'default'}`;
	
	const [taskPromptMappings, setTaskPromptMappings] = useState<Record<number, Record<string, { agentId: string, status: PromptMappingStatus }>>>(() => {
		// Initialize from localStorage if available
		try {
			const stored = localStorage.getItem(getStorageKey());
			if (stored) {
				const parsed = JSON.parse(stored);
				return parsed;
			}
		} catch (error) {
			// Silently handle localStorage errors
		}
		return {};
	});
	
	// Save to localStorage whenever taskPromptMappings changes
	useEffect(() => {
		try {
			const storageKey = getStorageKey();
			localStorage.setItem(storageKey, JSON.stringify(taskPromptMappings));
		} catch (error) {
			// Silently handle localStorage errors
		}
	}, [taskPromptMappings, project?.gitOriginUrl]);
	
	// Keep track of previous canvas state to detect prompt deletions
	const [previousCanvasData, setPreviousCanvasData] = useState<{ id: string, lockState?: string, promptCount?: number }[]>([]);

	// Calculate task status based on prompt mappings
	const calculateTaskStatus = (taskId: number, mappings?: Record<number, Record<string, { agentId: string, status: PromptMappingStatus }>>): BacklogTaskStatus => {
		// Use provided mappings or fall back to state
		const allMappings = mappings || taskPromptMappings;
		const prompts = allMappings[taskId];
		
		console.log(`📊 [STATUS-CALC] Calculating status for task ${taskId}:`, {
			hasPrompts: !!prompts,
			promptCount: prompts ? Object.keys(prompts).length : 0,
			prompts: prompts
		});
		
		if (!prompts || Object.keys(prompts).length === 0) {
			console.log(`📊 [STATUS-CALC] Task ${taskId} -> 'open' (no prompts)`);
			return 'open'; // No prompts linked
		}
		
		const promptStatuses = Object.values(prompts).map(p => p.status);
		const allMerged = promptStatuses.every(status => status === 'merged');
		
		console.log(`📊 [STATUS-CALC] Task ${taskId} prompt statuses:`, promptStatuses);
		console.log(`📊 [STATUS-CALC] Task ${taskId} all merged:`, allMerged);
		
		if (allMerged) {
			console.log(`📊 [STATUS-CALC] Task ${taskId} -> 'finished' (all prompts merged)`);
			return 'finished'; // All prompts are merged
		}
		
		console.log(`📊 [STATUS-CALC] Task ${taskId} -> 'in_progress' (some prompts exist but not all merged)`);
		return 'in_progress'; // Some prompts exist but not all are merged
	};

	// IMPORTANT: There are THREE distinct status systems (see StatusTypes.ts):
	// 1. PromptStatus = 'prompting' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' (Agent/Canvas execution level)
	// 2. BacklogTaskStatus = 'open' | 'in_progress' | 'finished' (Backlog management level)  
	// 3. PromptMappingStatus = 'active' | 'merged' (Mapping between backlog tasks and agent prompts)
	//
	// MAPPING LOGIC:
	// - Creating agent/adding prompt → PromptMappingStatus = 'active'
	// - Canvas submitted for merge → PromptMappingStatus = 'merged'
	// - Prompt deleted → Remove from mapping
	// - No prompts mapped → BacklogTaskStatus = 'open'
	// - All prompts 'merged' → BacklogTaskStatus = 'finished'
	// - Some prompts exist but not all 'merged' → BacklogTaskStatus = 'in_progress'

	// Update task status in backend and local state
	const updateTaskStatus = async (taskId: number, mappings?: Record<number, Record<string, { agentId: string, status: PromptMappingStatus }>>) => {
			const calculatedStatus = calculateTaskStatus(taskId, mappings);
			
		const currentItem = backlogItems.find(item => item.id === taskId);
			
		if (currentItem && currentItem.status !== calculatedStatus) {
				try {
				console.log(`🔄 [STATUS-UPDATE] Updating task ${taskId} status from "${currentItem.status}" to "${calculatedStatus}"`);
				
				// Update in backend
				await backlogService.updateBacklogItem(taskId, { status: calculatedStatus });
				console.log(`✅ [STATUS-UPDATE] Successfully updated task ${taskId} status to "${calculatedStatus}" in backend`);
				
				// Update local state
				setBacklogItems(prev => prev.map(item => 
					item.id === taskId ? { ...item, status: calculatedStatus } : item
				));
				console.log(`✅ [STATUS-UPDATE] Successfully updated task ${taskId} status to "${calculatedStatus}" in local state`);
				
			} catch (error) {
				console.error(`❌ [STATUS-UPDATE] Failed to update task ${taskId} status to "${calculatedStatus}":`, error);
				
				// Check if it's an authentication error
				if (error && typeof error === 'object' && 'status' in error) {
					if (error.status === 401) {
						console.error(`🔐 [STATUS-UPDATE] Authentication failed for task ${taskId} - token may be expired`);
					} else if (error.status === 403) {
						console.error(`🚫 [STATUS-UPDATE] Permission denied for task ${taskId} - may need admin permissions`);
					}
				}
			}
		} else if (currentItem) {
			} else {
			}
	};

	// Ensure localStorage is loaded on every initialization/re-initialization
	useEffect(() => {
								
		// Force reload from localStorage on every initialization
		try {
			const storageKey = getStorageKey();
				const stored = localStorage.getItem(storageKey);
			if (stored) {
				const parsed = JSON.parse(stored);
				setTaskPromptMappings(parsed);
			}
		} catch (error) {
			// Silently handle init errors
		}
	}, [onCreateAgent, onAddPrompt, selectedAgents, canvases, project]);

	// Check authentication status
	useEffect(() => {
			const authState = authService.getAuthState();
			setIsAuthenticated(authState.isAuthenticated);
		setCurrentUser(authState.user);
		
		// SECURITY: Initial check - trigger repository ID detection if authenticated
		
		if (authState.isAuthenticated && project && project.gitOriginUrl && !project.repositoryId) {
			project.retryRepositoryIdDetection().catch(error => {
				console.error('❌ [CollectiveBacklog] Failed to retry repository ID detection:', error);
			});
		}

		// Subscribe to auth state changes
		const unsubscribe = authService.subscribe((state) => {
			setIsAuthenticated(state.isAuthenticated);
			setCurrentUser(state.user);
			
			// SECURITY: Trigger repository ID detection when authentication becomes available
			if (state.isAuthenticated && project && project.gitOriginUrl && !project.repositoryId) {
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
				if (project.repositoryId && isAuthenticated) {
					fetchBacklogItems();
			}
		});
		
		// Initial check - call fetchBacklogItems even when repositoryId is null to trigger fallback
		if (isAuthenticated) {
			if (project.repositoryId) {
				} else {
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
			
			// Automatic repository ID detection
			if (project?.gitOriginUrl && !project?.repositoryId) {
				try {
					await project.retryRepositoryIdDetection();
				} catch (error) {
					console.error('Failed to detect repository ID:', error);
				}
			}
			
			if (project?.repositoryId) {
				items = await backlogService.getBacklogByRepositoryRandomId(project.repositoryId);
			} else if (project?.gitOriginUrl && !project?.repositoryId) {
				// Try to get repository ID if missing
				try {
					await project.retryRepositoryIdDetection();
					if (project.repositoryId) {
						items = await backlogService.getBacklogByRepositoryRandomId(project.repositoryId);
					} else {
						items = [];
					}
				} catch (error) {
					console.error('Failed to detect repository ID:', error);
					items = [];
				}
			} else {
				items = [];
			}
			
			setBacklogItems(items);
			
			// IMPORTANT: After fetching backlog items, ensure all tasks have correct status
			// Check if any tasks should be 'open' but aren't marked as such
			console.log('🔄 [BACKLOG-SYNC] Checking all fetched tasks for correct status...');
			setTimeout(() => {
				items.forEach(item => {
					const calculatedStatus = calculateTaskStatus(item.id);
					if (item.status !== calculatedStatus) {
						console.log(`🔄 [BACKLOG-SYNC] Task ${item.id} status mismatch: DB="${item.status}" vs Calculated="${calculatedStatus}" - updating...`);
						updateTaskStatus(item.id);
					}
				});
			}, 500); // Give time for state to settle

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
			
						
			// Update local state with the response from server
			setBacklogItems(prev => 
				prev.map(item => {
					if (item.id === id) {
						// If owner was changed, make sure to update owner info from available users
						if (updates.owner) {
							const newOwner = availableUsers.find(user => user.id === updates.owner);
										if (newOwner) {
								const finalItem = {
									...updatedItem,
									owner: updates.owner,
									owner_name: newOwner.name,
									owner_email: newOwner.email
								};
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
			
		if (!onCreateAgent || !onAddPrompt) {
			console.error('❌ [LINK] Missing onCreateAgent or onAddPrompt functions');
			return;
		}
		
		// Create new agent
		const newAgentId = onCreateAgent();
		console.log(`🔗 [TASK-LINK] Created new agent: ${newAgentId} for task ${item.id}`);
			
		if (newAgentId) {
			// Add the task as a prompt to the new agent
			onAddPrompt(newAgentId, item.task);
			console.log(`📝 [TASK-LINK] Added prompt to agent ${newAgentId}: "${item.task}"`);
			
			// Create prompt mapping with initial status 'active'
			const promptId = `${newAgentId}-${Date.now()}`; // Generate unique prompt ID
			console.log(`🔗 [TASK-LINK] Creating mapping - Task ${item.id} -> Prompt ${promptId} -> Agent ${newAgentId}`);
				
			const newMapping = {
				...taskPromptMappings,
				[item.id]: {
					...taskPromptMappings[item.id],
					[promptId]: {
						agentId: newAgentId,
						status: 'active' as const
					}
				}
			};
			console.log(`📊 [TASK-LINK] New mapping created:`, newMapping[item.id]);
			
				
			// Update state
			setTaskPromptMappings(newMapping);
			console.log(`📊 [TASK-LINK] Updated task prompt mappings state:`, newMapping);
			
			// Update task status immediately with the new mappings
			console.log(`🔄 [TASK-LINK] Triggering status update for task ${item.id}`);
			updateTaskStatus(item.id, newMapping);
			
			// Also schedule a delayed update as backup in case of re-initialization
				setTimeout(() => {
					updateTaskStatus(item.id);
			}, 1000);
			
			} else {
			console.error('❌ [LINK] Failed to create new agent');
		}
	};

	// Handle add to selected agents
	const handleAddToSelectedAgents = (item: BacklogItem) => {
			
		if (!onAddPrompt || !selectedAgents || selectedAgents.length === 0) {
			console.error('❌ [MULTI-LINK] Missing onAddPrompt function or no agents selected');
			return;
		}
		
		// Add the task as a prompt to each selected agent
		const newMappings: Record<string, { agentId: string, status: PromptMappingStatus }> = {};
		
		selectedAgents.forEach(agentId => {
				onAddPrompt(agentId, item.task);
			
			// Create prompt mapping for each agent
			const promptId = `${agentId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
			newMappings[promptId] = {
				agentId: agentId,
				status: 'active'
			};
			
			});
		
			
		// Update task prompt mappings
		const updatedMapping = {
			...taskPromptMappings,
			[item.id]: {
				...taskPromptMappings[item.id],
				...newMappings
			}
		};
		
			
		// Update state
		setTaskPromptMappings(updatedMapping);
		
		// Update task status immediately with the new mappings
			updateTaskStatus(item.id, updatedMapping);
		
		// Also schedule a delayed update as backup
			setTimeout(() => {
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
								status: 'active'
							}
						}
					}));
					
					// Update task status
					setTimeout(() => updateTaskStatus(taskId), 100);
					
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
								status: 'active'
							}
						}
					}));
					
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
			case 'finished':
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
		return new Date(dueDate) < new Date() && status !== 'finished';
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
		if (isAuthenticated) {
			fetchBacklogItems();
		}
	}, [filters, isAuthenticated, project?.gitOriginUrl, project?.repositoryId]);

	// Handle prompt deletion - removes task-prompt mapping and recalculates task status
	const handlePromptDeletion = (promptId: string, agentId: string) => {
		console.log(`🗑️ [PROMPT-DELETE] Handling deletion of prompt ${promptId} from agent ${agentId}`);
			
		setTaskPromptMappings(prev => {
			const updated = { ...prev };
			let hasChanges = false;
			const tasksToUpdate = new Set<number>();
			
			// Find and remove the prompt mapping
			Object.keys(updated).forEach(taskIdStr => {
				const taskId = parseInt(taskIdStr);
				const prompts = updated[taskId];
				
				if (prompts && prompts[promptId]) {
					console.log(`🗑️ [PROMPT-DELETE] Found prompt ${promptId} in task ${taskId}, removing it`);
					delete prompts[promptId];
					hasChanges = true;
					tasksToUpdate.add(taskId);
					
					// Check if this task now has no prompts left
					const remainingPrompts = Object.keys(prompts).length;
					console.log(`🗑️ [PROMPT-DELETE] Task ${taskId} now has ${remainingPrompts} prompts remaining`);
					
					if (remainingPrompts === 0) {
						console.log(`🗑️ [PROMPT-DELETE] Task ${taskId} has no prompts left - should revert to 'open' status`);
						// Don't delete the task entry, keep it as empty object so status calculation works
						// The empty object will make calculateTaskStatus return 'open'
					}
				}
			});
			
			// Update task statuses for all affected tasks
			if (hasChanges) {
				setTimeout(() => {
					tasksToUpdate.forEach(taskId => {
						console.log(`🔄 [PROMPT-DELETE] Updating status for task ${taskId} after prompt deletion`);
						updateTaskStatus(taskId);
					});
				}, 100);
			}
			
			return hasChanges ? updated : prev;
		});
	};

	// Manual status sync function for debugging
	const syncAllTaskStatuses = () => {
		console.log('🔄 [MANUAL-SYNC] Manually syncing all task statuses...');
		backlogItems.forEach(item => {
			const calculatedStatus = calculateTaskStatus(item.id);
			console.log(`🔄 [MANUAL-SYNC] Task ${item.id}: Current="${item.status}" Calculated="${calculatedStatus}"`);
			if (item.status !== calculatedStatus) {
				console.log(`🔄 [MANUAL-SYNC] Updating task ${item.id} from "${item.status}" to "${calculatedStatus}"`);
				updateTaskStatus(item.id);
			}
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
								}
					});
					
					// If this task has no more prompts, keep the empty object
					// Don't delete the task entry - empty object will make calculateTaskStatus return 'open'
					if (Object.keys(prompts).length === 0) {
						console.log(`🗑️ [CLEANUP] Task ${taskId} has no prompts left after cleanup - should revert to 'open' status`);
						// Keep the empty prompts object instead of deleting the task entry
						tasksToUpdate.add(taskId);
					}
				});
				
				// Return updated mappings
				if (hasChanges) {
					// Update task statuses immediately with the cleaned mappings
					setTimeout(() => {
						tasksToUpdate.forEach(taskId => {
									updateTaskStatus(taskId, updated);
						});
					}, 0);
				}
				
				return hasChanges ? updated : prev;
			});
		};
		
		// Update prompt statuses based on canvas lock states
		const updatePromptStatuses = () => {
			console.log('🔄 [CANVAS-MONITOR] Updating prompt statuses based on canvas lock states');
			console.log('🔄 [CANVAS-MONITOR] Current canvases:', canvases?.map(c => ({ id: c.id, lockState: c.lockState })));
			
			setTaskPromptMappings(prev => {
				const updated = { ...prev };
				let hasChanges = false;
				
				console.log('🔄 [CANVAS-MONITOR] Current task mappings:', updated);
				
				// Check each task's prompts
				Object.keys(updated).forEach(taskIdStr => {
					const taskId = parseInt(taskIdStr);
					const prompts = updated[taskId];
					
					Object.keys(prompts).forEach(promptId => {
						const prompt = prompts[promptId];
						const canvas = canvases.find(c => c.id === prompt.agentId);
						
						console.log(`🔄 [CANVAS-MONITOR] Checking prompt ${promptId} for agent ${prompt.agentId}:`, {
							promptCurrentStatus: prompt.status,
							canvasFound: !!canvas,
							canvasLockState: canvas?.lockState
						});
						
						if (canvas) {
							const newStatus = canvas.lockState === 'merged' ? 'merged' : 'active';
							console.log(`🔄 [CANVAS-MONITOR] Prompt ${promptId}: ${prompt.status} → ${newStatus}`);
							
							if (prompt.status !== newStatus) {
								prompts[promptId] = { ...prompt, status: newStatus };
								hasChanges = true;
								console.log(`✅ [CANVAS-MONITOR] Updated prompt ${promptId} status to ${newStatus}`);
							}
						} else {
							console.warn(`⚠️ [CANVAS-MONITOR] Canvas not found for agent ${prompt.agentId}`);
						}
					});
					
					// Update task status if prompts changed
					if (hasChanges) {
						console.log(`🔄 [CANVAS-MONITOR] Scheduling status update for task ${taskId}`);
						setTimeout(() => updateTaskStatus(taskId), 100);
					}
				});
				
				if (hasChanges) {
					console.log('✅ [CANVAS-MONITOR] Prompt statuses updated, returning new mappings');
				} else {
					console.log('ℹ️ [CANVAS-MONITOR] No prompt status changes detected');
				}
				
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


	// Expose the prompt deletion handler
	useEffect(() => {
		if (onPromptDeleted) {
			// This makes the handlePromptDeletion function available
			// In a real implementation, you would expose this through a ref or other mechanism
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

	// Trigger repository ID detection if needed
	if (isAuthenticated && project?.gitOriginUrl && !project?.repositoryId) {
		// Use setTimeout to avoid calling async function during render
		setTimeout(() => {
			project.retryRepositoryIdDetection().then(() => {
				if (project.repositoryId) {
					fetchBacklogItems();
				}
			}).catch(error => {
				console.error('Repository ID detection failed:', error);
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

			<div className="p-4 space-y-4">
				{/* Filters and Controls */}
				<div className="bg-[var(--base-100)] rounded-lg p-4 border border-[var(--base-300)]">
					<div className="flex flex-wrap gap-4 items-center">
						
						{/* Status Filter */}
						<select
							value={filters.status}
							onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
							className="px-3 py-1 text-sm border border-[var(--base-300)] rounded focus:outline-none focus:border-[var(--acc-500)]"
						>
							<option key="all-statuses" value="">All Statuses</option>
							<option key="open" value="open">Open</option>
							<option key="in_progress" value="in_progress">In Progress</option>
							<option key="finished" value="finished">Finished</option>
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


						{/* Refresh Button */}
						<button
							onClick={() => {
								fetchBacklogItems();
								// Also sync status after refresh
								setTimeout(() => syncAllTaskStatuses(), 1000);
							}}
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
									{selectedAgents && selectedAgents.length > 1 && (
										<button
											onClick={handleAddSelectedTasksToSelectedAgents}
											className="px-3 py-1 text-xs bg-[var(--positive-500)] text-white rounded hover:bg-[var(--positive-600)] transition-colors flex items-center gap-1"
											title={`Add all selected tasks to ${selectedAgents.length} selected agents`}
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
											className="px-4 py-3 text-left font-medium text-[var(--base-700)] cursor-pointer hover:bg-[var(--base-300)] transition-colors hidden"
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
															<option key="edit-finished" value="finished">Finished</option>
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
														</div>
													)}
												</td>

												{/* Created Date */}
												<td className="px-4 py-3 text-[var(--base-600)] hidden">
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
														</div>
													)}
												</td>

												{/* Actions */}
												<td className="px-4 py-3">
													<div className="flex gap-2">
														<button
															onClick={() => {
																handleAddToNewAgent(item);
															}}
															className="w-6 h-6 flex items-center justify-center bg-[var(--acc-500)] hover:bg-[var(--acc-600)] text-white rounded transition-colors"
															title="Add to new agent"
														>
															<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
																<path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
															</svg>
														</button>
														{selectedAgents && selectedAgents.length > 0 && (
															<button
																onClick={() => {
																	handleAddToSelectedAgents(item);
																}}
																className="w-6 h-6 flex items-center justify-center bg-[var(--positive-500)] hover:bg-[var(--positive-600)] text-white rounded transition-colors"
																title="Add to agents selection"
															>
																<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
																	<path d="M9.5 0a.5.5 0 0 1 .5.5.5.5 0 0 0 .5.5.5.5 0 0 1 .5.5V2a.5.5 0 0 1-.5.5h-5A.5.5 0 0 1 5 2v-.5a.5.5 0 0 1 .5-.5.5.5 0 0 0 .5-.5.5.5 0 0 1 .5-.5h3Z"/>
																	<path d="M3 2.5a.5.5 0 0 1 .5-.5H4a.5.5 0 0 0 0-1h-.5A1.5 1.5 0 0 0 2 2.5v12A1.5 1.5 0 0 0 3.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 12.5 1H12a.5.5 0 0 0 0 1h.5a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-12Z"/>
																	<path d="M8.5 6.5a.5.5 0 0 0-1 0V8H6a.5.5 0 0 0 0 1h1.5v1.5a.5.5 0 0 0 1 0V9H10a.5.5 0 0 0 0-1H8.5V6.5Z"/>
																</svg>
															</button>
														)}
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
											<option key="create-finished" value="finished">Finished</option>
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
								<div className="text-2xl font-semibold text-[var(--acc-600)]">
									{sortedAndFilteredItems.filter(item => item.status === 'in_progress').length}
								</div>
								<div className="text-sm text-[var(--base-600)]">In Progress</div>
							</div>
							<div>
								<div className="text-2xl font-semibold text-[var(--positive-600)]">
									{sortedAndFilteredItems.filter(item => item.status === 'finished').length}
								</div>
								<div className="text-sm text-[var(--base-600)]">Finished</div>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};