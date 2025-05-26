/**
 * Modern Gemini Telegram Client with enhanced mobile compatibility and error handling
 * Version: 3.0.1 (Patched for TelegramAudioBridge v3)
 * 
 * Integrated with modern UI controller for Siri-like interface
 */

class GeminiTelegramClient {
    constructor(options = {}) { // Accept options
        console.log('🔄 [DEBUG] Modern GeminiTelegramClient v3.0.1 (Patched) constructor called with options:', options);
        
        try {
            this.options = options; // Store options
            this.config = {
                debug: true,
                reconnectAttempts: 3,
                reconnectDelay: 2000,
                sessionTimeout: 45000,
                vadSilenceThreshold: 0.01,
                vadRequiredSilenceDuration: 1500,
                healthCheckInterval: 30000,
                connectionRetryDelay: 1000,
                audioFeedbackEnabled: true,
                autoConnect: true // Automatically connect when mic is clicked
            };
            
            // Enhanced state management
            this.state = {
                sessionToken: null,
                sessionConfig: null,
                isConnected: false,
                isInitialized: false,
                isInitializing: false,
                ws: null,
                reconnectCount: 0,
                reconnectTimer: null,
                sessionInitTimer: null,
                healthCheckTimer: null,
                lastActivity: Date.now(),
                connectionAttempts: 0,
                maxConnectionAttempts: 5,
                permissionState: 'unknown',
                transcriptions: {
                    input: '',
                    output: ''
                }
            };
            
            // UI Controller
            this.ui = window.uiController || null;
            
            // Initialize system
            this.initialize();
            
        } catch (error) {
            this.handleCriticalError('Constructor failed', error);
        }
    }
    
    async initialize() {
        if (this.state.isInitializing) return;
        this.state.isInitializing = true;
        
        try {
            this.log('Starting enhanced initialization...');
            
            // Check dependencies
            if (typeof TelegramAudioBridge === 'undefined') {
                throw new Error('TelegramAudioBridge is not available');
            }
            
            // Check UI controller
            if (!this.ui && window.uiController) {
                this.ui = window.uiController;
            }
            
            // Initialize audio bridge with error handling
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

            // Pass pre-resumed AudioContext if available and running
            if (this.options.audioContext && this.options.audioContext.state === 'running') {
                this.log('Passing pre-resumed AudioContext to TelegramAudioBridge');
                audioBridgeOptions.audioContext = this.options.audioContext;
            }

            this.audioBridge = new TelegramAudioBridge(audioBridgeOptions);
            
            // Setup UI
            this.setupUI();
            
            // Initialize session with enhanced error handling
            await this.initializeSession();
            
            // Setup health monitoring
            this.setupHealthMonitoring();
            
            this.state.isInitialized = true;
            this.log('Enhanced initialization completed successfully');
            
        } catch (error) {
            this.handleCriticalError('Initialization failed', error);
        } finally {
            this.state.isInitializing = false;
        }
    }
    
    setupUI() {
        try {
            // Get mic button
            const micButton = document.getElementById('micButton');
            
            if (micButton) {
                micButton.addEventListener('click', () => {
                    this.safeExecute(() => this.handleMicButtonClick());
                });
            }
            
            this.log('UI setup completed');
        } catch (error) {
            this.log('UI setup error: ' + error.message, true);
        }
    }
    
    handleMicButtonClick() {
        // If not connected, connect first
        if (!this.state.isConnected && this.config.autoConnect) {
            this.connectToWebSocket().then(() => {
                // After connection, toggle recording
                setTimeout(() => {
                    this.toggleRecording();
                }, 500);
            });
        } else {
            // Just toggle recording
            this.toggleRecording();
        }
    }
    
    updateUIForPermissionState(state) {
        this.log(`Updating UI for permission state: ${state}`);
        
        if (this.ui) {
            this.ui.updateStatus(`Microphone: ${state}`, state === 'granted' ? 'success' : (state === 'denied' ? 'error' : 'warning'));
        }
        
        switch (state) {
            case 'granted':
                if (this.ui) {
                    this.ui.updateMicButton(false, true);
                }
                break;
                
            case 'denied':
                if (this.ui) {
                    this.ui.updateMicButton(false, false);
                    this.ui.addMessage('🎤 Microphone access is required for voice chat. Please check your browser settings and reload the page.', 'system');
                }
                
                // Show permission guidance
                const platform = this.detectPlatform();
                window.showPermissionGuidance(platform);
                break;
                
            case 'prompt':
                if (this.ui) {
                    this.ui.updateMicButton(false, true);
                }
                break;
                
            default:
                if (this.ui) {
                    this.ui.updateMicButton(false, false);
                }
        }
    }
    
    detectPlatform() {
        const ua = navigator.userAgent;
        if (/iPhone|iPad|iPod/i.test(ua)) {
            return 'ios';
        } else if (/Android/i.test(ua)) {
            return 'android';
        } else {
            return 'generic';
        }
    }
    
    handlePermissionChange(state) {
        this.state.permissionState = state;
        this.updateUIForPermissionState(state);
    }
    
    async initializeSession() {
        try {
            this.log('Starting enhanced session initialization...');
            this.updateStatus('Initializing session...');
            
            // Get session token with validation
            const urlParams = new URLSearchParams(window.location.search);
            this.state.sessionToken = urlParams.get('session');
            
            if (!this.state.sessionToken || this.state.sessionToken.length < 10) {
                throw new Error('Invalid or missing session token');
            }
            
            this.log(`Session token: ${this.state.sessionToken.substring(0, 20)}...`);
            
            // Set session initialization timeout with longer duration
            this.state.sessionInitTimer = setTimeout(() => {
                this.handleSessionInitTimeout();
            }, this.config.sessionTimeout);
            
            // Fetch session configuration with retries
            const sessionData = await this.fetchSessionConfigWithRetry();
            
            // Clear timeout since we got a response
            if (this.state.sessionInitTimer) {
                clearTimeout(this.state.sessionInitTimer);
                this.state.sessionInitTimer = null;
            }
            
            // Process session data
            this.processSessionData(sessionData);
            
            this.updateStatus('Session ready - Tap microphone to start', 'success');
            
            // Enable mic button
            if (this.ui) {
                this.ui.updateMicButton(false, true);
            }
            
        } catch (error) {
            this.log(`Session initialization error: ${error.message}`, true);
            this.handleSessionInitError(error);
        }
    }
    
    async fetchSessionConfigWithRetry(maxRetries = 3) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.log(`Session config attempt ${attempt}/${maxRetries}`);
                
                const apiUrl = `https://n8n.lomeai.com/webhook/voice-session?session=${this.state.sessionToken}&action=initialize`;
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);
                
                const response = await fetch(apiUrl, {
                    signal: controller.signal,
                    headers: {
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`API returned status ${response.status}: ${response.statusText}`);
                }
                
                const rawData = await response.json();
                this.log(`Session config received: ${JSON.stringify(rawData).substring(0, 200)}...`);
                
                return rawData;
                
            } catch (error) {
                lastError = error;
                this.log(`Session config attempt ${attempt} failed: ${error.message}`, true);
                
                if (attempt < maxRetries) {
                    const delay = attempt * 2000; // Progressive delay
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
            
            if (!data || !data.success) {
                throw new Error(data?.error || 'Session configuration invalid');
            }
            
            this.state.sessionConfig = data.config;
            
            // Update session info
            const sessionInfoEl = document.getElementById('sessionInfo');
            if (sessionInfoEl) {
                sessionInfoEl.textContent = `Session: ${data.sessionId} | User: ${data.userId}`;
            }
            
            this.log(`Session configured - Model: ${this.state.sessionConfig.model}, WebSocket: ${this.state.sessionConfig.websocketProxyUrl}`);
            
        } catch (error) {
            throw new Error('Failed to process session data: ' + error.message);
        }
    }
    
    handleSessionInitTimeout() {
        this.log('Session initialization timed out', true);
        this.updateStatus('Connection timed out - Tap to retry', 'error');
    }
    
    handleSessionInitError(error) {
        this.updateStatus(`Failed to initialize: ${error.message}`, 'error');
        
        // Clear timeout if it exists
        if (this.state.sessionInitTimer) {
            clearTimeout(this.state.sessionInitTimer);
            this.state.sessionInitTimer = null;
        }
    }
    
    async connectToWebSocket() {
        if (!this.state.isInitialized && !this.state.sessionConfig) {
            try {
                await this.initializeSession();
            } catch (error) {
                this.log('Failed to initialize before connection', true);
                return false;
            }
        }
        
        if (this.state.connectionAttempts >= this.state.maxConnectionAttempts) {
            this.updateStatus('Too many connection attempts. Please refresh.', 'error');
            return false;
        }
        
        this.state.connectionAttempts++;
        
        try {
            this.log('Enhanced WebSocket connection starting...');
            this.updateStatus('Connecting to server...');
            
            const wsUrl = this.state.sessionConfig.websocketProxyUrl;
            if (!wsUrl) {
                throw new Error('No WebSocket URL provided');
            }
            
            // Close existing connection
            if (this.state.ws) {
                this.state.ws.close();
                this.state.ws = null;
            }
            
            // Create WebSocket with enhanced error handling
            const fullWsUrl = `${wsUrl}&session=${this.state.sessionToken}`;
            this.log(`Connecting to: ${fullWsUrl}`);
            
            this.state.ws = new WebSocket(fullWsUrl);
            this.setupWebSocketHandlers();
            
            // Wait for connection to be established
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 10000);
                
                this.state.ws.onopen = () => {
                    clearTimeout(timeout);
                    resolve(true);
                };
                
                this.state.ws.onerror = (error) => {
                    clearTimeout(timeout);
                    reject(error);
                };
            });
            
        } catch (error) {
            this.log(`Connection error: ${error.message}`, true);
            this.updateStatus('Connection failed: ' + error.message, 'error');
            return false;
        }
    }
    
    setupWebSocketHandlers() {
        if (!this.state.ws) return;
        
        // Connection timeout
        const connectionTimeout = setTimeout(() => {
            if (this.state.ws && this.state.ws.readyState === WebSocket.CONNECTING) {
                this.log('WebSocket connection timeout', true);
                this.state.ws.close();
                this.updateStatus('Connection timeout', 'error');
                this.handleConnectionFailure();
            }
        }, 10000);
        
        this.state.ws.onopen = () => {
            clearTimeout(connectionTimeout);
            this.log('WebSocket connection opened');
            this.updateStatus('Connected to server, initializing session...');
            this.state.reconnectCount = 0;
            this.state.connectionAttempts = 0; // Reset on successful connection
            this.state.lastActivity = Date.now();
        };
        
        this.state.ws.onmessage = (event) => {
            this.state.lastActivity = Date.now();
            try {
                const message = JSON.parse(event.data);
                this.handleWebSocketMessage(message);
            } catch (error) {
                this.log(`Failed to parse message: ${error.message}`, true);
            }
        };
        
        this.state.ws.onerror = (error) => {
            clearTimeout(connectionTimeout);
            this.log(`WebSocket error: ${error.message || 'Connection error'}`, true);
            this.updateStatus('Connection error', 'error');
            this.handleConnectionFailure();
        };
        
        this.state.ws.onclose = (event) => {
            clearTimeout(connectionTimeout);
            const reason = event.reason || 'Connection closed';
            this.log(`WebSocket closed: ${event.code} ${reason}`);
            this.updateStatus('Connection closed', 'error');
            this.handleDisconnection(reason);
        };
    }
    
    handleConnectionFailure() {
        this.state.isConnected = false;
        
        // Attempt reconnection if appropriate
        if (this.state.reconnectCount < this.config.reconnectAttempts) {
            this.state.reconnectCount++;
            this.log(`Attempting reconnection ${this.state.reconnectCount}/${this.config.reconnectAttempts}...`);
            this.updateStatus(`Reconnecting (${this.state.reconnectCount}/${this.config.reconnectAttempts})...`);
            
            this.state.reconnectTimer = setTimeout(() => {
                this.connectToWebSocket();
            }, this.config.reconnectDelay);
        }
    }
    
    handleWebSocketMessage(message) {
        this.log('Enhanced message handling:', {
            type: message.type,
            keys: Object.keys(message),
            hasAudioData: !!message.audioData,
            timestamp: message.timestamp
        });
        
        try {
            switch (message.type) {
                case 'session_initialized':
                    this.handleSessionInitialized();
                    break;
                    
                case 'gemini_connected':
                    this.handleGeminiConnected();
                    break;
                    
                case 'gemini_setup_complete':
                    this.log('Gemini setup complete');
                    break;
                    
                case 'gemini_disconnected':
                    this.handleGeminiDisconnected(message.reason);
                    break;
                    
                case 'audio_response':
                case 'live_audio_chunk':  // Support both message types
                    this.handleAudioResponse(message);
                    break;
                    
                case 'text_response':
                    if (this.ui) {
                        this.ui.addMessage(message.text, 'ai');
                    }
                    break;
                    
                case 'error':
                    this.handleServerError(message);
                    break;
                    
                case 'input_transcription':
                    this.handleInputTranscription(message);
                    break;
                    
                case 'output_transcription':
                    this.handleOutputTranscription(message);
                    break;
                    
                case 'turn_complete':
                case 'audio_stream_complete':  // Support both message types
                    this.handleTurnComplete();
                    break;
                    
                case 'interrupted':
                    this.handleInterruption();
                    break;
                    
                case 'pong':
                    this.log('Received pong response');
                    break;
                    
                case 'health_check':
                    this.log('Received health check');
                    break;
                    
                default:
                    this.log(`Unknown message type: ${message.type}`);
            }
        } catch (error) {
            this.log(`Error handling message: ${error.message}`, true);
        }
    }
    
    handleSessionInitialized() {
        this.log('Session initialized successfully');
        this.updateStatus('Session ready - Connecting to Gemini...');
        
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify({ type: 'connect_gemini' }));
            this.log('Sent connect_gemini message');
        }
    }
    
    handleGeminiConnected() {
        this.log('Gemini connected successfully');
        this.state.isConnected = true;
        this.updateStatus('Connected! Tap microphone to talk', 'connected');
        
        if (this.ui) {
            this.ui.updateMicButton(false, true);
            this.ui.addMessage('🤖 Connected! I can hear you now. Tap the microphone to start talking!', 'ai');
        }
    }
    
    handleGeminiDisconnected(reason) {
        this.log(`Gemini disconnected: ${reason}`);
        this.handleDisconnection(reason);
        
        if (this.ui) {
            this.ui.addMessage(`🔌 Disconnected from Gemini: ${reason}`, 'system');
        }
    }
    
    handleAudioResponse(message) {
        this.log(`Audio response received. MimeType: ${message.mimeType}, Length: ${message.audioData?.length}`);
        
        if (message.audioData && message.mimeType) {
            try {
                this.audioBridge.playAudio(message.audioData, message.mimeType);
                
                // Activate AI circle animation
                if (this.ui) {
                    this.ui.setAISpeaking(true);
                }
            } catch (error) {
                this.log(`Audio playback error: ${error.message}`, true);
            }
        } else {
            this.log('Invalid audio response format', true);
        }
    }
    
    handleInputTranscription(message) {
        if (message.text) {
            this.state.transcriptions.input = message.text;
            
            // Update UI
            if (this.ui) {
                this.ui.updateInputTranscription(message.text);
                this.ui.addMessage(`🎤 You: ${message.text}`, 'user');
            }
        }
    }
    
    handleOutputTranscription(message) {
        if (message.text) {
            this.state.transcriptions.output = message.text;
            
            // Update UI
            if (this.ui) {
                this.ui.updateOutputTranscription(message.text);
            }
        }
    }
    
    handleTurnComplete() {
        this.log('Turn complete');
        
        // Reset transcriptions
        this.state.transcriptions.input = '';
        this.state.transcriptions.output = '';
        
        // Hide transcription displays after a delay
        setTimeout(() => {
            if (this.ui) {
                this.ui.clearTranscriptions();
            }
        }, 3000);
    }
    
    handleInterruption() {
        this.log('Model generation interrupted');
        this.audioBridge.stopPlayback();
        
        // Stop AI speaking animation
        if (this.ui) {
            this.ui.setAISpeaking(false);
            this.ui.addMessage('(interrupted)', 'system');
        }
    }
    
    handleServerError(message) {
        this.log(`Server error: ${message.message}`, true);
        this.updateStatus(message.message, 'error');
    }
    
    async toggleRecording() {
        if (!this.state.isConnected && this.config.autoConnect) {
            try {
                await this.connectToWebSocket();
            } catch (error) {
                this.updateStatus('Please connect first', 'error');
                return;
            }
        }
        
        try {
            // PATCHED: Check recording state from audioBridge.state instead of audioBridge directly
            if (this.audioBridge.state && this.audioBridge.state.isRecording) {
                await this.audioBridge.stopRecording();
                
                if (this.ui) {
                    this.ui.updateMicButton(false);
                    this.ui.setUserSpeaking(false);
                }
                
                this.updateStatus('Connected! Tap microphone to talk', 'connected');
            } else {
                // PATCHED: Check initialization state from audioBridge.state
                if (!this.audioBridge.state || !this.audioBridge.state.initialized) {
                    this.log('Initializing audio before recording...');
                    const initialized = await this.audioBridge.initialize();
                    
                    if (!initialized) {
                        this.updateStatus('Audio initialization failed. Check permissions.', 'error');
                        return;
                    }
                }
                
                const started = await this.audioBridge.startRecording();
                if (started) {
                    if (this.ui) {
                        this.ui.updateMicButton(true);
                        this.ui.setUserSpeaking(true);
                    }
                    
                    this.updateStatus('Listening... Speak now', 'recording');
                } else {
                    this.updateStatus('Failed to start recording', 'error');
                }
            }
        } catch (error) {
            this.log(`Recording toggle error: ${error.message}`, true);
            this.updateStatus('Recording error: ' + error.message, 'error');
        }
    }
    
    // Audio event handlers
    handleAudioStart() {
        this.log('Audio recording started');
        
        if (this.ui) {
            this.ui.setUserSpeaking(true);
        }
    }
    
    handleAudioEnd() {
        this.log('Audio recording ended');
        
        if (this.ui) {
            this.ui.setUserSpeaking(false);
        }
    }
    
    handleAudioData(audioData, isEndOfSpeech) {
        if (!this.state.ws || this.state.ws.readyState !== WebSocket.OPEN) {
            this.log('WebSocket not connected for sending audio', true);
            return;
        }
        
        const messagePayload = {
            type: 'audio_input',
            audioData: audioData,
            mimeType: 'audio/webm;codecs=opus',
            isEndOfSpeech: isEndOfSpeech,
            timestamp: Date.now()
        };
        
        try {
            this.state.ws.send(JSON.stringify(messagePayload));
            this.log(`Audio sent: ${audioData ? audioData.length : 0} bytes, EOS: ${isEndOfSpeech}`);
        } catch (error) {
            this.log(`Failed to send audio: ${error.message}`, true);
        }
    }
    
    handlePlaybackStart() {
        this.log('Audio playback started');
        
        if (this.ui) {
            this.ui.setAISpeaking(true);
        }
    }
    
    handlePlaybackEnd() {
        this.log('Audio playback ended');
        
        if (this.ui) {
            this.ui.setAISpeaking(false);
        }
    }
    
    handleVADSilenceDetected() {
        this.log('VAD silence detected - End of speech');
    }
    
    handleAudioError(error) {
        this.log(`Audio error: ${error.message}`, true);
        this.updateStatus(`Audio error: ${error.message}`, 'error');
    }
    
    // Connection management
    disconnect(reason = 'User disconnected') {
        this.log(`Disconnecting... Reason: ${reason}`);
        
        // Stop audio
        if (this.audioBridge) {
            this.audioBridge.stopRecording();
            this.audioBridge.stopPlayback();
        }
        
        // Close WebSocket
        if (this.state.ws) {
            this.state.ws.close(1000, reason);
        }
        
        this.handleDisconnection(reason);
    }
    
    handleDisconnection(reason = 'Unknown reason') {
        this.state.isConnected = false;
        
        // Clear timers
        if (this.state.reconnectTimer) {
            clearTimeout(this.state.reconnectTimer);
            this.state.reconnectTimer = null;
        }
        
        // Update UI
        if (this.ui) {
            this.ui.setUserSpeaking(false);
            this.ui.setAISpeaking(false);
            this.ui.updateMicButton(false, true);
        }
        
        this.updateStatus(`Disconnected: ${reason}. Tap mic to reconnect.`, 'error');
    }
    
    // Health monitoring
    setupHealthMonitoring() {
        this.state.healthCheckTimer = setInterval(() => {
            if (this.state.isConnected && this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
                // Send ping
                try {
                    this.state.ws.send(JSON.stringify({ 
                        type: 'ping', 
                        timestamp: Date.now() 
                    }));
                } catch (error) {
                    this.log(`Health check failed: ${error.message}`, true);
                }
            }
        }, this.config.healthCheckInterval);
    }
    
    // UI helpers
    updateStatus(message, type = '') {
        if (this.ui) {
            this.ui.updateStatus(message, type);
        } else {
            const statusEl = document.getElementById('status');
            if (statusEl) {
                statusEl.textContent = message;
                statusEl.className = 'status ' + type;
            }
        }
        
        // Also log status changes
        this.log(`Status: ${message} (${type})`);
    }
    
    // Error handling
    handleCriticalError(context, error) {
        const message = `${context}: ${error.message}`;
        this.log(message, true);
        
        if (typeof window.debugLog === 'function') {
            window.debugLog(message, true, error);
        }
        
        if (typeof window.showCriticalError === 'function') {
            window.showCriticalError(message, error.stack);
        }
    }
    
    safeExecute(fn) {
        try {
            return fn();
        } catch (error) {
            this.log(`Safe execution failed: ${error.message}`, true);
        }
    }
    
    // Cleanup
    dispose() {
        this.log('Disposing client...');
        
        // Clear all timers
        [this.state.sessionInitTimer, this.state.reconnectTimer, this.state.healthCheckTimer]
            .forEach(timer => timer && clearTimeout(timer));
        
        // Stop audio
        if (this.audioBridge) {
            this.audioBridge.dispose();
        }
        
        // Close WebSocket
        if (this.state.ws) {
            this.state.ws.close();
        }
        
        this.log('Client disposed');
    }
    
    // Logging
    log(message, isError = false, data = null) {
        if (this.config.debug) {
            const logMethod = isError ? console.error : console.log;
            logMethod('[Modern GeminiTelegramClient]', message, data || '');
            
            // Global debug system integration
            if (typeof window.debugLog === 'function') {
                window.debugLog(`[Client] ${message}`, isError, data);
            }
        }
    }
}

// The instance will be created by the main HTML initialization function
