# Stripe Webhooks Documentation

## Overview

Stripe webhooks are used to handle subscription lifecycle events (successful payments, subscription updates, cancellations). This guide covers local testing and production setup.

## Webhook Events Handled

- **`checkout.session.completed`** - Initial payment completed, updates user's subscription plan
- **`customer.subscription.updated`** - Subscription modified or status changed
- **`customer.subscription.deleted`** - Subscription cancelled

## Local Testing with Stripe CLI

### Prerequisites

1. Install the Stripe CLI: https://stripe.com/docs/stripe-cli
2. Login to Stripe CLI:
   ```bash
   stripe login
   ```

### Setup Steps

1. **Start your backend** (if not already running):
   ```bash
   docker compose up
   ```
   Backend should be accessible at `http://localhost:3000`

2. **Forward webhook events to your local backend**:
   ```bash
   stripe listen --forward-to http://localhost:3000/api/stripe/webhook
   ```

3. **Copy the webhook signing secret** from the CLI output (starts with `whsec_`):
   ```
   > Ready! You are using Stripe API Version [...]
   > Your webhook signing secret is whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

4. **Add the webhook secret to your environment**:
   - Open `backend/.env`
   - Add or update:
     ```
     STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
     ```
   - Restart the backend:
     ```bash
     docker compose restart backend
     ```

### Testing Webhook Events

With the Stripe CLI listening, you can trigger test events:

```bash
# Test successful checkout
stripe trigger checkout.session.completed

# Test subscription update
stripe trigger customer.subscription.updated

# Test subscription cancellation
stripe trigger customer.subscription.deleted
```

Or complete an actual test payment:
1. Open your app and click "Get" on a subscription plan
2. Use Stripe test card: `4242 4242 4242 4242`
3. Any future expiry date, any CVC
4. The webhook will be triggered automatically

### Viewing Webhook Logs

The Stripe CLI will show webhook delivery in real-time:
```
2025-10-20 12:34:56   --> checkout.session.completed [evt_xxx]
2025-10-20 12:34:56   <-- [200] POST http://localhost:3000/api/stripe/webhook [evt_xxx]
```

You'll also see logs in your backend Docker container:
```bash
docker compose logs -f backend
```

## Production Setup

### 1. Create Webhook Endpoint in Stripe Dashboard

1. Go to: https://dashboard.stripe.com/webhooks
2. Click **Add endpoint**
3. Enter your production URL: `https://api.ariana.dev/api/stripe/webhook`
4. Select events to listen to:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Click **Add endpoint**

### 2. Configure Webhook Secret

1. Copy the **Signing secret** from the webhook details page (starts with `whsec_`)
2. Add to production environment variables:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_production_secret_here
   ```

### 3. Verify Webhook Delivery

- Test webhooks from Stripe Dashboard → Webhooks → [Your endpoint] → Send test webhook
- Monitor webhook delivery and errors in the dashboard
- Check backend logs for processing errors

## Environment Variables

Required environment variables for Stripe integration:

```bash
# Backend .env
STRIPE_SECRET_KEY=sk_test_... # or sk_live_... for production
STRIPE_WEBHOOK_SECRET=whsec_... # from Stripe CLI (dev) or Dashboard (prod)
FRONTEND_URL=http://localhost:1420 # for checkout redirect URLs
```

## Price IDs

See `/STRIPE_PRICES.md` for current price IDs for each environment.

## Troubleshooting

### Webhook returns 401 Unauthorized
- The OPTIONS preflight must be handled before authentication
- Check that `handleStripeRoutes` has the OPTIONS handler at the top

### Webhook signature verification fails
- Ensure `STRIPE_WEBHOOK_SECRET` matches the secret from Stripe CLI or Dashboard
- Restart backend after changing environment variables
- Check that the webhook payload hasn't been modified (raw body required)

### User subscription not updated
- Check backend logs: `docker compose logs -f backend | grep stripe`
- Verify metadata (`userId`, `subscriptionPlanId`) is present in checkout session
- Verify subscription plan exists in database
- Check that user ID matches an existing user

### Webhook timeout (30 seconds)
- Stripe webhooks must respond within 30 seconds
- Move long-running tasks to background jobs
- Return 200 immediately, process async

## Database Schema

Webhook handler updates these fields:

```sql
-- User table
UPDATE user SET
  subscriptionPlanId = 'max',      -- from session.metadata.subscriptionPlanId
  userLimitsTierId = 'max_limits'  -- from plan.userLimitId
WHERE id = session.metadata.userId;
```

## Security Notes

1. **Always verify webhook signatures** - prevents replay attacks
2. **Use HTTPS in production** - webhook payloads contain sensitive data
3. **Rotate webhook secrets** periodically via Stripe Dashboard
4. **Monitor failed webhooks** - Stripe will retry for 3 days
5. **Keep webhook endpoint public** - no authentication required (signature verification is sufficient)
