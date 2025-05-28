/**
 * Modern Gemini Telegram Client with enhanced mobile compatibility and error handling
 * Version: 3.1.0 (Integrates with UIController v3.1.0)
 */

class GeminiTelegramClient {
    constructor(options = {}) {
        // Initialize config first, as this.log depends on it.
        this.config = {
            debug: true,
            reconnectAttempts: 3,
            reconnectDelay: 2000,
            sessionTimeout: 45000,
            vadSilenceThreshold: 0.01,
            vadRequiredSilenceDuration: 1500, //ms
            healthCheckInterval: 30000,
            connectionRetryDelay: 1000,
            audioFeedbackEnabled: true,
        };
        
        this.log(`[Client v3.1.0] Constructor called with options:`, false, options);
        
        try {
            this.options = options;
            this.state = {
                sessionToken: null,
                sessionConfig: null,
                isConnectedToWebSocket: false, // WebSocket connection to our backend
                isGeminiSessionActive: false, // Gemini Live API session active
                isInitialized: false,
                isInitializing: false,
                isConnecting: false, // Overall connection process state
                isConversationPaused: true, // For Play/Stop logic
                ws: null,
                reconnectCount: 0,
                reconnectTimer: null,
                sessionInitTimer: null,
                healthCheckTimer: null,
                lastActivity: Date.now(),
                connectionAttempts: 0,
                maxConnectionAttempts: 5,
                permissionState: 'unknown',
                transcriptions: { input: '', output: '' }
            };
            
            // UIController should be globally available as window.uiController
            // It's initialized by voice_chat.html itself.
            // We reference it here. If it's not ready, methods will check.
            
            this.initialize();
            
        } catch (error) {
            this.handleCriticalError('Client Constructor failed', error);
        }
    }
    
    async initialize() {
        if (this.state.isInitializing || this.state.isInitialized) return;
        this.state.isInitializing = true;
        this.log('Starting client initialization...');
        
        try {
            if (typeof TelegramAudioBridge === 'undefined') {
                throw new Error('TelegramAudioBridge is not available');
            }
            
            const audioBridgeOptions = {
                debug: this.config.debug,
                vadSilenceThreshold: this.config.vadSilenceThreshold,
                vadRequiredSilenceDuration: this.config.vadRequiredSilenceDuration,
                onAudioStart: () => this.handleAudioStart(),
                onAudioEnd: () => this.handleAudioEnd(),
                onAudioData: (data, isEndOfSpeech) => this.handleAudioData(data, isEndOfSpeech),
                onPlaybackStart: () => this.handlePlaybackStart(),
                onPlaybackEnd: () => this.handlePlaybackEnd(),
                onVADSilenceDetected: () => this.handleVADSilenceDetected(),
                onPermissionChange: (state) => this.handlePermissionChange(state),
                onError: (error) => this.handleAudioError(error)
            };

            if (this.options.audioContext && this.options.audioContext.state === 'running') {
                this.log('Passing pre-resumed AudioContext to TelegramAudioBridge');
                audioBridgeOptions.audioContext = this.options.audioContext;
            }

            this.audioBridge = new TelegramAudioBridge(audioBridgeOptions);
            // UI setup is now primarily handled by UIController itself.
            // This client will call UIController methods.
            
            await this.initializeSessionToken(); // Just get token, don't fetch config yet
            this.setupHealthMonitoring(); // Can start even if not connected
            
            this.state.isInitialized = true;
            this.log('Client core initialized. Ready for connect command.');
            if (window.uiController) {
                window.uiController.setConnectionState('disconnected'); // Initial state for UI
            }
            
        } catch (error) {
            this.handleCriticalError('Client Initialization failed', error);
        } finally {
            this.state.isInitializing = false;
        }
    }

    // UI related methods are now mostly in UIController.
    // This client will call uiController methods.

    updateUIForPermissionState(state) {
        this.log(`Updating UI for permission state: ${state}`);
        if (window.uiController) {
            window.uiController.updateStatusBanner(`Microphone: ${state}`, state === 'granted' ? 'success' : (state === 'denied' ? 'error' : 'warning'));
            const canInteract = state === 'granted' && this.state.isConnectedToWebSocket && this.state.isGeminiSessionActive;
            window.uiController.updateInteractionButton(
                canInteract ? (this.state.isConversationPaused ? 'ready_to_play' : 'listening') : 'disconnected',
                canInteract 
            );
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
        this.state.permissionState = state;
        this.updateUIForPermissionState(state);
    }
    
    async initializeSessionToken() { // Renamed from initializeSession, only gets token
        try {
            this.log('Initializing session token...');
            if (window.uiController) window.uiController.updateStatusBanner('Initializing session...', 'info');
            
            const urlParams = new URLSearchParams(window.location.search);
            this.state.sessionToken = urlParams.get('session');
            if (!this.state.sessionToken || this.state.sessionToken.length < 10) {
                throw new Error('Invalid or missing session token');
            }
            this.log(`Session token obtained: ${this.state.sessionToken.substring(0, 20)}...`);
            // Session config will be fetched upon connect()
        } catch (error) {
            this.log(`Session token initialization error: ${error.message}`, true);
            this.handleSessionInitError(error); // Generic error display
            throw error; // Re-throw to prevent connection attempts
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
            // const sessionInfoEl = document.getElementById('sessionInfo'); // This element might be removed/changed
            // if (sessionInfoEl) sessionInfoEl.textContent = `Session: ${data.sessionId || 'N/A'} | User: ${data.userId || 'N/A'}`;
            this.log(`Session configured - Model: ${this.state.sessionConfig?.model}, WebSocket: ${this.state.sessionConfig?.websocketProxyUrl}`);
        } catch (error) {
            throw new Error('Failed to process session data: ' + error.message);
        }
    }
        
    handleSessionInitError(error) { // More generic error handler
        if (window.uiController) window.uiController.updateStatusBanner(`Initialization Error: ${error.message}`, 'error');
        if (this.state.sessionInitTimer) { clearTimeout(this.state.sessionInitTimer); this.state.sessionInitTimer = null; }
    }

    // --- New Public Methods for UIController ---
    async connect() {
        if (this.state.isConnecting || this.state.isConnectedToWebSocket) {
            this.log('Connect called but already connecting or connected.');
            return;
        }
        this.state.isConnecting = true;
        if (window.uiController) window.uiController.setConnectionState('connecting');

        try {
            if (!this.state.sessionConfig) { // Fetch config if not already done
                const sessionData = await this.fetchSessionConfigWithRetry();
                this.processSessionData(sessionData);
            }
            await this.connectToWebSocket(); // Existing method, adapted
        } catch (error) {
            this.log('Connection process failed', true, error);
            if (window.uiController) window.uiController.setConnectionState('error');
            this.state.isConnecting = false;
        }
    }

    disconnect(reason = 'User disconnected') {
        this.log(`Disconnecting... Reason: ${reason}`);
        this.state.isConversationPaused = true; // Ensure conversation is paused
        if (this.audioBridge) { 
            this.audioBridge.stopRecording(false); // Stop recording without sending EOS
            this.audioBridge.stopPlayback(); 
        }
        if (this.state.ws) {
            this.state.ws.close(1000, reason);
            // onclose handler will call handleDisconnection and update UI
        } else {
            // If ws was never established or already null
            this.handleDisconnection(reason);
        }
    }

    async startConversation() {
        if (!this.state.isConnectedToWebSocket || !this.state.isGeminiSessionActive) {
            this.log('Cannot start conversation: not fully connected.', true);
            if(window.uiController) window.uiController.updateInteractionButton('disconnected');
            return;
        }
        this.log('Starting conversation (Play pressed)');
        this.state.isConversationPaused = false;
        
        // Ensure audio context is running and permissions are granted
        if (!this.audioBridge.state || !this.audioBridge.state.initialized || this.state.permissionState !== 'granted') {
            this.log('AudioBridge not ready or permissions not granted. Requesting...');
            const audioReady = await this.audioBridge.requestPermissionAndResumeContext();
            if (!audioReady) {
                this.log('Audio setup failed for startConversation.', true);
                if(window.uiController) window.uiController.updateInteractionButton('ready_to_play'); // Revert to play
                this.state.isConversationPaused = true;
                return;
            }
        }
        
        // Start recording if not already (VAD will handle sending data)
        if (!this.audioBridge.state.isRecording) {
            const started = await this.audioBridge.startRecording();
            if (started) {
                if (window.uiController) window.uiController.updateInteractionButton('listening');
            } else {
                this.log('Failed to start recording for conversation.', true);
                if (window.uiController) window.uiController.updateInteractionButton('ready_to_play');
                this.state.isConversationPaused = true;
            }
        } else {
             if (window.uiController) window.uiController.updateInteractionButton('listening');
        }
    }

    pauseConversation() {
        this.log('Pausing conversation (Stop pressed)');
        this.state.isConversationPaused = true;
        if (this.audioBridge && this.audioBridge.state.isRecording) {
            // Stop recording but don't necessarily send EOS immediately,
            // as user might resume. Or send EOS if that's the desired "pause" behavior.
            // For now, let's assume "pause" means stop sending audio.
            this.audioBridge.stopRecording(true); // Send EOS on pause for now
        }
        if (window.uiController) {
            window.uiController.updateInteractionButton('ready_to_play');
            window.uiController.setUserSpeaking(false); // Ensure user wave stops
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
    // --- End New Public Methods ---

    async connectToWebSocket() { // Now an internal method, called by public connect()
        if (this.state.connectionAttempts >= this.state.maxConnectionAttempts && this.state.maxConnectionAttempts > 0) {
            if (window.uiController) window.uiController.setConnectionState('error');
            this.log('Max connection attempts reached.', true);
            return false;
        }
        this.state.connectionAttempts++;
        
        try {
            this.log('WebSocket connection starting...');
            // UIController already set state to 'connecting'
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
            this.setupWebSocketHandlers(); // Handlers will update UIController
            
            // No need for separate promise here, onopen/onerror will handle UI updates via UIController
        } catch (error) {
            this.log(`WebSocket connection setup error: ${error.message}`, true);
            if (window.uiController) window.uiController.setConnectionState('error');
            this.state.isConnecting = false; // Reset connecting flag
            return false;
        }
    }
    
    setupWebSocketHandlers() {
        if (!this.state.ws) return;
        const connectionTimeout = setTimeout(() => {
            if (this.state.ws && this.state.ws.readyState === WebSocket.CONNECTING) {
                this.log('WebSocket connection timeout', true); this.state.ws.close();
                // onclose will be triggered, which calls handleDisconnection
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
            // Backend will send 'session_initialized', then client sends 'connect_gemini'
            // UIController state will be updated by 'session_initialized' and 'gemini_connected' handlers
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
            this.handleConnectionFailure(); // Attempt reconnect if configured
        };

        this.state.ws.onclose = (event) => {
            clearTimeout(connectionTimeout); 
            const reason = event.reason || 'Connection closed';
            this.log(`WebSocket closed: ${event.code} ${reason}`);
            this.state.isConnecting = false;
            this.handleDisconnection(reason); // This will update UIController
        };
    }
    
    handleConnectionFailure() { // Called on WebSocket error or failed close
        this.state.isConnectedToWebSocket = false;
        this.state.isGeminiSessionActive = false;
        this.state.isConnecting = false;

        if (this.state.reconnectCount < this.config.reconnectAttempts) {
            this.state.reconnectCount++;
            this.log(`Attempting reconnection ${this.state.reconnectCount}/${this.config.reconnectAttempts}...`);
            if (window.uiController) window.uiController.updateStatusBanner(`Reconnecting (${this.state.reconnectCount}/${this.config.reconnectAttempts})...`, 'warning');
            
            this.state.reconnectTimer = setTimeout(() => {
                // Call the public connect method which handles UI updates
                this.connect().catch(err => this.log('Reconnect attempt failed.', true, err));
            }, this.config.reconnectDelay * Math.pow(2, this.state.reconnectCount -1)); // Exponential backoff
        } else {
            this.log('Max reconnect attempts reached.', true);
            if (window.uiController) window.uiController.setConnectionState('error'); // Final error state
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
                    this.state.isGeminiSessionActive = true; // Mark Gemini session as active
                    // UIController state for connection is already 'connected' from gemini_connected
                    // UIController interaction button should now be 'ready_to_play'
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
                case 'debug_log': // Already handled by global debugLog if UIController is loaded
                    // this.log(`[Backend Debug] ${message.message || ''}`, message.isError, message.data);
                    break;
                case 'gemini_raw_output': // Already handled by global debugLog
                    // this.log('Received RAW Gemini Output (see next log for stringified JSON):', false, message.data);
                    // console.log('[GEMINI RAW OUTPUT STRINGIFIED]:', JSON.stringify(message.data, null, 2));
                    break;
                default:
                    this.log(`Unknown message type: ${message.type}`, true, message);
            }
        } catch (error) { this.log(`Error handling WebSocket message: ${error.message}`, true, error); }
    }
    
    handleSessionInitialized() { // Received from backend after WebSocket opens
        this.log('Backend confirmed session initialized.');
        // Now safe to send connect_gemini
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify({ type: 'connect_gemini' }));
            this.log('Sent connect_gemini message to backend');
            // UIController connection state remains 'connecting' until gemini_connected
        }
    }
    
    handleGeminiConnected() { // Received from backend after it connects to Gemini
        this.log('Backend confirmed Gemini connected successfully');
        this.state.isGeminiSessionActive = true; // This is the crucial part for enabling interaction
        this.state.isConversationPaused = true; // Start in paused state
        if (window.uiController) {
            window.uiController.setConnectionState('connected'); // This updates connect button to "Disconnect"
            // updateInteractionButton will be called by setConnectionState to 'ready_to_play'
        }
    }
    
    handleGeminiDisconnected(reason) {
        this.log(`Backend reported Gemini disconnected: ${reason}`);
        this.state.isGeminiSessionActive = false;
        // If WebSocket is still open, this means only Gemini part disconnected.
        // UI should reflect this, perhaps by disabling interaction button but keeping "Disconnect" for WebSocket.
        if (window.uiController) {
            window.uiController.updateInteractionButton('disconnected'); // Disable interaction
            window.uiController.updateStatusBanner(`Gemini session ended: ${reason}. Re-connect if needed.`, 'warning');
            window.uiController.addMessage(`🔌 Gemini session ended: ${reason}`, 'system');
        }
    }
    
    handleAudioResponse(message) {
        this.log(`Audio response. Mime: ${message.mimeType}, Len: ${message.audioData?.length}`);
        if (message.audioData && message.mimeType) {
            try { 
                this.audioBridge.playAudio(message.audioData, message.mimeType); 
                if (window.uiController) window.uiController.setAISpeaking(true); 
            }
            catch (error) { this.log(`Audio playback error: ${error.message}`, true); }
        } else { this.log('Invalid audio response format', true); }
    }
    
    handleInputTranscription(message) {
        if (message.text) {
            this.state.transcriptions.input = message.text;
            if (window.uiController) { 
                window.uiController.updateInputTranscription(message.text); 
                // Decide if live voice transcriptions go to chat log. For now, let's keep them separate.
                // If needed: this.ui.addMessage(`🎤 You: ${message.text}`, 'user');
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
            // Clear live transcription displays sooner
            window.uiController.clearTranscriptions();
        }

        // If conversation is active (not paused by user), re-arm microphone for next user input
        if (!this.state.isConversationPaused && this.state.isGeminiSessionActive && this.state.isConnectedToWebSocket) {
            this.log('Turn complete, conversation active: Attempting to re-arm microphone.');
            
            // Attempt to explicitly stop any existing recording in the bridge first, just in case.
            // Pass `false` to stopRecording if it accepts an argument to not send another EOS.
            // This depends on TelegramAudioBridge's stopRecording behavior.
            // If it doesn't accept an argument, this might send an unwanted EOS.
            // Assuming stopRecording() is safe to call if not recording.
            const stopBridgeIfNeeded = async () => {
                if (this.audioBridge.state && this.audioBridge.state.isRecording) {
                    this.log('Ensuring bridge recording is stopped before re-arming...');
                    try {
                        // If stopRecording(false) means "stop without sending EOS", use it.
                        // Otherwise, just stop(). The VAD already sent EOS.
                        await this.audioBridge.stopRecording(false); 
                    } catch (e) {
                        this.log('Minor error ensuring bridge stop before re-arm', true, e);
                    }
                }
            };

            stopBridgeIfNeeded().then(() => {
                this.log('Proceeding to request permission and re-arm mic.');
                return this.audioBridge.requestPermissionAndResumeContext();
            }).then(audioReady => {
                if (audioReady) {
                    return this.audioBridge.startRecording();
                }
                throw new Error('Audio context not ready for re-arming mic.');
            }).then(started => {
                if (started) {
                    this.log('Microphone re-armed successfully for continuous conversation.');
                    if (window.uiController) {
                        window.uiController.updateInteractionButton('listening');
                    }
                } else {
                    this.log('Failed to auto-restart recording after turn complete.', true);
                    // If it fails to restart, perhaps revert to 'ready_to_play' so user can manually restart
                    if (window.uiController) window.uiController.updateInteractionButton('ready_to_play');
                }
            }).catch(err => {
                this.log('Error auto-restarting recording after turn complete', true, err);
                if (window.uiController) window.uiController.updateInteractionButton('ready_to_play');
            });
        } else if (window.uiController && this.state.isConversationPaused) {
            // If conversation was explicitly paused, ensure UI reflects 'ready_to_play'
            window.uiController.updateInteractionButton('ready_to_play');
        } else if (window.uiController) {
            // If not connected or gemini session not active, reflect disconnected state
             window.uiController.updateInteractionButton('disconnected');
        }
    }
    
    handleInterruption() {
        this.log('Model generation interrupted'); 
        this.audioBridge.stopPlayback();
        if (window.uiController) { 
            window.uiController.setAISpeaking(false); 
            window.uiController.addMessage('(AI interrupted)', 'system');
            if (!this.state.isConversationPaused) {
                 window.uiController.updateInteractionButton('listening'); // Ready for user again
            }
        }
    }
    
    handleServerError(message) { 
        this.log(`Server error: ${message.message}`, true); 
        if(window.uiController) window.uiController.updateStatusBanner(message.message, 'error');
    }
    
    // toggleRecording is now effectively split into startConversation and pauseConversation
    
    handleAudioStart() { 
        this.log('Audio recording started by AudioBridge'); 
        if (window.uiController) window.uiController.setUserSpeaking(true); 
        // UIController's updateInteractionButton('user_speaking') will be called from its setUserSpeaking
    }
    handleAudioEnd() { // This is when VAD stops or user manually stops mic via bridge
        this.log('Audio recording ended by AudioBridge'); 
        if (window.uiController) {
            window.uiController.setUserSpeaking(false);
            // If conversation is active, transition to processing or back to listening
            if (this.state.isConnectedToWebSocket && this.state.isGeminiSessionActive && !this.state.isConversationPaused) {
                 window.uiController.updateInteractionButton('processing'); // Or 'listening' if EOS was sent
            }
        }
    }
    
    handleAudioData(audioData, isEndOfSpeech) {
        if (this.state.isConversationPaused) {
            this.log('Conversation is paused, not sending audio data.');
            // If VAD is still running and EOS is detected, ensure recording stops.
            if (isEndOfSpeech && this.audioBridge.state.isRecording) {
                this.audioBridge.stopRecording(false); // Stop without sending another EOS
            }
            return;
        }
        if (!this.state.ws || this.state.ws.readyState !== WebSocket.OPEN) { 
            this.log('WebSocket not connected for sending audio', true); return; 
        }
        const messagePayload = { type: 'audio_input', audioData, mimeType: 'audio/webm;codecs=opus', isEndOfSpeech, timestamp: Date.now() };
        try { 
            this.state.ws.send(JSON.stringify(messagePayload)); 
            this.log(`Audio sent: ${audioData ? audioData.length : 0}b, EOS: ${isEndOfSpeech}`); 
            if (isEndOfSpeech && window.uiController) {
                // After sending EOS, UI might show processing state
                window.uiController.updateInteractionButton('processing');
            }
        }
        catch (error) { this.log(`Failed to send audio: ${error.message}`, true); }
    }
    
    handlePlaybackStart() { this.log('Audio playback started'); if (window.uiController) window.uiController.setAISpeaking(true); }
    handlePlaybackEnd() { 
        this.log('Audio playback ended'); 
        if (window.uiController) {
            window.uiController.setAISpeaking(false);
            // The decision to re-arm mic is now primarily in handleTurnComplete.
            // UIController's setAISpeaking(false) will call updateInteractionButton, 
            // which should correctly reflect 'listening' if conversation is active.
        }
    }
    handleVADSilenceDetected() { this.log('VAD silence detected - End of speech by AudioBridge'); } // AudioBridge handles EOS
    handleAudioError(error) { this.log(`AudioBridge error: ${error.message}`, true); if(window.uiController) window.uiController.updateStatusBanner(`Audio error: ${error.message}`, 'error'); }
    
    // disconnect method already exists, ensure it calls handleDisconnection
    
    handleDisconnection(reason = 'Unknown reason') { // Called on WebSocket close or manual disconnect
        this.log(`Handling disconnection. Reason: ${reason}`);
        this.state.isConnectedToWebSocket = false;
        this.state.isGeminiSessionActive = false;
        this.state.isConnecting = false;
        this.state.isConversationPaused = true; // Reset conversation state

        if (this.state.reconnectTimer) { clearTimeout(this.state.reconnectTimer); this.state.reconnectTimer = null; }
        
        if (window.uiController) {
            window.uiController.setConnectionState('disconnected'); // This updates connect and interaction buttons
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
    
    // updateStatus is now primarily handled by UIController.updateStatusBanner
    
    handleCriticalError(context, error) {
        const message = `${context}: ${error.message}`; 
        this.log(message, true, error); // Log to console via this client's logger
        if (typeof window.showCriticalError === 'function') { // Global HTML function
            window.showCriticalError(message, error.stack);
        }
    }
    
    safeExecute(fn) { try { return fn(); } catch (error) { this.log(`Safe execution failed: ${error.message}`, true, error); }}
    
    dispose() {
        this.log('Disposing client...');
        [this.state.sessionInitTimer, this.state.reconnectTimer, this.state.healthCheckTimer].forEach(t => t && clearTimeout(t));
        if (this.audioBridge) this.audioBridge.dispose();
        if (this.state.ws) {
            this.state.ws.onopen = null; this.state.ws.onmessage = null; 
            this.state.ws.onerror = null; this.state.ws.onclose = null;
            this.state.ws.close();
        }
        this.log('Client disposed');
    }
    
    log(message, isError = false, data = null) { // Internal logger
        if (this.config.debug || isError) { // Always log errors
            const logMethod = isError ? console.error : console.log;
            const prefix = '[GeminiClient]';
            if (data !== null && data !== undefined) {
                logMethod(prefix, message, data);
            } else {
                logMethod(prefix, message);
            }
            // Use global debugLog if available (from voice_chat.html) for UI debug panel
            if (typeof window.debugLog === 'function') {
                 window.debugLog(`[Client] ${message}`, isError, data);
            }
        }
    }
}
