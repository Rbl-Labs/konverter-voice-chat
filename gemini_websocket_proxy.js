// Enhanced Telegram-Optimized Gemini Live API WebSocket Proxy Server
// Version 3.0.3 - FFmpeg stdin piping for transcoding

const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const { spawn } = require('child_process');
const fs = require('fs/promises'); // For cleanup, if any temp files are still used elsewhere
const path = require('path');
const os = require('os'); // For tmpdir if needed for other purposes

const app = express();
const server = createServer(app);

// Enhanced Configuration
const PORT = process.env.PORT || 8003;
const HOST = process.env.HOST || '0.0.0.0';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const N8N_BASE_URL = process.env.N8N_BASE_URL || 'https://n8n.lomeai.com';
const NODE_ENV = process.env.NODE_ENV || 'production';
const SESSION_INIT_TIMEOUT = 45000; 
const HEALTH_CHECK_INTERVAL = 30000; 
const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; 

if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY environment variable is required');
    process.exit(1);
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

const connections = new Map();
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
        version: 'telegram-optimized-v3.0.3', // Updated version
        features: [
            'Enhanced Error Handling',
            'Health Monitoring',
            'Improved Session Management',
            'FFmpeg Stdin Piping Transcoding', // Updated feature
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
        this.currentGeminiPcmAudioBuffers = []; // Buffer for accumulating Gemini's PCM audio

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

    setupConnectionTimeout() { this.connectionTimeout = setTimeout(() => { this.log(`Session timeout after ${CONNECTION_TIMEOUT/1000/60} minutes of inactivity`); this.cleanup('Session timeout'); }, CONNECTION_TIMEOUT); }
    setupHealthMonitoring() { this.healthCheckInterval = setInterval(() => { const timeSinceLastActivity = Date.now() - this.lastActivity; if (timeSinceLastActivity > HEALTH_CHECK_INTERVAL * 2) { this.log(`Connection appears stale (${timeSinceLastActivity}ms since last activity)`, null, true); } if (this.ws.readyState === this.ws.OPEN && this.isConnected) { this.sendMessage({ type: 'health_check', status: 'healthy', timestamp: Date.now(), lastActivity: this.lastActivity, conversationTurns: this.conversationHistory.length }); } }, HEALTH_CHECK_INTERVAL); }
    resetTimeout() { if (this.connectionTimeout) { clearTimeout(this.connectionTimeout); this.setupConnectionTimeout(); } this.lastActivity = Date.now(); }

    async getSessionConfig() {
        try {
            this.log(`Fetching session config from N8N`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(`${N8N_BASE_URL}/webhook/voice-session?session=${this.sessionToken}&action=initialize`, { signal: controller.signal, headers: { 'User-Agent': 'TelegramVoiceBot/3.0', 'Accept': 'application/json' } });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`N8N API returned ${response.status}: ${response.statusText}`);
            const data = await response.json();
            const sessionData = Array.isArray(data) ? data[0] : data;
            if (!sessionData.success) throw new Error(sessionData.error || 'Invalid session token or unsuccessful n8n response');
            this.userId = sessionData.userId; this.sessionId = sessionData.sessionId; this.sessionConfigFromN8n = sessionData.config;
            this.log('Session configured successfully', { sessionId: this.sessionId, userId: this.userId, model: this.sessionConfigFromN8n?.model || 'not_provided' });
        } catch (error) { if (error.name === 'AbortError') throw new Error('N8N request timed out'); throw new Error(`Failed to get session configuration: ${error.message}`); }
    }

    detectModelType() { const modelName = this.sessionConfigFromN8n?.model || ''; if (modelName.includes('2.5') || modelName.includes('native-audio-dialog')) { this.modelType = '2.5'; } else if (modelName.includes('2.0') || modelName.includes('live-preview') || modelName.includes('live-001')) { this.modelType = '2.0'; } else { this.modelType = '2.5'; this.log(`Unknown model pattern: "${modelName}". Defaulting to 2.5`); } this.log(`Model type determined: ${this.modelType} for model: "${modelName}"`); }
    
    async connectToGemini() {
        if (!this.initializationComplete) throw new Error('Session initialization not complete');
        try {
            this.log(`Connecting to Gemini Live API (${this.modelType})...`);
            const modelName = this.sessionConfigFromN8n?.model || this.getDefaultModelForType();
            const liveConnectConfig = this.buildConnectionConfig();
            this.log('Using connection config', { model: modelName, configKeys: Object.keys(liveConnectConfig) });
            this.liveSession = await this.geminiClient.live.connect({ model: modelName, config: liveConnectConfig, callbacks: { onopen: () => this.handleGeminiOpen(modelName), onmessage: (message) => this.handleGeminiMessage(message), onerror: (error) => this.handleGeminiError(error, modelName), onclose: (event) => this.handleGeminiClose(event, modelName) } });
            this.log(`Gemini Live session created successfully`);
        } catch (error) { this.log(`Failed to connect to Gemini`, { error: error.message, modelType: this.modelType }, true); this.sendMessage({ type: 'gemini_connection_failed', message: error.message, modelType: this.modelType, timestamp: new Date().toISOString(), retryable: true }); throw error; }
    }

    handleGeminiOpen(modelName) { this.log(`Gemini Live API connected successfully`); this.isConnected = true; this.resetTimeout(); this.sendMessage({ type: 'gemini_connected', message: `Connected to Gemini Live API (${modelName})`, modelType: this.modelType, timestamp: new Date().toISOString() }); this.notifyN8n('connection_established', { modelName }); }
    handleGeminiError(error, modelName) { this.log(`Gemini error`, { error: error.message, model: modelName }, true); this.sendMessage({ type: 'gemini_error', message: error.message, modelType: this.modelType, timestamp: new Date().toISOString(), retryable: !error.message.includes('quota') && !error.message.includes('billing') }); this.notifyN8n('gemini_error', { error: error.message, modelName }); }
    handleGeminiClose(event, modelName) { const reason = event?.reason || (event instanceof Error ? event.message : 'Unknown reason'); this.log(`Gemini connection closed: ${reason}`); this.isConnected = false; this.sendMessage({ type: 'gemini_disconnected', reason: reason, modelType: this.modelType, timestamp: new Date().toISOString(), retryable: !(reason.includes('quota') || reason.includes('billing')) }); this.notifyN8n('connection_closed', { reason, modelName }); }
    getDefaultModelForType() { return this.modelType === '2.5' ? 'gemini-2.5-flash-preview-native-audio-dialog' : 'gemini-2.0-flash-live-001'; }
    buildConnectionConfig() { const n8nLiveConnectConfig = this.sessionConfigFromN8n?.config || {}; let defaultConfig; if (this.modelType === '2.5') { defaultConfig = { responseModalities: [this.Modality.AUDIO], enableAffectiveDialog: true, proactivity: { proactiveAudio: true }, speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } }, systemInstruction: { parts: [{ text: "You are a helpful AI assistant having a natural voice conversation with a user through Telegram. Be conversational, friendly, and concise in your responses. Respond naturally as if you're having a real-time phone conversation. Keep responses brief and engaging." }] }, inputAudioTranscription: {}, outputAudioTranscription: {}, realtimeInputConfig: { automaticActivityDetection: { disabled: false, startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', prefixPaddingMs: 0, silenceDurationMs: 0 } } }; } else { defaultConfig = { responseModalities: [this.Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }, languageCode: 'en-US' }, systemInstruction: { parts: [{ text: "You are a helpful AI assistant having a natural voice conversation with a user through Telegram. Be conversational, friendly, and concise in your responses. Respond naturally as if you're having a real-time phone conversation. Keep responses brief and engaging." }] }, inputAudioTranscription: {}, realtimeInputConfig: { automaticActivityDetection: { disabled: false, startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', prefixPaddingMs: 0, silenceDurationMs: 0 } } }; } return { ...defaultConfig, ...n8nLiveConnectConfig }; }
    
    async handleGeminiMessage(message) {
        // Log and send the raw message to the client for inspection
        this.log('Raw Gemini message received by backend', { /* Avoid logging full message here if too verbose for server logs, client will get it */ });
        this.sendMessage({ type: 'gemini_raw_output', data: message, timestamp: new Date().toISOString() });

        this.log('Processing Gemini message', { type: message.type || 'unknown', hasSetupComplete: !!message.setupComplete, hasServerContent: !!message.serverContent });
        try {
            if (message.setupComplete) {
                this.log('Gemini setup completed');
                this.sendMessage({ type: 'gemini_setup_complete', modelType: this.modelType, timestamp: new Date().toISOString() });
                return;
            }
            if (message.serverContent) {
                await this.processServerContent(message.serverContent);
            }
            if (message.usageMetadata) {
                this.log('Token usage', message.usageMetadata);
                this.sendMessage({ type: 'usage_metadata', usage: message.usageMetadata, timestamp: new Date().toISOString() });
            }
        } catch (error) {
            this.log('Error handling Gemini message', { error: error.message }, true);
            this.sendMessage({ type: 'error', message: 'Error processing Gemini response: ' + error.message, modelType: this.modelType, timestamp: new Date().toISOString() });
        }
    }
    async processServerContent(serverContent) {
        if (serverContent.modelTurn?.parts) {
            this.log('Processing model turn with parts for streaming PCM.');
            for (const part of serverContent.modelTurn.parts) {
                if (part.text) {
                    this.sendMessage({ type: 'text_response', text: part.text, modelType: this.modelType, timestamp: new Date().toISOString() });
                    this.conversationHistory.push({ type: 'ai_response', text: part.text, timestamp: new Date().toISOString() });
                }
                // Stream PCM audio chunks directly
                if (part.inlineData?.data && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('audio/pcm')) {
                    this.log(`Received PCM audio chunk from Gemini (mimeType: ${part.inlineData.mimeType}), forwarding to client. Size: ${part.inlineData.data.length}`);
                    this.sendMessage({
                        type: 'ai_audio_chunk_pcm', // New message type for client
                        audioData: part.inlineData.data, // This is base64 PCM
                        sampleRate: 24000, // Gemini native audio is 24kHz. Client needs to handle this rate.
                        mimeType: 'audio/pcm', 
                        timestamp: Date.now()
                    });
                } else if (part.inlineData?.data) {
                    this.log(`Received non-PCM inlineData from Gemini, mimeType: ${part.inlineData.mimeType}. Not streaming this type.`, null, true);
                }
            }
        }

        // The logic for accumulating currentGeminiPcmAudioBuffers and sending a single WAV on turnComplete
        // will be deprecated by streaming PCM chunks directly.
        // For now, we'll leave it, but it shouldn't receive data if PCM is streamed above.
        // If Gemini sends *only* audio and no text parts, and then a turnComplete,
        // the old logic might still try to send an empty WAV if currentGeminiPcmAudioBuffers is empty.
        // This needs to be cleaned up once PCM streaming is confirmed working.

        if (serverContent.turnComplete) {
            this.log('Turn complete received from Gemini.');
            // If we were accumulating and converting to WAV, that logic would be here.
            // Since we are now streaming PCM chunks, we primarily just forward the turn_complete signal.
            if (this.currentGeminiPcmAudioBuffers.length > 0) {
                this.log('Warning: currentGeminiPcmAudioBuffers has data at turnComplete, but PCM streaming is active. This old audio data will be discarded.', null, true);
                this.currentGeminiPcmAudioBuffers = []; // Discard, as we're streaming PCM directly
            }
            this.sendMessage({ type: 'turn_complete', modelType: this.modelType, timestamp: new Date().toISOString() });
            this.logConversationTurn();
        }

        if (serverContent.interrupted) {
            this.sendMessage({ type: 'interrupted', modelType: this.modelType, timestamp: new Date().toISOString() });
            // Clear any pending audio if interrupted
            if (this.currentGeminiPcmAudioBuffers.length > 0) {
                this.log('Clearing accumulated audio buffers due to interruption.');
                this.currentGeminiPcmAudioBuffers = [];
            }
        }
        if (serverContent.inputTranscription) {
            this.sendMessage({ type: 'input_transcription', text: serverContent.inputTranscription.text, modelType: this.modelType, timestamp: new Date().toISOString() });
        }
        if (serverContent.outputTranscription) {
            this.sendMessage({ type: 'output_transcription', text: serverContent.outputTranscription.text, modelType: this.modelType, timestamp: new Date().toISOString() });
        }
        // Note: generationComplete might also be a signal, but turnComplete is more definitive for an entire turn.
        // If generationComplete comes before turnComplete and all audio parts are guaranteed to have arrived by then,
        // we could potentially process audio on generationComplete. For now, turnComplete is safer.
    }
    
    async handleClientMessage(data) { try { this.resetTimeout(); if (data.length > MAX_MESSAGE_SIZE) throw new Error(`Message too large: ${data.length} bytes`); const message = JSON.parse(data); this.log(`Received client message: ${message.type}`, { hasAudioData: !!message.audioData, audioDataLength: message.audioData?.length || 0, textLength: message.text?.length || 0, sampleRate: message.sampleRate, timestamp: message.timestamp }); switch (message.type) { case 'connect_gemini': await this.connectToGemini(); break; case 'audio_input': await this.handleAudioInput(message); break; case 'audio_input_pcm': await this.handleAudioInputPCM(message); break; case 'text_input': await this.handleTextInput(message); break; case 'disconnect_gemini': this.disconnectGemini('Client requested disconnect'); break; case 'ping': this.handlePing(message); break; default: this.log(`Unknown message type: ${message.type}`, null, true); this.sendMessage({ type: 'error', message: `Unknown message type: ${message.type}`, timestamp: new Date().toISOString() }); } } catch (error) { this.log('Error handling client message', { error: error.message }, true); this.sendMessage({ type: 'error', message: 'Failed to process message: ' + error.message, modelType: this.modelType, timestamp: new Date().toISOString() }); } }
    handlePing(message) { this.pingCount++; this.lastPingTime = Date.now(); this.sendMessage({ type: 'pong', pingId: message.pingId, timestamp: message.timestamp, serverTime: this.lastPingTime, modelType: this.modelType, connectionStatus: this.isConnected ? 'connected' : 'disconnected' }); }

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
            const sampleRate = message.sampleRate || 16000; // Default to 16kHz if not provided
            this.log(`Processing PCM audio input`, { audioDataLength: message.audioData.length, sampleRate: sampleRate, timestamp: message.timestamp });

            const audioInput = {
                audio: {
                    data: message.audioData, // Expecting base64 PCM from client
                    mimeType: `audio/pcm;rate=${sampleRate}`
                }
            };
            await this.liveSession.sendRealtimeInput(audioInput);
            // this.log(`PCM audio chunk sent to Gemini.`); // This might be too verbose for every chunk
            // With continuous PCM, Gemini's server-side VAD (automaticActivityDetection) handles end-of-speech.
            // The client does not send an explicit isEndOfSpeech flag with PCM chunks.
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
            this.log(`Processing text input: "${message.text.substring(0, 50)}..."`);
            this.conversationHistory.push({ type: 'user_text', text: message.text, timestamp: new Date(message.timestamp || Date.now()).toISOString() });
            
            // Ensure any pending audio from user is sent before this text
            // This might require more complex queueing if audio and text can be sent very close together.
            // For now, assume text input implies end of any concurrent audio input from user.
            if (this.currentUtteranceWebmChunks.length > 0) {
                this.log('User sent text while audio chunks were buffered. Processing buffered audio first...');
                await this.processEndOfSpeech(); // Process and send any pending audio
            }

            await this.liveSession.sendRealtimeInput({ parts: [{ text: message.text }] });
            this.log('Text input sent to Gemini successfully.');
            // Gemini's response will be handled by handleGeminiMessage
        } catch (error) {
            this.log('Error sending text input to Gemini', { error: error.message }, true);
            this.sendMessage({ type: 'error', message: 'Failed to send text to AI: ' + error.message, modelType: this.modelType, timestamp: new Date().toISOString() });
        }
    }
    
    async handleAudioInput(message) { if (!this.isConnected || !this.liveSession) { this.sendMessage({ type: 'error', message: 'Not connected to Gemini', modelType: this.modelType, retryable: true }); return; } this.resetTimeout(); try { this.log(`Processing audio input`, { hasAudioData: !!message.audioData, isEndOfSpeech: message.isEndOfSpeech, timestamp: message.timestamp }); if (message.audioData) { const webmBuffer = Buffer.from(message.audioData, 'base64'); this.currentUtteranceWebmChunks.push(webmBuffer); this.log(`Buffered audio chunk, total: ${this.currentUtteranceWebmChunks.length}`); } if (message.isEndOfSpeech) { await this.processEndOfSpeech(); } } catch (error) { this.log('Error in handleAudioInput', { error: error.message }, true); this.sendMessage({ type: 'error', message: 'Failed to process audio: ' + error.message, modelType: this.modelType, timestamp: new Date().toISOString() }); } }

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
                    '-f', 'webm',       // Specify input format
                    '-c:a', 'libopus',  // Specify input codec
                    '-i', 'pipe:0',     // Input from stdin
                    '-f', 's16le',      // Output format PCM signed 16-bit little-endian
                    '-ar', '16000',     // Output sample rate 16kHz
                    '-ac', '1',         // Output audio channels 1 (mono)
                    '-'                 // Output to stdout
                ];
                this.log('Spawning ffmpeg with stdin piping, args:', ffmpegArgs);
                const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
                
                const outputBuffers = [];
                const errorOutput = [];
                
                ffmpegProcess.stdin.on('error', (err) => {
                    this.log('ffmpeg stdin error:', { error: err.message }, true);
                    // No reject here, as close event will handle ffmpeg exit code
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
                
                ffmpegProcess.on('error', (err) => { // For errors like EPIPE or spawn issues
                    this.log(`ffmpeg process error (stdin): ${err.message}`, null, true);
                    reject(new Error(`ffmpeg process error (stdin): ${err.message}`));
                });

                // Write buffer to stdin and close it
                ffmpegProcess.stdin.write(fullWebmBuffer);
                ffmpegProcess.stdin.end();
            });
            
        } catch (error) {
            this.log('Error during stdin transcoding process', { error: error.message }, true);
        }
        return pcmDataBuffer;
    }

    async convertPcmToWavForTelegram(pcmBase64Data) { const pcmBuffer = Buffer.from(pcmBase64Data, 'base64'); this.log(`Converting PCM to WAV`, { inputSize: pcmBuffer.length }); try { const wavBuffer = await this.convertPcmToWav44k(pcmBuffer); this.log(`PCM to WAV conversion successful`, { outputSize: wavBuffer.length }); return { base64: wavBuffer.toString('base64'), mimeType: 'audio/wav', sampleRate: 44100 }; } catch (error) { this.log('PCM to WAV conversion failed', { error: error.message }, true); throw error; } }
    async convertPcmToWav44k(pcmBuffer) { const safeUserId = (this.userId || 'unknownUser').replace(/[^a-zA-Z0-9_-]/g, '_'); const tempId = `audio_${safeUserId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; const tempPcmPath = path.join(os.tmpdir(), `${tempId}_input.pcm`); const tempWavPath = path.join(os.tmpdir(), `${tempId}_output.wav`); try { await fs.writeFile(tempPcmPath, pcmBuffer); await new Promise((resolve, reject) => { const ffmpegProcess = spawn('ffmpeg', ['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', tempPcmPath, '-ar', '44100', '-acodec', 'pcm_s16le', '-f', 'wav', '-bitexact', '-y', tempWavPath]); const errorOutput = []; ffmpegProcess.stderr.on('data', (data) => { errorOutput.push(data.toString()); }); ffmpegProcess.on('close', (code) => { if (code === 0) { resolve(); } else { reject(new Error(`FFmpeg failed with code ${code}. Error: ${errorOutput.join('')}`)); } }); ffmpegProcess.on('error', (err) => { reject(new Error(`FFmpeg process error: ${err.message}`)); }); }); const wavBuffer = await fs.readFile(tempWavPath); return wavBuffer; } finally { try { await fs.unlink(tempPcmPath).catch(() => {}); await fs.unlink(tempWavPath).catch(() => {}); } catch (e) { /* Ignore cleanup errors */ } } }
    disconnectGemini(reason = 'Manual disconnect') { this.log(`Disconnecting from Gemini: ${reason}`); if (this.liveSession) { try { this.liveSession.close(); } catch (e) { this.log('Error closing liveSession', { error: e.message }, true); } this.liveSession = null; } this.isConnected = false; this.notifyN8n('connection_closed', { reason, conversationTurns: this.conversationHistory.length, modelType: this.modelType }); }
    sendMessage(message) { if (this.ws.readyState === this.ws.OPEN) { try { this.ws.send(JSON.stringify(message)); } catch (error) { this.log('Error sending message', { error: error.message }, true); } } else { this.log('Cannot send message, WebSocket not open', { readyState: this.ws.readyState, messageType: message.type }, true); } }
    async notifyN8n(eventType, data = {}) { try { const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 5000); await fetch(`${N8N_BASE_URL}/webhook/voice-session`, { signal: controller.signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_token: this.sessionToken, action: 'log_event', event_type: eventType, data: { userId: this.userId, sessionId: this.sessionId, modelType: this.modelType, timestamp: new Date().toISOString(), ...data } }) }); clearTimeout(timeoutId); } catch (error) { this.log('Failed to notify N8N', { eventType, error: error.message }, true); } }
    async logConversationTurn() { const recentHistory = this.conversationHistory.slice(-10); await this.notifyN8n('conversation_turn', { conversationHistory: recentHistory, turnCount: this.turnCount }); }
    cleanup(reason = 'Unknown') { this.log(`Cleaning up session: ${reason}`); if (this.sessionInitTimer) { clearTimeout(this.sessionInitTimer); this.sessionInitTimer = null; } if (this.connectionTimeout) { clearTimeout(this.connectionTimeout); this.connectionTimeout = null; } if (this.healthCheckInterval) { clearInterval(this.healthCheckInterval); this.healthCheckInterval = null; } this.disconnectGemini(reason); connections.delete(this.sessionToken); connectionStats.activeConnections = Math.max(0, connectionStats.activeConnections - 1); if (this.ws.readyState === this.ws.OPEN) { this.ws.close(1000, reason); } this.log(`Session cleanup completed`); }
}

wss.on('connection', (ws, request) => { const connectionTime = Date.now(); const clientIP = request.headers['x-forwarded-for'] || request.socket.remoteAddress; console.log(`🔌 New WebSocket connection from ${clientIP}`); const url = new URL(request.url, `http://${request.headers.host}`); const sessionToken = url.searchParams.get('session'); if (!sessionToken) { console.error('❌ No session token provided'); ws.close(1008, 'Session token required'); return; } if (sessionToken.length < 10) { console.error('❌ Invalid session token format'); ws.close(1008, 'Invalid session token'); return; } if (connections.has(sessionToken)) { console.log('⚠️ Session already exists, closing old connection'); connections.get(sessionToken).cleanup('Replaced by new connection'); } const session = new EnhancedTelegramGeminiSession(ws, sessionToken); connections.set(sessionToken, session); console.log(`✅ Enhanced session created: ${sessionToken.substring(0, 20)}... (Total: ${connections.size})`); ws.on('message', async (data) => { try { await session.handleClientMessage(data); } catch (error) { console.error('❌ Error handling message:', error); session.sendMessage({ type: 'error', message: 'Internal server error', timestamp: new Date().toISOString() }); } }); ws.on('close', (code, reason) => { const duration = Date.now() - connectionTime; const reasonStr = reason ? reason.toString() : 'No reason provided'; console.log(`📴 WebSocket closed after ${duration}ms: ${code} - ${reasonStr}`); session.cleanup(`Connection closed: ${reasonStr}`); }); ws.on('error', (error) => { console.error('❌ WebSocket error:', error); session.cleanup(`WebSocket error: ${error.message}`); }); const connectionTimeout = setTimeout(() => { if (ws.readyState === ws.CONNECTING) { console.log('⏰ Connection timeout during handshake'); ws.close(1000, 'Connection timeout'); } }, 30000); ws.on('open', () => { clearTimeout(connectionTimeout); }); });
setInterval(() => { const now = Date.now(); let cleanedUp = 0; for (const [token, session] of connections.entries()) { const timeSinceActivity = now - session.lastActivity; if (timeSinceActivity > CONNECTION_TIMEOUT) { console.log(`🧹 Cleaning up stale session: ${token.substring(0, 20)}... (inactive for ${Math.round(timeSinceActivity/1000/60)}min)`); session.cleanup('Stale connection cleanup'); cleanedUp++; } } if (cleanedUp > 0) { console.log(`🧹 Cleaned up ${cleanedUp} stale connections. Active: ${connections.size}`); } }, 5 * 60 * 1000);
function gracefulShutdown(signal) { console.log(`${signal} received, shutting down gracefully...`); connections.forEach(session => { session.sendMessage({ type: 'server_shutdown', message: 'Server is shutting down', timestamp: new Date().toISOString() }); session.cleanup('Server shutdown'); }); wss.close(() => { console.log('WebSocket server closed'); server.close(() => { console.log('HTTP server closed'); console.log('Final connection stats:', { total: connectionStats.totalConnections, successful: connectionStats.successfulSessions, failed: connectionStats.failedSessions, uptime: Math.floor(process.uptime()) + 's' }); process.exit(0); }); }); setTimeout(() => { console.log('Force exit after timeout'); process.exit(1); }, 10000); }
process.on('SIGTERM', gracefulShutdown); process.on('SIGINT', gracefulShutdown);
server.listen(PORT, HOST, () => { console.log(`🚀 Enhanced Telegram-Optimized Gemini WebSocket Proxy v3.0.3`); console.log(`   Running on ${HOST}:${PORT}`); console.log(`   Environment: ${NODE_ENV}`); console.log(`   Session timeout: ${SESSION_INIT_TIMEOUT/1000}s`); console.log(`   Health check interval: ${HEALTH_CHECK_INTERVAL/1000}s`); console.log(`   Max message size: ${MAX_MESSAGE_SIZE/1024/1024}MB`); console.log(`   Features: Enhanced Error Handling, Health Monitoring, FFmpeg Stdin Piping Transcoding, Modern UI Support`); console.log(`   N8N URL: ${N8N_BASE_URL}`); console.log(`   Ready to accept connections...`); });
process.on('uncaughtException', (error) => { console.error('💥 Uncaught Exception:', error); console.error('Stack:', error.stack); gracefulShutdown('UNCAUGHT_EXCEPTION'); });
process.on('unhandledRejection', (reason, promise) => { console.error('💥 Unhandled Rejection at:', promise); console.error('Reason:', reason); gracefulShutdown('UNHANDLED_REJECTION'); });
setInterval(() => { const memUsage = process.memoryUsage(); const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024); if (memUsedMB > 500) { console.warn(`⚠️ High memory usage: ${memUsedMB}MB (Active connections: ${connections.size})`); } }, 60000);
