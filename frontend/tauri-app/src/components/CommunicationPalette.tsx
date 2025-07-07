import React, { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "../utils";
import { communicationService } from "../services/CommunicationService";
import { AgentCommandService } from "../services/AgentCommandService";

// Extend Window interface for Speech Recognition
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
    __TAURI__: any;
  }
}

interface CommunicationPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSend?: (message: string) => Promise<void>;
  isAudioEnabled?: boolean;
  audioAutoSendDelay?: number;
  provider?: string;
  model?: string;
  apiKey?: string;
  systemPrompt?: string;
}

// Check if we're running in Tauri
const isTauri = () => {
  return typeof window !== 'undefined' && window.__TAURI__;
};

// Microphone/Audio button component that handles both recording and audio toggle
const MicrophoneButton: React.FC<{
  isRecording: boolean;
  isAudioEnabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}> = ({ isRecording, isAudioEnabled, onToggle, disabled = false }) => {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "w-12 h-12 relative rounded-full transition-all duration-300 focus:outline-none",
        "flex items-center justify-center p-2",
        "bg-black border-2 border-gray-400",
        "hover:border-gray-300 hover:shadow-md",
        "shadow-sm",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        isRecording ? "border-red-400 shadow-red-400/25" : "",
        isAudioEnabled ? "shadow-md" : "shadow-sm opacity-75"
      )}
      title={disabled ? 'Speech recognition not available' : 
        isAudioEnabled ? 'Audio ON - Click to turn off' : 'Audio OFF - Click to turn on and start recording'
      }
    >
      {isRecording ? (
        <svg
          className="w-5 h-5 text-red-400"
          fill="currentColor"
          viewBox="0 0 16 16"
        >
          <path d="M5.5 3.5A1.5 1.5 0 0 1 7 2h2a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 9 14H7a1.5 1.5 0 0 1-1.5-1.5z"/>
        </svg>
      ) : (
        <svg
          className={cn(
            "w-5 h-5 transition-colors",
            isAudioEnabled ? "text-white" : "text-gray-500"
          )}
          fill="currentColor"
          viewBox="0 0 16 16"
        >
          <path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5"/>
          <path d="M10 8a2 2 0 1 1-4 0V3a2 2 0 1 1 4 0zM8 0a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V3a3 3 0 0 0-3-3"/>
        </svg>
      )}

      {isRecording && (
        <div className="absolute inset-0 rounded-full border-2 border-red-400 animate-pulse" />
      )}
    </button>
  );
};

export const CommunicationPalette: React.FC<CommunicationPaletteProps> = ({
  isOpen,
  onClose,
  onSend,
  isAudioEnabled = false,
  audioAutoSendDelay = 2500,
  provider = "anthropic",
  model = "claude-3-5-sonnet-20241022",
  apiKey = "",
  systemPrompt = "You are a helpful assistant.",
}) => {
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [audioTimeout, setAudioTimeout] = useState<NodeJS.Timeout | null>(null);
  const [response, setResponse] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentCommandService] = useState(() => new AgentCommandService());
  const [audioEnabledState, setAudioEnabledState] = useState(isAudioEnabled);
  
  // Speech recognition state
  const [isRecording, setIsRecording] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(true);
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown');
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSpeechTimeRef = useRef<number>(0);

  // Check browser support and permissions on mount
  useEffect(() => {
    const tauriDetected = isTauri();
    setIsTauriEnv(tauriDetected);
    
    console.log('Environment detection:', {
      isTauri: tauriDetected,
      hasMediaDevices: !!navigator.mediaDevices,
      hasGetUserMedia: !!(navigator.mediaDevices?.getUserMedia),
      hasSpeechRecognition: !!(window.SpeechRecognition || window.webkitSpeechRecognition)
    });

    const checkSupport = () => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setIsSupported(false);
        setSpeechError('Speech recognition is not supported in this browser. Try Chrome, Edge, or Safari.');
        return;
      }

      // In Tauri, we can still use Speech Recognition even without mediaDevices
      if (tauriDetected) {
        console.log('✅ Tauri environment detected - Speech recognition available without mediaDevices');
        setIsSupported(true);
        setPermissionStatus('granted'); // Assume granted in Tauri
        return;
      }

      // Check if we're in a secure context (HTTPS or localhost) for web browsers
      if (!window.isSecureContext) {
        setSpeechError('Speech recognition requires a secure context (HTTPS or localhost)');
        return;
      }

      console.log('Speech recognition is supported');
    };

    const checkPermissions = async () => {
      // Skip permission check in Tauri environment
      if (tauriDetected) {
        setPermissionStatus('granted');
        return;
      }

      try {
        if (navigator.permissions) {
          const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          setPermissionStatus(permission.state);
          console.log('Microphone permission status:', permission.state);
          
          permission.addEventListener('change', () => {
            setPermissionStatus(permission.state);
            console.log('Microphone permission changed to:', permission.state);
          });
        }
      } catch (error) {
        console.log('Could not check microphone permissions:', error);
      }
    };

    checkSupport();
    checkPermissions();
  }, []);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (audioEnabledState && message.trim() && !isLoading && !isStreaming) {
      if (audioTimeout) {
        clearTimeout(audioTimeout);
      }
      
      const timeout = setTimeout(() => {
        handleSend();
      }, audioAutoSendDelay);
      
      setAudioTimeout(timeout);
    }
    
    return () => {
      if (audioTimeout) {
        clearTimeout(audioTimeout);
      }
    };
  }, [message, audioEnabledState, audioAutoSendDelay, isLoading, isStreaming]);

  const startRecording = useCallback(async () => {
    // Prevent multiple simultaneous starts
    if (isRecording) {
      return;
    }
    
    setSpeechError(null);
    
    try {
      // Always request microphone permission to trigger macOS dialog
      console.log('Requesting microphone access...');
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: 44100,
              channelCount: 1
            } 
          });
          console.log('✅ Microphone access granted');
          console.log('Stream details:', {
            active: stream.active,
            tracks: stream.getTracks().length,
            trackSettings: stream.getTracks()[0]?.getSettings()
          });
          
          // Stop the stream immediately as we only needed it for permission
          stream.getTracks().forEach(track => track.stop());
        } catch (mediaError: any) {
          console.warn('⚠️ MediaDevices permission failed:', mediaError);
          console.warn('Error name:', mediaError.name);
          console.warn('Error message:', mediaError.message);
          
          if (!isTauriEnv) {
            // In web browsers, this is a hard error
            throw mediaError;
          }
          // In Tauri, we can continue without mediaDevices
          console.log('🏗️ Continuing in Tauri environment without mediaDevices');
        }
      } else {
        console.log('📱 MediaDevices API not available');
        if (!isTauriEnv) {
          throw new Error('MediaDevices API not available');
        }
      }
      
      // Initialize Speech Recognition
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        throw new Error('Speech recognition not supported');
      }

      console.log('🎯 Creating speech recognition instance...');
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      console.log('🎯 Speech recognition configured with:', {
        continuous: recognition.continuous,
        interimResults: recognition.interimResults,
        lang: recognition.lang,
        maxAlternatives: recognition.maxAlternatives
      });

      recognition.onstart = () => {
        console.log('🎤 Speech recognition started successfully');
        setIsRecording(true);
        setSpeechError(null);
      };

      recognition.onresult = (event: any) => {
        console.log('📝 Speech recognition result event:', {
          resultIndex: event.resultIndex,
          resultsLength: event.results.length
        });
        
        // Update last speech time
        lastSpeechTimeRef.current = Date.now();
        
        // Clear existing silence timeout
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }
        
        let finalTranscript = '';
        let interimText = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          const confidence = event.results[i][0].confidence;
          
          console.log(`Result ${i}: "${transcript}" (confidence: ${confidence}, final: ${event.results[i].isFinal})`);
          
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimText += transcript;
          }
        }
        
        if (finalTranscript) {
          console.log('✅ Final transcript:', finalTranscript);
          setMessage(prev => prev + finalTranscript);
          setInterimTranscript('');
        } else if (interimText) {
          console.log('⏳ Interim transcript:', interimText);
          setInterimTranscript(interimText);
        }
        
        // Set timeout for auto-send after 2 seconds of silence
        silenceTimeoutRef.current = setTimeout(async () => {
          // Get the current message state at the time of timeout
          setMessage(currentMessage => {
            if (currentMessage.trim()) {
              console.log('🔄 Auto-sending after 2 seconds of silence:', currentMessage);
              // Auto-send the message
              setTimeout(() => handleSend(), 100);
            }
            return currentMessage; // Return unchanged for this setter
          });
        }, 2000);
      };

      recognition.onend = () => {
        console.log('🛑 Speech recognition ended');
        setIsRecording(false);
        setInterimTranscript('');
        
        // Auto-restart if we were recording and it ended unexpectedly
        if (recognitionRef.current === recognition && isRecording) {
          console.log('🔄 Speech recognition ended unexpectedly, restarting...');
          setTimeout(() => {
            if (recognitionRef.current === recognition) {
              try {
                recognition.start();
                console.log('✅ Speech recognition restarted');
              } catch (restartError) {
                console.error('❌ Failed to restart recognition:', restartError);
                setSpeechError('Speech recognition stopped unexpectedly and could not restart');
              }
            }
          }, 100);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('❌ Speech recognition error:', event.error, event);
        console.error('Full error event:', {
          error: event.error,
          message: event.message,
          timeStamp: event.timeStamp
        });
        
        let errorMessage = 'Speech recognition error: ';
        
        switch (event.error) {
          case 'no-speech':
            errorMessage += 'No speech detected. The microphone is working but no speech was heard. Try speaking louder or closer to the microphone.';
            // Don't stop recording for no-speech, it will auto-restart
            return;
          case 'audio-capture':
            errorMessage += 'Audio capture failed. Please check:\n';
            errorMessage += '• Microphone permissions in System Settings → Privacy & Security → Microphone\n';
            errorMessage += '• Microphone is not being used by another app\n';
            errorMessage += '• Microphone hardware is working properly';
            break;
          case 'not-allowed':
            errorMessage += 'Speech recognition access denied. This might be due to:\n';
            errorMessage += '1. Microphone permissions not granted\n';
            errorMessage += '2. Speech recognition blocked by browser/system\n';
            errorMessage += '3. App not trusted by macOS\n\n';
            errorMessage += 'Try: System Settings → Privacy & Security → Microphone → Enable "ariana IDE"';
            break;
          case 'network':
            errorMessage += 'Network error. Speech recognition requires an internet connection. Please check your connection and try again.';
            break;
          case 'service-not-allowed':
            errorMessage += 'Speech service not allowed. This might be due to:\n';
            errorMessage += '• Speech recognition disabled in browser settings\n';
            errorMessage += '• System-level speech recognition permissions\n';
            errorMessage += '• Try: System Settings → Privacy & Security → Speech Recognition';
            break;
          case 'aborted':
            errorMessage += 'Speech recognition was aborted. This usually means no speech was detected for a while. The microphone is working, but try:\n';
            errorMessage += '• Speaking more clearly and loudly\n';
            errorMessage += '• Moving closer to the microphone\n';
            errorMessage += '• Checking microphone volume in system settings';
            break;
          default:
            errorMessage += `${event.error} (see console for details)`;
        }
        
        setSpeechError(errorMessage);
        setIsRecording(false);
        setInterimTranscript('');
      };

      recognitionRef.current = recognition;
      console.log('🚀 Starting speech recognition...');
      
      // Add a small delay to ensure everything is ready
      setTimeout(() => {
        try {
          recognition.start();
          console.log('✅ Speech recognition start() called');
        } catch (startError: any) {
          console.error('❌ Failed to start recognition:', startError);
          setSpeechError(`Failed to start speech recognition: ${startError.message}`);
          setIsRecording(false);
        }
      }, 100);
      
    } catch (error: any) {
      console.error('❌ Failed to start recording:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      
      let errorMessage = 'Failed to start recording: ';
      
      if (error.name === 'NotAllowedError') {
        errorMessage += 'Microphone access denied. Please:\n';
        errorMessage += '1. Go to System Settings → Privacy & Security → Microphone\n';
        errorMessage += '2. Enable "ariana IDE"\n';
        errorMessage += '3. Restart the app';
      } else if (error.name === 'NotFoundError') {
        errorMessage += 'No microphone found. Please connect a microphone and try again.';
      } else if (error.name === 'NotSupportedError') {
        errorMessage += 'Your browser does not support microphone access.';
      } else if (error.message === 'MediaDevices API not available') {
        errorMessage += 'MediaDevices API not available in this browser.';
      } else {
        errorMessage += error.message || 'Unknown error occurred.';
      }
      
      setSpeechError(errorMessage);
      setIsRecording(false);
    }
  }, [isTauriEnv, isRecording]);

  const stopRecording = useCallback(() => {
    console.log('🛑 Stopping recording...');
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    
    // Clear silence timeout when stopping
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    
    setIsRecording(false);
    setInterimTranscript('');
  }, []);

  const handleToggleRecording = useCallback(() => {
    // Simple 2-state logic: OFF -> ON (with recording) -> OFF
    if (audioEnabledState) {
      // Audio is ON, turn it OFF (stop recording and disable audio)
      if (isRecording) {
        stopRecording();
      }
      setAudioEnabledState(false);
      if (audioTimeout) {
        clearTimeout(audioTimeout);
        setAudioTimeout(null);
      }
    } else {
      // Audio is OFF, turn it ON (enable audio and start recording)
      setAudioEnabledState(true);
      if (audioTimeout) {
        clearTimeout(audioTimeout);
        setAudioTimeout(null);
      }
      // Start recording immediately after enabling audio
      setTimeout(() => {
        startRecording();
      }, 100);
    }
  }, [audioEnabledState, isRecording, audioTimeout, stopRecording, startRecording]);

  const handleApiSend = useCallback(async (messageText: string) => {
    if (!apiKey.trim()) {
      throw new Error("API key is required");
    }

    const request = communicationService.createBasicRequest(
      provider,
      model,
      messageText,
      apiKey,
      systemPrompt
    );

    setIsStreaming(true);
    setResponse("");
    
    try {
      for await (const chunk of communicationService.sendMessageStream(request)) {
        setResponse(prev => prev + chunk.delta);
        if (chunk.done) break;
      }
    } finally {
      setIsStreaming(false);
    }
  }, [provider, model, apiKey, systemPrompt]);

  const handleAskClaude = useCallback(async (messageText: string) => {
    setIsLoading(true);
    setResponse("");
    
    try {
      const result = await communicationService.askClaude(messageText);
      setResponse(result.content);
    } catch (error) {
      console.error("Failed to ask Claude:", error);
      setResponse(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSend = async () => {
    if (!message.trim() || isLoading || isStreaming) return;
    
    setIsLoading(true);
    try {
      if (onSend) {
        await onSend(message.trim());
      } else {
        await handleApiSend(message.trim());
      }
      setMessage("");
      setInterimTranscript("");
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAsk = async () => {
    if (!message.trim() || isLoading || isStreaming) return;
    
    try {
      await handleAskClaude(message.trim());
      setMessage("");
      setInterimTranscript("");
    } catch (error) {
      console.error("Failed to ask Claude:", error);
    }
  };

  const handleParseToJson = async () => {
    if (!message.trim() || isLoading || isStreaming) return;
    
    setIsLoading(true);
    setResponse("");
    
    try {
      // Use LLM to parse natural language into JSON commands
      const systemPrompt = `You are an intelligent command parser for an AI development environment. Parse the following natural language input into structured JSON commands.

Available Commands:
- create_agent: Creates a new AI agent
- prompt_agent: Sends a prompt to a specific agent  
- merge_agent: Merges agent work/output
- list_agents: Lists all available agents
- delete_agent: Deletes a specific agent

Instructions:
1. Identify the user's intent from the natural language input
2. Map the intent to appropriate command(s) from the available commands
3. Extract relevant parameters and arguments from the input
4. For agent creation with tasks, generate a suitable agent name and include the task as a "prompt" argument
5. Be flexible with pattern matching and understand variations in wording
6. Handle compound commands (multiple actions in one input)

Input: "${message.trim()}"

Expected output format (return ONLY the JSON array, no other text):
[
  {"command": "command_id", "args": {"param1": "value1", "param2": "value2"}}
]

Examples:
- "create agent that writes hello world" -> [{"command": "create_agent", "args": {"agentName": "HelloWorldWriter", "prompt": "write hello world"}}]
- "create an agent that parses a file into multiple files" -> [{"command": "create_agent", "args": {"agentName": "FileParser", "prompt": "parse a file into multiple files"}}]
- "ask MyAgent to fix bugs" -> [{"command": "prompt_agent", "args": {"agentName": "MyAgent", "prompt": "fix bugs"}}]
- "list all agents" -> [{"command": "list_agents", "args": {}}]
- "delete agent TestAgent" -> [{"command": "delete_agent", "args": {"agentName": "TestAgent"}}]

Return only the JSON array, no other text.`;

      const response = await communicationService.askClaude(systemPrompt);
      
      // Try to parse the response as JSON
      const responseText = response.content.trim();
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      
      if (jsonMatch) {
        const parsedCommands = JSON.parse(jsonMatch[0]);
        const jsonResult = JSON.stringify(parsedCommands, null, 2);
        setResponse(jsonResult);
      } else {
        setResponse(`Error: Could not parse LLM response as JSON. Response: ${responseText}`);
      }
      
      setMessage("");
      setInterimTranscript("");
    } catch (error) {
      console.error("Failed to parse to JSON:", error);
      setResponse(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsStreaming(false);
    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Only allow editing if not currently recording
    if (!isRecording) {
      setMessage(e.target.value);
      setInterimTranscript('');
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  const displayText = message + (interimTranscript ? ` ${interimTranscript}` : '');

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
      <div className="bg-[var(--base-100)] rounded-lg shadow-xl w-[600px] max-w-[90vw] max-h-[80vh] p-4 border border-[var(--acc-400)] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg  text-[var(--blackest)]">
            Communication Palette
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--base-600)] hover:text-[var(--blackest)] transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col space-y-4">
          {/* Speech Error Display */}
          {speechError && (
            <div className="p-3 bg-red-500/20 border border-red-300/40 rounded text-sm text-red-700">
              <pre className="whitespace-pre-wrap">{speechError}</pre>
            </div>
          )}

          {/* Permission Status */}
          {!isTauriEnv && permissionStatus === 'denied' && (
            <div className="p-3 bg-yellow-500/20 border border-yellow-300/40 rounded text-sm text-yellow-700">
              Microphone access denied. Please enable it in your browser settings.
            </div>
          )}

          <div className="relative">
            <textarea
              ref={textareaRef}
              value={displayText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type your message or use voice input..."
              className={cn(
                "w-full h-32 p-3 rounded-md border border-[var(--acc-400)] bg-[var(--base-200)] text-[var(--blackest)] placeholder-[var(--base-500)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--acc-500)]",
                "font-mono text-sm",
                isRecording && "cursor-not-allowed"
              )}
              disabled={isLoading || isStreaming}
              readOnly={isRecording}
            />
            {audioEnabledState && message.trim() && !isLoading && !isStreaming && (
              <div className="absolute bottom-2 right-2 flex items-center gap-2">
                <div className="animate-pulse w-2 h-2 bg-red-500 rounded-full"></div>
                <span className="text-xs text-[var(--base-600)]">
                  Auto-send in {Math.ceil(audioAutoSendDelay / 1000)}s
                </span>
              </div>
            )}
          </div>

          {response && (
            <div className="flex-1 overflow-auto">
              <div className="text-sm text-[var(--base-600)] mb-2">
                Response:
                {!apiKey && (
                  <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                    Via Claude CLI
                  </span>
                )}
              </div>
              <div className="p-3 rounded-md bg-[var(--base-200)] border border-[var(--acc-400)] overflow-auto max-h-64">
                <pre className="whitespace-pre-wrap font-mono text-sm text-[var(--blackest)]">
                  {response}
                  {isStreaming && <span className="animate-pulse">|</span>}
                </pre>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 p-2">
              {/* Merged Audio/Recording Button */}
              <MicrophoneButton
                isRecording={isRecording}
                isAudioEnabled={audioEnabledState}
                onToggle={handleToggleRecording}
                disabled={!isSupported || (!isTauriEnv && permissionStatus === 'denied')}
              />
              
              {isRecording && (
                <span className="text-xs text-red-500 animate-pulse">
                  Recording...
                </span>
              )}
              
              {!apiKey && (
                <span className="text-xs text-red-500">
                  API key required
                </span>
              )}
            </div>

            <div className="flex gap-2">
              {isStreaming && (
                <button
                  onClick={handleStop}
                  className="px-4 py-2 rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                >
                  Stop
                </button>
              )}
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-md bg-[var(--base-400)] text-[var(--base-600)] hover:bg-[var(--base-500)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleParseToJson}
                disabled={!message.trim() || isLoading || isStreaming}
                className={cn(
                  "px-4 py-2 rounded-md transition-colors",
                  !message.trim() || isLoading || isStreaming
                    ? "bg-[var(--base-400)] text-[var(--base-600)] cursor-not-allowed"
                    : "bg-green-500 text-white hover:bg-green-600"
                )}
                title="Parse input to JSON commands without executing"
              >
                {isLoading ? "Parsing..." : "Parse JSON"}
              </button>
              <button
                onClick={handleAsk}
                disabled={!message.trim() || isLoading || isStreaming}
                className={cn(
                  "px-4 py-2 rounded-md transition-colors",
                  !message.trim() || isLoading || isStreaming
                    ? "bg-[var(--base-400)] text-[var(--base-600)] cursor-not-allowed"
                    : "bg-blue-500 text-white hover:bg-blue-600"
                )}
                title="Ask Claude using local CLI (no API key required)"
              >
                {isLoading ? "Asking..." : "Ask"}
              </button>
              <button
                onClick={handleSend}
                disabled={!message.trim() || isLoading || isStreaming || !apiKey}
                className={cn(
                  "px-4 py-2 rounded-md transition-colors",
                  !message.trim() || isLoading || isStreaming || !apiKey
                    ? "bg-[var(--base-400)] text-[var(--base-600)] cursor-not-allowed"
                    : "bg-[var(--acc-500)] text-white hover:bg-[var(--acc-600)]"
                )}
              >
                {isLoading ? "Sending..." : isStreaming ? "Streaming..." : "Send"}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};