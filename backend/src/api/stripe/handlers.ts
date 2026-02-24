import type { ServiceContainer } from '@/services';
import { addCorsHeaders } from '@/middleware/auth';
import type { AuthenticatedRequest } from '@/middleware/auth';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['api', 'stripe']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

/**
 * Create Stripe checkout session
 */
export async function handleCreateCheckoutSession(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json() as {
      subscriptionPlanId: string;
      successUrl?: string;
      cancelUrl?: string;
    };

    const { subscriptionPlanId, successUrl, cancelUrl } = body;

    if (!subscriptionPlanId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'subscriptionPlanId is required'
      }, { status: 400 }), context.origin);
    }

    // Default URLs if not provided
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:1420';
    const finalSuccessUrl = successUrl || `${serverUrl}/api/stripe/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
    const finalCancelUrl = cancelUrl || `${frontendUrl}/profile`;

    // Create checkout session
    const session = await context.services.stripe.createCheckoutSession({
      userId: auth.user.id,
      subscriptionPlanId,
      successUrl: finalSuccessUrl,
      cancelUrl: finalCancelUrl,
    });

    logger.info`Checkout session created - userId: ${auth.user.id}, planId: ${subscriptionPlanId}`;

    return addCorsHeaders(Response.json({
      success: true,
      sessionId: session.sessionId,
      url: session.url,
    }), context.origin);
  } catch (error) {
    logger.error`Create checkout session failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create checkout session'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Get available subscription plans
 */
export async function handleGetSubscriptionPlans(
  req: Request,
  context: RequestContext,
  auth?: AuthenticatedRequest
): Promise<Response> {
  try {
    const plans = await context.services.repositoryContainer.subscriptionPlans.findAll();

    return addCorsHeaders(Response.json({
      success: true,
      plans: plans.map((plan: any) => ({
        id: plan.id,
        label: plan.label,
        stripePriceId: process.env.NODE_ENV === 'production'
          ? plan.stripePriceId
          : (plan.stripePriceIdTest || plan.stripePriceId),
        limits: plan.userLimit ? {
          maxProjectsTotal: plan.userLimit.maxProjectsTotal,
          maxAgentsPerMonth: plan.userLimit.maxAgentsPerMonth,
          maxSpecificationsTotal: plan.userLimit.maxSpecificationsTotal,
        } : null,
      })),
    }), context.origin);
  } catch (error) {
    logger.error`Get subscription plans failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get subscription plans'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Cancel user subscription
 */
export async function handleCancelSubscription(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    console.log('[Stripe Handler] Canceling subscription for user:', auth.user.id);

    const result = await context.services.stripe.cancelSubscription(auth.user.id);

    if (!result.success) {
      return addCorsHeaders(Response.json({
        success: false,
        error: result.message
      }, { status: 400 }), context.origin);
    }

    logger.info`Subscription cancelled - userId: ${auth.user.id}`;
    console.log('[Stripe Handler] ✓ Subscription cancelled successfully');

    return addCorsHeaders(Response.json({
      success: true,
      message: result.message,
      cancelAt: result.cancelAt,
    }), context.origin);
  } catch (error) {
    logger.error`Cancel subscription failed: ${error}`;
    console.error('[Stripe Handler] ✗ Cancel subscription failed:', error);
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel subscription'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Handle Stripe webhook
 */
export async function handleStripeWebhook(
  req: Request,
  context: RequestContext
): Promise<Response> {
  try {
    console.log('[Stripe Handler] Received webhook request');

    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      logger.error`Webhook missing stripe-signature header`;
      console.error('[Stripe Handler] Missing stripe-signature header');
      return Response.json({
        success: false,
        error: 'Missing stripe-signature header'
      }, { status: 400 });
    }

    console.log('[Stripe Handler] Signature present, reading payload...');
    const payload = await req.text();
    console.log('[Stripe Handler] Payload length:', payload.length, 'bytes');

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.error`STRIPE_WEBHOOK_SECRET not configured`;
      console.error('[Stripe Handler] STRIPE_WEBHOOK_SECRET environment variable not set');
      return Response.json({
        success: false,
        error: 'Webhook secret not configured'
      }, { status: 500 });
    }

    console.log('[Stripe Handler] Webhook secret configured, processing...');

    // Process webhook
    await context.services.stripe.handleWebhook(payload, signature, webhookSecret);

    logger.info`Webhook processed successfully`;
    console.log('[Stripe Handler] ✓ Webhook processed successfully');

    return Response.json({
      success: true,
      received: true,
    });
  } catch (error) {
    logger.error`Webhook processing failed: ${error}`;
    console.error('[Stripe Handler] ✗ Webhook processing failed:', error);
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Webhook processing failed'
    }, { status: 400 });
  }
}
