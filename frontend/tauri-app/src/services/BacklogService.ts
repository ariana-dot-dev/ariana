import AuthService from './AuthService';
import { API_CONFIG, getApiUrl } from './ApiConfig';

interface BacklogItem {
  id: number;
  task: string;
  status: 'open' | 'in_progress' | 'completed';
  owner: string;
  owner_name: string;
  owner_email: string;
  git_repository_url: string;
  priority: number;
  due_date: string;
  created_at: string;
}

interface BacklogFilters {
  status?: string;
  priority?: string;
  owner?: string;
  overdue?: boolean;
}

interface CreateBacklogItemRequest {
  git_repository_url: string;
  task: string;
  status?: 'open' | 'in_progress' | 'completed';
  priority?: number;
}

interface UpdateBacklogItemRequest {
  task?: string;
  status?: 'open' | 'in_progress' | 'completed';
  priority?: number;
  due_date?: string;
}

class BacklogService {
  private authService: AuthService;

  constructor() {
    this.authService = AuthService.getInstance();
  }

  async getBacklogItems(filters?: BacklogFilters): Promise<BacklogItem[]> {
    const params = new URLSearchParams();
    
    if (filters?.status) params.append('status', filters.status);
    if (filters?.priority) params.append('priority', filters.priority);
    if (filters?.owner) params.append('owner', filters.owner);
    if (filters?.overdue) params.append('overdue', 'true');

    const url = getApiUrl(API_CONFIG.ENDPOINTS.BACKLOG) + (params.toString() ? `?${params.toString()}` : '');
    
    const response = await this.authService.apiRequest<{ backlogItems: BacklogItem[] }>(url);
    return response.backlogItems;
  }

  async createBacklogItem(item: CreateBacklogItemRequest): Promise<BacklogItem> {
    const response = await this.authService.apiRequest<{ backlogItem: BacklogItem }>(
      getApiUrl(API_CONFIG.ENDPOINTS.BACKLOG),
      {
        method: 'POST',
        body: JSON.stringify(item),
      }
    );
    return response.backlogItem;
  }

  async updateBacklogItem(id: number, updates: UpdateBacklogItemRequest): Promise<BacklogItem> {
    // Use admin endpoint for collective backlog management (project-level permissions)
    const response = await this.authService.apiRequest<{ backlogItem: BacklogItem }>(
      getApiUrl(`${API_CONFIG.ENDPOINTS.ADMIN_BACKLOG_ITEM}/${id}`),
      {
        method: 'PUT',
        body: JSON.stringify(updates),
      }
    );
    return response.backlogItem;
  }

  async deleteBacklogItem(id: number): Promise<void> {
    // Use admin endpoint for collective backlog management (project-level permissions)
    await this.authService.apiRequest(
      getApiUrl(`${API_CONFIG.ENDPOINTS.ADMIN_BACKLOG_ITEM}/${id}`),
      {
        method: 'DELETE',
      }
    );
  }

  async getBacklogStats(): Promise<any> {
    return this.authService.apiRequest(getApiUrl(API_CONFIG.ENDPOINTS.BACKLOG_STATS));
  }

  async getBacklogByRepository(gitRepositoryUrl: string): Promise<BacklogItem[]> {
    const params = new URLSearchParams({ git_repository_url: gitRepositoryUrl });
    const url = getApiUrl(API_CONFIG.ENDPOINTS.BACKLOG_BY_REPOSITORY) + `?${params.toString()}`;
    
    const response = await this.authService.apiRequest<{ backlogItems: BacklogItem[] }>(url);
    return response.backlogItems;
  }

  async getAllBacklogItems(filters?: BacklogFilters): Promise<BacklogItem[]> {
    const params = new URLSearchParams();
    
    if (filters?.status) params.append('status', filters.status);
    if (filters?.priority) params.append('priority', filters.priority);
    if (filters?.owner) params.append('owner', filters.owner);
    if (filters?.overdue) params.append('overdue', 'true');

    const url = getApiUrl(API_CONFIG.ENDPOINTS.ADMIN_BACKLOG) + (params.toString() ? `?${params.toString()}` : '');
    
    const response = await this.authService.apiRequest<{ backlogItems: BacklogItem[] }>(url);
    return response.backlogItems;
  }
}

export default BacklogService;
export type { BacklogItem, BacklogFilters, CreateBacklogItemRequest, UpdateBacklogItemRequest };