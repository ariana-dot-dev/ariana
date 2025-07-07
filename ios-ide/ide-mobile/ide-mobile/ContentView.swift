//
//  ContentView.swift
//  ide-mobile
//
//  Created by Kirill on 7/7/25.
//

import SwiftUI

struct ContentView: View {
    @State private var inputText = ""
    @State private var currentRequest: String? = nil
    @State private var tasks: [Task] = []
    @State private var isLoading = false
    @State private var showingTasks = false
    @StateObject private var voiceInputManager = VoiceInputManager()
    @State private var showingMenu = false
    @State private var selectedChat = "Chat 1"
    @State private var chats = ["Chat 1", "Chat 2", "Chat 3"]
    
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
                        
                        Text(selectedChat)
                            .font(.headline)
                            .foregroundColor(.primary)
                        
                        Spacer()
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
                        selectedChat: $selectedChat,
                        chats: chats
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
    }
    
    private func handleSubmit() {
        guard !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        
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
    ContentView()
}
