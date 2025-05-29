/**
 * Modern Gemini Telegram Client with enhanced mobile compatibility and error handling
 * Version: 3.2.0 (Integrates AdvancedAudioRecorder for input)
 */
import { AdvancedAudioRecorder } from './advanced_audio_recorder.js';

class GeminiTelegramClient {
    constructor(options = {}) {
        // Initialize config first, as this.log depends on it.
        this.config = {
            debug: true,
            reconnectAttempts: 3,
            reconnectDelay: 2000,
            sessionTimeout: 45000,
            // vadSilenceThreshold and vadRequiredSilenceDuration are for TelegramAudioBridge,
            // AdvancedAudioRecorder doesn't use them directly in this client.
            healthCheckInterval: 30000,
            connectionRetryDelay: 1000,
            audioFeedbackEnabled: true, // For playback
        };
        
        this.log(`[Client v3.2.0] Constructor called with options:`, false, options);
        
        try {
            this.options = options;
            this.state = {
                sessionToken: null,
                sessionConfig: null,
                isConnectedToWebSocket: false,
                isGeminiSessionActive: false,
                isInitialized: false,
                isInitializing: false,
                isConnecting: false,
                isConversationPaused: true, // User mic starts paused
                ws: null,
                reconnectCount: 0,
                reconnectTimer: null,
                sessionInitTimer: null,
                healthCheckTimer: null,
                lastActivity: Date.now(),
                connectionAttempts: 0,
                maxConnectionAttempts: 5,
                permissionState: 'unknown', // 'unknown', 'prompt', 'granted', 'denied'
                transcriptions: { input: '', output: '' },
                aiPlayedAudioThisTurn: false // To track if AI audio was played in the current turn
            };
            
            this.advancedRecorder = null;
            this.audioBridgeForPlayback = null; // For playing AI responses

            this.initialize();
            
        } catch (error) {
            this.handleCriticalError('Client Constructor failed', error);
        }
    }
    
    async initialize() {
        if (this.state.isInitializing || this.state.isInitialized) return;
        this.state.isInitializing = true;
        this.log('Starting client initialization with AdvancedAudioRecorder...');
        
        try {
            // Initialize AdvancedAudioRecorder for input
            if (typeof AdvancedAudioRecorder === 'undefined') {
                throw new Error('AdvancedAudioRecorder is not available. Make sure it is imported from ./advanced_audio_recorder.js');
            }
            this.advancedRecorder = new AdvancedAudioRecorder({
                logger: (msg, err, data) => this.log(`[AdvRec] ${msg}`, err, data),
                onPermissionChange: (state) => this.handlePermissionChange(state),
                targetSampleRate: 16000 
            });
            this.log('AdvancedAudioRecorder instantiated.');

            // Keep TelegramAudioBridge for PLAYBACK ONLY for now
            if (typeof TelegramAudioBridge === 'undefined') {
                this.log('TelegramAudioBridge not available, playback will fail.', true);
            } else {
                const audioBridgePlaybackOptions = {
                    debug: this.config.debug,
                    onPlaybackStart: () => this.handlePlaybackStart(),
                    onPlaybackEnd: () => this.handlePlaybackEnd(),
                    onError: (error) => this.handleAudioError(`Playback Error: ${error.message || error}`)
                };
                 if (this.options.audioContext && this.options.audioContext.state === 'running') { // Pass if main app created one
                    audioBridgePlaybackOptions.audioContext = this.options.audioContext;
                }
                this.audioBridgeForPlayback = new TelegramAudioBridge(audioBridgePlaybackOptions);
                this.log('TelegramAudioBridge instantiated for playback.');
            }
            
            await this.initializeSessionToken();
            this.setupHealthMonitoring();
            
            this.state.isInitialized = true;
            this.log('Client core initialized with AdvancedAudioRecorder. Ready for connect command.');
            if (window.uiController) {
                window.uiController.setConnectionState('disconnected');
            }
            
        } catch (error) {
            this.handleCriticalError('Client Initialization failed', error);
        } finally {
            this.state.isInitializing = false;
        }
    }

    updateUIForPermissionState(state) {
        this.log(`Updating UI for permission state: ${state}`);
        if (window.uiController) {
            window.uiController.updateStatusBanner(`Microphone: ${state}`, state === 'granted' ? 'success' : (state === 'denied' ? 'error' : 'warning'));
            if (state === 'granted' && this.state.isConnectedToWebSocket && this.state.isGeminiSessionActive && this.state.isConversationPaused) {
                 window.uiController.updateInteractionButton('ready_to_play');
            } else if (state !== 'granted') {
                 window.uiController.updateInteractionButton('disconnected', false);
            }
        }
        if (state === 'denied') {
            if (window.uiController) window.uiController.addMessage('🎤 Microphone access is required. Please check settings.', 'system');
            if (typeof window.showPermissionGuidance === 'function') window.showPermissionGuidance(this.detectPlatform());
        }
    }
    
    detectPlatform() {
        const ua = navigator.userAgent;
        if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
        if (/Android/i.test(ua)) return 'android';
        return 'generic';
    }
    
    handlePermissionChange(state) {
        this.log(`Permission state changed to: ${state}`);
        this.state.permissionState = state;
        this.updateUIForPermissionState(state);
    }
    
    async initializeSessionToken() {
        try {
            this.log('Initializing session token...');
            if (window.uiController) window.uiController.updateStatusBanner('Initializing session...', 'info');
            
            const urlParams = new URLSearchParams(window.location.search);
            this.state.sessionToken = urlParams.get('session');
            if (!this.state.sessionToken || this.state.sessionToken.length < 10) {
                throw new Error('Invalid or missing session token');
            }
            this.log(`Session token obtained: ${this.state.sessionToken.substring(0, 20)}...`);
        } catch (error) {
            this.log(`Session token initialization error: ${error.message}`, true);
            this.handleSessionInitError(error);
            throw error;
        }
    }

    async fetchSessionConfigWithRetry(maxRetries = 3) {
        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.log(`Fetching session config attempt ${attempt}/${maxRetries}`);
                const apiUrl = `https://n8n.lomeai.com/webhook/voice-session?session=${this.state.sessionToken}&action=initialize`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);
                const response = await fetch(apiUrl, { signal: controller.signal, headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
                clearTimeout(timeoutId);
                if (!response.ok) throw new Error(`N8N API returned status ${response.status}: ${response.statusText}`);
                const rawData = await response.json();
                this.log(`Session config received: ${JSON.stringify(rawData).substring(0, 200)}...`);
                return rawData;
            } catch (error) {
                lastError = error;
                this.log(`Session config fetch attempt ${attempt} failed: ${error.message}`, true);
                if (attempt < maxRetries) {
                    const delay = attempt * 2000;
                    this.log(`Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        throw lastError;
    }
    
    processSessionData(rawData) {
        try {
            let data = Array.isArray(rawData) && rawData.length > 0 ? rawData[0] : rawData;
            if (!data || !data.success) throw new Error(data?.error || 'Session configuration invalid');
            this.state.sessionConfig = data.config;
            this.log(`Session configured - Model: ${this.state.sessionConfig?.model}, WebSocket: ${this.state.sessionConfig?.websocketProxyUrl}`);
        } catch (error) {
            throw new Error('Failed to process session data: ' + error.message);
        }
    }
        
    handleSessionInitError(error) {
        if (window.uiController) window.uiController.updateStatusBanner(`Initialization Error: ${error.message}`, 'error');
        if (this.state.sessionInitTimer) { clearTimeout(this.state.sessionInitTimer); this.state.sessionInitTimer = null; }
    }

    async connect() {
        if (this.state.isConnecting || this.state.isConnectedToWebSocket) {
            this.log('Connect called but already connecting or connected.');
            return;
        }
        this.state.isConnecting = true;
        if (window.uiController) window.uiController.setConnectionState('connecting');

        try {
            if (!this.state.sessionConfig) {
                const sessionData = await this.fetchSessionConfigWithRetry();
                this.processSessionData(sessionData);
            }
            await this.connectToWebSocket();
        } catch (error) {
            this.log('Connection process failed', true, error);
            if (window.uiController) window.uiController.setConnectionState('error');
            this.state.isConnecting = false;
        }
    }

    disconnect(reason = 'User disconnected') {
        this.log(`Disconnecting... Reason: ${reason}`);
        this.state.isConversationPaused = true;
        
        if (this.advancedRecorder && this.advancedRecorder.isRecording) {
            this.advancedRecorder.stop();
            this.log('AdvancedAudioRecorder stopped.');
        }
        if (this.audioBridgeForPlayback) { 
            this.audioBridgeForPlayback.stopPlayback(); 
            this.log('TelegramAudioBridge playback stopped.');
        }
        if (this.state.ws) {
            this.state.ws.close(1000, reason);
        } else {
            this.handleDisconnection(reason);
        }
    }

    async startConversation() {
        if (!this.state.isConnectedToWebSocket || !this.state.isGeminiSessionActive) {
            this.log('Cannot start conversation: not fully connected.', true);
            if(window.uiController) window.uiController.updateInteractionButton('disconnected');
            return;
        }
        this.log('Starting conversation with AdvancedAudioRecorder (Play pressed)');
        this.state.isConversationPaused = false;
        
        try {
            if (!this.advancedRecorder.isRecording) {
                this.log('AdvancedAudioRecorder not recording, starting it...');
                // Start will request permissions if needed and initialize AudioContext
                await this.advancedRecorder.start(this.handlePCMDataFromRecorder.bind(this));
            }
            // Ensure mic is active (not suspended)
            this.advancedRecorder.resumeMic(); 
            if (window.uiController) {
                window.uiController.updateInteractionButton('listening');
                window.uiController.setUserSpeaking(true); // Indicate user can speak
            }

        } catch (error) {
            this.log('Error starting/resuming AdvancedAudioRecorder for conversation.', true, error);
            if(window.uiController) window.uiController.updateInteractionButton('ready_to_play');
            this.state.isConversationPaused = true;
        }
    }

    pauseConversation() {
        this.log('Pausing conversation with AdvancedAudioRecorder (Stop pressed)');
        this.state.isConversationPaused = true;
        if (this.advancedRecorder && this.advancedRecorder.isRecording && !this.advancedRecorder.isSuspended) {
            this.advancedRecorder.suspendMic();
            this.log('User mic suspended via AdvancedAudioRecorder.');
            // Consider sending an explicit 'user_speech_end' if backend needs it
            // when relying on server-side VAD for continuous PCM.
        }
        if (window.uiController) {
            window.uiController.updateInteractionButton('ready_to_play');
            window.uiController.setUserSpeaking(false);
        }
    }

    sendTextMessage(text) {
        if (!this.state.isConnectedToWebSocket || !this.state.isGeminiSessionActive) {
            this.log('Cannot send text message: not fully connected.', true);
            if(window.uiController) window.uiController.addMessage('Error: Not connected. Cannot send text.', 'system');
            return;
        }
        this.log(`Sending text message to backend: "${text}"`);
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify({ type: 'text_input', text: text, timestamp: Date.now() }));
        } else {
            this.log('WebSocket not open, cannot send text message.', true);
        }
    }

    async connectToWebSocket() {
        if (this.state.connectionAttempts >= this.state.maxConnectionAttempts && this.state.maxConnectionAttempts > 0) {
            if (window.uiController) window.uiController.setConnectionState('error');
            this.log('Max connection attempts reached.', true);
            return false;
        }
        this.state.connectionAttempts++;
        
        try {
            this.log('WebSocket connection starting...');
            const wsUrl = this.state.sessionConfig?.websocketProxyUrl;
            if (!wsUrl) throw new Error('No WebSocket URL provided in session config');
            
            if (this.state.ws) { 
                this.log('Closing existing WebSocket before reconnecting.');
                this.state.ws.onopen = null; this.state.ws.onmessage = null; 
                this.state.ws.onerror = null; this.state.ws.onclose = null;
                this.state.ws.close(); 
                this.state.ws = null; 
            }
            const fullWsUrl = `${wsUrl}&session=${this.state.sessionToken}`;
            this.log(`Connecting to: ${fullWsUrl}`);
            this.state.ws = new WebSocket(fullWsUrl);
            this.setupWebSocketHandlers();
        } catch (error) {
            this.log(`WebSocket connection setup error: ${error.message}`, true);
            if (window.uiController) window.uiController.setConnectionState('error');
            this.state.isConnecting = false;
            return false;
        }
    }
    
    setupWebSocketHandlers() {
        if (!this.state.ws) return;
        const connectionTimeout = setTimeout(() => {
            if (this.state.ws && this.state.ws.readyState === WebSocket.CONNECTING) {
                this.log('WebSocket connection timeout', true); this.state.ws.close();
            }
        }, 10000);

        this.state.ws.onopen = () => {
            clearTimeout(connectionTimeout); 
            this.log('WebSocket connection opened');
            this.state.isConnectedToWebSocket = true;
            this.state.isConnecting = false;
            this.state.reconnectCount = 0; 
            this.state.connectionAttempts = 0; 
            this.state.lastActivity = Date.now();
            if (window.uiController) window.uiController.updateStatusBanner('WebSocket connected. Initializing session...', 'info');
        };

        this.state.ws.onmessage = (event) => {
            this.state.lastActivity = Date.now();
            try { const message = JSON.parse(event.data); this.handleWebSocketMessage(message); }
            catch (error) { this.log(`Failed to parse message: ${error.message}`, true); }
        };

        this.state.ws.onerror = (error) => {
            clearTimeout(connectionTimeout); 
            this.log(`WebSocket error: ${error.message || 'Connection error'}`, true);
            this.state.isConnecting = false;
            if (window.uiController) window.uiController.setConnectionState('error');
            this.handleConnectionFailure();
        };

        this.state.ws.onclose = (event) => {
            clearTimeout(connectionTimeout); 
            const reason = event.reason || 'Connection closed';
            this.log(`WebSocket closed: ${event.code} ${reason}`);
            this.state.isConnecting = false;
            this.handleDisconnection(reason);
        };
    }
    
    handleConnectionFailure() {
        this.state.isConnectedToWebSocket = false;
        this.state.isGeminiSessionActive = false;
        this.state.isConnecting = false;

        if (this.state.reconnectCount < this.config.reconnectAttempts) {
            this.state.reconnectCount++;
            this.log(`Attempting reconnection ${this.state.reconnectCount}/${this.config.reconnectAttempts}...`);
            if (window.uiController) window.uiController.updateStatusBanner(`Reconnecting (${this.state.reconnectCount}/${this.config.reconnectAttempts})...`, 'warning');
            
            this.state.reconnectTimer = setTimeout(() => {
                this.connect().catch(err => this.log('Reconnect attempt failed.', true, err));
            }, this.config.reconnectDelay * Math.pow(2, this.state.reconnectCount -1));
        } else {
            this.log('Max reconnect attempts reached.', true);
            if (window.uiController) window.uiController.setConnectionState('error');
        }
    }
    
    handleWebSocketMessage(message) {
        this.log('[Client] Message handling:', false, { type: message.type, ts: message.timestamp });
        try {
            switch (message.type) {
                case 'session_initialized': this.handleSessionInitialized(); break;
                case 'gemini_connected': this.handleGeminiConnected(); break;
                case 'gemini_setup_complete': 
                    this.log('Gemini setup complete from backend'); 
                    this.state.isGeminiSessionActive = true;
                    if(window.uiController) window.uiController.updateInteractionButton('ready_to_play');
                    break;
                case 'gemini_disconnected': this.handleGeminiDisconnected(message.reason); break;
                case 'audio_response': this.handleAudioResponse(message); break;
                case 'text_response': 
                    if (window.uiController) window.uiController.addMessage(message.text, 'ai', message.isHTML || false); 
                    break;
                case 'error': this.handleServerError(message); break;
                case 'input_transcription': this.handleInputTranscription(message); break;
                case 'output_transcription': this.handleOutputTranscription(message); break;
                case 'turn_complete': this.handleTurnComplete(); break;
                case 'interrupted': this.handleInterruption(); break;
                case 'pong': this.log('Received pong response'); break;
                case 'health_check': this.log('Received health check from server'); break;
                case 'usage_metadata': 
                    this.log('Received usage_metadata', false, message.usage);
                    break;
                default:
                    this.log(`Unknown message type: ${message.type}`, true, message);
            }
        } catch (error) { this.log(`Error handling WebSocket message: ${error.message}`, true, error); }
    }
    
    handleSessionInitialized() {
        this.log('Backend confirmed session initialized.');
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify({ type: 'connect_gemini' }));
            this.log('Sent connect_gemini message to backend');
        }
    }
    
    handleGeminiConnected() {
        this.log('Backend confirmed Gemini connected successfully');
        this.state.isGeminiSessionActive = true;
        this.state.isConversationPaused = true; 
        if (window.uiController) {
            window.uiController.setConnectionState('connected');
        }
    }
    
    handleGeminiDisconnected(reason) {
        this.log(`Backend reported Gemini disconnected: ${reason}`);
        this.state.isGeminiSessionActive = false;
        if (window.uiController) {
            window.uiController.updateInteractionButton('disconnected');
            window.uiController.updateStatusBanner(`Gemini session ended: ${reason}. Re-connect if needed.`, 'warning');
            window.uiController.addMessage(`🔌 Gemini session ended: ${reason}`, 'system');
        }
    }
    
    handleAudioResponse(message) { // For AI audio playback
        this.log(`Audio response. Mime: ${message.mimeType}, Len: ${message.audioData?.length}`);
        if (message.audioData && message.mimeType) {
            try { 
                if (this.audioBridgeForPlayback) {
                    if (!this.state.isConversationPaused && this.advancedRecorder && this.advancedRecorder.isRecording && !this.advancedRecorder.isSuspended) {
                        this.log('Suspending user mic for AI speech playback.');
                        this.advancedRecorder.suspendMic();
                        if(window.uiController) window.uiController.setUserSpeaking(false); // Ensure user wave stops
                    }
                    this.audioBridgeForPlayback.playAudio(message.audioData, message.mimeType); 
                    if (window.uiController) window.uiController.setAISpeaking(true); 
                } else {
                    this.log('audioBridgeForPlayback not available, cannot play AI audio.', true);
                }
            }
            catch (error) { this.log(`Audio playback error: ${error.message}`, true); }
        } else { this.log('Invalid audio response format', true); }
    }
    
    handleInputTranscription(message) {
        if (message.text) {
            this.state.transcriptions.input = message.text;
            if (window.uiController) { 
                window.uiController.updateInputTranscription(message.text); 
            }
        }
    }
    
    handleOutputTranscription(message) {
        if (message.text) { 
            this.state.transcriptions.output = message.text; 
            if (window.uiController) window.uiController.updateOutputTranscription(message.text); 
        }
    }
    
    handleTurnComplete() {
        this.log('Turn complete received from backend'); 
        this.state.transcriptions.input = ''; 
        this.state.transcriptions.output = '';
        if (window.uiController) {
            window.uiController.clearTranscriptions();
        }

        if (!this.state.isConversationPaused && this.advancedRecorder && this.advancedRecorder.isRecording) {
            // If AI didn't play audio (e.g., text-only response, or interruption before audio)
            // and mic was suspended, resume it.
            if (this.advancedRecorder.isSuspended && !this.state.aiPlayedAudioThisTurn) {
                 this.log('Turn complete (no AI audio or AI was cut short), resuming user mic.');
                 this.advancedRecorder.resumeMic();
                 if (window.uiController) {
                    window.uiController.updateInteractionButton('listening');
                    window.uiController.setUserSpeaking(true); // Indicate user can speak
                 }
            } else if (!this.advancedRecorder.isSuspended) {
                // If mic was already active (e.g. AI spoke very fast, playbackEnd already resumed)
                // ensure UI is in listening state.
                if (window.uiController) {
                    window.uiController.updateInteractionButton('listening');
                    window.uiController.setUserSpeaking(true);
                }
            }
        } else if (window.uiController && this.state.isConversationPaused) {
            window.uiController.updateInteractionButton('ready_to_play');
        }
        this.state.aiPlayedAudioThisTurn = false; // Reset for next turn
    }
    
    handleInterruption() {
        this.log('Model generation interrupted'); 
        if (this.audioBridgeForPlayback) this.audioBridgeForPlayback.stopPlayback();
        if (window.uiController) { 
            window.uiController.setAISpeaking(false); 
            window.uiController.addMessage('(AI interrupted)', 'system');
        }
        // If conversation is active, resume user mic as AI was cut short
        if (!this.state.isConversationPaused && this.advancedRecorder && this.advancedRecorder.isRecording) {
             this.log('AI interrupted, resuming user mic.');
             this.advancedRecorder.resumeMic();
             if (window.uiController) {
                window.uiController.updateInteractionButton('listening');
                window.uiController.setUserSpeaking(true);
             }
        }
    }
    
    handleServerError(message) { 
        this.log(`Server error: ${message.message}`, true); 
        if(window.uiController) window.uiController.updateStatusBanner(message.message, 'error');
    }
    
    // New method for AdvancedAudioRecorder PCM data
    handlePCMDataFromRecorder(pcmInt16Array) {
        if (this.state.isConversationPaused || !this.state.isConnectedToWebSocket || !this.state.isGeminiSessionActive) {
            return;
        }

        const arrayBufferToBase64 = (buffer) => {
            let binary = '';
            const bytes = new Uint8Array(buffer);
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return window.btoa(binary);
        };
        
        const base64PCM = arrayBufferToBase64(pcmInt16Array.buffer);

        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            const messagePayload = {
                type: 'audio_input_pcm', 
                audioData: base64PCM,
                sampleRate: this.advancedRecorder.targetSampleRate,
                timestamp: Date.now()
            };
            this.state.ws.send(JSON.stringify(messagePayload));
            // User speaking UI is handled by UIController when conversation starts/resumes.
            // No explicit EOS from client with continuous PCM; server-side VAD from Gemini is expected.
        }
    }
    
    handlePlaybackStart() { 
        this.log('AI audio playback started'); 
        this.state.aiPlayedAudioThisTurn = true;
        if (window.uiController) window.uiController.setAISpeaking(true); 
    }

    handlePlaybackEnd() { 
        this.log('AI audio playback ended'); 
        if (window.uiController) {
            window.uiController.setAISpeaking(false);
        }
        if (!this.state.isConversationPaused && this.advancedRecorder && this.advancedRecorder.isRecording) {
            this.log('AI playback ended, resuming user mic.');
            this.advancedRecorder.resumeMic();
            if (window.uiController) {
                window.uiController.updateInteractionButton('listening');
                window.uiController.setUserSpeaking(true); // Indicate user can speak again
            }
        }
    }

    handleAudioError(errorMsg) { 
        this.log(`Audio Playback/Bridge Error: ${errorMsg}`, true); 
        if(window.uiController) window.uiController.updateStatusBanner(`Audio Playback Error: ${errorMsg}`, 'error'); 
    }
    
    handleDisconnection(reason = 'Unknown reason') {
        this.log(`Handling disconnection. Reason: ${reason}`);
        this.state.isConnectedToWebSocket = false;
        this.state.isGeminiSessionActive = false;
        this.state.isConnecting = false;
        this.state.isConversationPaused = true;

        if (this.advancedRecorder && this.advancedRecorder.isRecording) {
            this.advancedRecorder.stop(); 
        }
        if (this.state.reconnectTimer) { clearTimeout(this.state.reconnectTimer); this.state.reconnectTimer = null; }
        
        if (window.uiController) {
            window.uiController.setConnectionState('disconnected');
        }
    }
    
    setupHealthMonitoring() {
        this.state.healthCheckTimer = setInterval(() => {
            if (this.state.isConnectedToWebSocket && this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
                try { this.state.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() })); }
                catch (error) { this.log(`Health check ping failed: ${error.message}`, true); }
            }
        }, this.config.healthCheckInterval);
    }
    
    handleCriticalError(context, error) {
        const message = `${context}: ${error.message}`; 
        this.log(message, true, error);
        if (typeof window.showCriticalError === 'function') {
            window.showCriticalError(message, error.stack);
        }
    }
    
    safeExecute(fn) { try { return fn(); } catch (error) { this.log(`Safe execution failed: ${error.message}`, true, error); }}
    
    dispose() {
        this.log('Disposing client...');
        [this.state.sessionInitTimer, this.state.reconnectTimer, this.state.healthCheckTimer].forEach(t => t && clearTimeout(t));
        
        if (this.advancedRecorder) {
            this.advancedRecorder.stop();
            this.advancedRecorder = null;
        }
        if (this.audioBridgeForPlayback && typeof this.audioBridgeForPlayback.dispose === 'function') {
            this.audioBridgeForPlayback.dispose();
            this.audioBridgeForPlayback = null;
        } else if (this.audioBridgeForPlayback) {
             if (this.audioBridgeForPlayback.stopPlayback) this.audioBridgeForPlayback.stopPlayback();
        }

        if (this.state.ws) {
            this.state.ws.onopen = null; this.state.ws.onmessage = null; 
            this.state.ws.onerror = null; this.state.ws.onclose = null;
            this.state.ws.close();
        }
        this.log('Client disposed');
    }
    
    log(message, isError = false, data = null) {
        if (this.config.debug || isError) {
            const logMethod = isError ? console.error : console.log;
            const prefix = '[GeminiClient]';
            if (data !== null && data !== undefined) {
                logMethod(prefix, message, data);
            } else {
                logMethod(prefix, message);
            }
            if (typeof window.debugLog === 'function') {
                 window.debugLog(`[Client] ${message}`, isError, data);
            }
        }
    }
}

// Explicitly attach to window object to make it globally accessible when loaded as a module
if (typeof window !== 'undefined') {
    window.GeminiTelegramClient = GeminiTelegramClient;
}
