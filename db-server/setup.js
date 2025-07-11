#!/usr/bin/env node

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigrations() {
  try {
    console.log('Starting database setup...');
    
    // Run the complete schema first
    console.log('Creating tables from schema...');
    const schemaSQL = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    await db.query(schemaSQL);
    
    // Run individual migrations in order
    const migrations = [
      '001_create_git_repositories.sql',
      '002_create_backlog.sql', 
      '003_add_priority_and_due_date_to_backlog.sql',
      '004_add_repository_random_id.sql'
    ];
    
    console.log('Running migrations...');
    for (const migration of migrations) {
      try {
        console.log(`Running migration: ${migration}`);
        const migrationSQL = readFileSync(join(__dirname, 'migrations', migration), 'utf8');
        await db.query(migrationSQL);
        console.log(`✓ ${migration} completed`);
      } catch (error) {
        console.log(`⚠ ${migration} skipped (likely already applied): ${error.message}`);
      }
    }
    
    console.log('Database setup completed successfully!');
    
    // Show current stats
    const userStats = await db.getUserStats();
    const repoStats = await db.getGitRepositoryStats();
    
    console.log('Current database stats:');
    console.log('Users:', userStats);
    console.log('Repositories:', repoStats);
    
  } catch (error) {
    console.error('Error during database setup:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run migrations if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
}