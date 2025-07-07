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
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
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
                    Text("What can I help you with?")
                        .font(.title2)
                        .foregroundColor(.gray)
                    Spacer()
                }
                
                PromptInputView(
                    text: $inputText,
                    onSubmit: handleSubmit,
                    onVoiceInput: handleVoiceInput,
                    isRecording: voiceInputManager.isRecording
                )
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
