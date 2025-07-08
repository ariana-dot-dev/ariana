//
//  RootView.swift
//  ide-mobile
//
//  Created by Claude on 7/8/25.
//

import SwiftUI

struct RootView: View {
    @State private var selectedProject: Project?
    @State private var showingProjectSelection = true
    
    var body: some View {
        if showingProjectSelection {
            ProjectSelectionView { project in
                selectedProject = project
                showingProjectSelection = false
            }
        } else {
            ChatView(project: selectedProject!) {
                // Back to project selection
                showingProjectSelection = true
                selectedProject = nil
            }
        }
    }
}

struct ChatView: View {
    let project: Project
    let onBackToProjects: () -> Void
    
    @State private var inputText = ""
    @State private var currentRequest: String? = nil
    @State private var tasks: [Task] = []
    @State private var isLoading = false
    @State private var showingTasks = false
    @StateObject private var voiceInputManager = VoiceInputManager()
    @State private var showingMenu = false
    @State private var selectedChatId: Int?
    @State private var chats: [AgentChat] = []
    @State private var isLoadingChats = true
    @State private var draftChat: AgentChat?
    @State private var isDraftMode = false
    
    private var selectedChatName: String {
        if isDraftMode, let draftChat = draftChat {
            return draftChat.name
        }
        if let selectedChatId = selectedChatId,
           let chat = chats.first(where: { $0.id == selectedChatId }) {
            return chat.name
        }
        return chats.first?.name ?? "No Chat"
    }
    
    private var allChats: [AgentChat] {
        var allChats = chats
        if let draftChat = draftChat {
            allChats.insert(draftChat, at: 0) // Add draft at the beginning
        }
        return allChats
    }
    
    var body: some View {
        NavigationView {
            ZStack {
                VStack(spacing: 0) {
                    HStack {
                        Button(action: {
                            showingMenu = true
                        }) {
                            Image(systemName: "line.horizontal.3")
                                .font(.system(size: 20))
                                .foregroundColor(.primary)
                                .padding(12)
                        }
                        
                        Spacer()
                        
                        Text(selectedChatName)
                            .font(.headline)
                            .foregroundColor(.primary)
                        
                        Spacer()
                        
                        // Invisible placeholder to balance the left menu button
                        Button(action: {}) {
                            Image(systemName: "line.horizontal.3")
                                .font(.system(size: 20))
                                .foregroundColor(.clear)
                                .padding(12)
                        }
                        .disabled(true)
                    }
                    .padding(.horizontal, 8)
                    .padding(.top, 8)
                    .background(Color(UIColor.systemBackground))
                    .shadow(color: .black.opacity(0.1), radius: 1, x: 0, y: 1)
                
                if let request = currentRequest {
                    VStack {
                        Text(request)
                            .font(.headline)
                            .multilineTextAlignment(.center)
                            .padding()
                        
                        if showingTasks {
                            TaskListView(tasks: tasks)
                        } else if isLoading {
                            ProgressView("Processing...")
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    Spacer()
                    VStack(spacing: 16) {
                        Image("app-icon")
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: 80, height: 80)
                            .opacity(0.5)
                        
                        Text("What do we vibecode today?")
                            .font(.title2)
                            .foregroundColor(.gray)
                        
                        Text("Project: \(project.name)")
                            .font(.caption)
                            .foregroundColor(.gray)
                    }
                    Spacer()
                }
                
                PromptInputView(
                    text: $inputText,
                    onSubmit: handleSubmit,
                    onVoiceInput: handleVoiceInput,
                    isRecording: voiceInputManager.isRecording
                )
                }
                
                if showingMenu {
                    ChatMenuView(
                        isPresented: $showingMenu,
                        selectedChatId: $selectedChatId,
                        chats: allChats,
                        isLoadingChats: isLoadingChats,
                        onBackToProjects: onBackToProjects,
                        onNewChat: createNewDraftChat,
                        project: project
                    )
                    .transition(.move(edge: .leading))
                    .animation(.easeInOut(duration: 0.3), value: showingMenu)
                }
            }
            .navigationBarHidden(true)
        }
        .onReceive(voiceInputManager.$transcribedText) { text in
            if !text.isEmpty && !voiceInputManager.isRecording {
                inputText = text
            }
        }
        .onAppear {
            loadChats()
        }
    }
    
    private func loadChats() {
        isLoadingChats = true
        
        BackendService.shared.fetchChats(for: project.id) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let fetchedChats):
                    self.chats = fetchedChats
                    // Select first chat by default if none selected
                    if self.selectedChatId == nil && !fetchedChats.isEmpty {
                        self.selectedChatId = fetchedChats.first?.id
                    }
                case .failure(let error):
                    print("Error loading chats: \(error)")
                    // Fallback to empty chats array
                    self.chats = []
                }
                self.isLoadingChats = false
            }
        }
    }
    
    private func createNewDraftChat() {
        // Create a draft chat with negative ID (local only)
        let draftChatId = -Int.random(in: 1...1000000)
        let newDraftChat = AgentChat(
            id: draftChatId,
            name: "New Chat",
            project_id: project.id,
            user_id: BackendService.currentUserId,
            status_id: 1,
            created_at: Date(),
            updated_at: Date()
        )
        
        draftChat = newDraftChat
        selectedChatId = draftChatId
        isDraftMode = true
        
        print("📝 Created draft chat: \(newDraftChat.name) with ID: \(draftChatId)")
    }
    
    private func handleSubmit() {
        guard !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        
        // If we're in draft mode, create the chat in the database first
        if isDraftMode, let draftChat = draftChat {
            createChatInDatabase(draftChat: draftChat, firstMessage: inputText)
            return
        }
        
        // Normal message submission
        currentRequest = inputText
        isLoading = true
        showingTasks = false
        
        BackendService.shared.submitRequest(inputText) { result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    pollForCompletion()
                case .failure(let error):
                    print("Error submitting request: \(error)")
                    isLoading = false
                }
            }
        }
        
        inputText = ""
    }
    
    private func createChatInDatabase(draftChat: AgentChat, firstMessage: String) {
        print("💾 Creating chat in database: \(draftChat.name)")
        
        BackendService.shared.createChat(name: draftChat.name, projectId: project.id) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let createdChat):
                    print("✅ Chat created in database with ID: \(createdChat.id)")
                    
                    // Replace draft with real chat
                    self.chats.append(createdChat)
                    self.selectedChatId = createdChat.id
                    self.draftChat = nil
                    self.isDraftMode = false
                    
                    // Now submit the first message
                    self.currentRequest = firstMessage
                    self.isLoading = true
                    self.showingTasks = false
                    
                    BackendService.shared.submitRequest(firstMessage) { messageResult in
                        DispatchQueue.main.async {
                            switch messageResult {
                            case .success:
                                self.pollForCompletion()
                            case .failure(let error):
                                print("Error submitting first message: \(error)")
                                self.isLoading = false
                            }
                        }
                    }
                    
                case .failure(let error):
                    print("❌ Error creating chat: \(error)")
                    // Keep in draft mode, show error to user
                    // TODO: Show error alert
                }
                
                self.inputText = ""
            }
        }
    }
    
    private func pollForCompletion() {
        BackendService.shared.pollForCompletion { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let isReady):
                    if isReady {
                        fetchTasks()
                    } else {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            pollForCompletion()
                        }
                    }
                case .failure(let error):
                    print("Error polling: \(error)")
                    isLoading = false
                }
            }
        }
    }
    
    private func fetchTasks() {
        BackendService.shared.fetchTasks { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let fetchedTasks):
                    self.tasks = fetchedTasks
                    self.isLoading = false
                    self.showingTasks = true
                case .failure(let error):
                    print("Error fetching tasks: \(error)")
                    self.isLoading = false
                }
            }
        }
    }
    
    private func handleVoiceInput() {
        if voiceInputManager.isRecording {
            voiceInputManager.stopRecording()
        } else {
            voiceInputManager.startRecording()
        }
    }
}

#Preview {
    RootView()
}