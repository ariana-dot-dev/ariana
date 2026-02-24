#!/bin/bash

# Script to fix the failed migration on staging
# Run this on the staging server (debian@ns3088971)

set -e  # Exit on any error

echo "======================================"
echo "Migration Fix Script"
echo "======================================"
echo ""

# Check if we're in the right directory
if [ ! -f "backend/prisma/schema.prisma" ]; then
    echo "ERROR: Please run this script from the dedale-deploy directory"
    echo "Expected to find backend/prisma/schema.prisma"
    exit 1
fi

# Load environment variables
if [ -f ".env" ]; then
    echo "Loading environment variables from .env..."
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "WARNING: .env file not found. Make sure DATABASE_URL is set."
fi

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL is not set"
    echo "Please set it with: export DATABASE_URL='your-database-url'"
    exit 1
fi

echo "Step 1: Checking current migration status..."
echo ""
psql "$DATABASE_URL" -c "SELECT migration_name, started_at, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '20251109134304_fix_environment_data_and_defaults';" || {
    echo "ERROR: Could not query the database. Check your DATABASE_URL"
    exit 1
}

echo ""
echo "Step 2: Marking the failed migration as rolled back..."
psql "$DATABASE_URL" -c "UPDATE _prisma_migrations SET rolled_back_at = NOW() WHERE migration_name = '20251109134304_fix_environment_data_and_defaults' AND rolled_back_at IS NULL;"

echo ""
echo "Step 3: Pulling latest changes from dev branch..."
git fetch origin dev
git pull origin dev

echo ""
echo "Step 4: Regenerating Prisma Client..."
cd backend
npm run prisma:generate

echo ""
echo "Step 5: Applying migrations..."
npm run prisma:migrate:deploy

echo ""
echo "======================================"
echo "Migration fix completed successfully!"
echo "======================================"
echo ""
echo "Verifying the fix..."
psql "$DATABASE_URL" -c "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '20251109134304_fix_environment_data_and_defaults';"

echo ""
echo "Checking for invalid environment data..."
psql "$DATABASE_URL" -c "SELECT COUNT(*) as empty_object_count FROM \"PersonalEnvironment\" WHERE data = '{}';"
psql "$DATABASE_URL" -c "SELECT COUNT(*) as empty_string_count FROM \"PersonalEnvironment\" WHERE data = '';"

echo ""
echo "Done! The migration should now be applied successfully."
