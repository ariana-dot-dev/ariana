-- Update SubscriptionPlan with production Stripe price IDs
UPDATE "SubscriptionPlan"
SET "stripePriceId" = 'price_1SLMeMRs8dzFHUTINFE1GMCc'
WHERE "id" = 'max';

UPDATE "SubscriptionPlan"
SET "stripePriceId" = 'price_1SLMh3Rs8dzFHUTIGvkzCRuc'
WHERE "id" = 'ultra';