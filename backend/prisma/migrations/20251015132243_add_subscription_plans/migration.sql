-- AlterTable
ALTER TABLE "User" ADD COLUMN "subscriptionPlanId" TEXT;

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "stripePriceId" TEXT,
    "stripePriceIdTest" TEXT,
    "label" TEXT NOT NULL,
    "userLimitId" TEXT NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionPlan_userLimitId_idx" ON "SubscriptionPlan"("userLimitId");

-- AddForeignKey
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_userLimitId_fkey" FOREIGN KEY ("userLimitId") REFERENCES "UserLimits"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_subscriptionPlanId_fkey" FOREIGN KEY ("subscriptionPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Insert new UserLimits tiers
INSERT INTO "UserLimits" ("id", "label", "maxProjectsTotal", "maxProjectsPerMinute", "maxProjectsPer24Hours", "maxAgentsPerMonth", "maxAgentsPerMinute", "maxAgentsPer24Hours", "maxSpecificationsTotal", "maxSpecificationsPerMinute", "maxSpecificationsPer24Hours", "maxPromptsPerMinute", "maxPromptsPer24Hours") VALUES
('max-user', 'Max User', 10000, 20, 150, 300, 30, 200, 5000, 20, 150, 20, 1000),
('ultra-user', 'Ultra User', 50000, 50, 500, 3000, 30, 1000, 20000, 20, 500, 20, 5000);

-- Insert SubscriptionPlans
INSERT INTO "SubscriptionPlan" ("id", "stripePriceId", "stripePriceIdTest", "label", "userLimitId") VALUES
('free', NULL, NULL, 'Free Plan', 'github'),
('max', NULL, 'price_1SKMtMRs8dzFHUTIVScrghTX', 'Max Plan', 'max-user'),
('ultra', NULL, 'price_1SKMr6Rs8dzFHUTIJoy1Dz3C', 'Ultra Plan', 'ultra-user');
