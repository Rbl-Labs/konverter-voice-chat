/**
 * Modern Gemini Telegram Client with enhanced mobile compatibility and error handling
 * Version: 3.0.4 (Enhanced timer logging, usage_metadata & debug_log handlers)
 * 
 * Integrated with modern UI controller for Siri-like interface
 */

class GeminiTelegramClient {
    constructor(options = {}) { 
        console.log('🔄 [DEBUG] Modern GeminiTelegramClient v3.0.4 constructor called with options:', options);
        
        try {
            this.options = options; 
            this.config = {
                debug: true,
                reconnectAttempts: 3,
                reconnectDelay: 2000,
                sessionTimeout: 45000, // 45 seconds for N8N call
                vadSilenceThreshold: 0.01,
                vadRequiredSilenceDuration: 1500,
                healthCheckInterval: 30000,
                connectionRetryDelay: 1000,
                audioFeedbackEnabled: true,
                autoConnect: true 
            };
            
            this.state = {
                sessionToken: null,
                sessionConfig: null,
                isConnected: false,
                isInitialized: false,
                isInitializing: false,
                ws: null,
                reconnectCount: 0,
                reconnectTimer: null,
                sessionInitTimer: null, // Timer for N8N call
                sessionInitTimerId: null, // Store the actual timer ID
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
            
            this.ui = window.uiController || null;
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
            if (typeof TelegramAudioBridge === 'undefined') {
                throw new Error('TelegramAudioBridge is not available');
            }
            if (!this.ui && window.uiController) {
                this.ui = window.uiController;
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
            this.setupUI();
            await this.initializeSession(); // This sets and clears sessionInitTimer
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
        if (!this.state.isConnected && this.config.autoConnect) {
            this.connectToWebSocket().then(() => {
                setTimeout(() => { this.toggleRecording(); }, 500);
            }).catch(err => {
                this.log('Failed to connect WebSocket on mic click', true, err);
                this.updateStatus('Connection failed. Tap mic to retry.', 'error');
            });
        } else {
            this.toggleRecording();
        }
    }
    
    updateUIForPermissionState(state) {
        this.log(`Updating UI for permission state: ${state}`);
        if (this.ui) {
            this.ui.updateStatus(`Microphone: ${state}`, state === 'granted' ? 'success' : (state === 'denied' ? 'error' : 'warning'));
        }
        switch (state) {
            case 'granted': if (this.ui) this.ui.updateMicButton(false, true); break;
            case 'denied':
                if (this.ui) {
                    this.ui.updateMicButton(false, false);
                    this.ui.addMessage('🎤 Microphone access is required. Please check settings.', 'system');
                }
                window.showPermissionGuidance(this.detectPlatform());
                break;
            case 'prompt': if (this.ui) this.ui.updateMicButton(false, true); break;
            default: if (this.ui) this.ui.updateMicButton(false, false);
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
    
    async initializeSession() {
        this.log('initializeSession called.');
        if (this.state.sessionInitTimerId) {
            this.log('Clearing existing sessionInitTimerId before setting a new one.', false, { timerId: this.state.sessionInitTimerId });
            clearTimeout(this.state.sessionInitTimerId);
            this.state.sessionInitTimerId = null;
        }

        try {
            this.log('Starting session initialization...');
            this.updateStatus('Initializing session...');
            const urlParams = new URLSearchParams(window.location.search);
            this.state.sessionToken = urlParams.get('session');
            if (!this.state.sessionToken || this.state.sessionToken.length < 10) {
                throw new Error('Invalid or missing session token');
            }
            this.log(`Session token: ${this.state.sessionToken.substring(0, 20)}...`);
            
            this.state.sessionInitTimerId = setTimeout(() => this.handleSessionInitTimeout(), this.config.sessionTimeout);
            this.log('Session init timer SET', false, { timerId: this.state.sessionInitTimerId, timeout: this.config.sessionTimeout });

            const sessionData = await this.fetchSessionConfigWithRetry();
            
            if (this.state.sessionInitTimerId) {
                this.log('Session config received, clearing sessionInitTimerId.', false, { timerId: this.state.sessionInitTimerId });
                clearTimeout(this.state.sessionInitTimerId);
                this.state.sessionInitTimerId = null;
            } else {
                this.log('Session config received, but sessionInitTimerId was already null. This might indicate a very fast response or a double clear.', true);
            }
            
            this.processSessionData(sessionData);
            this.updateStatus('Session ready - Tap microphone to start', 'success');
            if (this.ui) this.ui.updateMicButton(false, true);
            this.log('initializeSession successfully completed.');

        } catch (error) {
            this.log(`Session initialization error in initializeSession: ${error.message}`, true, error);
            this.handleSessionInitError(error); // This also tries to clear the timer
        }
    }
    
    async fetchSessionConfigWithRetry(maxRetries = 3) {
        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.log(`Session config attempt ${attempt}/${maxRetries}`);
                const apiUrl = `https://n8n.lomeai.com/webhook/voice-session?session=${this.state.sessionToken}&action=initialize`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout for fetch
                const response = await fetch(apiUrl, { signal: controller.signal, headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
                clearTimeout(timeoutId);
                if (!response.ok) throw new Error(`API returned status ${response.status}: ${response.statusText}`);
                const rawData = await response.json();
                this.log(`Session config received: ${JSON.stringify(rawData).substring(0, 200)}...`);
                return rawData;
            } catch (error) {
                lastError = error;
                this.log(`Session config attempt ${attempt} failed: ${error.message}`, true);
                if (attempt < maxRetries) {
                    const delay = attempt * 2000;
                    this.log(`Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        this.log('fetchSessionConfigWithRetry failed after all retries.', true, lastError);
        throw lastError;
    }
    
    processSessionData(rawData) {
        try {
            let data = Array.isArray(rawData) && rawData.length > 0 ? rawData[0] : rawData;
            if (!data || !data.success) throw new Error(data?.error || 'Session configuration invalid or not successful');
            this.state.sessionConfig = data.config;
            const sessionInfoEl = document.getElementById('sessionInfo');
            if (sessionInfoEl) sessionInfoEl.textContent = `Session: ${data.sessionId || 'N/A'} | User: ${data.userId || 'N/A'}`;
            this.log(`Session configured - Model: ${this.state.sessionConfig?.model}, WebSocket: ${this.state.sessionConfig?.websocketProxyUrl}`);
        } catch (error) {
            this.log('Error in processSessionData', true, error);
            throw new Error('Failed to process session data: ' + error.message);
        }
    }
    
    handleSessionInitTimeout() {
        this.log('Session initialization TIMED OUT.', true, { timerId: this.state.sessionInitTimerId });
        this.updateStatus('Connection timed out - Tap to retry', 'error');
        if (typeof window.debugLog === 'function') {
            window.debugLog('[Client] Session initialization timed out', true, { currentTimerId: this.state.sessionInitTimerId });
        }
        // Ensure the timer reference is cleared if it fires
        this.state.sessionInitTimerId = null; 
    }
    
    handleSessionInitError(error) {
        this.updateStatus(`Failed to initialize: ${error.message}`, 'error');
        if (this.state.sessionInitTimerId) { 
            this.log('Clearing sessionInitTimerId due to session init error.', false, { timerId: this.state.sessionInitTimerId });
            clearTimeout(this.state.sessionInitTimerId);
            this.state.sessionInitTimerId = null;
        }
    }
    
    async connectToWebSocket() {
        if (!this.state.isInitialized && !this.state.sessionConfig) {
            this.log('connectToWebSocket: sessionConfig not ready, attempting initializeSession.');
            try { 
                await this.initializeSession(); 
                if (!this.state.sessionConfig) { // Check again after attempt
                    this.log('connectToWebSocket: initializeSession did not populate sessionConfig.', true);
                    this.updateStatus('Session config failed. Please retry.', 'error');
                    return false;
                }
            } catch (error) { 
                this.log('Failed to initialize session before WebSocket connection', true, error); 
                this.updateStatus('Session init failed. Please retry.', 'error');
                return false; 
            }
        }
        if (this.state.connectionAttempts >= this.state.maxConnectionAttempts) {
            this.updateStatus('Too many connection attempts. Please refresh.', 'error'); return false;
        }
        this.state.connectionAttempts++;
        try {
            this.log('WebSocket connection starting...');
            this.updateStatus('Connecting to server...');
            const wsUrl = this.state.sessionConfig?.websocketProxyUrl;
            if (!wsUrl) throw new Error('No WebSocket URL provided in session config');
            if (this.state.ws) { this.state.ws.close(); this.state.ws = null; }
            const fullWsUrl = `${wsUrl}&session=${this.state.sessionToken}`;
            this.log(`Connecting to: ${fullWsUrl}`);
            this.state.ws = new WebSocket(fullWsUrl);
            this.setupWebSocketHandlers();
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.log('WebSocket connection attempt timed out.', true);
                    reject(new Error('Connection timeout'));
                }, 10000); // 10s for WS connection
                this.state.ws.onopen = () => { clearTimeout(timeout); resolve(true); };
                this.state.ws.onerror = (err) => { clearTimeout(timeout); reject(err || new Error('WebSocket connection error')); };
            });
        } catch (error) {
            this.log(`Connection error: ${error.message}`, true);
            this.updateStatus('Connection failed: ' + error.message, 'error');
            return false;
        }
    }
    
    setupWebSocketHandlers() { /* ... same as in v3.0.3 ... */ }
    handleConnectionFailure() { /* ... same as in v3.0.3 ... */ }
    
    handleWebSocketMessage(message) {
        this.log('Message handling:', { type: message.type, keys: Object.keys(message), ts: message.timestamp });
        try {
            switch (message.type) {
                case 'session_initialized': this.handleSessionInitialized(); break;
                case 'gemini_connected': this.handleGeminiConnected(); break;
                case 'gemini_setup_complete': this.log('Gemini setup complete'); break;
                case 'gemini_disconnected': this.handleGeminiDisconnected(message.reason); break;
                case 'audio_response': case 'live_audio_chunk': this.handleAudioResponse(message); break;
                case 'text_response': if (this.ui) this.ui.addMessage(message.text, 'ai'); break;
                case 'error': this.handleServerError(message); break;
                case 'input_transcription': this.handleInputTranscription(message); break;
                case 'output_transcription': this.handleOutputTranscription(message); break;
                case 'turn_complete': case 'audio_stream_complete': this.handleTurnComplete(); break;
                case 'interrupted': this.handleInterruption(); break;
                case 'pong': this.log('Received pong response'); break;
                case 'health_check': this.log('Received health check'); break;
                case 'usage_metadata': 
                    this.log('Received usage_metadata', false, message.usage);
                    break;
                case 'debug_log':
                    this.log(`[Backend Debug] ${message.message || ''}`, message.isError, message.data);
                    break;
                default:
                    this.log(`Unknown message type: ${message.type}`, true, message);
            }
        } catch (error) { this.log(`Error handling message: ${error.message}`, true); }
    }
    
    handleSessionInitialized() { /* ... same as in v3.0.3 ... */ }
    handleGeminiConnected() { /* ... same as in v3.0.3 ... */ }
    handleGeminiDisconnected(reason) { /* ... same as in v3.0.3 ... */ }
    handleAudioResponse(message) { /* ... same as in v3.0.3 ... */ }
    handleInputTranscription(message) { /* ... same as in v3.0.3 ... */ }
    handleOutputTranscription(message) { /* ... same as in v3.0.3 ... */ }
    handleTurnComplete() { /* ... same as in v3.0.3 ... */ }
    handleInterruption() { /* ... same as in v3.0.3 ... */ }
    handleServerError(message) { /* ... same as in v3.0.3 ... */ }
    async toggleRecording() { /* ... same as in v3.0.3 ... */ }
    handleAudioStart() { /* ... same as in v3.0.3 ... */ }
    handleAudioEnd() { /* ... same as in v3.0.3 ... */ }
    handleAudioData(audioData, isEndOfSpeech) { /* ... same as in v3.0.3 ... */ }
    handlePlaybackStart() { /* ... same as in v3.0.3 ... */ }
    handlePlaybackEnd() { /* ... same as in v3.0.3 ... */ }
    handleVADSilenceDetected() { /* ... same as in v3.0.3 ... */ }
    handleAudioError(error) { /* ... same as in v3.0.3 ... */ }
    disconnect(reason = 'User disconnected') { /* ... same as in v3.0.3 ... */ }
    handleDisconnection(reason = 'Unknown reason') { /* ... same as in v3.0.3 ... */ }
    setupHealthMonitoring() { /* ... same as in v3.0.3 ... */ }
    updateStatus(message, type = '') { /* ... same as in v3.0.3 ... */ }
    handleCriticalError(context, error) { /* ... same as in v3.0.3 ... */ }
    safeExecute(fn) { /* ... same as in v3.0.3 ... */ }
    dispose() { /* ... same as in v3.0.3 ... */ }
    log(message, isError = false, data = null) { /* ... same as in v3.0.3 ... */ }
}

// --- Full content of unchanged methods from v3.0.3 ---
GeminiTelegramClient.prototype.setupWebSocketHandlers = function() {
    if (!this.state.ws) return;
    const connectionTimeout = setTimeout(() => {
        if (this.state.ws && this.state.ws.readyState === WebSocket.CONNECTING) {
            this.log('WebSocket connection timeout', true); this.state.ws.close();
            this.updateStatus('Connection timeout', 'error'); this.handleConnectionFailure();
        }
    }, 10000);
    this.state.ws.onopen = () => {
        clearTimeout(connectionTimeout); this.log('WebSocket connection opened');
        this.updateStatus('Connected, initializing session...');
        this.state.reconnectCount = 0; this.state.connectionAttempts = 0; this.state.lastActivity = Date.now();
    };
    this.state.ws.onmessage = (event) => {
        this.state.lastActivity = Date.now();
        try { const message = JSON.parse(event.data); this.handleWebSocketMessage(message); }
        catch (error) { this.log(`Failed to parse message: ${error.message}`, true); }
    };
    this.state.ws.onerror = (error) => {
        clearTimeout(connectionTimeout); this.log(`WebSocket error: ${error.message || 'Connection error'}`, true);
        this.updateStatus('Connection error', 'error'); this.handleConnectionFailure();
    };
    this.state.ws.onclose = (event) => {
        clearTimeout(connectionTimeout); const reason = event.reason || 'Connection closed';
        this.log(`WebSocket closed: ${event.code} ${reason}`);
        this.updateStatus('Connection closed', 'error'); this.handleDisconnection(reason);
    };
};

GeminiTelegramClient.prototype.handleConnectionFailure = function() {
    this.state.isConnected = false;
    if (this.state.reconnectCount < this.config.reconnectAttempts) {
        this.state.reconnectCount++;
        this.log(`Attempting reconnection ${this.state.reconnectCount}/${this.config.reconnectAttempts}...`);
        this.updateStatus(`Reconnecting (${this.state.reconnectCount}/${this.config.reconnectAttempts})...`);
        this.state.reconnectTimer = setTimeout(() => this.connectToWebSocket(), this.config.reconnectDelay);
    }
};

GeminiTelegramClient.prototype.handleSessionInitialized = function() {
    this.log('Session initialized successfully'); this.updateStatus('Session ready - Connecting to Gemini...');
    if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
        this.state.ws.send(JSON.stringify({ type: 'connect_gemini' }));
        this.log('Sent connect_gemini message');
    }
};

GeminiTelegramClient.prototype.handleGeminiConnected = function() {
    this.log('Gemini connected successfully'); this.state.isConnected = true;
    this.updateStatus('Connected! Tap microphone to talk', 'connected');
    if (this.ui) {
        this.ui.updateMicButton(false, true);
        this.ui.addMessage('🤖 Connected! Tap mic to talk.', 'ai');
    }
};

GeminiTelegramClient.prototype.handleGeminiDisconnected = function(reason) {
    this.log(`Gemini disconnected: ${reason}`); this.handleDisconnection(reason);
    if (this.ui) this.ui.addMessage(`🔌 Disconnected from Gemini: ${reason}`, 'system');
};

GeminiTelegramClient.prototype.handleAudioResponse = function(message) {
    this.log(`Audio response. Mime: ${message.mimeType}, Len: ${message.audioData?.length}`);
    if (message.audioData && message.mimeType) {
        try { this.audioBridge.playAudio(message.audioData, message.mimeType); if (this.ui) this.ui.setAISpeaking(true); }
        catch (error) { this.log(`Audio playback error: ${error.message}`, true); }
    } else { this.log('Invalid audio response format', true); }
};

GeminiTelegramClient.prototype.handleInputTranscription = function(message) {
    if (message.text) {
        this.state.transcriptions.input = message.text;
        if (this.ui) { this.ui.updateInputTranscription(message.text); this.ui.addMessage(`🎤 You: ${message.text}`, 'user');}
    }
};

GeminiTelegramClient.prototype.handleOutputTranscription = function(message) {
    if (message.text) { this.state.transcriptions.output = message.text; if (this.ui) this.ui.updateOutputTranscription(message.text); }
};

GeminiTelegramClient.prototype.handleTurnComplete = function() {
    this.log('Turn complete'); this.state.transcriptions.input = ''; this.state.transcriptions.output = '';
    setTimeout(() => { if (this.ui) this.ui.clearTranscriptions(); }, 3000);
};

GeminiTelegramClient.prototype.handleInterruption = function() {
    this.log('Model generation interrupted'); this.audioBridge.stopPlayback();
    if (this.ui) { this.ui.setAISpeaking(false); this.ui.addMessage('(interrupted)', 'system');}
};

GeminiTelegramClient.prototype.handleServerError = function(messagePayload) { // Renamed 'message' to 'messagePayload' to avoid conflict
    this.log(`Server error: ${messagePayload.message}`, true); this.updateStatus(messagePayload.message, 'error');
};
    
GeminiTelegramClient.prototype.toggleRecording = async function() {
    if (!this.state.isConnected && this.config.autoConnect) {
        try { 
            this.log('toggleRecording: Not connected, attempting to connect...');
            await this.connectToWebSocket(); 
            if (!this.state.isConnected) { // Check if connection was successful
                 this.updateStatus('Connection failed. Please try again.', 'error');
                 return;
            }
        } catch (error) { 
            this.updateStatus('Connection failed. Please try again.', 'error'); 
            return; 
        }
    }
    // Add a small delay if just connected to allow Gemini connection to establish
    if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN && !this.state.isConnected) {
        this.log('toggleRecording: WS open but Gemini not yet connected, waiting briefly...');
        await new Promise(resolve => setTimeout(resolve, 750)); // Wait for gemini_connected
    }


    try {
        if (this.audioBridge.state && this.audioBridge.state.isRecording) {
            await this.audioBridge.stopRecording();
            if (this.ui) { this.ui.updateMicButton(false); this.ui.setUserSpeaking(false); }
            this.updateStatus('Connected! Tap microphone to talk', 'connected');
        } else {
            if (!this.audioBridge.state || !this.audioBridge.state.initialized || !this.audioBridge.state.audioContextReady) {
                this.log('AudioBridge not fully ready, attempting requestPermissionAndResumeContext...');
                if (typeof this.audioBridge.requestPermissionAndResumeContext === 'function') {
                    const audioReady = await this.audioBridge.requestPermissionAndResumeContext();
                    if (!audioReady) {
                        this.updateStatus('Audio setup failed. Check permissions.', 'error');
                        return;
                    }
                } else { 
                    const initialized = await this.audioBridge.initialize(); // Fallback
                    if (!initialized) { this.updateStatus('Audio init failed (fallback). Check permissions.', 'error'); return; }
                }
            }
            const started = await this.audioBridge.startRecording();
            if (started) {
                if (this.ui) { this.ui.updateMicButton(true); this.ui.setUserSpeaking(true); }
                this.updateStatus('Listening... Speak now', 'recording');
            } else { this.updateStatus('Failed to start recording', 'error'); }
        }
    } catch (error) {
        this.log(`Recording toggle error: ${error.message}`, true, error);
        this.updateStatus('Recording error: ' + error.message, 'error');
    }
};
    
GeminiTelegramClient.prototype.handleAudioStart = function() { this.log('Audio recording started'); if (this.ui) this.ui.setUserSpeaking(true); };
GeminiTelegramClient.prototype.handleAudioEnd = function() { this.log('Audio recording ended'); if (this.ui) this.ui.setUserSpeaking(false); };
    
GeminiTelegramClient.prototype.handleAudioData = function(audioData, isEndOfSpeech) {
    if (!this.state.ws || this.state.ws.readyState !== WebSocket.OPEN) { this.log('WebSocket not connected for sending audio', true); return; }
    const messagePayload = { type: 'audio_input', audioData, mimeType: 'audio/webm;codecs=opus', isEndOfSpeech, timestamp: Date.now() };
    try { this.state.ws.send(JSON.stringify(messagePayload)); this.log(`Audio sent: ${audioData ? audioData.length : 0}b, EOS: ${isEndOfSpeech}`); }
    catch (error) { this.log(`Failed to send audio: ${error.message}`, true); }
};
    
GeminiTelegramClient.prototype.handlePlaybackStart = function() { this.log('Audio playback started'); if (this.ui) this.ui.setAISpeaking(true); };
GeminiTelegramClient.prototype.handlePlaybackEnd = function() { this.log('Audio playback ended'); if (this.ui) this.ui.setAISpeaking(false); };
GeminiTelegramClient.prototype.handleVADSilenceDetected = function() { this.log('VAD silence detected - End of speech'); };
GeminiTelegramClient.prototype.handleAudioError = function(error) { this.log(`Audio error: ${error.message}`, true); this.updateStatus(`Audio error: ${error.message}`, 'error'); };
    
GeminiTelegramClient.prototype.disconnect = function(reason = 'User disconnected') {
    this.log(`Disconnecting... Reason: ${reason}`);
    if (this.audioBridge) { this.audioBridge.stopRecording(); this.audioBridge.stopPlayback(); }
    if (this.state.ws) this.state.ws.close(1000, reason);
    this.handleDisconnection(reason);
};
    
GeminiTelegramClient.prototype.handleDisconnection = function(reason = 'Unknown reason') {
    this.state.isConnected = false;
    if (this.state.reconnectTimer) { clearTimeout(this.state.reconnectTimer); this.state.reconnectTimer = null; }
    if (this.ui) { this.ui.setUserSpeaking(false); this.ui.setAISpeaking(false); this.ui.updateMicButton(false, true); }
    this.updateStatus(`Disconnected: ${reason}. Tap mic to reconnect.`, 'error');
};
    
GeminiTelegramClient.prototype.setupHealthMonitoring = function() {
    if (this.state.healthCheckTimer) clearInterval(this.state.healthCheckTimer); // Clear existing if any
    this.state.healthCheckTimer = setInterval(() => {
        if (this.state.isConnected && this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            try { this.state.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() })); }
            catch (error) { this.log(`Health check ping failed: ${error.message}`, true); }
        }
    }, this.config.healthCheckInterval);
};
    
GeminiTelegramClient.prototype.updateStatus = function(message, type = '') {
    if (this.ui) this.ui.updateStatus(message, type);
    else { const el = document.getElementById('status'); if (el) { el.textContent = message; el.className = 'status ' + type; }}
    this.log(`Status: ${message} (${type || 'info'})`);
};
    
GeminiTelegramClient.prototype.handleCriticalError = function(context, error) {
    const message = `${context}: ${error.message}`; this.log(message, true, error.stack);
    if (typeof window.debugLog === 'function') window.debugLog(message, true, {stack: error.stack});
    if (typeof window.showCriticalError === 'function') window.showCriticalError(message, error.stack);
};
    
GeminiTelegramClient.prototype.safeExecute = function(fn) { try { return fn(); } catch (error) { this.log(`Safe execution failed: ${error.message}`, true, error.stack); }};
    
GeminiTelegramClient.prototype.dispose = function() {
    this.log('Disposing client...');
    [this.state.sessionInitTimerId, this.state.reconnectTimer, this.state.healthCheckTimer].forEach(timerId => {
        if (timerId) clearTimeout(timerId);
    });
    this.state.sessionInitTimerId = null;
    this.state.reconnectTimer = null;
    this.state.healthCheckTimer = null;

    if (this.audioBridge) this.audioBridge.dispose();
    if (this.state.ws) this.state.ws.close();
    this.log('Client disposed');
};
    
GeminiTelegramClient.prototype.log = function(message, isError = false, data = null) {
    if (this.config.debug) {
        const logMethod = isError ? console.error : console.log;
        const fullMessage = `[Modern GeminiTelegramClient] ${message}`;
        if (data) logMethod(fullMessage, data);
        else logMethod(fullMessage);
        
        if (typeof window.debugLog === 'function') {
            window.debugLog(`[Client] ${message}`, isError, data);
        }
    }
};
// --- End of GeminiTelegramClient class ---
