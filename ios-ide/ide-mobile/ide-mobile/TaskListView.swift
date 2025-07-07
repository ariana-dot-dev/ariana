import SwiftUI

struct TaskListView: View {
    let tasks: [Task]
    
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(tasks) { task in
                    TaskRowView(task: task)
                }
            }
            .padding()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct TaskRowView: View {
    let task: Task
    
    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(task.status.color)
                .frame(width: 12, height: 12)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(task.name)
                    .font(.headline)
                    .foregroundColor(.primary)
                
                if let description = task.description {
                    Text(description)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
                
                Text(task.status.displayName)
                    .font(.caption)
                    .foregroundColor(task.status.color)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(task.status.color.opacity(0.1))
                    .cornerRadius(4)
            }
            
            Spacer()
        }
        .padding()
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(12)
    }
}

#Preview {
    TaskListView(tasks: [
        Task(id: "1", name: "Initialize Project", status: .completed, description: "Setting up the project structure"),
        Task(id: "2", name: "API Integration", status: .inProgress, description: "Connecting to backend services"),
        Task(id: "3", name: "UI Polish", status: .pending, description: "Final touches on user interface"),
        Task(id: "4", name: "Testing", status: .failed, description: "Running comprehensive tests")
    ])
}