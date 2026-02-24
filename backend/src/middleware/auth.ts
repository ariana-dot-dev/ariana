import type { ServiceContainer } from '../services';
import type { JWTPayload } from '../../shared/types';
import { getLogger } from '../utils/logger';

const logger = getLogger(['auth', 'middleware']);

export interface AuthenticatedRequest {
  user: AuthenticatedRequestUser;
  jwt: JWTPayload;
}

export interface AuthenticatedRequestUser {
  id: string;
}

export function getAllowedOrigins(): string[] {
  return [
    'http://localhost:1420',
    'http://localhost:1430', // Dev Tauri app
    'tauri://localhost',
    'https://tauri.localhost',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'https://api.ariana.dev',
    'https://staging.ariana.dev',
    'https://ariana.dev'
  ];
}

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  const allowedOrigins = getAllowedOrigins();
  return allowedOrigins.includes(origin);
}

export function addCorsHeaders(response: Response, origin?: string | null): Response {
  const allowedOrigins = getAllowedOrigins();
  const originToUse = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  
  response.headers.set('Access-Control-Allow-Origin', originToUse);
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.headers.set('Access-Control-Allow-Credentials', 'false');
  response.headers.set('Access-Control-Max-Age', '86400');
  
  return response;
}
export async function requireAuthAsync(req: Request, services: ServiceContainer): Promise<AuthenticatedRequest> {
  const authHeader = req.headers.get('Authorization');

  if (!authHeader) {
    throw new Error('AUTHENTICATION_REQUIRED: No Authorization header found');
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('AUTHENTICATION_REQUIRED: Authorization header must start with "Bearer "');
  }

  const token = authHeader.slice(7);
  
  if (!token) {
    const path = new URL(req.url).pathname;
    // logger.error `Auth failed: Empty JWT token - path: ${path}`;
    throw new Error('AUTHENTICATION_REQUIRED: Empty JWT token');
  }

  let validationResult;
  try {
    validationResult = await services.auth.validateJwtToken(token);
  } catch (error) {
    // logger.error `Auth failed: JWT verification failed - error: ${error instanceof Error ? error.message : String(error)}, tokenPreview: ${token.substring(0, 20)}..., path: ${path}`;
    throw new Error(`AUTHENTICATION_FAILED: ${error instanceof Error ? error.message : 'Invalid token'}`);
  }

  if (!validationResult) {
    throw new Error('AUTHENTICATION_FAILED: Token validation returned null');
  }

  const authenticatedRequest: AuthenticatedRequest = {
    user: {
      id: validationResult.jwt.sub,
    },
    jwt: validationResult.jwt
  };

  const path = new URL(req.url).pathname;
  // logger.debug `Request authenticated successfully - userId: ${validationResult.jwt.sub}, jti: ${validationResult.jwt.jti}, path: ${path}`;

  return authenticatedRequest;
}


export function createAuthErrorResponse(error: Error, origin?: string | null): Response {

  let status = 401;
  let message = 'Authentication required';

  if (error.message.includes('AUTHENTICATION_REQUIRED')) {
    status = 401;
    message = 'Valid JWT token required in Authorization header';
  } else if (error.message.includes('AUTHENTICATION_FAILED')) {
    status = 401;
    message = 'Invalid or expired JWT token';
  } else if (error.message.includes('AUTHORIZATION_FAILED')) {
    status = 403;
    message = 'Insufficient permissions';
  }

  const response = new Response(JSON.stringify({
    error: message,
    code: error.message.split(':')[0] || 'AUTH_ERROR',
    timestamp: new Date().toISOString()
  }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

  return addCorsHeaders(response, origin);
}
