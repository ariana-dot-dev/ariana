-- Migration: Unify agent provider config into single JSON column
-- This consolidates: claudeCodeOauthToken, claudeCodeRefreshToken, claudeCodeTokenExpiry, anthropicApiKey, claudeProvider
-- into a single agentProviderConfig JSON column

-- Step 1: Add the new column
ALTER TABLE "User" ADD COLUMN "agentProviderConfig" JSONB;

-- Step 2: Migrate existing data to the new JSON structure
UPDATE "User" SET "agentProviderConfig" = jsonb_build_object(
    'activeAgentType', 'claude-code',
    'claudeCode', jsonb_build_object(
        'activeAuthMethod',
            CASE
                WHEN "claudeCodeOauthToken" IS NOT NULL THEN 'subscription'
                WHEN "anthropicApiKey" IS NOT NULL THEN 'api-key'
                ELSE 'subscription'
            END,
        'subscription', jsonb_build_object(
            'oauthToken', "claudeCodeOauthToken",
            'refreshToken', "claudeCodeRefreshToken",
            'tokenExpiry', CASE WHEN "claudeCodeTokenExpiry" IS NOT NULL THEN to_char("claudeCodeTokenExpiry", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END
        ),
        'apiKey', jsonb_build_object(
            'activeProvider', COALESCE("claudeProvider", 'anthropic'),
            'anthropic', jsonb_build_object(
                'apiKey', CASE WHEN COALESCE("claudeProvider", 'anthropic') = 'anthropic' THEN "anthropicApiKey" ELSE NULL END
            ),
            'openrouter', jsonb_build_object(
                'apiKey', CASE WHEN "claudeProvider" = 'openrouter' THEN "anthropicApiKey" ELSE NULL END
            )
        )
    )
);

-- Step 3: Drop old columns
ALTER TABLE "User" DROP COLUMN "claudeCodeOauthToken";
ALTER TABLE "User" DROP COLUMN "claudeCodeRefreshToken";
ALTER TABLE "User" DROP COLUMN "claudeCodeTokenExpiry";
ALTER TABLE "User" DROP COLUMN "anthropicApiKey";
ALTER TABLE "User" DROP COLUMN "claudeProvider";
