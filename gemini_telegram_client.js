/**
 * Gemini Telegram Client
 * 
 * A WebRTC-based client for Gemini Live API integration with Telegram Mini Apps.
 * This client uses the TelegramAudioBridge for audio handling and provides a
 * seamless voice chat experience optimized for mobile devices.
 * 
 * Version: 1.0.0
 */

class GeminiTelegramClient {
    constructor() {
        console.log('🔄 [DEBUG] GeminiTelegramClient constructor called');
        
        try {
            // Configuration
            this.config = {
                debug: true,
                reconnectAttempts: 3,
                reconnectDelay: 2000,
                sessionTimeout: 30000,
                vadSilenceThreshold: 0.01,
                vadRequiredSilenceDuration: 1500
            };
            
            // State
            this.sessionToken = null;
            this.sessionConfig = null;
            this.isConnected = false;
            this.isInitialized = false;
            this.ws = null;
            this.reconnectCount = 0;
            this.reconnectTimer = null;
            this.sessionInitTimer = null;
            
            console.log('🔄 [DEBUG] Getting UI elements');
            
            // UI Elements
            this.statusEl = document.getElementById('status');
            if (!this.statusEl) console.error('❌ [ERROR] Status element not found');
            
            this.micButton = document.getElementById('micButton');
            if (!this.micButton) console.error('❌ [ERROR] Mic button not found');
            
            this.connectBtn = document.getElementById('connectBtn');
            if (!this.connectBtn) console.error('❌ [ERROR] Connect button not found');
            
            this.disconnectBtn = document.getElementById('disconnectBtn');
            if (!this.disconnectBtn) console.error('❌ [ERROR] Disconnect button not found');
            
            this.conversationLog = document.getElementById('conversationLog');
            if (!this.conversationLog) console.error('❌ [ERROR] Conversation log not found');
            
            this.sessionInfo = document.getElementById('sessionInfo');
            if (!this.sessionInfo) console.error('❌ [ERROR] Session info not found');
            
            this.waveform = document.getElementById('waveform');
            if (!this.waveform) console.error('❌ [ERROR] Waveform not found');
            
            this.debugInfo = document.getElementById('debugInfo');
            
            console.log('✅ [DEBUG] UI elements initialized');
            
            // Check if TelegramAudioBridge is available
            if (typeof TelegramAudioBridge === 'undefined') {
                console.error('❌ [ERROR] TelegramAudioBridge is not defined. Make sure it loaded correctly.');
                this.updateStatus('Error: Audio components not loaded', 'error');
                return;
            }
            
            console.log('🔄 [DEBUG] Initializing TelegramAudioBridge');
            
            // Initialize audio bridge
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
            
            console.log('✅ [DEBUG] TelegramAudioBridge initialized');
            
            // Initialize UI
            this.initializeUI();
            
            // Initialize session
            this.initializeSession();
            
            // Setup animation
            this.setupParticleAnimation();
            
            console.log('✅ [DEBUG] GeminiTelegramClient constructor completed');
        } catch (error) {
            console.error('❌ [CRITICAL ERROR] Error in GeminiTelegramClient constructor:', error);
            if (this.statusEl) {
                this.statusEl.textContent = 'Critical error: ' + error.message;
                this.statusEl.className = 'status error';
            } else {
                // If we can't even get the status element, create a new one
                const errorDiv = document.createElement('div');
                errorDiv.style.color = 'red';
                errorDiv.style.padding = '20px';
                errorDiv.style.margin = '20px';
                errorDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
                errorDiv.style.borderRadius = '10px';
                errorDiv.textContent = 'Critical initialization error: ' + error.message;
                document.body.prepend(errorDiv);
            }
        }
    }
    
    /**
     * Initialize UI elements and event listeners
     */
    initializeUI() {
        // Set up button event listeners
        this.micButton.addEventListener('click', () => this.toggleRecording());
        this.connectBtn.addEventListener('click', () => this.connectToWebSocket());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        
        // Generate waveform bars
        this.generateWaveBars();
        
        this.log('UI initialized');
    }
    
    /**
     * Generate wave bars for audio visualization
     */
    generateWaveBars() {
        this.waveform.innerHTML = '';
        for (let i = 0; i < 50; i++) {
            const bar = document.createElement('div');
            bar.className = 'wave-bar';
            bar.style.height = '10px';
            this.waveform.appendChild(bar);
        }
    }
    
    /**
     * Initialize session by fetching configuration from the server
     */
    async initializeSession() {
        try {
            this.log('Starting session initialization...');
            this.updateStatus('Getting session config...');
            
            // Get session token from URL
            const urlParams = new URLSearchParams(window.location.search);
            this.sessionToken = urlParams.get('session');
            
            if (!this.sessionToken) {
                throw new Error('No session token provided');
            }
            
            this.log(`Session token: ${this.sessionToken.substring(0, 20)}...`);
            
            // Set session initialization timeout
            this.sessionInitTimer = setTimeout(() => {
                this.handleSessionInitTimeout();
            }, this.config.sessionTimeout);
            
            // Fetch session configuration from server
            const apiUrl = `https://n8n.lomeai.com/webhook/voice-session?session=${this.sessionToken}&action=initialize`;
            this.log(`Calling API: ${apiUrl}`);
            
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`API returned status ${response.status}`);
            }
            
            const rawData = await response.json();
            this.log(`Raw response: ${JSON.stringify(rawData).substring(0, 200)}...`);
            
            // Clear timeout since we got a response
            clearTimeout(this.sessionInitTimer);
            
            // Process response
            let data = Array.isArray(rawData) && rawData.length > 0 ? rawData[0] : rawData;
            
            if (!data || !data.success) {
                throw new Error(data?.error || 'Failed to initialize session');
            }
            
            this.sessionConfig = data.config;
            this.sessionInfo.textContent = `Session: ${data.sessionId} | User: ${data.userId}`;
            
            this.log(`Model: ${this.sessionConfig.model}, WebSocket URL: ${this.sessionConfig.websocketProxyUrl}`);
            
            this.updateStatus('Ready to connect');
            this.connectBtn.disabled = false;
            this.isInitialized = true;
            
        } catch (error) {
            this.log(`Session initialization error: ${error.message}`);
            this.updateStatus(`Failed to initialize: ${error.message}`, 'error');
            
            // Clear timeout if it exists
            if (this.sessionInitTimer) {
                clearTimeout(this.sessionInitTimer);
            }
            
            // Show retry button after a delay
            setTimeout(() => {
                this.updateStatus('Click to retry initialization', 'error');
                this.connectBtn.disabled = false;
                this.connectBtn.textContent = 'Retry';
                this.connectBtn.addEventListener('click', () => window.location.reload(), { once: true });
            }, 3000);
        }
    }
    
    /**
     * Handle session initialization timeout
     */
    handleSessionInitTimeout() {
        this.log('Session initialization timed out');
        this.updateStatus('Connection timed out. Please try again.', 'error');
        
        // Show retry button
        this.connectBtn.disabled = false;
        this.connectBtn.textContent = 'Retry';
        this.connectBtn.addEventListener('click', () => window.location.reload(), { once: true });
    }
    
    /**
     * Connect to the WebSocket server
     */
    async connectToWebSocket() {
        if (!this.isInitialized) {
            this.updateStatus('Session not initialized', 'error');
            return;
        }
        
        try {
            this.connectBtn.disabled = true;
            this.log('Connecting to WebSocket proxy...');
            this.updateStatus('Connecting...', '');
            
            const wsUrl = this.sessionConfig.websocketProxyUrl;
            if (!wsUrl) {
                throw new Error('No WebSocket proxy URL provided');
            }
            
            // Close existing connection if any
            if (this.ws) {
                this.ws.close();
                this.ws = null;
            }
            
            // Connect to WebSocket server
            this.ws = new WebSocket(`${wsUrl}&session=${this.sessionToken}`);
            
            // Set up event handlers
            this.ws.onopen = () => {
                this.log('WebSocket connection opened');
                this.updateStatus('WebSocket connected, waiting for session initialization...', '');
                this.reconnectCount = 0; // Reset reconnect count on successful connection
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleWebSocketMessage(message);
                } catch (error) {
                    this.log(`Failed to parse message: ${error.message}`);
                }
            };
            
            this.ws.onerror = (error) => {
                this.log(`WebSocket error: ${error.message || 'Unknown error'}`);
                this.updateStatus('Connection error', 'error');
                this.handleDisconnection();
            };
            
            this.ws.onclose = (event) => {
                this.log(`WebSocket closed: ${event.code} ${event.reason}`);
                this.updateStatus('Connection closed', 'error');
                this.handleDisconnection(event.reason || 'Closed by server');
            };
            
        } catch (error) {
            this.log(`Connection error: ${error.message}`);
            this.updateStatus('Connection failed: ' + error.message, 'error');
            this.connectBtn.disabled = false;
        }
    }
    
    /**
     * Handle WebSocket messages from the server
     * @param {Object} message - The message received from the server
     */
    handleWebSocketMessage(message) {
        this.log('Received message:', {
            type: message.type,
            keys: Object.keys(message),
            hasAudioData: !!message.audioData,
            audioDataLength: message.audioData ? message.audioData.length : 0,
            mimeType: message.mimeType
        });
        
        switch (message.type) {
            case 'session_initialized':
                this.log('Session initialized successfully');
                this.updateStatus('Session ready - Connecting to Gemini...', '');
                this.ws.send(JSON.stringify({ type: 'connect_gemini' }));
                this.log('Sent connect_gemini message');
                break;
                
            case 'gemini_connected':
                this.log('Received gemini_connected message');
                this.isConnected = true;
                this.updateStatus('Connected! Click microphone to talk', 'connected');
                this.micButton.disabled = false;
                this.micButton.classList.add('connected');
                this.disconnectBtn.disabled = false;
                this.connectBtn.disabled = true;
                this.addMessage('🤖 Connected! I can hear you now. Click the microphone to start talking!', 'ai');
                break;
                
            case 'gemini_disconnected':
                this.log('Received gemini_disconnected message: ' + message.reason);
                this.handleDisconnection(message.reason);
                this.addMessage(`🔌 Disconnected from Gemini: ${message.reason}`, 'ai');
                break;
                
            case 'audio_response':
                this.log(`Received audio response. MimeType: ${message.mimeType}, Length: ${message.audioData?.length}`);
                
                if (message.audioData && message.mimeType) {
                    try {
                        this.audioBridge.playAudio(message.audioData, message.mimeType);
                        this.animateWaveformForAudio();
                        this.log('Audio sent to bridge for playback');
                    } catch (error) {
                        this.log(`Audio playback error: ${error.message}`);
                    }
                } else {
                    this.log(`Invalid audio response - Data: ${!!message.audioData}, MimeType: ${message.mimeType}`);
                }
                break;
                
            case 'text_response':
                this.addMessage('🤖 ' + message.text, 'ai');
                break;
                
            case 'error':
                this.log(`Server error: ${message.message}`);
                this.updateStatus(message.message, 'error');
                break;
                
            case 'gemini_setup_complete':
                this.log('Gemini setup complete');
                break;
                
            case 'input_transcription':
                this.log(`Input transcription: ${message.text}`);
                this.addMessage(`🎤 You: ${message.text}`, 'user');
                break;
                
            case 'output_transcription':
                this.log(`Output transcription: ${message.text}`);
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
    }
    
    /**
     * Toggle recording state
     */
    async toggleRecording() {
        if (!this.isConnected) {
            this.updateStatus('Please connect first', 'error');
            return;
        }
        
        if (this.audioBridge.isRecording) {
            await this.audioBridge.stopRecording();
            this.micButton.classList.remove('recording');
            this.micButton.innerHTML = '🎤';
            this.updateStatus('Connected! Click microphone to talk', 'connected');
        } else {
            const started = await this.audioBridge.startRecording();
            if (started) {
                this.micButton.classList.add('recording');
                this.micButton.innerHTML = '⏹️';
                this.updateStatus('Listening... Speak now', 'recording');
                this.startWaveAnimation();
            } else {
                this.updateStatus('Failed to start recording', 'error');
            }
        }
    }
    
    /**
     * Handle audio start event from the audio bridge
     */
    handleAudioStart() {
        this.log('Audio recording started');
        this.startWaveAnimation();
    }
    
    /**
     * Handle audio end event from the audio bridge
     */
    handleAudioEnd() {
        this.log('Audio recording ended');
        this.stopWaveAnimation();
    }
    
    /**
     * Handle audio data from the audio bridge
     * @param {string} audioData - Base64-encoded audio data
     * @param {boolean} isEndOfSpeech - Whether this is the end of speech
     */
    handleAudioData(audioData, isEndOfSpeech) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.log('WebSocket not connected for sending audio');
            return;
        }
        
        const messagePayload = {
            type: 'audio_input',
            audioData: audioData,
            mimeType: 'audio/webm;codecs=opus',
            isEndOfSpeech: isEndOfSpeech
        };
        
        this.ws.send(JSON.stringify(messagePayload));
        this.log(`Audio sent: ${audioData ? audioData.length : 0} bytes, EOS: ${isEndOfSpeech}`);
    }
    
    /**
     * Handle playback start event from the audio bridge
     */
    handlePlaybackStart() {
        this.log('Audio playback started');
    }
    
    /**
     * Handle playback end event from the audio bridge
     */
    handlePlaybackEnd() {
        this.log('Audio playback ended');
    }
    
    /**
     * Handle VAD silence detection event from the audio bridge
     */
    handleVADSilenceDetected() {
        this.log('VAD silence detected');
    }
    
    /**
     * Handle audio error from the audio bridge
     * @param {Error} error - The error that occurred
     */
    handleAudioError(error) {
        this.log(`Audio error: ${error.message}`);
        this.updateStatus(`Audio error: ${error.message}`, 'error');
    }
    
    /**
     * Start wave animation for audio visualization
     */
    startWaveAnimation() {
        // Animation is handled by the audio bridge
        this.log('Wave animation started');
    }
    
    /**
     * Stop wave animation
     */
    stopWaveAnimation() {
        // Reset wave bars
        const bars = this.waveform.querySelectorAll('.wave-bar');
        bars.forEach(bar => bar.style.height = '10px');
        this.log('Wave animation stopped');
    }
    
    /**
     * Animate waveform for audio playback
     */
    animateWaveformForAudio() {
        // Simple animation for received audio
        const bars = this.waveform.querySelectorAll('.wave-bar');
        bars.forEach(bar => {
            const height = Math.max(5, Math.random() * 40);
            bar.style.height = `${height}px`;
            
            // Reset after a short delay
            setTimeout(() => {
                bar.style.height = '10px';
            }, 300);
        });
    }
    
    /**
     * Disconnect from the WebSocket server
     * @param {string} reason - Reason for disconnection
     */
    disconnect(reason = 'User disconnected') {
        this.log(`Disconnecting... Reason: ${reason}`);
        
        // Stop audio bridge
        this.audioBridge.stopRecording();
        this.audioBridge.stopPlayback();
        
        // Close WebSocket
        if (this.ws) {
            this.ws.close(1000, reason);
        }
        
        this.handleDisconnection(reason);
    }
    
    /**
     * Handle disconnection event
     * @param {string} reason - Reason for disconnection
     */
    handleDisconnection(reason = 'Unknown reason') {
        this.isConnected = false;
        
        // Update UI
        this.micButton.disabled = true;
        this.micButton.classList.remove('connected', 'recording');
        this.micButton.innerHTML = '🎤';
        this.connectBtn.disabled = false;
        this.disconnectBtn.disabled = true;
        this.updateStatus(`Disconnected: ${reason}. Click Connect.`, 'error');
        
        // Attempt reconnection if appropriate
        if (reason === 'Connection lost' && this.reconnectCount < this.config.reconnectAttempts) {
            this.reconnectCount++;
            this.log(`Attempting reconnection ${this.reconnectCount}/${this.config.reconnectAttempts}...`);
            this.updateStatus(`Connection lost. Reconnecting (${this.reconnectCount}/${this.config.reconnectAttempts})...`, 'error');
            
            this.reconnectTimer = setTimeout(() => {
                this.connectToWebSocket();
            }, this.config.reconnectDelay);
        }
    }
    
    /**
     * Update status display
     * @param {string} message - Status message
     * @param {string} type - Status type ('', 'connected', 'recording', 'error')
     */
    updateStatus(message, type = '') {
        this.statusEl.textContent = message;
        this.statusEl.className = 'status ' + type;
    }
    
    /**
     * Add a message to the conversation log
     * @param {string} text - Message text
     * @param {string} sender - Message sender ('user' or 'ai')
     */
    addMessage(text, sender) {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${sender}`;
        messageEl.textContent = text;
        
        const avatarEl = document.createElement('div');
        avatarEl.className = 'message-avatar';
        avatarEl.textContent = sender === 'ai' ? 'K' : 'U';
        messageEl.appendChild(avatarEl);
        
        this.conversationLog.appendChild(messageEl);
        this.conversationLog.scrollTop = this.conversationLog.scrollHeight;
    }
    
    /**
     * Set up particle animation for background
     */
    setupParticleAnimation() {
        const particles = document.getElementById('particles');
        if (!particles) return;
        
        // Create particles
        for (let i = 0; i < 50; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            
            // Random size
            const size = Math.random() * 5 + 2;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            
            // Random position
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.top = `${Math.random() * 100}%`;
            
            // Random opacity
            particle.style.opacity = Math.random() * 0.2 + 0.1;
            
            particles.appendChild(particle);
            
            // Animate particle
            this.animateParticle(particle);
        }
    }
    
    /**
     * Animate a single particle
     * @param {HTMLElement} particle - The particle element
     */
    animateParticle(particle) {
        const duration = Math.random() * 30 + 20;
        const xMove = Math.random() * 10 - 5;
        const yMove = Math.random() * 10 - 5;
        
        particle.style.transition = `transform ${duration}s linear`;
        particle.style.transform = `translate(${xMove}vw, ${yMove}vh)`;
        
        // Reset and animate again after duration
        setTimeout(() => {
            particle.style.transition = 'none';
            particle.style.transform = 'translate(0, 0)';
            
            // Start new animation after a short delay
            setTimeout(() => {
                this.animateParticle(particle);
            }, 50);
        }, duration * 1000);
    }
    
    /**
     * Log debug messages
     * @param  {...any} args - Arguments to log
     */
    log(...args) {
        if (this.config.debug) {
            console.log('[GeminiTelegramClient]', ...args);
            
            // Add to debug info if element exists
            if (this.debugInfo) {
                const timestamp = new Date().toLocaleTimeString();
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
                
                this.debugInfo.innerHTML += `${timestamp}: ${message}<br>`;
                this.debugInfo.scrollTop = this.debugInfo.scrollHeight;
            }
        }
    }
}

// Initialize client when DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
    window.geminiClient = new GeminiTelegramClient();
});
