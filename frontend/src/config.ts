export const API_URL = import.meta.env.VITE_API_URL || 'https://ariana.dev';
export const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || API_URL.replace(':3000', ':1420');
export const USE_DEEP_LINK = import.meta.env.VITE_USE_DEEP_LINK !== 'false';