// API Configuration for Ariana IDE
export const API_CONFIG = {
  // OVH Server API Base URL
  BASE_URL: 'http://54.36.60.211:3000',
  
  // API Endpoints
  ENDPOINTS: {
    // Auth endpoints
    PROFILE: '/api/profile',
    SESSIONS: '/api/sessions',
    LOGOUT: '/auth/logout',
    
    // Backlog endpoints
    BACKLOG: '/api/backlog',
    BACKLOG_STATS: '/api/backlog/stats',
    BACKLOG_BY_REPOSITORY: '/api/backlog/repository',
    ADMIN_BACKLOG: '/api/admin/backlog',
    
    // Admin backlog endpoints (for collective management)
    ADMIN_BACKLOG_ITEM: '/api/admin/backlog', // For update/delete operations
  },
  
  // Request timeout
  TIMEOUT: 10000,
};

export const getApiUrl = (endpoint: string): string => {
  return `${API_CONFIG.BASE_URL}${endpoint}`;
};