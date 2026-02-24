// JWT token types

export interface JWTPayload {
  sub: string; // User ID
  exp: number;
  iat: number;
  jti?: string;
}

// Agent access JWT - used for sharing agents (read-only for now)
export interface AgentAccessJWTPayload {
  agentId: string;
  access: 'read';
  jti: string;
  exp?: number;  // Set by jwt.sign
  iat?: number;  // Set by jwt.sign
}