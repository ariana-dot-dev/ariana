import SwiftUI

struct PromptInputView: View {
    @Binding var text: String
    let onSubmit: () -> Void
    let onVoiceInput: () -> Void
    let isRecording: Bool
    
    var body: some View {
        VStack(spacing: 12) {
            HStack {
                TextField("make me build something...", text: $text, axis: .vertical)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                    .lineLimit(1...6)
                    .onSubmit {
                        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            onSubmit()
                        }
                    }
            }
            .padding(.horizontal)
            
            HStack(spacing: 8) {
                Spacer()
                
                Button(action: onVoiceInput) {
                    Image(systemName: isRecording ? "mic.fill" : "mic.fill")
                        .font(.system(size: 20))
                        .foregroundColor(isRecording ? .red : .blue)
                        .scaleEffect(isRecording ? 1.2 : 1.0)
                        .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: isRecording)
                }
                .padding(.vertical, 8)
                .padding(.horizontal, 12)
                .background((isRecording ? Color.red : Color.blue).opacity(0.1))
                .cornerRadius(8)
                
                Button(action: onSubmit) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 20))
                        .foregroundColor(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .gray : .blue)
                }
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .padding(.vertical, 8)
                .padding(.horizontal, 12)
                .background((text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Color.gray : Color.blue).opacity(0.1))
                .cornerRadius(8)
            }
            .padding(.horizontal)
        }
        .padding(.bottom, 8)
        .background(Color(UIColor.systemBackground))
        .shadow(color: .black.opacity(0.1), radius: 1, x: 0, y: -1)
    }
}

#Preview {
    PromptInputView(
        text: .constant(""),
        onSubmit: {},
        onVoiceInput: {},
        isRecording: false
    )
}
