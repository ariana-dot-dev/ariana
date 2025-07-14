#!/usr/bin/env node

import { db } from './database.js';

async function testBacklogFunctions() {
  try {
    console.log('Testing Backlog functions...');
    
    // First, let's get some existing users for testing
    const users = await db.getAllUsers();
    console.log(`Found ${users.length} users in database`);
    
    if (users.length === 0) {
      console.log('No users found. Creating a test user...');
      const testUser = await db.createOrUpdateUser(
        'test', 
        'backlog-test', 
        {
          email: 'backlog-test@example.com',
          name: 'Backlog Test User',
          avatar_url: 'https://example.com/avatar.jpg'
        }
      );
      console.log('Created test user:', testUser);
      users.push(testUser);
    }
    
    const testUserId = users[0].id;
    console.log(`Using user ID: ${testUserId}`);
    
    // Test creating backlog items
    console.log('\n1. Testing createBacklogItem...');
    const item1 = await db.createBacklogItem(
      'https://github.com/test/repo1.git',
      'Implement user authentication',
      testUserId,
      'open'
    );
    console.log('Created backlog item 1:', item1);
    
    const item2 = await db.createBacklogItem(
      'https://github.com/test/repo1.git',
      'Add database migrations',
      testUserId,
      'in_progress'
    );
    console.log('Created backlog item 2:', item2);
    
    const item3 = await db.createBacklogItem(
      'https://github.com/test/repo2.git',
      'Setup CI/CD pipeline',
      testUserId,
      'completed'
    );
    console.log('Created backlog item 3:', item3);
    
    // Test getting all backlog items
    console.log('\n2. Testing getBacklogItems (all)...');
    const allItems = await db.getBacklogItems();
    console.log(`Found ${allItems.length} backlog items:`, allItems);
    
    // Test getting backlog items with filters
    console.log('\n3. Testing getBacklogItems with filters...');
    const openItems = await db.getBacklogItems({ status: 'open' });
    console.log(`Found ${openItems.length} open items:`, openItems.map(i => i.task));
    
    const repo1Items = await db.getBacklogItems({ gitRepositoryUrl: 'https://github.com/test/repo1.git' });
    console.log(`Found ${repo1Items.length} items for repo1:`, repo1Items.map(i => i.task));
    
    // Test getting backlog item by ID
    console.log('\n4. Testing getBacklogItemById...');
    const itemById = await db.getBacklogItemById(item1.id);
    console.log('Item by ID:', itemById);
    
    // Test updating backlog item
    console.log('\n5. Testing updateBacklogItem...');
    const updatedItem = await db.updateBacklogItem(item1.id, {
      status: 'in_progress',
      task: 'Implement user authentication with OAuth'
    });
    console.log('Updated item:', updatedItem);
    
    // Test getting backlog statistics
    console.log('\n6. Testing getBacklogStats...');
    const stats = await db.getBacklogStats();
    console.log('Backlog stats:', stats);
    
    // Test getting backlog by repository
    console.log('\n7. Testing getBacklogByRepository...');
    const repoItems = await db.getBacklogByRepository('https://github.com/test/repo1.git');
    console.log('Items for repo1:', repoItems);
    
    // Test getting user backlog summary
    console.log('\n8. Testing getUserBacklogSummary...');
    const userSummary = await db.getUserBacklogSummary(testUserId);
    console.log('User summary:', userSummary);
    
    // Test deleting a backlog item
    console.log('\n9. Testing deleteBacklogItem...');
    const deletedItem = await db.deleteBacklogItem(item3.id);
    console.log('Deleted item:', deletedItem);
    
    // Final stats check
    console.log('\n10. Final stats check...');
    const finalStats = await db.getBacklogStats();
    console.log('Final stats:', finalStats);
    
    console.log('\n✅ All backlog tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Backlog test failed:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testBacklogFunctions();
}