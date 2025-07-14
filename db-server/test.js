#!/usr/bin/env node

import { db } from './database.js';

async function testGitRepositoryFunctions() {
  try {
    console.log('Testing Git Repository functions...');
    
    // First, let's get some existing users for testing
    const users = await db.getAllUsers();
    console.log(`Found ${users.length} users in database`);
    
    if (users.length === 0) {
      console.log('No users found. Creating a test user...');
      const testUser = await db.createOrUpdateUser(
        'test', 
        'test123', 
        {
          email: 'test@example.com',
          name: 'Test User',
          avatar_url: 'https://example.com/avatar.jpg'
        }
      );
      console.log('Created test user:', testUser);
      users.push(testUser);
    }
    
    const testUserId = users[0].id;
    console.log(`Using user ID: ${testUserId}`);
    
    // Test creating a git repository
    console.log('\n1. Testing createGitRepository...');
    const repo1 = await db.createGitRepository(testUserId, 'https://github.com/test/repo1.git');
    console.log('Created repository:', repo1);
    
    const repo2 = await db.createGitRepository(testUserId, 'https://github.com/test/repo2.git');
    console.log('Created repository:', repo2);
    
    // Test getting repositories by user ID
    console.log('\n2. Testing getGitRepositoriesByUserId...');
    const userRepos = await db.getGitRepositoriesByUserId(testUserId);
    console.log(`Found ${userRepos.length} repositories for user:`, userRepos);
    
    // Test getting repository by ID
    console.log('\n3. Testing getGitRepositoryById...');
    const repoById = await db.getGitRepositoryById(repo1.id);
    console.log('Repository by ID:', repoById);
    
    // Test updating repository access
    console.log('\n4. Testing updateGitRepositoryAccess...');
    const updatedRepo = await db.updateGitRepositoryAccess(repo1.id, false);
    console.log('Updated repository access:', updatedRepo);
    
    // Test getting repository stats
    console.log('\n5. Testing getGitRepositoryStats...');
    const repoStats = await db.getGitRepositoryStats();
    console.log('Repository stats:', repoStats);
    
    // Test getting users with repositories
    console.log('\n6. Testing getUsersWithRepositories...');
    const usersWithRepos = await db.getUsersWithRepositories();
    console.log('Users with repositories:', usersWithRepos);
    
    // Test deleting a repository
    console.log('\n7. Testing deleteGitRepository...');
    const deletedRepo = await db.deleteGitRepository(repo2.id);
    console.log('Deleted repository:', deletedRepo);
    
    console.log('\n✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testGitRepositoryFunctions();
}