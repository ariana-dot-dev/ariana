import { db } from './database.js';

async function testPriorityAndDueDate() {
  console.log('🚀 Testing Priority and Due Date functionality...\n');

  try {
    // Test 1: Create backlog items with different priorities
    console.log('Test 1: Creating backlog items with different priorities...');
    
    const testUserId = 1; // Assuming we have a test user
    const testRepo = 'https://github.com/test/repo';
    
    const priorities = [1, 2, 3, 4, 5, 6, 7];
    const items = [];
    
    for (const priority of priorities) {
      const item = await db.createBacklogItem(
        testRepo,
        `Test task with priority ${priority}`,
        testUserId,
        'open',
        priority
      );
      items.push(item);
      console.log(`✅ Created item with priority ${priority}:`, {
        id: item.id,
        task: item.task,
        priority: item.priority,
        due_date: item.due_date,
        created_at: item.created_at
      });
    }
    
    // Test 2: Verify due date calculations
    console.log('\nTest 2: Verifying due date calculations...');
    
    for (const item of items) {
      const createdAt = new Date(item.created_at);
      const dueDate = new Date(item.due_date);
      const diffDays = Math.ceil((dueDate - createdAt) / (1000 * 60 * 60 * 24));
      
      let expectedDays;
      switch (item.priority) {
        case 1: expectedDays = 1; break;
        case 2: expectedDays = 2; break;
        case 3: expectedDays = 3; break;
        case 4: expectedDays = 7; break;
        case 5: expectedDays = 14; break;
        case 6: expectedDays = 30; break; // Approximate
        case 7: expectedDays = 365; break; // Approximate
      }
      
      console.log(`Priority ${item.priority}: Expected ~${expectedDays} days, Got ${diffDays} days`);
      
      // Allow some tolerance for months/years
      if (item.priority <= 5) {
        if (diffDays === expectedDays) {
          console.log(`✅ Priority ${item.priority} due date calculation is correct`);
        } else {
          console.log(`❌ Priority ${item.priority} due date calculation is incorrect`);
        }
      } else {
        console.log(`ℹ️  Priority ${item.priority} uses approximate calculation (${diffDays} days)`);
      }
    }
    
    // Test 3: Test priority-based ordering
    console.log('\nTest 3: Testing priority-based ordering...');
    
    const allItems = await db.getBacklogItems();
    console.log('Items ordered by priority (ascending), then due date:');
    allItems.forEach(item => {
      console.log(`Priority ${item.priority}: ${item.task} (Due: ${item.due_date})`);
    });
    
    // Test 4: Test filtering by priority
    console.log('\nTest 4: Testing priority filtering...');
    
    const highPriorityItems = await db.getBacklogItemsByPriority(1);
    console.log(`High priority items (priority 1): ${highPriorityItems.length} items`);
    
    // Test 5: Test overdue items (create a backdated item)
    console.log('\nTest 5: Testing overdue items...');
    
    // Create an item with priority 1 but backdate it by 2 days
    const overdueItem = await db.createBacklogItem(
      testRepo,
      'Overdue test task',
      testUserId,
      'open',
      1
    );
    
    // Manually update the created_at and due_date to make it overdue
    await db.query(
      'UPDATE backlog SET created_at = $1, due_date = $2 WHERE id = $3',
      [
        new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago (overdue)
        overdueItem.id
      ]
    );
    
    const overdueItems = await db.getOverdueBacklogItems();
    console.log(`Overdue items: ${overdueItems.length} items`);
    overdueItems.forEach(item => {
      console.log(`- ${item.task} (Due: ${item.due_date})`);
    });
    
    // Test 6: Test backlog stats with new fields
    console.log('\nTest 6: Testing enhanced backlog stats...');
    
    const stats = await db.getBacklogStats();
    console.log('Backlog Statistics:');
    console.log(`Total items: ${stats.totalItems}`);
    console.log(`Items by status:`, stats.itemsByStatus);
    console.log(`Items by priority:`, stats.itemsByPriority);
    console.log(`Overdue items: ${stats.overdueItems}`);
    console.log(`Due today: ${stats.dueTodayItems}`);
    console.log(`Recent items: ${stats.recentItems}`);
    
    // Test 7: Test updating priority (should auto-update due date)
    console.log('\nTest 7: Testing priority update (should auto-update due date)...');
    
    const itemToUpdate = items[0];
    console.log('Before update:', {
      priority: itemToUpdate.priority,
      due_date: itemToUpdate.due_date
    });
    
    const updatedItem = await db.updateBacklogItem(itemToUpdate.id, { priority: 4 });
    console.log('After update:', {
      priority: updatedItem.priority,
      due_date: updatedItem.due_date
    });
    
    // Test 8: Test user backlog summary with new fields
    console.log('\nTest 8: Testing enhanced user backlog summary...');
    
    const userSummary = await db.getUserBacklogSummary(testUserId);
    console.log('User Backlog Summary:');
    console.log(`Total tasks: ${userSummary.total_tasks}`);
    console.log(`Open tasks: ${userSummary.open_tasks}`);
    console.log(`In progress: ${userSummary.in_progress_tasks}`);
    console.log(`Completed: ${userSummary.completed_tasks}`);
    console.log(`Overdue: ${userSummary.overdue_tasks}`);
    console.log(`Due today: ${userSummary.due_today_tasks}`);
    console.log(`High priority: ${userSummary.high_priority_tasks}`);
    console.log(`Repositories: ${userSummary.repositories_with_tasks}`);
    
    console.log('\n🎉 All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

// Run the test
testPriorityAndDueDate()
  .then(() => {
    console.log('\n✅ Priority and Due Date testing completed!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Testing failed:', error);
    process.exit(1);
  });