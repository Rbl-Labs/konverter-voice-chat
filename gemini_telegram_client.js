/**
 * Modern Gemini Telegram Client with enhanced mobile compatibility and error handling
 * Version: 3.3.0 (Integrates PCMStreamPlayer for AI audio playback)
 */
import { AdvancedAudioRecorder } from './advanced_audio_recorder.js';
import { PCMStreamPlayer } from './pcm_stream_player.js';

class GeminiTelegramClient {
    constructor(options = {}) {
        this.config = {
            debug: true,
            reconnectAttempts: 3,
            reconnectDelay: 2000,
            sessionTimeout: 45000,
            healthCheckInterval: 30000,
            connectionRetryDelay: 1000,
            audioFeedbackEnabled: true, 
        };
        
        this.log(`[Client v3.3.0] Constructor called with options:`, false, options);
        
        try {
            this.options = options; // User-provided options like a shared AudioContext
            this.state = {
                sessionToken: null,
                sessionConfig: null,
                isConnectedToWebSocket: false,
                isGeminiSessionActive: false,
                isInitialized: false,
                isInitializing: false,
                isConnecting: false,
                isConversationPaused: true, 
                ws: null,
                reconnectCount: 0,
                reconnectTimer: null,
                sessionInitTimer: null,
                healthCheckTimer: null,
                lastActivity: Date.now(),
                connectionAttempts: 0,
                maxConnectionAttempts: 5,
                permissionState: 'unknown',
                transcriptions: { input: '', output: '' },
                aiPlayedAudioThisTurn: false 
            };
            
            this.advancedRecorder = null;
            this.pcmPlayer = null; 
            this.audioBridgeForPlayback = null; // Kept for potential fallback or other uses, but not for AI speech

            this.initialize();
            
        } catch (error) {
            this.handleCriticalError('Client Constructor failed', error);
        }
    }
    
    async initialize() {
        if (this.state.isInitializing || this.state.isInitialized) return;
        this.state.isInitializing = true;
        this.log('Starting client initialization with AdvancedAudioRecorder and PCMStreamPlayer...');
        
        try {
            if (typeof AdvancedAudioRecorder === 'undefined') {
                throw new Error('AdvancedAudioRecorder is not available.');
            }
            this.advancedRecorder = new AdvancedAudioRecorder({
                logger: (msg, err, data) => this.log(`[AdvRec] ${msg}`, err, data),
                onPermissionChange: (state) => this.handlePermissionChange(state),
                targetSampleRate: 16000 
            });
            this.log('AdvancedAudioRecorder instantiated.');

            if (typeof PCMStreamPlayer === 'undefined') {
                throw new Error('PCMStreamPlayer is not available.');
            }
            this.pcmPlayer = new PCMStreamPlayer({
                logger: (msg, err, data) => this.log(`[PCMPlayer] ${msg}`, err, data),
                onPlaybackStart: () => this.handlePlaybackStart(), 
                onPlaybackEnd: () => this.handlePlaybackEnd()    
            });
            await this.pcmPlayer.initialize(); 
            this.log('PCMStreamPlayer instantiated and initialized.');
            
            await this.initializeSessionToken();
            this.setupHealthMonitoring();
            
            this.state.isInitialized = true;
            this.log('Client core initialized. Ready for connect command.');
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
            
            // Connect to WebSocket but don't connect to Gemini yet
            await this.connectToWebSocket();
            
            // Check if we have user data in localStorage
            const userName = localStorage.getItem('user_name');
            const userEmail = localStorage.getItem('user_email');
            
            if (userName || userEmail) {
                this.userData = {
                    name: userName,
                    email: userEmail
                };
                this.log('Found user data in localStorage:', false, this.userData);
            }
            
            // Show user form if no data is available
            if (!this.userData && window.UserForm) {
                this.log('No user data found, showing form');
                this.showUserForm();
            }
        } catch (error) {
            this.log('Connection process failed', true, error);
            if (window.uiController) window.uiController.setConnectionState('error');
            this.state.isConnecting = false;
        }
    }
    
    showUserForm() {
        if (!window.UserForm) {
            this.log('UserForm not available', true);
            return;
        }
        
        const userForm = new window.UserForm();
        userForm.onSubmit((formData) => {
            this.log('User form submitted:', false, formData);
            
            // Store user data
            this.userData = formData;
            
            // Send user data to backend
            this.sendUserInfo();
            
            // Update UI
            if (window.uiController) {
                window.uiController.updateStatusBanner(`Connected as ${formData.name}. Click Play to start conversation.`, 'connected');
                window.uiController.updateInteractionButton('ready_to_play');
            }
        });
        userForm.show();
    }

    disconnect(reason = 'User disconnected') {
        this.log(`Disconnecting... Reason: ${reason}`);
        this.state.isConversationPaused = true;
        
        if (this.advancedRecorder && this.advancedRecorder.isRecording) {
            this.advancedRecorder.stop();
            this.log('AdvancedAudioRecorder stopped.');
        }
        if (this.pcmPlayer && this.pcmPlayer.isInitialized) { 
            this.pcmPlayer.stopPlayback(); 
            this.log('PCMStreamPlayer playback stopped.');
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
        
        // IMPORTANT: Send a resume notification to the backend to restore session context
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify({ 
                type: 'conversation_resumed', 
                timestamp: Date.now(),
                userData: this.userData // Include user data to restore context
            }));
            this.log('Sent conversation_resumed message to backend');
        }
        
        try {
            if (!this.advancedRecorder.isRecording) {
                this.log('AdvancedAudioRecorder not recording, starting it...');
                await this.advancedRecorder.start(this.handlePCMDataFromRecorder.bind(this));
            }
            this.advancedRecorder.resumeMic(); 
            if (window.uiController) {
                window.uiController.updateInteractionButton('listening');
                window.uiController.setUserSpeaking(true); 
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
        }
        if (this.pcmPlayer && this.pcmPlayer.isPlaying) {
            this.pcmPlayer.stopPlayback(); 
            this.log('AI Playback stopped due to user pause.');
        }
        
        // IMPORTANT: Send a pause notification to the backend to maintain session context
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify({ 
                type: 'conversation_paused', 
                timestamp: Date.now(),
                userData: this.userData // Include user data to maintain context
            }));
            this.log('Sent conversation_paused message to backend');
        }
        
        if (window.uiController) {
            window.uiController.updateInteractionButton('ready_to_play');
            window.uiController.setUserSpeaking(false);
            window.uiController.setAISpeaking(false);
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

    // Add this method to handle Play button
    handlePlayButtonPress() {
        if (!this.state.isConnectedToWebSocket) {
            this.log('Cannot start: not connected to WebSocket', true);
            return;
        }
        
        if (!this.userData) {
            this.log('Cannot start: no user data available', true);
            if (window.uiController) {
                window.uiController.updateStatusBanner('Please fill out the form first', 'error');
            }
            return;
        }
        
        // First send user data to backend
        const userInfoSent = this.sendUserInfo();
        
        if (!userInfoSent) {
            this.log('Failed to send user info to backend', true);
            if (window.uiController) {
                window.uiController.updateStatusBanner('Failed to send user info', 'error');
            }
            return;
        }
        
        // Wait a moment to ensure user info is processed
        setTimeout(() => {
            // Then connect to Gemini with user data
            if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
                this.state.ws.send(JSON.stringify({ 
                    type: 'connect_gemini_with_user_data', 
                    timestamp: Date.now() 
                }));
                this.log('Sent connect_gemini_with_user_data message');
            }
        }, 500); // 500ms delay to ensure user info is processed
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
            // Use the wsUrl directly as it should already contain the session token
            // The sessionToken from this.state.sessionToken is the raw one from the initial page URL,
            // while wsUrl (from this.state.sessionConfig.websocketProxyUrl) contains the processed one from n8n.
            this.log(`Connecting to: ${wsUrl}`);
            this.state.ws = new WebSocket(wsUrl);
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
                case 'ai_audio_chunk_pcm': 
                    if (this.pcmPlayer) {
                        this.pcmPlayer.streamAudioChunk(message.audioData, message.sampleRate);
                    }
                    break;
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
                case 'gemini_raw_output': 
                    this.log('Received RAW Gemini Output from backend:', false, message.data);
                    break;
                case 'debug_log': 
                    this.log(`[Backend Debug] ${message.message || ''}`, message.isError || message.level === 'ERROR', message.data);
                    break;
                default:
                    this.log(`Unknown message type: ${message.type}`, true, message);
            }
        } catch (error) { this.log(`Error handling WebSocket message: ${error.message}`, true, error); }
    }
    
    handleSessionInitialized() {
        this.log('Backend confirmed session initialized.');
        
        // Send websocket_ready message instead of connect_gemini
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify({ type: 'websocket_ready' }));
            this.log('Sent websocket_ready message to backend');
            
            // Update UI to show form or ready state
            if (window.uiController) {
                if (this.userData) {
                    window.uiController.updateStatusBanner(`Connected as ${this.userData.name}. Click Play to start conversation.`, 'connected');
                    window.uiController.setConnectionState('connected');
                } else {
                    window.uiController.updateStatusBanner('Please fill out the form to continue.', 'info');
                }
            }
        }
    }
    
    // Send user information to backend
    sendUserInfo() {
        if (!this.userData) {
            this.log('No user data to send');
            return false;
        }
        
        if (!this.state.isConnectedToWebSocket) {
            this.log('Cannot send user info: not connected to WebSocket');
            return false;
        }
        
        this.log('Sending user info to backend:', false, this.userData);
        
        // Send user info to backend
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            try {
                const message = { 
                    type: 'user_info_update', 
                    userData: this.userData, 
                    timestamp: Date.now() 
                };
                
                this.log('Sending WebSocket message:', false, message);
                
                this.state.ws.send(JSON.stringify(message));
                
                this.log('User info sent to backend');
                return true;
            } catch (error) {
                this.log('Error sending user info:', true, error);
                return false;
            }
        } else {
            this.log('WebSocket not ready for sending user info', false, {
                wsExists: !!this.state.ws,
                readyState: this.state.ws ? this.state.ws.readyState : 'N/A'
            });
            return false;
        }
    }
    
    handleGeminiConnected() {
        this.log('Backend confirmed Gemini connected successfully');
        this.state.isGeminiSessionActive = true;
        this.state.isConversationPaused = true; 
        
        if (window.uiController) {
            window.uiController.setConnectionState('connected');
            
            // Update status banner with user name if available
            if (this.userData && this.userData.name) {
                window.uiController.updateStatusBanner(`Connected as ${this.userData.name}`, 'connected');
            } else {
                window.uiController.updateStatusBanner('Connected', 'connected');
            }
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
            if (this.advancedRecorder.isSuspended && !this.state.aiPlayedAudioThisTurn) {
                 this.log('Turn complete (no AI audio this turn or AI cut short), resuming user mic.');
                 this.advancedRecorder.resumeMic();
                 if (window.uiController) {
                    window.uiController.updateInteractionButton('listening');
                    window.uiController.setUserSpeaking(true); 
                 }
            } else if (!this.advancedRecorder.isSuspended) {
                if (window.uiController) {
                    window.uiController.updateInteractionButton('listening');
                    window.uiController.setUserSpeaking(true);
                }
            }
        } else if (window.uiController && this.state.isConversationPaused) {
            window.uiController.updateInteractionButton('ready_to_play');
        }
        this.state.aiPlayedAudioThisTurn = false; 
    }
    
    handleInterruption() {
        this.log('Model generation interrupted'); 
        if (this.pcmPlayer) this.pcmPlayer.stopPlayback(); 
        if (window.uiController) { 
            window.uiController.setAISpeaking(false); 
            window.uiController.addMessage('(AI interrupted)', 'system');
        }
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
        }
    }
    
    handlePlaybackStart() { 
        this.log('AI audio playback started (PCMStreamPlayer)'); 
        this.state.aiPlayedAudioThisTurn = true;
        if (!this.state.isConversationPaused && this.advancedRecorder && this.advancedRecorder.isRecording && !this.advancedRecorder.isSuspended) {
            this.log('Suspending user mic for AI speech playback.');
            this.advancedRecorder.suspendMic();
            if(window.uiController) window.uiController.setUserSpeaking(false); 
        }
        if (window.uiController) window.uiController.setAISpeaking(true); 
    }

    handlePlaybackEnd() { 
        this.log('AI audio playback ended (PCMStreamPlayer)'); 
        if (window.uiController) {
            window.uiController.setAISpeaking(false);
        }
        if (!this.state.isConversationPaused && this.advancedRecorder && this.advancedRecorder.isRecording) {
            this.log('AI playback ended, resuming user mic.');
            this.advancedRecorder.resumeMic();
            if (window.uiController) {
                window.uiController.updateInteractionButton('listening');
                window.uiController.setUserSpeaking(true); 
            }
        }
    }

    handleAudioError(errorMsg) { 
        this.log(`Audio Playback Error: ${errorMsg}`, true); 
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
        if (this.pcmPlayer && this.pcmPlayer.isInitialized) {
            this.pcmPlayer.stopPlayback();
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
        if (this.pcmPlayer) {
            this.pcmPlayer.dispose();
            this.pcmPlayer = null;
        }
        if (this.audioBridgeForPlayback && typeof this.audioBridgeForPlayback.dispose === 'function') {
            this.audioBridgeForPlayback.dispose();
        } else if (this.audioBridgeForPlayback && typeof this.audioBridgeForPlayback.stopPlayback === 'function') {
            this.audioBridgeForPlayback.stopPlayback();
        }
        this.audioBridgeForPlayback = null;

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
