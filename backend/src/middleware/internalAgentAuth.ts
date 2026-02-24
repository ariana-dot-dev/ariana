import jwt from 'jsonwebtoken';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required but not set');
}

const SECRET: string = process.env.JWT_SECRET;

interface InternalAgentClaims {
  type: 'ariana-agent';
  userId: string;
  agentId: string;
  exp: number;
}

/**
 * Generate a JWT token for internal agent-to-backend communication.
 * Used by MCP tools running on agent machines to authenticate with backend.
 *
 * @param userId - The user ID the agent belongs to
 * @param agentId - The agent ID
 * @param ttlSeconds - Token time-to-live in seconds (default: 9 days)
 */
export function generateInternalAgentToken(userId: string, agentId: string, ttlSeconds = 777600): string {
  return jwt.sign(
    { type: 'ariana-agent', userId, agentId, exp: Math.floor(Date.now() / 1000) + ttlSeconds },
    SECRET
  );
}

/**
 * Validate an internal agent JWT token from request headers
 * @throws Error if token is missing or invalid
 */
export function requireInternalAgent(req: Request): InternalAgentClaims {
  const header = req.headers.get('authorization') || '';
  const token = header.replace(/bearer\s+/i, '');

  if (!token) {
    throw new Error('Missing authorization token');
  }

  try {
    const decoded = jwt.verify(token, SECRET) as InternalAgentClaims;

    if (decoded.type !== 'ariana-agent') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw error;
  }
}
