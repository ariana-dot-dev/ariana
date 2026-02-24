import Stripe from 'stripe';
import type { RepositoryContainer } from '@/data/repositories';
import { getLogger } from '@/utils/logger';
import crypto from 'crypto';

const logger = getLogger(['stripe']);

export class StripeService {
  private stripe: Stripe;

  constructor(
    private repositories: RepositoryContainer,
    stripeSecretKey: string
  ) {
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY is required');
    }
    this.stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-12-18.acacia' as any,
      httpClient: Stripe.createFetchHttpClient(),
    });
  }

  /**
   * Verify Stripe webhook signature manually (async-compatible)
   */
  private async verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): Promise<boolean> {
    const items = signature.split(',');
    let timestamp: number | null = null;
    const signatures: string[] = [];

    for (const item of items) {
      const [key, value] = item.split('=');
      if (key === 't') {
        timestamp = parseInt(value, 10);
      } else if (key === 'v1') {
        signatures.push(value);
      }
    }

    if (!timestamp) {
      throw new Error('Unable to extract timestamp from signature header');
    }

    // Check timestamp tolerance (10 minutes)
    const timestampAge = Math.floor(Date.now() / 1000) - timestamp;
    if (timestampAge > 600) {
      throw new Error('Timestamp outside the tolerance zone (10 minutes)');
    }

    // Compute expected signature
    const signedPayload = `${timestamp}.${payload}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    // Check if any of the signatures match
    const signatureFound = signatures.some(sig => sig === expectedSignature);

    if (!signatureFound) {
      throw new Error('No signatures found matching the expected signature for payload');
    }

    return true;
  }

  /**
   * Create a Stripe Checkout session for subscription
   */
  async createCheckoutSession(params: {
    userId: string;
    subscriptionPlanId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ sessionId: string; url: string }> {
    try {
      const { userId, subscriptionPlanId, successUrl, cancelUrl } = params;

      // Get subscription plan from database
      const plan = await this.repositories.subscriptionPlans.findById(subscriptionPlanId);
      if (!plan) {
        throw new Error(`Subscription plan not found: ${subscriptionPlanId}`);
      }

      // Determine which price ID to use (test vs production)
      const priceId = process.env.NODE_ENV === 'production'
        ? plan.stripePriceId
        : (plan.stripePriceIdTest || plan.stripePriceId);

      if (!priceId) {
        throw new Error(`No Stripe price ID configured for plan: ${subscriptionPlanId}`);
      }

      // Get user info for prefilling
      const user = await this.repositories.users.findByIdWithProfile(userId);
      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }

      // Get or create Stripe customer
      let customerId = user.stripeCustomerId;

      if (!customerId) {
        // Create new Stripe customer with GitHub email in metadata
        const customer = await this.stripe.customers.create({
          metadata: {
            userId,
            githubEmail: user.githubProfile?.email || '',
          },
        });
        customerId = customer.id;

        // Store customer ID in database
        await this.repositories.prisma.user.update({
          where: { id: userId },
          data: { stripeCustomerId: customerId },
        });

        console.log('[Stripe Service] Created new customer:', customerId);
      }

      // Create Stripe checkout session
      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer: customerId,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: userId,
        metadata: {
          userId,
          subscriptionPlanId,
          githubEmail: user.githubProfile?.email || '',
          stripeCustomerId: customerId,
        },
        billing_address_collection: 'required',
        allow_promotion_codes: true,
        customer_update: {
          address: 'auto',
          name: 'auto',
        },
        subscription_data: {
          metadata: {
            userId,
            githubEmail: user.githubProfile?.email || '',
          },
        },
      });

      logger.info`Stripe checkout session created - sessionId: ${session.id}, userId: ${userId}, plan: ${subscriptionPlanId}`;

      return {
        sessionId: session.id,
        url: session.url!,
      };
    } catch (error) {
      logger.error`Failed to create Stripe checkout session: ${error}`;
      throw error;
    }
  }

  /**
   * Cancel a user's subscription (at period end)
   */
  async cancelSubscription(userId: string): Promise<{ success: boolean; message: string; cancelAt?: Date }> {
    try {
      console.log('[Stripe Service] Canceling subscription for user:', userId);

      // Get user to find their Stripe subscription
      const user = await this.repositories.users.findByIdWithProfile(userId);
      if (!user) {
        throw new Error('User not found');
      }

      console.log('[Stripe Service] User subscription plan:', user.subscriptionPlanId);
      console.log('[Stripe Service] Stripe subscription ID:', user.stripeSubscriptionId);

      // Check if user has an active subscription
      if (!user.subscriptionPlanId || user.subscriptionPlanId === 'free') {
        return {
          success: false,
          message: 'No active subscription to cancel',
        };
      }

      if (!user.stripeSubscriptionId) {
        // Fallback: Immediately downgrade if no Stripe subscription ID
        console.warn('[Stripe Service] No Stripe subscription ID found, downgrading immediately');
        await this.repositories.prisma.user.update({
          where: { id: userId },
          data: {
            subscriptionPlanId: 'free',
            userLimitsTierId: 'github',
          },
        });

        return {
          success: true,
          message: 'Subscription cancelled successfully',
        };
      }

      // Cancel subscription in Stripe at period end
      const subscription = await this.stripe.subscriptions.update(user.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      console.log('[Stripe Service] Subscription set to cancel at:', new Date(subscription.cancel_at! * 1000));

      // Update user record with cancellation date
      await this.repositories.prisma.user.update({
        where: { id: userId },
        data: {
          subscriptionCancelAt: new Date(subscription.cancel_at! * 1000),
        },
      });

      return {
        success: true,
        message: 'Subscription will be cancelled at the end of the billing period',
        cancelAt: new Date(subscription.cancel_at! * 1000),
      };
    } catch (error) {
      console.error('[Stripe Service] Failed to cancel subscription:', error);
      throw error;
    }
  }

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(payload: string, signature: string, webhookSecret: string): Promise<void> {
    try {
      // Verify webhook signature manually (async-compatible for Bun)
      await this.verifyWebhookSignature(payload, signature, webhookSecret);
      console.log('[Stripe Webhook] Signature verified successfully');

      // Parse the event
      const event = JSON.parse(payload) as Stripe.Event;

      logger.info`Received Stripe webhook event: ${event.type}`;
      console.log('[Stripe Webhook] Event type:', event.type);
      console.log('[Stripe Webhook] Event ID:', event.id);
      console.log('[Stripe Webhook] Event data:', JSON.stringify(event.data.object, null, 2));

      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
          break;

        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;

        default:
          logger.debug`Unhandled webhook event type: ${event.type}`;
          console.log('[Stripe Webhook] Unhandled event type:', event.type);
      }
    } catch (error) {
      logger.error`Webhook processing failed: ${error}`;
      console.error('[Stripe Webhook] Error:', error);
      throw error;
    }
  }

  /**
   * Handle successful checkout
   */
  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
    try {
      console.log('[Stripe Webhook] Processing checkout.session.completed');
      console.log('[Stripe Webhook] Session ID:', session.id);
      console.log('[Stripe Webhook] Session metadata:', session.metadata);
      console.log('[Stripe Webhook] Subscription ID:', session.subscription);

      const userId = session.metadata?.userId;
      const subscriptionPlanId = session.metadata?.subscriptionPlanId;
      const githubEmail = session.metadata?.githubEmail;
      const stripeCustomerId = session.metadata?.stripeCustomerId || (session.customer as string);
      const stripeSubscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

      if (!userId || !subscriptionPlanId) {
        logger.error`Missing metadata in checkout session: ${session.id}`;
        console.error('[Stripe Webhook] Missing metadata - userId:', userId, 'subscriptionPlanId:', subscriptionPlanId);
        return;
      }

      console.log('[Stripe Webhook] Fetching subscription plan:', subscriptionPlanId);

      // Get subscription plan and its associated user limit
      const plan = await this.repositories.subscriptionPlans.findById(subscriptionPlanId);
      if (!plan) {
        logger.error`Subscription plan not found: ${subscriptionPlanId}`;
        console.error('[Stripe Webhook] Subscription plan not found in database:', subscriptionPlanId);
        return;
      }

      console.log('[Stripe Webhook] Plan found:', { id: plan.id, label: plan.label, userLimitId: plan.userLimitId });
      console.log('[Stripe Webhook] Updating user:', userId);

      // Update Stripe customer with GitHub email in metadata for identification
      if (stripeCustomerId && githubEmail) {
        console.log('[Stripe Webhook] Updating customer metadata with GitHub email:', githubEmail);
        await this.stripe.customers.update(stripeCustomerId, {
          metadata: {
            userId,
            githubEmail,
          },
        });
      }

      // Update user's subscription plan, limits tier, and Stripe subscription ID
      await this.repositories.prisma.user.update({
        where: { id: userId },
        data: {
          subscriptionPlanId: plan.id,
          userLimitsTierId: plan.userLimitId,
          stripeSubscriptionId: stripeSubscriptionId || undefined,
          stripeCustomerId: stripeCustomerId || undefined,
          subscriptionCancelAt: null, // Clear any previous cancellation
        },
      });

      logger.info`User subscription updated - userId: ${userId}, plan: ${plan.label}, limits: ${plan.userLimitId}`;
      console.log('[Stripe Webhook] ✓ User subscription updated successfully');
    } catch (error) {
      logger.error`Failed to handle checkout session completed: ${error}`;
      console.error('[Stripe Webhook] ✗ Error processing checkout.session.completed:', error);
      throw error;
    }
  }

  /**
   * Handle subscription updates (e.g., plan changes)
   */
  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    try {
      console.log('[Stripe Webhook] Processing customer.subscription.updated');
      console.log('[Stripe Webhook] Subscription ID:', subscription.id);
      console.log('[Stripe Webhook] Subscription status:', subscription.status);

      // Find user by Stripe customer ID
      const customerId = subscription.customer as string;
      console.log('[Stripe Webhook] Customer ID:', customerId);

      // You might want to store Stripe customer ID on User model for easier lookups
      logger.info`Subscription updated for customer: ${customerId}`;

      // Handle subscription status changes if needed
      if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
        // Downgrade user to free tier
        logger.warn`Subscription ${subscription.id} is ${subscription.status}`;
        console.warn('[Stripe Webhook] Subscription status requires action:', subscription.status);
      }
    } catch (error) {
      logger.error`Failed to handle subscription updated: ${error}`;
      console.error('[Stripe Webhook] ✗ Error processing customer.subscription.updated:', error);
    }
  }

  /**
   * Handle subscription cancellation
   */
  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    try {
      console.log('[Stripe Webhook] Processing customer.subscription.deleted');
      console.log('[Stripe Webhook] Subscription ID:', subscription.id);

      const customerId = subscription.customer as string;
      console.log('[Stripe Webhook] Customer ID:', customerId);

      // Find user by Stripe subscription ID
      const user = await this.repositories.prisma.user.findUnique({
        where: { stripeSubscriptionId: subscription.id },
      });

      if (!user) {
        logger.warn`No user found for subscription: ${subscription.id}`;
        console.warn('[Stripe Webhook] No user found with subscription ID:', subscription.id);
        return;
      }

      console.log('[Stripe Webhook] Found user:', user.id);
      console.log('[Stripe Webhook] Downgrading to free tier');

      // Downgrade user to free tier
      await this.repositories.prisma.user.update({
        where: { id: user.id },
        data: {
          subscriptionPlanId: 'free',
          userLimitsTierId: 'github',
          stripeSubscriptionId: null,
          subscriptionCancelAt: null,
        },
      });

      logger.info`Subscription deleted - userId: ${user.id}, downgraded to free tier`;
      console.log('[Stripe Webhook] ✓ User downgraded to free tier successfully');
    } catch (error) {
      logger.error`Failed to handle subscription deleted: ${error}`;
      console.error('[Stripe Webhook] ✗ Error processing customer.subscription.deleted:', error);
    }
  }
}
