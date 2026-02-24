import type { ServiceContainer } from '@/services';
import { requireAuthAsync, createAuthErrorResponse, addCorsHeaders } from '@/middleware/auth';
import {
  handleCreateCheckoutSession,
  handleGetSubscriptionPlans,
  handleStripeWebhook,
  handleCancelSubscription,
} from './handlers';

export async function handleStripeRoutes(
  req: Request,
  url: URL,
  services: ServiceContainer,
  origin: string | null
): Promise<Response | null> {
  const context = { services, origin };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return addCorsHeaders(new Response(null, { status: 200 }), origin);
  }

  // Webhook endpoint (no authentication)
  if (url.pathname === '/api/stripe/webhook' && req.method === 'POST') {
    return await handleStripeWebhook(req, context);
  }

  // Get subscription plans (public endpoint)
  if (url.pathname === '/api/stripe/plans' && req.method === 'GET') {
    return await handleGetSubscriptionPlans(req, context);
  }

  // Checkout success page (public endpoint)
  if (url.pathname === '/api/stripe/checkout/success' && req.method === 'GET') {
    try {
      const filePath = new URL('../../../static/checkout-success.html', import.meta.url);
      const html = await Bun.file(filePath).text();

      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    } catch (error) {
      console.error('Error serving checkout success page:', error);
      return new Response('Checkout success page not found', { status: 404 });
    }
  }

  // Authenticated endpoints
  let auth;
  try {
    auth = await requireAuthAsync(req, services);
  } catch (error) {
    return createAuthErrorResponse(error instanceof Error ? error : new Error('Authentication failed'), origin);
  }

  // Create checkout session
  if (url.pathname === '/api/stripe/checkout' && req.method === 'POST') {
    return await handleCreateCheckoutSession(req, context, auth);
  }

  // Cancel subscription
  if (url.pathname === '/api/stripe/subscription/cancel' && req.method === 'POST') {
    return await handleCancelSubscription(req, context, auth);
  }

  return null;
}
