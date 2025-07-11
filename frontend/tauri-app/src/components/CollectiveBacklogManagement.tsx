import React, { useState, useEffect, useMemo } from 'react';
import BacklogService, { BacklogItem, BacklogFilters } from '../services/BacklogService';
import AuthService from '../services/AuthService';
import { GitProject } from '../types/GitProject';

interface CollectiveBacklogManagementProps {
	project?: GitProject;
	onClose?: () => void;
}

export const CollectiveBacklogManagement: React.FC<CollectiveBacklogManagementProps> = ({ project, onClose }) => {
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

	// Check authentication status
	useEffect(() => {
		const authState = authService.getAuthState();
		setIsAuthenticated(authState.isAuthenticated);
		setCurrentUser(authState.user);

		// Subscribe to auth state changes
		const unsubscribe = authService.subscribe((state) => {
			setIsAuthenticated(state.isAuthenticated);
			setCurrentUser(state.user);
		});

		return unsubscribe;
	}, [authService]);


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

			// Check if we have a project with git origin URL for repository-specific filtering
			if (project?.gitOriginUrl) {
				console.log(`Fetching backlog items for repository: ${project.gitOriginUrl}`);
				try {
					items = await backlogService.getBacklogByRepository(project.gitOriginUrl);
					console.log(`Successfully fetched ${items.length} items for repository`);
				} catch (repoError) {
					console.warn('Failed to fetch repository-specific backlog:', repoError);
					// If the repository endpoint fails, it means no backlog items are available
					// Don't fall back to all items for security reasons
					items = [];
				}
				
				// Apply local filtering to repository-specific results
				if (filters.status) {
					items = items.filter(item => item.status === filters.status);
				}
				if (filters.priority) {
					items = items.filter(item => item.priority.toString() === filters.priority);
				}
				if (filters.owner) {
					items = items.filter(item => item.owner === filters.owner);
				}
				if (filters.overdue) {
					const now = new Date();
					items = items.filter(item => {
						if (!item.due_date) return false;
						return new Date(item.due_date) < now;
					});
				}
			} else {
				// Build filters object for admin endpoint (fallback when no project)
				const filterParams: BacklogFilters = {};
				if (filters.status) filterParams.status = filters.status;
				if (filters.priority) filterParams.priority = filters.priority;
				if (filters.owner) filterParams.owner = filters.owner;
				if (filters.overdue) filterParams.overdue = filters.overdue;

				// Use admin endpoint to get all backlog items across repositories
				items = await backlogService.getAllBacklogItems(filterParams);
				console.log('Fetching all backlog items (no project git URL available)');
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
			const taskData = {
				...newTaskData,
				git_repository_url: project.gitOriginUrl
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
		if (isAuthenticated) {
			fetchBacklogItems();
		}
	}, [filters, isAuthenticated, project?.gitOriginUrl]);

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
						<h3 className="text-sm font-medium text-[var(--base-700)]">Filters:</h3>
						
						{/* Status Filter */}
						<select
							value={filters.status}
							onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
							className="px-3 py-1 text-sm border border-[var(--base-300)] rounded focus:outline-none focus:border-[var(--acc-500)]"
						>
							<option value="">All Statuses</option>
							<option value="open">Open</option>
							<option value="in_progress">In Progress</option>
							<option value="completed">Completed</option>
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
							Refresh
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
					/* Backlog Table */
					<div className="bg-[var(--base-100)] rounded-lg border border-[var(--base-300)] overflow-hidden">
						<div className="overflow-x-auto">
							<table className="w-full text-sm table-fixed">
								<thead className="bg-[var(--base-200)] border-b border-[var(--base-300)]">
									<tr>
										<th 
											className="px-4 py-3 text-left font-medium text-[var(--base-700)] cursor-pointer hover:bg-[var(--base-300)] transition-colors"
											onClick={() => handleSort('task')}
											style={{ width: '43%' }}
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
											<tr key={item.id} className="hover:bg-[var(--base-50)] transition-colors">
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
															<option value="open">Open</option>
															<option value="in_progress">In Progress</option>
															<option value="completed">Completed</option>
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
															onClick={() => {/* TODO: Implement add to new agent */}}
															className="w-6 h-6 flex items-center justify-center bg-[var(--acc-500)] hover:bg-[var(--acc-600)] text-white rounded transition-colors"
															title="Add to new agent"
														>
															<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
																<path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
															</svg>
														</button>
														<button
															onClick={() => {/* TODO: Implement add to selected agents */}}
															className="w-6 h-6 flex items-center justify-center bg-[var(--positive-500)] hover:bg-[var(--positive-600)] text-white rounded transition-colors"
															title="Add to agents selection"
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
								
								<div className="flex gap-2 items-center justify-end">
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
											<option value="open">Open</option>
											<option value="in_progress">In Progress</option>
											<option value="completed">Completed</option>
										</select>
										<button
											onClick={createNewTask}
											className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors w-16"
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