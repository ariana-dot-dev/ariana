import { ServiceContainer } from '../../services';
import { addCorsHeaders } from '../../middleware/auth';

export async function handleClaudeRoutes(
  req: Request,
  url: URL,
  services: ServiceContainer,
  origin: string | null
): Promise<Response | null> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return addCorsHeaders(new Response(null, { status: 200 }), origin);
  }
  
  // No matching claude route
  return null;
}