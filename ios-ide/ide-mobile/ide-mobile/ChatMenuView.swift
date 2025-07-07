import SwiftUI

struct ChatMenuView: View {
    @Binding var isPresented: Bool
    @Binding var selectedChat: String
    let chats: [String]
    
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Chats")
                        .font(.title2)
                        .fontWeight(.bold)
                        .padding(.horizontal, 20)
                        .padding(.top, 20)
                    
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(chats, id: \.self) { chat in
                            Button(action: {
                                selectedChat = chat
                                isPresented = false
                            }) {
                                HStack {
                                    Image(systemName: "message.circle.fill")
                                        .foregroundColor(.blue)
                                    Text(chat)
                                        .foregroundColor(.primary)
                                    Spacer()
                                    if selectedChat == chat {
                                        Image(systemName: "checkmark")
                                            .foregroundColor(.blue)
                                    }
                                }
                                .padding(.horizontal, 20)
                                .padding(.vertical, 12)
                                .background(selectedChat == chat ? Color.blue.opacity(0.1) : Color.clear)
                            }
                        }
                        
                        Button(action: {
                            // Add new chat functionality
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
        selectedChat: .constant("Chat 1"),
        chats: ["Chat 1", "Chat 2", "Chat 3"]
    )
}