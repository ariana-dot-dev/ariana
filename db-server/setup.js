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