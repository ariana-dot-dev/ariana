import SwiftUI

struct ChatMenuView: View {
    @Binding var isPresented: Bool
    @Binding var selectedChatId: Int?
    let chats: [AgentChat]
    let isLoadingChats: Bool
    let onBackToProjects: (() -> Void)?
    let onNewChat: (() -> Void)?
    let project: Project?
    
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 20) {
                    HStack {
                        if let project = project {
                            Text(project.emoji)
                                .font(.title2)
                            Text(project.name)
                                .font(.title2)
                                .fontWeight(.bold)
                        } else {
                            Text("Chats")
                                .font(.title2)
                                .fontWeight(.bold)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 20)
                    
                    // Back to Projects button
                    if let onBackToProjects = onBackToProjects {
                        Button(action: {
                            onBackToProjects()
                            isPresented = false
                        }) {
                            HStack {
                                Image(systemName: "arrow.left.circle.fill")
                                    .foregroundColor(.gray)
                                Text("Open Project")
                                    .foregroundColor(.primary)
                                Spacer()
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(Color.gray.opacity(0.1))
                            .cornerRadius(8)
                        }
                        .padding(.horizontal, 20)
                    }
                    
                    VStack(alignment: .leading, spacing: 8) {
                        if isLoadingChats {
                            HStack {
                                ProgressView()
                                    .scaleEffect(0.8)
                                Text("Loading chats...")
                                    .foregroundColor(.gray)
                                    .font(.caption)
                                Spacer()
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                        } else if chats.isEmpty {
                            HStack {
                                Image(systemName: "message.circle")
                                    .foregroundColor(.gray)
                                Text("No chats available")
                                    .foregroundColor(.gray)
                                    .font(.caption)
                                Spacer()
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                        } else {
                            ForEach(chats) { chat in
                                Button(action: {
                                    selectedChatId = chat.id
                                    isPresented = false
                                }) {
                                    HStack {
                                        Image(systemName: "message.circle.fill")
                                            .foregroundColor(.blue)
                                        Text(chat.name)
                                            .foregroundColor(.primary)
                                        Spacer()
                                        if selectedChatId == chat.id {
                                            Image(systemName: "checkmark")
                                                .foregroundColor(.blue)
                                        }
                                    }
                                    .padding(.horizontal, 20)
                                    .padding(.vertical, 12)
                                    .background(selectedChatId == chat.id ? Color.blue.opacity(0.1) : Color.clear)
                                }
                            }
                        }
                        
                        Button(action: {
                            onNewChat?()
                            isPresented = false
                        }) {
                            HStack {
                                Image(systemName: "plus.circle.fill")
                                    .foregroundColor(.green)
                                Text("New Chat")
                                    .foregroundColor(.primary)
                                Spacer()
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                        }
                    }
                }
                .padding(.top, 50)
                
                Spacer()
            }
            .frame(width: 280)
            .background(Color(UIColor.systemBackground))
            .shadow(color: .black.opacity(0.1), radius: 5, x: 2, y: 0)
            
            Spacer()
        }
        .background(Color.black.opacity(0.3))
        .edgesIgnoringSafeArea(.all)
        .onTapGesture {
            isPresented = false
        }
    }
}

#Preview {
    ChatMenuView(
        isPresented: .constant(true),
        selectedChatId: .constant(1),
        chats: [
            AgentChat(id: 1, name: "Development Chat", project_id: 1, user_id: 1, status_id: 1, created_at: Date(), updated_at: Date()),
            AgentChat(id: 2, name: "Bug Fixes", project_id: 1, user_id: 1, status_id: 1, created_at: Date(), updated_at: Date()),
            AgentChat(id: 3, name: "Feature Planning", project_id: 1, user_id: 1, status_id: 1, created_at: Date(), updated_at: Date())
        ],
        isLoadingChats: false,
        onBackToProjects: {
            print("Back to projects tapped")
        },
        onNewChat: {
            print("New chat tapped")
        },
        project: Project(id: 1, name: "Test Project", description: "A test project", user_owner_id: 1, created_at: Date(), updated_at: Date())
    )
}