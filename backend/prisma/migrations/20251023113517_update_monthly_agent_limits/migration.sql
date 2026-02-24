-- Update monthly agent limits for each plan tier

-- Update Free Plan (github tier) to 30 agents per month
UPDATE "UserLimits"
SET "maxAgentsPerMonth" = 30
WHERE "id" = 'github';

-- Update Max Plan to 300 agents per month
UPDATE "UserLimits"
SET "maxAgentsPerMonth" = 300
WHERE "id" = 'max-user';

-- Update Ultra Plan to 3000 agents per month
UPDATE "UserLimits"
SET "maxAgentsPerMonth" = 3000
WHERE "id" = 'ultra-user';