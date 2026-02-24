-- Migration to fix environment data issues
-- This migration addresses:
-- 1. Environments with empty or invalid data (ghost envs with no name)
-- 2. Environments missing isDefault flag from migration gap
-- 3. Projects without any default environment

-- Step 1: Fix environments with empty or invalid data
-- Set default data structure for any environment with empty or invalid JSON
UPDATE "PersonalEnvironment"
SET "data" = '{"name":"Default","envContents":"","secretFiles":[]}'
WHERE "data" = '{}'
   OR "data" = ''
   OR "data" IS NULL
   OR (
     "data" != ''
     AND "data" IS NOT NULL
     AND "data" != '{}'
     AND NOT (
       "data"::jsonb ? 'name'
       AND "data"::jsonb ? 'envContents'
     )
   );

-- Step 2: Re-add isDefault index if it was dropped
CREATE INDEX IF NOT EXISTS "PersonalEnvironment_isDefault_idx" ON "PersonalEnvironment"("isDefault");

-- Step 3: Ensure each project+user combination has exactly one default environment
-- This handles cases where environments lost their default flag during migration gap
DO $$
DECLARE
    combo_record RECORD;
    default_env_id TEXT;
    oldest_env_id TEXT;
BEGIN
    -- Loop through all unique project+user combinations
    FOR combo_record IN
        SELECT DISTINCT "projectId", "userId"
        FROM "PersonalEnvironment"
    LOOP
        -- Check if this combo has a default environment
        SELECT "id" INTO default_env_id
        FROM "PersonalEnvironment"
        WHERE "projectId" = combo_record."projectId"
          AND "userId" = combo_record."userId"
          AND "isDefault" = true
        LIMIT 1;

        -- If no default environment exists, set the oldest one as default
        IF default_env_id IS NULL THEN
            SELECT "id" INTO oldest_env_id
            FROM "PersonalEnvironment"
            WHERE "projectId" = combo_record."projectId"
              AND "userId" = combo_record."userId"
            ORDER BY "createdAt" ASC NULLS LAST, "id" ASC
            LIMIT 1;

            -- Set this as the default
            IF oldest_env_id IS NOT NULL THEN
                UPDATE "PersonalEnvironment"
                SET "isDefault" = true
                WHERE "id" = oldest_env_id;

                RAISE NOTICE 'Set environment % as default for project % and user %',
                    oldest_env_id, combo_record."projectId", combo_record."userId";
            END IF;
        END IF;
    END LOOP;
END $$;

-- Step 4: Ensure no duplicate defaults per project+user
-- If somehow there are multiple defaults, keep only the oldest one
DO $$
DECLARE
    combo_record RECORD;
    keep_env_id TEXT;
BEGIN
    -- Loop through project+user combos that have multiple defaults
    FOR combo_record IN
        SELECT "projectId", "userId", COUNT(*) as default_count
        FROM "PersonalEnvironment"
        WHERE "isDefault" = true
        GROUP BY "projectId", "userId"
        HAVING COUNT(*) > 1
    LOOP
        -- Get the oldest default environment to keep
        SELECT "id" INTO keep_env_id
        FROM "PersonalEnvironment"
        WHERE "projectId" = combo_record."projectId"
          AND "userId" = combo_record."userId"
          AND "isDefault" = true
        ORDER BY "createdAt" ASC NULLS LAST, "id" ASC
        LIMIT 1;

        -- Unset isDefault for all others
        UPDATE "PersonalEnvironment"
        SET "isDefault" = false
        WHERE "projectId" = combo_record."projectId"
          AND "userId" = combo_record."userId"
          AND "isDefault" = true
          AND "id" != keep_env_id;

        RAISE NOTICE 'Fixed duplicate defaults for project % and user %, keeping %',
            combo_record."projectId", combo_record."userId", keep_env_id;
    END LOOP;
END $$;
