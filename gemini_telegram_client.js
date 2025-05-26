/**
 * Enhanced Gemini Telegram Client with improved mobile compatibility and error handling
 * Version: 2.0.0
 */

class GeminiTelegramClient {
    constructor() {
        console.log('🔄 [DEBUG] Enhanced GeminiTelegramClient constructor called');
        
        try {
            this.config = {
                debug: true,
                reconnectAttempts: 3,
                reconnectDelay: 2000,
                sessionTimeout: 45000, // Increased timeout
                vadSilenceThreshold: 0.01,
                vadRequiredSilenceDuration: 1500,
                healthCheckInterval: 30000,
                connectionRetryDelay: 1000
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
                maxConnectionAttempts: 5
            };
            
            // UI Elements with better error handling
            this.ui = this.initializeUIElements();
            
            // Initialize system
            this.initialize();
            
        } catch (error) {
            this.handleCriticalError('Constructor failed', error);
        }
    }
    
    initializeUIElements() {
        const elements = {};
        const requiredElements = [
            'status', 'micButton', 'connectBtn', 'disconnectBtn', 
            'conversationLog', 'sessionInfo', 'waveform'
        ];
        
        for (const id of requiredElements) {
            elements[id] = document.getElementById(id);
            if (!elements[id]) {
                this.log(`Warning: Element ${id} not found`, true);
            }
        }
        
        return elements;
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
            
            // Initialize audio bridge with error handling
            this.audioBridge = new TelegramAudioBridge({
                debug: this.config.debug,
                vadSilenceThreshold: this.config.vadSilenceThreshold,
                vadRequiredSilenceDuration: this.config.vadRequiredSilenceDuration,
                onAudioStart: () => this.handleAudioStart(),
                onAudioEnd: () => this.handleAudioEnd(),
                onAudioData: (data, isEndOfSpeech) => this.handleAudioData(data, isEndOfSpeech),
                onPlaybackStart: () => this.handlePlaybackStart(),
                onPlaybackEnd: () => this.handlePlaybackEnd(),
                onVADSilenceDetected: () => this.handleVADSilenceDetected(),
                onError: (error) => this.handleAudioError(error)
            });
            
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
            // Button event listeners with error handling
            this.ui.micButton?.addEventListener('click', () => {
                this.safeExecute(() => this.toggleRecording());
            });
            
            this.ui.connectBtn?.addEventListener('click', () => {
                this.safeExecute(() => this.connectToWebSocket());
            });
            
            this.ui.disconnectBtn?.addEventListener('click', () => {
                this.safeExecute(() => this.disconnect());
            });
            
            // Generate waveform
            this.generateWaveBars();
            
            this.log('UI setup completed');
        } catch (error) {
            this.log('UI setup error: ' + error.message, true);
        }
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
            
            this.updateStatus('Session ready - Click Connect');
            this.ui.connectBtn.disabled = false;
            
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
            this.ui.sessionInfo.textContent = `Session: ${data.sessionId} | User: ${data.userId}`;
            
            this.log(`Session configured - Model: ${this.state.sessionConfig.model}, WebSocket: ${this.state.sessionConfig.websocketProxyUrl}`);
            
        } catch (error) {
            throw new Error('Failed to process session data: ' + error.message);
        }
    }
    
    handleSessionInitTimeout() {
        this.log('Session initialization timed out', true);
        this.updateStatus('Connection timed out - Click to retry', 'error');
        this.showRetryButton();
    }
    
    handleSessionInitError(error) {
        this.updateStatus(`Failed to initialize: ${error.message}`, 'error');
        
        // Clear timeout if it exists
        if (this.state.sessionInitTimer) {
            clearTimeout(this.state.sessionInitTimer);
            this.state.sessionInitTimer = null;
        }
        
        // Show retry option after a delay
        setTimeout(() => {
            this.showRetryButton();
        }, 2000);
    }
    
    showRetryButton() {
        this.updateStatus('Click Connect to retry', 'error');
        this.ui.connectBtn.disabled = false;
        this.ui.connectBtn.textContent = 'Retry Connection';
        
        // Reset button text after successful connection
        const originalHandler = this.ui.connectBtn.onclick;
        this.ui.connectBtn.onclick = () => {
            this.ui.connectBtn.textContent = 'Connect';
            this.ui.connectBtn.onclick = originalHandler;
            this.safeExecute(() => this.connectToWebSocket());
        };
    }
    
    async connectToWebSocket() {
        if (!this.state.isInitialized && !this.state.sessionConfig) {
            try {
                await this.initializeSession();
            } catch (error) {
                this.log('Failed to initialize before connection', true);
                return;
            }
        }
        
        if (this.state.connectionAttempts >= this.state.maxConnectionAttempts) {
            this.updateStatus('Too many connection attempts. Please refresh.', 'error');
            return;
        }
        
        this.state.connectionAttempts++;
        
        try {
            this.ui.connectBtn.disabled = true;
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
            
        } catch (error) {
            this.log(`Connection error: ${error.message}`, true);
            this.updateStatus('Connection failed: ' + error.message, 'error');
            this.ui.connectBtn.disabled = false;
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
        this.ui.connectBtn.disabled = false;
        
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
                    
                case 'gemini_disconnected':
                    this.handleGeminiDisconnected(message.reason);
                    break;
                    
                case 'audio_response':
                    this.handleAudioResponse(message);
                    break;
                    
                case 'text_response':
                    this.addMessage('🤖 ' + message.text, 'ai');
                    break;
                    
                case 'error':
                    this.handleServerError(message);
                    break;
                    
                case 'input_transcription':
                    this.addMessage(`🎤 You: ${message.text}`, 'user');
                    break;
                    
                case 'turn_complete':
                    this.log('Turn complete');
                    break;
                    
                case 'interrupted':
                    this.log('Model generation interrupted');
                    this.audioBridge.stopPlayback();
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
        this.updateStatus('Connected! Click microphone to talk', 'connected');
        this.ui.micButton.disabled = false;
        this.ui.micButton.classList.add('connected');
        this.ui.disconnectBtn.disabled = false;
        this.ui.connectBtn.disabled = true;
        this.addMessage('🤖 Connected! I can hear you now. Click the microphone to start talking!', 'ai');
    }
    
    handleGeminiDisconnected(reason) {
        this.log(`Gemini disconnected: ${reason}`);
        this.handleDisconnection(reason);
        this.addMessage(`🔌 Disconnected from Gemini: ${reason}`, 'ai');
    }
    
    handleAudioResponse(message) {
        this.log(`Audio response received. MimeType: ${message.mimeType}, Length: ${message.audioData?.length}`);
        
        if (message.audioData && message.mimeType) {
            try {
                this.audioBridge.playAudio(message.audioData, message.mimeType);
                this.animateWaveformForAudio();
            } catch (error) {
                this.log(`Audio playback error: ${error.message}`, true);
            }
        } else {
            this.log('Invalid audio response format', true);
        }
    }
    
    handleServerError(message) {
        this.log(`Server error: ${message.message}`, true);
        this.updateStatus(message.message, 'error');
    }
    
    async toggleRecording() {
        if (!this.state.isConnected) {
            this.updateStatus('Please connect first', 'error');
            return;
        }
        
        try {
            if (this.audioBridge.isRecording) {
                await this.audioBridge.stopRecording();
                this.ui.micButton.classList.remove('recording');
                this.ui.micButton.innerHTML = '🎤';
                this.updateStatus('Connected! Click microphone to talk', 'connected');
            } else {
                // Mobile audio unlock attempt
                if (!this.audioBridge.audioUnlocked) {
                    const unlocked = await this.audioBridge.initialize();
                    if (!unlocked) {
                        this.updateStatus('Audio access denied. Please check permissions.', 'error');
                        return;
                    }
                }
                
                const started = await this.audioBridge.startRecording();
                if (started) {
                    this.ui.micButton.classList.add('recording');
                    this.ui.micButton.innerHTML = '⏹️';
                    this.updateStatus('Listening... Speak now', 'recording');
                    this.startWaveAnimation();
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
        this.startWaveAnimation();
    }
    
    handleAudioEnd() {
        this.log('Audio recording ended');
        this.stopWaveAnimation();
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
    }
    
    handlePlaybackEnd() {
        this.log('Audio playback ended');
    }
    
    handleVADSilenceDetected() {
        this.log('VAD silence detected');
    }
    
    handleAudioError(error) {
        this.log(`Audio error: ${error.message}`, true);
        this.updateStatus(`Audio error: ${error.message}`, 'error');
    }
    
    // Animation functions
    startWaveAnimation() {
        this.log('Wave animation started');
    }
    
    stopWaveAnimation() {
        const bars = this.ui.waveform?.querySelectorAll('.wave-bar');
        if (bars) {
            bars.forEach(bar => bar.style.height = '10px');
        }
        this.log('Wave animation stopped');
    }
    
    animateWaveformForAudio() {
        const bars = this.ui.waveform?.querySelectorAll('.wave-bar');
        if (bars) {
            bars.forEach(bar => {
                const height = Math.max(5, Math.random() * 40);
                bar.style.height = `${height}px`;
                
                setTimeout(() => {
                    bar.style.height = '10px';
                }, 300);
            });
        }
    }
    
    generateWaveBars() {
        if (!this.ui.waveform) return;
        
        this.ui.waveform.innerHTML = '';
        for (let i = 0; i < 50; i++) {
            const bar = document.createElement('div');
            bar.className = 'wave-bar';
            bar.style.height = '10px';
            this.ui.waveform.appendChild(bar);
        }
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
        this.ui.micButton.disabled = true;
        this.ui.micButton.classList.remove('connected', 'recording');
        this.ui.micButton.innerHTML = '🎤';
        this.ui.connectBtn.disabled = false;
        this.ui.disconnectBtn.disabled = true;
        this.updateStatus(`Disconnected: ${reason}. Click Connect.`, 'error');
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
        if (this.ui.status) {
            this.ui.status.textContent = message;
            this.ui.status.className = 'status ' + type;
        }
        
        // Also log status changes
        this.log(`Status: ${message} (${type})`);
    }
    
    addMessage(text, sender) {
        if (!this.ui.conversationLog) return;
        
        const messageEl = document.createElement('div');
        messageEl.className = `message ${sender}`;
        messageEl.textContent = text;
        
        const avatarEl = document.createElement('div');
        avatarEl.className = 'message-avatar';
        avatarEl.textContent = sender === 'ai' ? 'K' : 'U';
        messageEl.appendChild(avatarEl);
        
        this.ui.conversationLog.appendChild(messageEl);
        this.ui.conversationLog.scrollTop = this.ui.conversationLog.scrollHeight;
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
    log(...args) {
        if (this.config.debug) {
            console.log('[Enhanced GeminiTelegramClient]', ...args);
            
            // Global debug system integration
            if (typeof window.debugLog === 'function') {
                const message = args.map(arg => {
                    if (typeof arg === 'object') {
                        try {
                            return JSON.stringify(arg);
                        } catch (e) {
                            return '[Object]';
                        }
                    }
                    return arg;
                }).join(' ');
                
                window.debugLog(`[Client] ${message}`, args.some(arg => 
                    typeof arg === 'string' && arg.toLowerCase().includes('error')
                ));
            }
        }
    }
}

// The instance will be created by the main HTML initialization function
// No need for DOMContentLoaded listener since we're creating the instance manually
