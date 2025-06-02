/**
 * Enhanced Gemini Telegram Client with Gemini 2.5 Support
 * Version: 4.0.0 - Support for model switching and complete text responses
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
        
        this.log(`[Client v4.0.0] Constructor called with options:`, false, options);
        
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
                aiPlayedAudioThisTurn: false,
                // New state properties
                modelType: null,
                modelName: null,
                useNativeAudio: false,
                chatModeEnabled: false,
                completeTextResponses: []
            };
            
            this.advancedRecorder = null;
            this.pcmPlayer = null;
            this.audioBridgeForPlayback = null;

            this.initialize();
            
        } catch (error) {
            this.handleCriticalError('Client Constructor failed', error);
        }
    }
    
    async initialize() {
        if (this.state.isInitializing || this.state.isInitialized) return;
        this.state.isInitializing = true;
        this.log('Starting client initialization with enhanced features...');
        
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
            
            // Extract model information
            this.state.modelName = this.state.sessionConfig?.model;
            this.state.modelType = this.detectModelType(this.state.modelName);
            this.state.useNativeAudio = this.state.modelType === '2.5';
            this.state.chatModeEnabled = this.state.sessionConfig?.config?.enableChatMode || false;
            
            this.log(`Session configured - Model: ${this.state.modelName}, Type: ${this.state.modelType}, Native Audio: ${this.state.useNativeAudio}`);
            
            // Update UI with model info
            if (window.uiController) {
                window.uiController.updateModelInfo(this.state.modelType, this.state.modelName);
            }
        } catch (error) {
            throw new Error('Failed to process session data: ' + error.message);
        }
    }
    
    detectModelType(modelName) {
        if (!modelName) return '2.5'; // Default to 2.5
        
        if (modelName.includes('2.5') || modelName.includes('native-audio-dialog')) {
            return '2.5';
        } else if (modelName.includes('2.0') || modelName.includes('live-preview') || modelName.includes('live-001')) {
            return '2.0';
        }
        
        return '2.5'; // Default to 2.5 for better experience
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
    
    enableChatMode(enabled = true) {
        this.state.chatModeEnabled = enabled;
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify({ type: 'enable_chat_mode', enabled: enabled }));
        }
    }
    
    async switchModel(modelTypeOrName) {
        if (!this.state.isConnectedToWebSocket) {
            this.log('Cannot switch model: not connected.', true);
            return;
        }
        
        const message = { type: 'switch_model' };
        
        if (modelTypeOrName === '2.0' || modelTypeOrName === '2.5') {
            message.modelType = modelTypeOrName;
        } else {
            message.modelName = modelTypeOrName;
        }
        
        this.log(`Requesting model switch to: ${modelTypeOrName}`);
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify(message));
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
            // Correctly append session token with '?' as wsUrl from n8n is now the base URL
            const fullWsUrl = `${wsUrl}?session=${this.state.sessionToken}`;
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
                case 'session_initialized': 
                    this.handleSessionInitialized(message);
                    break;
                case 'gemini_connected': 
                    this.handleGeminiConnected(message);
                    break;
                case 'gemini_setup_complete':
                    this.log('Gemini setup complete from backend');
                    this.state.isGeminiSessionActive = true;
                    if(window.uiController) window.uiController.updateInteractionButton('ready_to_play');
                    break;
                case 'gemini_disconnected': 
                    this.handleGeminiDisconnected(message.reason);
                    break;
                case 'ai_audio_chunk_pcm':
                    if (this.pcmPlayer) {
                        this.pcmPlayer.streamAudioChunk(message.audioData, message.sampleRate);
                    }
                    break;
                case 'text_response':
                    this.handleTextResponse(message);
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
                    this.handleTurnComplete();
                    break;
                case 'interrupted': 
                    this.handleInterruption();
                    break;
                case 'chat_mode_changed':
                    this.state.chatModeEnabled = message.enabled;
                    this.log(`Chat mode ${message.enabled ? 'enabled' : 'disabled'}`);
                    break;
                case 'model_switched':
                    this.handleModelSwitched(message);
                    break;
                case 'function_executing':
                    this.handleFunctionExecuting(message);
                    break;
                case 'function_completed':
                    this.handleFunctionCompleted(message);
                    break;
                case 'pong': 
                    this.log('Received pong response');
                    break;
                case 'health_check': 
                    this.log('Received health check from server');
                    break;
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
    
    handleSessionInitialized(message) {
        this.log('Backend confirmed session initialized.');
        
        // Update model info from session
        if (message.modelType) this.state.modelType = message.modelType;
        if (message.modelName) this.state.modelName = message.modelName;
        
        if (window.uiController) {
            window.uiController.updateModelInfo(this.state.modelType, this.state.modelName);
        }
        
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify({ type: 'connect_gemini' }));
            this.log('Sent connect_gemini message to backend');
        }
    }
    
    handleGeminiConnected(message) {
        this.log('Backend confirmed Gemini connected successfully');
        this.state.isGeminiSessionActive = true;
        this.state.isConversationPaused = true;
        
        // Update model info if provided
        if (message.modelType) this.state.modelType = message.modelType;
        if (message.modelName) this.state.modelName = message.modelName;
        if (message.useNativeAudio !== undefined) this.state.useNativeAudio = message.useNativeAudio;
        if (message.chatModeEnabled !== undefined) this.state.chatModeEnabled = message.chatModeEnabled;
        
        if (window.uiController) {
            window.uiController.setConnectionState('connected');
            window.uiController.updateModelInfo(this.state.modelType, this.state.modelName);
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
    
    handleTextResponse(message) {
        if (message.text) {
            // Add to complete text responses if it's a complete response
            if (message.isComplete) {
                this.state.completeTextResponses.push({
                    text: message.text,
                    timestamp: message.timestamp
                });
            }
            
            if (window.uiController) {
                window.uiController.addMessage(message.text, 'ai', message.isHTML || false);
            }
        }
    }
    
    handleModelSwitched(message) {
        this.state.modelType = message.modelType;
        this.state.modelName = message.modelName;
        this.state.useNativeAudio = message.useNativeAudio;
        
        this.log(`Model switched to: ${message.modelName} (type: ${message.modelType}, nativeAudio: ${message.useNativeAudio})`);
        
        if (window.uiController) {
            window.uiController.updateModelInfo(message.modelType, message.modelName);
            window.uiController.addMessage(`✅ Switched to ${message.modelName}`, 'system');
        }
    }
    
    handleFunctionExecuting(message) {
        this.log(`Function executing: ${message.functionName}`);
        if (window.uiController) {
            window.uiController.showFunctionExecution(message.functionName);
        }
    }
    
    handleFunctionCompleted(message) {
        this.log(`Function completed: ${message.functionName}, success: ${message.success}`);
        if (window.uiController) {
            const resultMessage = message.success 
                ? message.response?.message || 'Function executed successfully'
                : message.error || 'Function execution failed';
            window.uiController.showFunctionResult(message.functionName, message.success, resultMessage);
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
                this.log('Turn complete but user mic is already active.');
            } else {
                this.log('Turn complete but waiting for AI audio to finish before resuming mic.');
            }
        }
        this.state.aiPlayedAudioThisTurn = false;
    }
    
    handleInterruption() {
        this.log('Interruption received from backend');
        if (this.pcmPlayer && this.pcmPlayer.isPlaying) {
            this.pcmPlayer.stopPlayback();
            this.log('AI playback stopped due to interruption.');
        }
        if (window.uiController) {
            window.uiController.setAISpeaking(false);
        }
    }
    
    handlePlaybackStart() {
        this.log('AI audio playback started');
        this.state.aiPlayedAudioThisTurn = true;
        
        if (!this.state.isConversationPaused && this.advancedRecorder && this.advancedRecorder.isRecording && !this.advancedRecorder.isSuspended) {
            this.advancedRecorder.suspendMic();
            this.log('User mic suspended during AI playback.');
        }
        
        if (window.uiController) {
            window.uiController.setAISpeaking(true);
            window.uiController.setUserSpeaking(false);
            window.uiController.updateInteractionButton('processing');
        }
    }
    
    handlePlaybackEnd() {
        this.log('AI audio playback ended');
        if (window.uiController) {
            window.uiController.setAISpeaking(false);
        }
        
        if (!this.state.isConversationPaused && this.advancedRecorder && this.advancedRecorder.isRecording && this.advancedRecorder.isSuspended) {
            this.advancedRecorder.resumeMic();
            this.log('User mic resumed after AI playback.');
            if (window.uiController) {
                window.uiController.updateInteractionButton('listening');
                window.uiController.setUserSpeaking(true);
            }
        } else if (this.state.isConversationPaused) {
            if (window.uiController) {
                window.uiController.updateInteractionButton('ready_to_play');
            }
        }
    }
    
    handlePCMDataFromRecorder(pcmData, sampleRate) {
        if (!this.state.isConnectedToWebSocket || !this.state.isGeminiSessionActive) return;
        
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            const base64Data = this.arrayBufferToBase64(pcmData);
            this.state.ws.send(JSON.stringify({
                type: 'audio_input_pcm',
                audioData: base64Data,
                sampleRate: sampleRate,
                timestamp: Date.now()
            }));
        }
    }
    
    arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
    
    handleDisconnection(reason) {
        this.state.isConnectedToWebSocket = false;
        this.state.isGeminiSessionActive = false;
        this.state.isConversationPaused = true;
        
        if (this.advancedRecorder && this.advancedRecorder.isRecording) {
            this.advancedRecorder.stop();
        }
        if (this.pcmPlayer && this.pcmPlayer.isPlaying) {
            this.pcmPlayer.stopPlayback();
        }
        
        if (window.uiController) {
            window.uiController.setConnectionState('disconnected');
            window.uiController.updateStatusBanner(`Disconnected: ${reason}`, 'warning');
            window.uiController.setUserSpeaking(false);
            window.uiController.setAISpeaking(false);
        }
    }
    
    handleServerError(message) {
        this.log(`Server error: ${message.message}`, true);
        if (window.uiController) {
            window.uiController.updateStatusBanner(`Error: ${message.message}`, 'error');
            window.uiController.addMessage(`❌ Error: ${message.message}`, 'system');
        }
    }
    
    setupHealthMonitoring() {
        this.state.healthCheckTimer = setInterval(() => {
            if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
                this.state.ws.send(JSON.stringify({
                    type: 'ping',
                    pingId: Date.now(),
                    timestamp: Date.now()
                }));
            }
        }, this.config.healthCheckInterval);
    }
    
    cleanup() {
        if (this.state.healthCheckTimer) {
            clearInterval(this.state.healthCheckTimer);
            this.state.healthCheckTimer = null;
        }
        if (this.state.reconnectTimer) {
            clearTimeout(this.state.reconnectTimer);
            this.state.reconnectTimer = null;
        }
        if (this.state.sessionInitTimer) {
            clearTimeout(this.state.sessionInitTimer);
            this.state.sessionInitTimer = null;
        }
        this.disconnect('Cleanup');
    }
    
    handleCriticalError(context, error) {
        this.log(`CRITICAL ERROR in ${context}: ${error.message}`, true, error);
        if (window.uiController) {
            window.uiController.updateStatusBanner(`Critical Error: ${error.message}`, 'error');
            window.uiController.setConnectionState('error');
        }
    }
    
    log(message, isError = false, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = { timestamp, message, isError, data };
        const consoleMessage = `${timestamp} [GeminiClient] ${message}`;
        
        if (isError) {
            console.error(consoleMessage, data || '');
        } else {
            console.log(consoleMessage, data || '');
        }
        
        if (typeof window.debugLog === 'function') {
            window.debugLog(message, isError, data);
        }
    }
}

// Export for use in module context
export { GeminiTelegramClient };

// Also expose on window for backward compatibility
window.GeminiTelegramClient = GeminiTelegramClient;
