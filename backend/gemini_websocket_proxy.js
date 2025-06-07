// CORRECTED: Enhanced Telegram-Optimized Gemini Live API WebSocket Proxy Server
// Version 3.0.5 - Fixed Form Data Integration with Gemini Live

const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

// Import the ModelConfigFactory
const ModelConfigFactory = require('./model_config_factory');

const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const app = express();
const server = createServer(app);

// Enhanced Configuration
const DEFAULT_PORT = 8003;
const PORT = process.env.PORT || DEFAULT_PORT;
console.log(`[PROXY_INIT] Attempting to use port: ${PORT} (process.env.PORT: ${process.env.PORT}, Default: ${DEFAULT_PORT})`);
const HOST = process.env.HOST || '0.0.0.0';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const N8N_BASE_URL = process.env.N8N_BASE_URL || 'https://n8n.lomeai.com';
const N8N_API_KEY = process.env.N8N_API_KEY;
const NODE_ENV = process.env.NODE_ENV || 'production';
const SESSION_INIT_TIMEOUT = 45000; 
const HEALTH_CHECK_INTERVAL = 30000; 
const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; 

if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY environment variable is required');
    process.exit(1);
}

if (!N8N_API_KEY) {
    console.warn('N8N_API_KEY environment variable is not set. N8N webhook authentication will fail.');
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

const connections = new Map();
const activeSessions = new Map(); // For tracking active Gemini sessions with their configs
const CONNECTION_TIMEOUT = 30 * 60 * 1000; 
const connectionStats = {
    totalConnections: 0,
    activeConnections: 0,
    successfulSessions: 0,
    failedSessions: 0,
    lastReset: Date.now()
};

app.get('/health', (req, res) => {
    const uptime = Math.floor(process.uptime());
    const memUsage = process.memoryUsage();
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime,
        uptimeHuman: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`,
        connections: {
            active: connections.size,
            total: connectionStats.totalConnections,
            successful: connectionStats.successfulSessions,
            failed: connectionStats.failedSessions
        },
        system: {
            memory: {
                used: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
                total: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
                rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB'
            },
            platform: process.platform,
            nodeVersion: process.version
        },
        environment: NODE_ENV,
        geminiApiReady: !!GEMINI_API_KEY,
        version: 'telegram-optimized-v3.0.4-function-calling-fixed',
        features: [
            'Enhanced Error Handling',
            'Health Monitoring',
            'Improved Session Management',
            'FFmpeg Stdin Piping Transcoding',
            'Function Calling Support',
            'Modern UI Support'
        ]
    });
});

app.get('/debug/:sessionToken', (req, res) => {
    const { sessionToken } = req.params;
    const session = connections.get(sessionToken);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({
        sessionId: session.sessionId,
        userId: session.userId,
        isConnected: session.isConnected,
        modelType: session.modelType,
        lastActivity: new Date(session.lastActivity).toISOString(),
        conversationTurns: session.conversationHistory.length,
        initialized: session.initializationComplete,
        connectionDuration: Date.now() - session.createdAt
    });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_SIZE });

class EnhancedTelegramGeminiSession {
    constructor(ws, sessionToken) {
        this.ws = ws;
        this.sessionToken = sessionToken;
        this.createdAt = Date.now();
        this.geminiClient = null;
        this.liveSession = null;
        this.isConnected = false;
        this.userId = null;
        this.sessionId = null;
        this.sessionConfigFromN8n = null;
        this.modelType = null;
        this.conversationHistory = [];
        this.lastActivity = Date.now();
        this.connectionTimeout = null;
        this.healthCheckInterval = null;
        this.lastPingTime = 0;
        this.pingCount = 0;
        this.initializationComplete = false;
        this.sessionInitTimer = null;
        this.sessionInitialized = false;
        this.initializationAttempts = 0;
        this.maxInitializationAttempts = 3;
        this.currentUtteranceWebmChunks = [];
        this.turnCount = 0;
        this.audioProcessingQueue = [];
        this.currentGeminiPcmAudioBuffers = [];

        // New properties for form data integration
        this.userData = null; // Store form data
        this.userDataReceived = false; // Track if form was submitted
        this.geminiConnectionRequested = false; // Track connection requests
        
        // New property to track conversation state
        this.conversationPaused = true; // Start with conversation paused
        
        // Track current input transcription
        this.currentInputTranscription = '';
        
        // NEW: Track current conversation turn
        this.currentTurn = {
            turnId: 0,
            userMessage: '',
            aiResponse: '',
            userMethod: 'voice',
            timestamp: Date.now(),
            interrupted: false
        };
        
        // NEW: Track accumulated AI responses for the current turn
        this.currentAIResponses = [];

        this.log('Enhanced session created', { sessionToken: this.sessionToken.substring(0, 20) + '...', timestamp: new Date().toISOString() });
        connectionStats.totalConnections++;
        connectionStats.activeConnections++;
        this.startInitialization();
        this.setupConnectionTimeout();
        this.setupHealthMonitoring();
    }

    log(message, data = null, isError = false) {
        const timestamp = new Date().toISOString();
        const prefix = isError ? '❌' : '✅';
        const logLevel = isError ? 'ERROR' : 'INFO';
        const logMessage = `${timestamp} ${prefix} [Session ${this.sessionId || this.sessionToken.substring(0,8) || 'Unknown'}] ${message}`;
        if (isError) console.error(logMessage, data || '');
        else console.log(logMessage, data || '');
        if (this.ws.readyState === this.ws.OPEN && (isError || NODE_ENV === 'development')) {
            this.sendMessage({ type: 'debug_log', level: logLevel, message, data, timestamp });
        }
    }
    
    startInitialization() {
        this.log('Starting enhanced initialization...');
        this.sessionInitTimer = setTimeout(() => {
            if (!this.sessionInitialized) {
                this.log(`Session initialization timed out after ${SESSION_INIT_TIMEOUT/1000}s`, null, true);
                this.sendMessage({ type: 'session_initialization_failed', message: `Session initialization timed out.`, timestamp: new Date().toISOString(), retryable: true });
                connectionStats.failedSessions++;
            }
        }, SESSION_INIT_TIMEOUT);
        this.initialize();
    }
    
    async initialize() {
        this.initializationAttempts++;
        if (this.initializationAttempts > this.maxInitializationAttempts) {
            this.log(`Maximum initialization attempts exceeded`, null, true);
            this.sendMessage({ type: 'session_initialization_failed', message: 'Max init attempts exceeded.', timestamp: new Date().toISOString(), retryable: false });
            connectionStats.failedSessions++;
            return;
        }
        try {
            this.log(`Initialization attempt ${this.initializationAttempts}/${this.maxInitializationAttempts}`);
            await this.getSessionConfig();
            this.detectModelType();
            this.log('Importing @google/genai SDK...');
            const { GoogleGenAI, Modality } = await import('@google/genai');
            this.Modality = Modality;
            this.log('@google/genai SDK imported successfully');
            this.geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
            this.log(`GoogleGenAI client created (model type: ${this.modelType})`);
            this.initializationComplete = true;
            this.sessionInitialized = true;
            connectionStats.successfulSessions++;
            if (this.sessionInitTimer) { clearTimeout(this.sessionInitTimer); this.sessionInitTimer = null; }
            this.sendMessage({ type: 'session_initialized', sessionId: this.sessionId, userId: this.userId, modelType: this.modelType, message: 'Session initialized', timestamp: new Date().toISOString() });
        } catch (error) {
            this.log('Session initialization failed', { attempt: this.initializationAttempts, error: error.message, stack: error.stack?.substring(0, 500) }, true);
            if (this.initializationAttempts < this.maxInitializationAttempts) {
                const retryDelay = this.initializationAttempts * 2000;
                this.log(`Retrying initialization in ${retryDelay}ms...`);
                setTimeout(() => { this.initialize(); }, retryDelay);
            } else {
                if (this.sessionInitTimer) { clearTimeout(this.sessionInitTimer); this.sessionInitTimer = null; }
                this.sendMessage({ type: 'session_initialization_failed', message: 'Session init failed: ' + error.message, timestamp: new Date().toISOString(), retryable: true });
                connectionStats.failedSessions++;
            }
        }
    }

    setupConnectionTimeout() { 
        this.connectionTimeout = setTimeout(() => { 
            this.log(`Session timeout after ${CONNECTION_TIMEOUT/1000/60} minutes of inactivity`); 
            this.cleanup('Session timeout'); 
        }, CONNECTION_TIMEOUT); 
    }
    
    setupHealthMonitoring() { 
        this.healthCheckInterval = setInterval(() => { 
            const timeSinceLastActivity = Date.now() - this.lastActivity; 
            if (timeSinceLastActivity > HEALTH_CHECK_INTERVAL * 2) { 
                this.log(`Connection appears stale (${timeSinceLastActivity}ms since last activity)`, null, true); 
            } 
            if (this.ws.readyState === this.ws.OPEN && this.isConnected) { 
                this.sendMessage({ type: 'health_check', status: 'healthy', timestamp: Date.now(), lastActivity: this.lastActivity, conversationTurns: this.conversationHistory.length }); 
            } 
        }, HEALTH_CHECK_INTERVAL); 
    }
    
    resetTimeout() { 
        if (this.connectionTimeout) { 
            clearTimeout(this.connectionTimeout); 
            this.setupConnectionTimeout(); 
        } 
        this.lastActivity = Date.now(); 
    }

    async getSessionConfig() {
        try {
            this.log(`Fetching session config from N8N`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(`${N8N_BASE_URL}/webhook/voice-session?session=${this.sessionToken}&action=initialize`, { 
                signal: controller.signal, 
                headers: { 
                    'User-Agent': 'TelegramVoiceBot/3.0', 
                    'Accept': 'application/json',
                    'X-API-Key': N8N_API_KEY  // Add API key authentication
                } 
            });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`N8N API returned ${response.status}: ${response.statusText}`);
            const data = await response.json();
            const sessionData = Array.isArray(data) ? data[0] : data;
            if (!sessionData.success) throw new Error(sessionData.error || 'Invalid session token or unsuccessful n8n response');
            this.userId = sessionData.userId; 
            this.sessionId = sessionData.sessionId; 
            this.sessionConfigFromN8n = sessionData.config;
            this.log('Session configured successfully', { sessionId: this.sessionId, userId: this.userId, model: this.sessionConfigFromN8n?.model || 'not_provided' });
        } catch (error) { 
            if (error.name === 'AbortError') throw new Error('N8N request timed out'); 
            throw new Error(`Failed to get session configuration: ${error.message}`); 
        }
    }

    detectModelType() { 
        const modelName = this.sessionConfigFromN8n?.model || ''; 
        if (modelName.includes('2.5') || modelName.includes('native-audio-dialog')) { 
            this.modelType = '2.5'; 
        } else if (modelName.includes('2.0') || modelName.includes('live-preview') || modelName.includes('live-001')) { 
            this.modelType = '2.0'; 
        } else { 
            this.modelType = '2.5'; 
            this.log(`Unknown model pattern: "${modelName}". Defaulting to 2.5`); 
        } 
        this.log(`Model type determined: ${this.modelType} for model: "${modelName}"`); 
    }
    
    async connectToGemini() {
        if (!this.initializationComplete) throw new Error('Session initialization not complete');
        try {
            this.log(`Connecting to Gemini Live API (${this.modelType})...`);
            const modelName = this.sessionConfigFromN8n?.model || this.getDefaultModelForType();
            const liveConnectConfig = this.buildConnectionConfig();
            this.log('Using connection config', { model: modelName, configKeys: Object.keys(liveConnectConfig) });
            this.liveSession = await this.geminiClient.live.connect({ 
                model: modelName, 
                config: liveConnectConfig, 
                callbacks: { 
                    onopen: () => this.handleGeminiOpen(modelName), 
                    onmessage: (message) => this.handleGeminiMessage(message), 
                    onerror: (error) => this.handleGeminiError(error, modelName), 
                    onclose: (event) => this.handleGeminiClose(event, modelName) 
                } 
            });
            this.log(`Gemini Live session created successfully`);
        } catch (error) { 
            this.log(`Failed to connect to Gemini`, { error: error.message, modelType: this.modelType }, true); 
            this.sendMessage({ type: 'gemini_connection_failed', message: error.message, modelType: this.modelType, timestamp: new Date().toISOString(), retryable: true }); 
            throw error; 
        }
    }
    
    getDefaultModelForType() { 
        return this.modelType === '2.5' ? 'gemini-2.5-flash-preview-native-audio-dialog' : 'gemini-2.0-flash-live-001'; 
    }

    handleGeminiOpen(modelName) { 
        this.log(`Gemini Live API connected successfully`); 
        this.isConnected = true; 
        this.resetTimeout(); 
        this.sendMessage({ type: 'gemini_connected', message: `Connected to Gemini Live API (${modelName})`, modelType: this.modelType, timestamp: new Date().toISOString() }); 
        this.notifyN8n('connection_established', { modelName }); 
    }
    
    handleGeminiError(error, modelName) { 
        this.log(`Gemini error`, { error: error.message, model: modelName }, true); 
        this.sendMessage({ type: 'gemini_error', message: error.message, modelType: this.modelType, timestamp: new Date().toISOString(), retryable: !error.message.includes('quota') && !error.message.includes('billing') }); 
        this.notifyN8n('gemini_error', { error: error.message, modelName }); 
    }
    
    handleGeminiClose(event, modelName) { 
        const reason = event?.reason || (event instanceof Error ? event.message : 'Unknown reason'); 
        this.log(`Gemini connection closed: ${reason}`); 
        this.isConnected = false; 
        this.sendMessage({ type: 'gemini_disconnected', reason: reason, modelType: this.modelType, timestamp: new Date().toISOString(), retryable: !(reason.includes('quota') || reason.includes('billing')) }); 
        this.notifyN8n('connection_closed', { reason, modelName }); 
    }
    
    buildConnectionConfig() { 
        const n8nLiveConnectConfig = this.sessionConfigFromN8n?.config || {}; 
        let defaultConfig; 
        
        // Check if we have function calling in the n8n config
        const hasFunctionCalling = n8nLiveConnectConfig.tools && 
            (Array.isArray(n8nLiveConnectConfig.tools) ? 
                n8nLiveConnectConfig.tools.some(tool => tool.functionDeclarations) : 
                Object.keys(n8nLiveConnectConfig.tools).includes('functionDeclarations'));
        
        // Check if we have Google Search in the n8n config
        const hasGoogleSearch = n8nLiveConnectConfig.tools && 
            (Array.isArray(n8nLiveConnectConfig.tools) ? 
                n8nLiveConnectConfig.tools.some(tool => tool.googleSearch) : 
                Object.keys(n8nLiveConnectConfig.tools).includes('googleSearch'));
        
        if (this.modelType === '2.5') { 
            defaultConfig = { 
                responseModalities: [this.Modality.AUDIO], 
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } }, 
                // System instruction will come from N8N with user data
                inputAudioTranscription: {}, 
                outputAudioTranscription: {}, 
                realtimeInputConfig: { automaticActivityDetection: { disabled: false, startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', prefixPaddingMs: 0, silenceDurationMs: 0 } },
                contextWindowCompression: {
                    triggerTokens: 25600,
                    slidingWindow: {
                        targetTokens: 12800
                    }
                }
            }; 
            
            // Only add affectiveDialog and proactiveAudio if we don't have function calling
            if (!hasFunctionCalling) {
                defaultConfig.enableAffectiveDialog = true;
                defaultConfig.proactivity = { proactiveAudio: true };
            }
        } else { 
            defaultConfig = { 
                responseModalities: [this.Modality.AUDIO], 
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }, languageCode: 'en-US' }, 
                // System instruction will come from N8N with user data
                inputAudioTranscription: {}, 
                realtimeInputConfig: { automaticActivityDetection: { disabled: false, startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', prefixPaddingMs: 0, silenceDurationMs: 0 } },
                contextWindowCompression: {
                    triggerTokens: 32000,
                    slidingWindow: {
                        targetTokens: 32000
                    }
                }
            }; 
        } 
        
        // Create a merged config but don't override tools yet
        const mergedConfig = { ...defaultConfig };
        
        // Copy all properties except tools from n8nLiveConnectConfig
        for (const key in n8nLiveConnectConfig) {
            if (key !== 'tools') {
                mergedConfig[key] = n8nLiveConnectConfig[key];
            }
        }
        
        // Handle tools separately to ensure proper format
        if (n8nLiveConnectConfig.tools) {
            // If tools is already an array, use it directly
            if (Array.isArray(n8nLiveConnectConfig.tools)) {
                mergedConfig.tools = n8nLiveConnectConfig.tools;
            } 
            // If tools is an object, convert it to an array
            else {
                mergedConfig.tools = [];
                
                // Add Google Search if present
                if (n8nLiveConnectConfig.tools.googleSearch) {
                    mergedConfig.tools.push({ googleSearch: {} });
                }
                
                // Add function declarations if present
                if (n8nLiveConnectConfig.tools.functionDeclarations) {
                    mergedConfig.tools.push({ 
                        functionDeclarations: n8nLiveConnectConfig.tools.functionDeclarations 
                    });
                }
            }
        }
        
        // Remove incompatible features based on logic constraints
        if (hasFunctionCalling) {
            delete mergedConfig.enableAffectiveDialog;
            delete mergedConfig.proactivity;
        }
        
        return mergedConfig;
    }
    
    async handleGeminiMessage(message) {
        // ENHANCED DEBUG LOGGING FOR FUNCTION CALLS
        console.log('=== COMPLETE GEMINI MESSAGE DEBUG ===');
        console.log('Full message object:', JSON.stringify(message, null, 2));
        console.log('Message keys:', Object.keys(message));
        console.log('Message type:', message.type);
        
        // Check all possible function call patterns
        console.log('=== FUNCTION CALL DETECTION ===');
        console.log('Direct toolCall:', !!message.toolCall);
        console.log('Direct functionCall:', !!message.functionCall);
        console.log('Direct functionCalls:', !!message.functionCalls);
        console.log('ServerContent toolCall:', !!(message.serverContent && message.serverContent.toolCall));
        console.log('ServerContent functionCalls:', !!(message.serverContent && message.serverContent.functionCalls));
        
        if (message.toolCall) {
            console.log('ToolCall object:', JSON.stringify(message.toolCall, null, 2));
            console.log('ToolCall keys:', Object.keys(message.toolCall));
            console.log('Has functionCalls array:', Array.isArray(message.toolCall.functionCalls));
            if (message.toolCall.functionCalls) {
                console.log('FunctionCalls count:', message.toolCall.functionCalls.length);
                message.toolCall.functionCalls.forEach((fc, index) => {
                    console.log(`Function ${index}:`, JSON.stringify(fc, null, 2));
                });
            }
        }
        
        // Check serverContent for function calls too
        if (message.serverContent) {
            console.log('ServerContent keys:', Object.keys(message.serverContent));
            if (message.serverContent.toolCall) {
                console.log('ServerContent.toolCall:', JSON.stringify(message.serverContent.toolCall, null, 2));
            }
        }
        console.log('=== END COMPLETE DEBUG ===');

        // Log to file for persistent debugging
        const debugData = {
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            messageType: message.type,
            hasToolCall: !!message.toolCall,
            hasFunctionCalls: !!(message.toolCall && message.toolCall.functionCalls),
            fullMessage: message
        };
        
        // Write to debug file
        const fs = require('fs').promises;
        try {
            await fs.appendFile('/tmp/gemini_function_debug.log', 
                JSON.stringify(debugData) + '\n');
        } catch (e) {
            console.log('Could not write debug file:', e.message);
        }

        // Continue with existing logic...
        this.log('Raw Gemini message received by backend');
        this.sendMessage({ type: 'gemini_raw_output', data: message, timestamp: new Date().toISOString() });

        this.log('Processing Gemini message', { 
            type: message.type || 'unknown', 
            hasSetupComplete: !!message.setupComplete, 
            hasServerContent: !!message.serverContent,
            hasToolCall: !!message.toolCall,
            hasToolCallResult: !!message.toolCallResult,
            hasFunctionCalls: !!(message.toolCall && message.toolCall.functionCalls)
        });
        
        try {
            if (message.setupComplete) {
                this.log('Gemini setup completed');
                this.sendMessage({ type: 'gemini_setup_complete', modelType: this.modelType, timestamp: new Date().toISOString() });
                return;
            }
            
            // FIXED: Enhanced function call detection
            if (message.toolCall) {
                if (message.toolCall.functionCalls && Array.isArray(message.toolCall.functionCalls)) {
                    this.log('Received function calls from Gemini', { 
                        count: message.toolCall.functionCalls.length,
                        functions: message.toolCall.functionCalls.map(fc => fc.name)
                    });
                    
                    for (const functionCall of message.toolCall.functionCalls) {
                        await this.executeFunctionCall(functionCall);
                    }
                    return;
                } else {
                    this.log('Received toolCall but no functionCalls array', { toolCall: message.toolCall });
                }
            }
            
            if (message.serverContent) {
                await this.processServerContent(message.serverContent);
            }
            
            if (message.usageMetadata) {
                this.log('Token usage', message.usageMetadata);
                this.sendMessage({ type: 'usage_metadata', usage: message.usageMetadata, timestamp: new Date().toISOString() });
            }
            
        } catch (error) {
            this.log('Error handling Gemini message', { error: error.message, stack: error.stack }, true);
            this.sendMessage({ 
                type: 'error', 
                message: 'Error processing Gemini response: ' + error.message, 
                modelType: this.modelType, 
                timestamp: new Date().toISOString() 
            });
        }
    }

    async processServerContent(serverContent) {
        // STEP 1: Process input transcriptions (interim)
        if (serverContent.inputTranscription) {
            const transcriptionText = serverContent.inputTranscription.text;
            
            // Store current transcription for final processing
            this.currentInputTranscription = transcriptionText;
            
            // Store in current turn data
            this.currentTurn.userMessage = transcriptionText;
            this.currentTurn.userMethod = 'voice';
            
            // Send interim transcription for live display
            this.sendMessage({ 
                type: 'input_transcription', 
                text: transcriptionText, 
                isFinal: false, // Mark as interim
                modelType: this.modelType, 
                timestamp: new Date().toISOString() 
            });
        }
        
        // STEP 2: Process AI text responses
        if (serverContent.modelTurn?.parts) {
            this.log('Processing model turn with parts for streaming PCM.');
            for (const part of serverContent.modelTurn.parts) {
                if (part.text) {
                    // Send text response for live display
                    this.sendMessage({ 
                        type: 'text_response', 
                        text: part.text, 
                        modelType: this.modelType, 
                        timestamp: new Date().toISOString() 
                    });
                    
                    // Accumulate AI response for the current turn
                    this.currentAIResponses.push(part.text);
                    
                    // Update current turn data
                    this.currentTurn.aiResponse = this.currentAIResponses.join('');
                }
                
                // Stream PCM audio chunks directly
                if (part.inlineData?.data && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('audio/pcm')) {
                    this.log(`Received PCM audio chunk from Gemini (mimeType: ${part.inlineData.mimeType}), forwarding to client. Size: ${part.inlineData.data.length}`);
                    this.sendMessage({
                        type: 'ai_audio_chunk_pcm',
                        audioData: part.inlineData.data,
                        sampleRate: 24000,
                        mimeType: 'audio/pcm', 
                        timestamp: Date.now()
                    });
                } else if (part.inlineData?.data) {
                    this.log(`Received non-PCM inlineData from Gemini, mimeType: ${part.inlineData.mimeType}. Not streaming this type.`, null, true);
                }
            }
        }
        
        // STEP 3: Process output transcriptions
        if (serverContent.outputTranscription) {
            this.sendMessage({ 
                type: 'output_transcription', 
                text: serverContent.outputTranscription.text, 
                modelType: this.modelType, 
                timestamp: new Date().toISOString() 
            });
        }

        // STEP 4: Handle turn completion
        if (serverContent.turnComplete) {
            this.log('Turn complete received from Gemini.');
            
            // Increment turn ID
            this.currentTurn.turnId = ++this.turnCount;
            this.currentTurn.timestamp = new Date().toISOString();
            
            // Finalize user message if available
            if (this.currentInputTranscription && this.currentInputTranscription.trim()) {
                this.log(`Final user transcription for turn ${this.currentTurn.turnId}: "${this.currentInputTranscription}"`);
                this.currentTurn.userMessage = this.currentInputTranscription;
                
                // Send final transcription for display
                this.sendMessage({ 
                    type: 'input_transcription', 
                    text: this.currentInputTranscription,
                    isFinal: true,
                    modelType: this.modelType, 
                    timestamp: new Date().toISOString() 
                });
                
                // Clear the current transcription
                this.currentInputTranscription = '';
            }
            
            // Clean up audio buffers
            if (this.currentGeminiPcmAudioBuffers.length > 0) {
                this.log('Warning: currentGeminiPcmAudioBuffers has data at turnComplete, but PCM streaming is active. This old audio data will be discarded.', null, true);
                this.currentGeminiPcmAudioBuffers = [];
            }
            
            // Send complete conversation turn to client
            this.sendMessage({ 
                type: 'conversation_turn_complete', 
                turn: this.currentTurn,
                modelType: this.modelType, 
                timestamp: new Date().toISOString() 
            });
            
            // Store conversation turn securely via N8N
            this.storeConversationTurnInN8N(this.currentTurn);
            
            // Send turn complete notification
            this.sendMessage({ 
                type: 'turn_complete', 
                modelType: this.modelType, 
                timestamp: new Date().toISOString() 
            });
            
            // Reset for next turn
            this.currentAIResponses = [];
            this.currentTurn = {
                turnId: 0,
                userMessage: '',
                aiResponse: '',
                userMethod: 'voice',
                timestamp: Date.now(),
                interrupted: false
            };
        }

        // Handle interruptions
        if (serverContent.interrupted) {
            this.log('Interruption received from Gemini.');
            
            // Mark current turn as interrupted
            this.currentTurn.interrupted = true;
            
            // Finalize user message if available
            if (this.currentInputTranscription && this.currentInputTranscription.trim()) {
                this.log(`Final user transcription (interrupted): "${this.currentInputTranscription}"`);
                this.currentTurn.userMessage = this.currentInputTranscription;
                
                // Send final transcription for display
                this.sendMessage({ 
                    type: 'input_transcription', 
                    text: this.currentInputTranscription,
                    isFinal: true,
                    interrupted: true,
                    modelType: this.modelType, 
                    timestamp: new Date().toISOString() 
                });
                
                this.currentInputTranscription = '';
            }
            
            // Send interrupted notification
            this.sendMessage({ 
                type: 'interrupted', 
                modelType: this.modelType, 
                timestamp: new Date().toISOString() 
            });
            
            if (this.currentGeminiPcmAudioBuffers.length > 0) {
                this.log('Clearing accumulated audio buffers due to interruption.');
                this.currentGeminiPcmAudioBuffers = [];
            }
            
            // Send partial conversation turn to client
            this.currentTurn.turnId = ++this.turnCount;
            this.currentTurn.timestamp = new Date().toISOString();
            
            this.sendMessage({ 
                type: 'conversation_turn_complete', 
                turn: this.currentTurn,
                interrupted: true,
                modelType: this.modelType, 
                timestamp: new Date().toISOString() 
            });
            
            // Store interrupted conversation turn securely via N8N
            this.storeConversationTurnInN8N(this.currentTurn);
            
            // Reset for next turn
            this.currentAIResponses = [];
            this.currentTurn = {
                turnId: 0,
                userMessage: '',
                aiResponse: '',
                userMethod: 'voice',
                timestamp: Date.now(),
                interrupted: false
            };
        }
    }
    
    async handleClientMessage(data) { 
        try { 
            this.resetTimeout(); 
            if (data.length > MAX_MESSAGE_SIZE) throw new Error(`Message too large: ${data.length} bytes`); 
            const message = JSON.parse(data); 
            this.log(`Received client message: ${message.type}`, { hasAudioData: !!message.audioData, audioDataLength: message.audioData?.length || 0, textLength: message.text?.length || 0, sampleRate: message.sampleRate, timestamp: message.timestamp }); 
            switch (message.type) { 
                case 'connect_gemini': await this.connectToGemini(); break;
                case 'connect_gemini_with_user_data': await this.connectToGeminiWithUserData(); break;
                case 'audio_input': await this.handleAudioInput(message); break; 
                case 'audio_input_pcm': await this.handleAudioInputPCM(message); break; 
                case 'text_input': await this.handleTextInput(message); break; 
                case 'user_info_update': await this.handleUserInfoUpdate(message); break; 
                case 'disconnect_gemini': this.disconnectGemini('Client requested disconnect'); break; 
                case 'ping': this.handlePing(message); break;
            case 'websocket_ready':
                // Just acknowledge WebSocket connection
                this.sendMessage({ 
                    type: 'websocket_ready_ack', 
                    message: 'WebSocket connection established',
                    timestamp: new Date().toISOString() 
                });
                break;
            // NEW: Handle conversation pause/resume messages
            case 'conversation_paused':
                this.handleConversationPaused(message);
                break;
            case 'conversation_resumed':
                this.handleConversationResumed(message);
                break;
            default: this.log(`Unknown message type: ${message.type}`, null, true); this.sendMessage({ type: 'error', message: `Unknown message type: ${message.type}`, timestamp: new Date().toISOString() }); 
            } 
        } catch (error) { 
            this.log('Error handling client message', { error: error.message }, true); 
            this.sendMessage({ type: 'error', message: 'Failed to process message: ' + error.message, modelType: this.modelType, timestamp: new Date().toISOString() }); 
        } 
    }
    
    handlePing(message) { 
        this.pingCount++; 
        this.lastPingTime = Date.now(); 
        this.sendMessage({ type: 'pong', pingId: message.pingId, timestamp: message.timestamp, serverTime: this.lastPingTime, modelType: this.modelType, connectionStatus: this.isConnected ? 'connected' : 'disconnected' }); 
    }

    async handleAudioInputPCM(message) {
        if (!this.isConnected || !this.liveSession) {
            this.sendMessage({ type: 'error', message: 'Not connected to Gemini, cannot process PCM audio.', modelType: this.modelType, retryable: true });
            this.log('Cannot process PCM audio input, not connected to Gemini.', null, true);
            return;
        }
        if (!message.audioData) {
            this.log('Received audio_input_pcm without audioData, ignoring.', null, true);
            return;
        }
        this.resetTimeout();
        try {
            const sampleRate = message.sampleRate || 16000;
            this.log(`Processing PCM audio input`, { audioDataLength: message.audioData.length, sampleRate: sampleRate, timestamp: message.timestamp });

            const audioInput = {
                audio: {
                    data: message.audioData,
                    mimeType: `audio/pcm;rate=${sampleRate}`
                }
            };
            await this.liveSession.sendRealtimeInput(audioInput);
        } catch (error) {
            this.log('Error sending PCM audio input to Gemini', { error: error.message }, true);
            this.sendMessage({ type: 'error', message: 'Failed to process PCM audio: ' + error.message, modelType: this.modelType, timestamp: new Date().toISOString() });
        }
    }

    async handleTextInput(message) {
        if (!this.isConnected || !this.liveSession) {
            this.sendMessage({ type: 'error', message: 'Not connected to Gemini. Cannot send text.', modelType: this.modelType, retryable: true });
            this.log('Cannot send text input, not connected to Gemini.', null, true);
            return;
        }
        if (!message.text || message.text.trim().length === 0) {
            this.log('Received empty text_input from client, ignoring.', null, true);
            return;
        }
        this.resetTimeout();
        try {
            this.log(`[DEBUG TEXT] Processing text input: "${message.text}"`);
            this.log(`[DEBUG TEXT] Connection state: isConnected=${this.isConnected}, liveSession=${!!this.liveSession}`);
            
            // Update current turn data for text input
            this.currentTurn.userMessage = message.text;
            this.currentTurn.userMethod = 'text';
            
            // Send debug message back to client
            this.sendMessage({ 
                type: 'debug_log', 
                level: 'INFO', 
                message: `Backend received text: "${message.text}"`, 
                timestamp: new Date().toISOString() 
            });

            if (this.currentUtteranceWebmChunks.length > 0) {
                this.log('User sent text while audio chunks were buffered. Processing buffered audio first...');
                await this.processEndOfSpeech();
            }

            // First send the text input
            this.log(`[DEBUG TEXT] Sending text to Gemini: "${message.text}"`);
            await this.liveSession.sendRealtimeInput({ parts: [{ text: message.text }] });
            this.log(`[DEBUG TEXT] Text sent to Gemini successfully`);
            
            // Then signal end of turn (equivalent to end_of_turn=True in Python)
            this.log(`[DEBUG TEXT] Sending audioStreamEnd signal to Gemini`);
            await this.liveSession.sendRealtimeInput({ audioStreamEnd: true });
            this.log(`[DEBUG TEXT] audioStreamEnd signal sent to Gemini successfully`);
            
            // Send confirmation to client
            this.sendMessage({ 
                type: 'text_input_received', 
                text: message.text, 
                timestamp: new Date().toISOString() 
            });
            
            this.log('Text input sent to Gemini successfully with end-of-turn signal.');
        } catch (error) {
            this.log('Error sending text input to Gemini', { error: error.message }, true);
            this.sendMessage({ type: 'error', message: 'Failed to send text to AI: ' + error.message, modelType: this.modelType, timestamp: new Date().toISOString() });
        }
    }

    // Handle user information update - store but don't connect to Gemini yet
    async handleUserInfoUpdate(message) {
        if (!message.userData) {
            this.log('Received user_info_update without userData, ignoring.', null, true);
            return;
        }
        
        this.resetTimeout();
        
        try {
            const { name, email } = message.userData;
            this.log(`Received and storing user info: name="${name}", email="${email}"`);
            
            // Store user data for later use when connecting to Gemini
            this.userData = message.userData;
            this.userDataReceived = true;
            
            // Send confirmation to client
            this.sendMessage({ 
                type: 'user_info_stored', 
                userData: this.userData, 
                message: 'User information received and stored. Ready to connect to Gemini.',
                timestamp: new Date().toISOString() 
            });
            
            this.log('User info stored successfully. Waiting for Gemini connection request.');
            
        } catch (error) {
            this.log('Error storing user info', { error: error.message }, true);
            this.sendMessage({ 
                type: 'error', 
                message: 'Failed to store user info: ' + error.message, 
                timestamp: new Date().toISOString() 
            });
        }
    }
    
    // New method to connect to Gemini with user data
    async connectToGeminiWithUserData() {
        if (!this.initializationComplete) {
            this.sendMessage({ 
                type: 'error', 
                message: 'Session initialization not complete', 
                timestamp: new Date().toISOString() 
            });
            return;
        }

        if (this.isConnected) {
            this.sendMessage({ 
                type: 'error', 
                message: 'Already connected to Gemini', 
                timestamp: new Date().toISOString() 
            });
            return;
        }

        if (!this.userDataReceived) {
            this.sendMessage({ 
                type: 'error', 
                message: 'No user data received. Please fill out the form first.', 
                timestamp: new Date().toISOString() 
            });
            return;
        }

        try {
            this.log('Getting enhanced session config with user data from N8N');
            
            // Get enhanced config from N8N (includes user data in system prompt)
            await this.getSessionConfigWithUserData();
            
            // Now connect to Gemini with the enhanced config from N8N
            await this.connectToGemini();
            
            // Reset conversation state
            this.conversationPaused = false;
            
        } catch (error) {
            this.log('Failed to connect to Gemini with user data', { error: error.message }, true);
            this.sendMessage({ 
                type: 'gemini_connection_failed', 
                message: error.message, 
                timestamp: new Date().toISOString() 
            });
        }
    }
    
    // Handle conversation paused message
    handleConversationPaused(message) {
        this.log('Conversation paused by user');
        
        // Store user data if provided
        if (message.userData) {
            this.userData = message.userData;
            this.log('User data stored during pause', { userData: this.userData });
            
            // Send acknowledgment to client
            this.sendMessage({ 
                type: 'conversation_paused_ack', 
                message: 'Conversation paused, user data stored',
                timestamp: new Date().toISOString() 
            });
        } else {
            this.log('Conversation paused, no user data provided');
            
            // Send acknowledgment to client
            this.sendMessage({ 
                type: 'conversation_paused_ack', 
                message: 'Conversation paused',
                timestamp: new Date().toISOString() 
            });
        }
        
        // Update session state
        this.conversationPaused = true;
        
        // Notify n8n of the pause event
        this.notifyN8n('conversation_paused', { 
            userData: this.userData,
            timestamp: new Date().toISOString()
        });
    }

    // Handle conversation resumed message
    handleConversationResumed(message) {
        this.log('Conversation resumed by user');
        
        // Restore or update user data if provided
        if (message.userData) {
            this.userData = message.userData;
            this.log('User data restored during resume', { userData: this.userData });
            
            // Send acknowledgment to client with user data
            this.sendMessage({ 
                type: 'conversation_resumed_ack', 
                message: 'Conversation resumed with user data',
                userData: this.userData,
                timestamp: new Date().toISOString() 
            });
        } else {
            this.log('Conversation resumed, using existing user data');
            
            // Send acknowledgment to client with existing user data
            this.sendMessage({ 
                type: 'conversation_resumed_ack', 
                message: 'Conversation resumed',
                userData: this.userData,
                timestamp: new Date().toISOString() 
            });
        }
        
        // Update session state
        this.conversationPaused = false;
        
        // Notify n8n of the resume event
        this.notifyN8n('conversation_resumed', { 
            userData: this.userData,
            timestamp: new Date().toISOString()
        });
    }
    
    // New method to get session config with user data
    async getSessionConfigWithUserData() {
        try {
            this.log('Fetching session config with user data from N8N');
            
            // Prepare URL with user data parameters
            const params = new URLSearchParams();
            params.append('session', this.sessionToken);
            params.append('action', 'initialize');
            
            // Add user data if available
            if (this.userData) {
                if (this.userData.name) params.append('user_name', this.userData.name);
                if (this.userData.email) params.append('user_email', this.userData.email);
            }
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            const response = await fetch(`${N8N_BASE_URL}/webhook/voice-session?${params}`, {
                signal: controller.signal,
                headers: { 
                    'User-Agent': 'TelegramVoiceBot/3.0', 
                    'Accept': 'application/json',
                    'X-API-Key': N8N_API_KEY  // Add API key authentication
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`N8N API returned ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            const sessionData = Array.isArray(data) ? data[0] : data;
            
            if (!sessionData.success) {
                throw new Error(sessionData.error || 'Failed to get session config with user data');
            }
            
            // Update session config with enhanced prompt from N8N
            this.sessionConfigFromN8n = sessionData.config;
            
            this.log('Session configured with user data via N8N', { 
                sessionId: this.sessionId, 
                userId: this.userId,
                hasUserData: !!this.userData,
                userName: this.userData?.name,
                userEmail: this.userData?.email
            });
            
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('N8N request timed out');
            }
            throw new Error(`Failed to get session configuration with user data: ${error.message}`);
        }
    }
    
    async handleAudioInput(message) { 
        if (!this.isConnected || !this.liveSession) { 
            this.sendMessage({ type: 'error', message: 'Not connected to Gemini', modelType: this.modelType, retryable: true }); 
            return; 
        } 
        this.resetTimeout(); 
        try { 
            this.log(`Processing audio input`, { hasAudioData: !!message.audioData, isEndOfSpeech: message.isEndOfSpeech, timestamp: message.timestamp }); 
            if (message.audioData) { 
                const webmBuffer = Buffer.from(message.audioData, 'base64'); 
                this.currentUtteranceWebmChunks.push(webmBuffer); 
                this.log(`Buffered audio chunk, total: ${this.currentUtteranceWebmChunks.length}`); 
            } 
            if (message.isEndOfSpeech) { 
                await this.processEndOfSpeech(); 
            } 
        } catch (error) { 
            this.log('Error in handleAudioInput', { error: error.message }, true); 
            this.sendMessage({ type: 'error', message: 'Failed to process audio: ' + error.message, modelType: this.modelType, timestamp: new Date().toISOString() }); 
        } 
    }

    async processEndOfSpeech() {
        this.turnCount++;
        this.log(`Processing end of speech (Turn ${this.turnCount})`);
        
        const chunksToProcess = [...this.currentUtteranceWebmChunks];
        this.currentUtteranceWebmChunks = [];
        
        if (chunksToProcess.length === 0) {
            this.log('No audio chunks to process for EOS, sending EOS only');
            if (this.isConnected && this.liveSession) {
                try {
                    await this.liveSession.sendRealtimeInput({ audioStreamEnd: true });
                    this.log('AudioStreamEnd sent successfully (no audio data with EOS)');
                } catch (e) { 
                    this.log('Error sending EOS (no audio data with EOS)', { error: e.message }, true);
                }
            }
            return;
        }
        
        this.log(`Concatenating and transcoding ${chunksToProcess.length} WebM chunks via stdin piping...`);
        const fullWebmBuffer = Buffer.concat(chunksToProcess);
        let fullPcmBuffer = null;

        try {
            fullPcmBuffer = await this.transcodeWebmStreamToPcmViaStdIn(fullWebmBuffer);
        } catch (error) {
            this.log('Error transcoding WebM stream to PCM via stdin', { error: error.message }, true);
        }

        if (fullPcmBuffer && fullPcmBuffer.length > 0) {
            const base64PcmData = fullPcmBuffer.toString('base64');
            this.log(`Sending ${fullPcmBuffer.length} bytes of PCM data to Gemini`);
            
            if (this.isConnected && this.liveSession) {
                const audioInput = { 
                    audio: { 
                        data: base64PcmData, 
                        mimeType: 'audio/pcm;rate=16000' 
                    } 
                };
                try {
                    await this.liveSession.sendRealtimeInput(audioInput);
                    this.log('Full audio data sent successfully to Gemini');
                } catch (e) { 
                    this.log('Error sending full audio data to Gemini', { error: e.message }, true);
                }
            }
        } else {
            this.log('No PCM data to send after transcoding (or transcoding failed)', null, true);
        }

        if (this.isConnected && this.liveSession) {
            try {
                await this.liveSession.sendRealtimeInput({ audioStreamEnd: true });
                this.log('AudioStreamEnd sent successfully after processing audio.');
            } catch (e) { 
                this.log('Error sending EOS after processing audio', { error: e.message }, true);
            }
        }
    }
    
    async transcodeWebmStreamToPcmViaStdIn(fullWebmBuffer) {
        this.log(`Attempting to transcode ${fullWebmBuffer.length} bytes of WebM data via stdin`);
        let pcmDataBuffer = null;

        try {
            pcmDataBuffer = await new Promise((resolve, reject) => {
                const ffmpegArgs = [
                    '-f', 'webm',
                    '-c:a', 'libopus',
                    '-i', 'pipe:0',
                    '-f', 's16le',
                    '-ar', '16000',
                    '-ac', '1',
                    '-'
                ];
                this.log('Spawning ffmpeg with stdin piping, args:', ffmpegArgs);
                const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
                
                const outputBuffers = [];
                const errorOutput = [];
                
                ffmpegProcess.stdin.on('error', (err) => {
                    this.log('ffmpeg stdin error:', { error: err.message }, true);
                });

                ffmpegProcess.stdout.on('data', (data) => outputBuffers.push(data));
                ffmpegProcess.stderr.on('data', (data) => {
                    const errStr = data.toString();
                    this.log(`ffmpeg stderr: ${errStr.trim()}`); 
                    errorOutput.push(errStr);
                });
                
                ffmpegProcess.on('close', (code) => {
                    if (code === 0) {
                        const resultBuffer = Buffer.concat(outputBuffers);
                        this.log(`ffmpeg stdin transcoding successful, PCM size: ${resultBuffer.length}`);
                        resolve(resultBuffer.length > 0 ? resultBuffer : Buffer.alloc(0));
                    } else {
                        const fullErrorString = errorOutput.join('');
                        this.log(`ffmpeg (stdin) exited with code ${code}. Full Error: ${fullErrorString}`, null, true);
                        reject(new Error(`ffmpeg (stdin) exited with code ${code}. Error: ${fullErrorString.substring(0, 1000)}`));
                    }
                });
                
                ffmpegProcess.on('error', (err) => {
                    this.log(`ffmpeg process error (stdin): ${err.message}`, null, true);
                    reject(new Error(`ffmpeg process error (stdin): ${err.message}`));
                });

                ffmpegProcess.stdin.write(fullWebmBuffer);
                ffmpegProcess.stdin.end();
            });
            
        } catch (error) {
            this.log('Error during stdin transcoding process', { error: error.message }, true);
        }
        return pcmDataBuffer;
    }

    async convertPcmToWavForTelegram(pcmBase64Data) { 
        const pcmBuffer = Buffer.from(pcmBase64Data, 'base64'); 
        this.log(`Converting PCM to WAV`, { inputSize: pcmBuffer.length }); 
        try { 
            const wavBuffer = await this.convertPcmToWav44k(pcmBuffer); 
            this.log(`PCM to WAV conversion successful`, { outputSize: wavBuffer.length }); 
            return { base64: wavBuffer.toString('base64'), mimeType: 'audio/wav', sampleRate: 44100 }; 
        } catch (error) { 
            this.log('PCM to WAV conversion failed', { error: error.message }, true); 
            throw error; 
        } 
    }
    
    async convertPcmToWav44k(pcmBuffer) { 
        const safeUserId = (this.userId || 'unknownUser').replace(/[^a-zA-Z0-9_-]/g, '_'); 
        const tempId = `audio_${safeUserId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; 
        const tempPcmPath = path.join(os.tmpdir(), `${tempId}_input.pcm`); 
        const tempWavPath = path.join(os.tmpdir(), `${tempId}_output.wav`); 
        try { 
            await fs.writeFile(tempPcmPath, pcmBuffer); 
            await new Promise((resolve, reject) => { 
                const ffmpegProcess = spawn('ffmpeg', ['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', tempPcmPath, '-ar', '44100', '-acodec', 'pcm_s16le', '-f', 'wav', '-bitexact', '-y', tempWavPath]); 
                const errorOutput = []; 
                ffmpegProcess.stderr.on('data', (data) => { errorOutput.push(data.toString()); }); 
                ffmpegProcess.on('close', (code) => { if (code === 0) { resolve(); } else { reject(new Error(`FFmpeg failed with code ${code}. Error: ${errorOutput.join('')}`)); } }); 
                ffmpegProcess.on('error', (err) => { reject(new Error(`FFmpeg process error: ${err.message}`)); }); 
            }); 
            const wavBuffer = await fs.readFile(tempWavPath); 
            return wavBuffer; 
        } finally { 
            try { 
                await fs.unlink(tempPcmPath).catch(() => {}); 
                await fs.unlink(tempWavPath).catch(() => {}); 
            } catch (e) { /* Ignore cleanup errors */ } 
        } 
    }
    
    async executeFunctionCall(functionCall) {
        try {
            this.log(`Executing function: ${functionCall.name}`, { args: functionCall.args });
            
            // Send notification to client about function execution
            this.sendMessage({
                type: 'function_executing',
                functionName: functionCall.name,
                functionId: functionCall.id,
                timestamp: new Date().toISOString()
            });
            
            // Step 1: Get routing information from Voice Session API using GET
            const params = new URLSearchParams({
                session: this.sessionToken,
                action: 'execute_function',
                function_name: functionCall.name,
                function_id: functionCall.id,
                recipient_email: functionCall.args.recipient_email || '',
                email_subject: functionCall.args.email_subject || '',
                custom_message: functionCall.args.custom_message || '',
                email_purpose: functionCall.args.email_purpose || 'general_info',
                sessionId: this.sessionId,
                userId: this.userId
            });

            this.log('Sending GET routing request', { url: `${N8N_BASE_URL}/webhook/voice-session?${params}` });

            const routingResponse = await fetch(`${N8N_BASE_URL}/webhook/voice-session?${params}`, {
                method: 'GET',
                headers: { 
                    'User-Agent': 'TelegramVoiceBot/3.0',
                    'Accept': 'application/json'
                }
            });

            if (!routingResponse.ok) {
                const errorText = await routingResponse.text();
                throw new Error(`Routing request failed: ${routingResponse.status} ${routingResponse.statusText} - ${errorText}`);
            }

            const routingData = await routingResponse.json();
            this.log('Routing response received', { routingData });
            
            // Handle array response from N8N
            const responseData = Array.isArray(routingData) ? routingData[0] : routingData;
            
            if (!responseData.routeToAgent) {
                throw new Error(`No agent route found for function: ${functionCall.name}`);
            }

            // Step 2: Execute function via agent webhook (still POST for email agent)
            this.log(`Routing to agent: ${responseData.agentWebhookUrl}`);
            
            const agentPayload = {
                functionCall: responseData.functionCall,
                sessionId: responseData.sessionId,
                userId: responseData.userId,
                userContext: responseData.userContext || this.getConversationContext()
            };

            const agentResponse = await fetch(responseData.agentWebhookUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'User-Agent': 'TelegramVoiceBot/3.0'
                },
                body: JSON.stringify(agentPayload)
            });

            if (!agentResponse.ok) {
                const errorText = await agentResponse.text();
                throw new Error(`Agent request failed: ${agentResponse.status} ${agentResponse.statusText} - ${errorText}`);
            }

            const functionResponse = await agentResponse.json();
            this.log(`Function executed successfully: ${functionCall.name}`, { response: functionResponse });

            // Step 3: Send response back to Gemini - FIXED: Correct method name and structure
            if (this.liveSession) {
                const formattedResponse = {
                    id: functionCall.id,
                    name: functionCall.name,
                    response: {
                        ...functionResponse.response,
                        scheduling: "INTERRUPT"  // CRITICAL: From official docs
                    }
                };

                await this.liveSession.sendToolResponse({  // FIXED: Correct method name
                    functionResponses: [formattedResponse]
                });
                
                this.log(`Function response sent to Gemini with INTERRUPT scheduling`);
                
                // Notify client of successful execution
                this.sendMessage({
                    type: 'function_completed',
                    functionName: functionCall.name,
                    functionId: functionCall.id,
                    success: true,
                    response: functionResponse,
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            this.log(`Error executing function ${functionCall.name}`, { error: error.message, stack: error.stack }, true);
            
            // Send error response to Gemini - FIXED: Correct method name and structure
            if (this.liveSession) {
                try {
                    await this.liveSession.sendToolResponse({  // FIXED: Correct method name
                        functionResponses: [{
                            id: functionCall.id,
                            name: functionCall.name,
                            response: { 
                                success: false,
                                error: true,
                                message: `❌ Function execution failed: ${error.message}`,
                                details: error.stack?.substring(0, 500),
                                scheduling: "INTERRUPT"  // CRITICAL: From official docs
                            }
                        }]
                    });
                } catch (toolResponseError) {
                    this.log('Error sending tool response to Gemini', { error: toolResponseError.message }, true);
                }
            }

            // Notify client of failed execution
            this.sendMessage({
                type: 'function_completed',
                functionName: functionCall.name,
                functionId: functionCall.id,
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Helper method for conversation context
    getConversationContext() {
        const recentHistory = this.conversationHistory.slice(-5);
        const contextSummary = recentHistory.map(turn => {
            if (turn.type === 'user_text') return `User: ${turn.text}`;
            if (turn.type === 'ai_response') return `AI: ${turn.text}`;
            return '';
        }).filter(Boolean).join('\n');
        
        return contextSummary || 'No recent conversation context';
    }
    
    disconnectGemini(reason = 'Manual disconnect') { 
        this.log(`Disconnecting from Gemini: ${reason}`); 
        if (this.liveSession) { 
            try { 
                this.liveSession.close(); 
            } catch (e) { 
                this.log('Error closing liveSession', { error: e.message }, true); 
            } 
            this.liveSession = null; 
        } 
        this.isConnected = false; 
        this.notifyN8n('connection_closed', { reason, conversationTurns: this.conversationHistory.length, modelType: this.modelType }); 
    }
    
    sendMessage(message) { 
        if (this.ws.readyState === this.ws.OPEN) { 
            try { 
                this.ws.send(JSON.stringify(message)); 
            } catch (error) { 
                this.log('Error sending message', { error: error.message }, true); 
            } 
        } else { 
            this.log('Cannot send message, WebSocket not open', { readyState: this.ws.readyState, messageType: message.type }, true); 
        } 
    }
    
    async notifyN8n(eventType, data = {}) { 
        try { 
            const controller = new AbortController(); 
            const timeoutId = setTimeout(() => controller.abort(), 5000); 
            await fetch(`${N8N_BASE_URL}/webhook/voice-session`, { 
                signal: controller.signal, 
                method: 'POST', 
                headers: { 
                    'Content-Type': 'application/json',
                    'X-API-Key': N8N_API_KEY  // Add API key authentication
                }, 
                body: JSON.stringify({ 
                    session_token: this.sessionToken, 
                    action: 'log_event', 
                    event_type: eventType, 
                    data: { 
                        userId: this.userId, 
                        sessionId: this.sessionId, 
                        modelType: this.modelType, 
                        timestamp: new Date().toISOString(), 
                        ...data 
                    } 
                }) 
            }); 
            clearTimeout(timeoutId); 
        } catch (error) { 
            this.log('Failed to notify N8N', { eventType, error: error.message }, true); 
        } 
    }
    
    async logConversationTurn() { 
        const recentHistory = this.conversationHistory.slice(-10); 
        await this.notifyN8n('conversation_turn', { conversationHistory: recentHistory, turnCount: this.turnCount }); 
    }
    
    // NEW: Store conversation turn securely via N8N
    async storeConversationTurnInN8N(turnData) {
        try {
            this.log('Storing conversation turn securely via N8N', { turnId: turnData.turnId });
            
            const response = await fetch(`${N8N_BASE_URL}/webhook/conversation-storage`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-API-Key': N8N_API_KEY  // Add API key authentication
                },
                body: JSON.stringify({
                    session_token: this.sessionToken,
                    action: 'store_conversation_turn',
                    data: {
                        userId: this.userId,
                        sessionId: this.sessionId,
                        turnId: turnData.turnId,
                        userMessage: turnData.userMessage,
                        aiResponse: turnData.aiResponse,
                        userMethod: turnData.userMethod,
                        timestamp: turnData.timestamp,
                        interrupted: turnData.interrupted || false,
                        modelType: this.modelType,
                        userData: this.userData || {}
                    }
                })
            });
            
            if (response.ok) {
                this.log('Conversation turn stored securely via N8N', { turnId: turnData.turnId });
            } else {
                this.log('Failed to store conversation turn via N8N', { 
                    status: response.status, 
                    statusText: response.statusText 
                }, true);
            }
        } catch (error) {
            this.log('Error storing conversation turn via N8N', { error: error.message }, true);
        }
    }
    
    cleanup(reason = 'Unknown') { 
        this.log(`Cleaning up session: ${reason}`); 
        if (this.sessionInitTimer) { 
            clearTimeout(this.sessionInitTimer); 
            this.sessionInitTimer = null; 
        } 
        if (this.connectionTimeout) { 
            clearTimeout(this.connectionTimeout); 
            this.connectionTimeout = null; 
        } 
        if (this.healthCheckInterval) { 
            clearInterval(this.healthCheckInterval); 
            this.healthCheckInterval = null; 
        } 
        this.disconnectGemini(reason); 
        connections.delete(this.sessionToken); 
        connectionStats.activeConnections = Math.max(0, connectionStats.activeConnections - 1); 
        if (this.ws.readyState === this.ws.OPEN) { 
            this.ws.close(1000, reason); 
        } 
        this.log(`Session cleanup completed`); 
    }
}

// WebSocket server setup
wss.on('connection', (ws, request) => { 
    const connectionTime = Date.now(); 
    const clientIP = request.headers['x-forwarded-for'] || request.socket.remoteAddress; 
    console.log(`🔌 New WebSocket connection from ${clientIP}`); 
    const url = new URL(request.url, `http://${request.headers.host}`); 
    const sessionToken = url.searchParams.get('session'); 
    
    if (!sessionToken) { 
        console.error('❌ No session token provided'); 
        ws.close(1008, 'Session token required'); 
        return; 
    } 
    
    if (sessionToken.length < 10) { 
        console.error('❌ Invalid session token format'); 
        ws.close(1008, 'Invalid session token'); 
        return; 
    } 
    
    if (connections.has(sessionToken)) { 
        console.log('⚠️ Session already exists, closing old connection'); 
        connections.get(sessionToken).cleanup('Replaced by new connection'); 
    } 
    
    const session = new EnhancedTelegramGeminiSession(ws, sessionToken); 
    connections.set(sessionToken, session); 
    console.log(`✅ Enhanced session created: ${sessionToken.substring(0, 20)}... (Total: ${connections.size})`); 
    
    ws.on('message', async (data) => { 
        try { 
            await session.handleClientMessage(data); 
        } catch (error) { 
            console.error('❌ Error handling message:', error); 
            session.sendMessage({ type: 'error', message: 'Internal server error', timestamp: new Date().toISOString() }); 
        } 
    }); 
    
    ws.on('close', (code, reason) => { 
        const duration = Date.now() - connectionTime; 
        const reasonStr = reason ? reason.toString() : 'No reason provided'; 
        console.log(`📴 WebSocket closed after ${duration}ms: ${code} - ${reasonStr}`); 
        session.cleanup(`Connection closed: ${reasonStr}`); 
    }); 
    
    ws.on('error', (error) => { 
        console.error('❌ WebSocket error:', error); 
        session.cleanup(`WebSocket error: ${error.message}`); 
    }); 
    
    const connectionTimeout = setTimeout(() => { 
        if (ws.readyState === ws.CONNECTING) { 
            console.log('⏰ Connection timeout during handshake'); 
            ws.close(1000, 'Connection timeout'); 
        } 
    }, 30000); 
    
    ws.on('open', () => { 
        clearTimeout(connectionTimeout); 
    }); 
});

// Cleanup and monitoring
setInterval(() => { 
    const now = Date.now(); 
    let cleanedUp = 0; 
    for (const [token, session] of connections.entries()) { 
        const timeSinceActivity = now - session.lastActivity; 
        if (timeSinceActivity > CONNECTION_TIMEOUT) { 
            console.log(`🧹 Cleaning up stale session: ${token.substring(0, 20)}... (inactive for ${Math.round(timeSinceActivity/1000/60)}min)`); 
            session.cleanup('Stale connection cleanup'); 
            cleanedUp++; 
        } 
    } 
    if (cleanedUp > 0) { 
        console.log(`🧹 Cleaned up ${cleanedUp} stale connections. Active: ${connections.size}`); 
    } 
}, 5 * 60 * 1000);

function gracefulShutdown(signal) { 
    console.log(`${signal} received, shutting down gracefully...`); 
    connections.forEach(session => { 
        session.sendMessage({ type: 'server_shutdown', message: 'Server is shutting down', timestamp: new Date().toISOString() }); 
        session.cleanup('Server shutdown'); 
    }); 
    wss.close(() => { 
        console.log('WebSocket server closed'); 
        server.close(() => { 
            console.log('HTTP server closed'); 
            console.log('Final connection stats:', { 
                total: connectionStats.totalConnections, 
                successful: connectionStats.successfulSessions, 
                failed: connectionStats.failedSessions, 
                uptime: Math.floor(process.uptime()) + 's' 
            }); 
            process.exit(0); 
        }); 
    }); 
    setTimeout(() => { 
        console.log('Force exit after timeout'); 
        process.exit(1); 
    }, 10000); 
}

process.on('SIGTERM', gracefulShutdown); 
process.on('SIGINT', gracefulShutdown);

server.listen(PORT, HOST, () => { 
    console.log(`🚀 Enhanced Telegram-Optimized Gemini WebSocket Proxy v3.0.4-function-calling-fixed`); 
    console.log(`   Running on ${HOST}:${PORT}`); 
    console.log(`   Environment: ${NODE_ENV}`); 
    console.log(`   Session timeout: ${SESSION_INIT_TIMEOUT/1000}s`); 
    console.log(`   Health check interval: ${HEALTH_CHECK_INTERVAL/1000}s`); 
    console.log(`   Max message size: ${MAX_MESSAGE_SIZE/1024/1024}MB`); 
    console.log(`   Features: Enhanced Error Handling, Health Monitoring, FFmpeg Stdin Piping Transcoding, Function Calling Support, Modern UI Support`); 
    console.log(`   N8N URL: ${N8N_BASE_URL}`); 
    console.log(`   Ready to accept connections...`); 
});

process.on('uncaughtException', (error) => { 
    console.error('💥 Uncaught Exception:', error); 
    console.error('Stack:', error.stack); 
    gracefulShutdown('UNCAUGHT_EXCEPTION'); 
});

process.on('unhandledRejection', (reason, promise) => { 
    console.error('💥 Unhandled Rejection at:', promise); 
    console.error('Reason:', reason); 
    gracefulShutdown('UNHANDLED_REJECTION'); 
});

setInterval(() => { 
    const memUsage = process.memoryUsage(); 
    const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024); 
    if (memUsedMB > 500) { 
        console.warn(`⚠️ High memory usage: ${memUsedMB}MB (Active connections: ${connections.size})`); 
    } 
}, 60000);
