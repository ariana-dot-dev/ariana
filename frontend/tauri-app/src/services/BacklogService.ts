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
  owner?: string | null;
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
    console.log('Creating backlog item:', item);
    console.log('API URL:', getApiUrl(API_CONFIG.ENDPOINTS.BACKLOG));
    
    const response = await this.authService.apiRequest<{ backlogItem: BacklogItem }>(
      getApiUrl(API_CONFIG.ENDPOINTS.BACKLOG),
      {
        method: 'POST',
        body: JSON.stringify(item),
      }
    );
    
    console.log('Create response:', response);
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
    
    console.log('Fetching backlog by repository:', gitRepositoryUrl);
    console.log('Request URL:', url);
    
    try {
      const response = await this.authService.apiRequest<{ backlogItems: BacklogItem[] }>(url);
      console.log('Fetch response:', response);
      return response.backlogItems;
    } catch (error) {
      console.error('getBacklogByRepository error:', error);
      throw error;
    }
  }

  async getRepositoryByUrl(gitRepositoryUrl: string): Promise<{id: number, random_id: string} | null> {
    try {
      const params = new URLSearchParams({ repo_url: gitRepositoryUrl });
      const url = getApiUrl(API_CONFIG.ENDPOINTS.REPOSITORY_BY_URL) + `?${params.toString()}`;
      
      const response = await this.authService.apiRequest<{ repository: {id: number, random_id: string} }>(url);
      return response.repository;
    } catch (error) {
      console.error('Failed to get repository by URL:', error);
      return null;
    }
  }

  async getBacklogByRepositoryRandomId(randomId: string): Promise<BacklogItem[]> {
    console.log('Fetching backlog by repository random ID:', randomId);
    const params = new URLSearchParams({ repository_id: randomId });
    const url = getApiUrl(API_CONFIG.ENDPOINTS.BACKLOG_BY_REPOSITORY_ID) + `?${params.toString()}`;
    console.log('Request URL:', url);
    
    try {
      const response = await this.authService.apiRequest<{ backlogItems: BacklogItem[] }>(url);
      console.log('Fetch response:', response);
      return response.backlogItems;
    } catch (error) {
      console.error('getBacklogByRepositoryRandomId error:', error);
      throw error;
    }
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