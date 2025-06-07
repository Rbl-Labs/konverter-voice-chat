/**
 * Logger Integration Example for gemini_websocket_proxy.js
 * 
 * This file demonstrates how to integrate the SessionLogger with the existing
 * gemini_websocket_proxy.js to log all API messages (requests and responses).
 */

// Import the SessionLogger
const SessionLogger = require('./session_logger');

// Example of how to modify the EnhancedTelegramGeminiSession class in gemini_websocket_proxy.js

class EnhancedTelegramGeminiSession {
    constructor(ws, sessionToken) {
        // Existing initialization code...
        
        // Initialize logger with a temporary ID
        this.logger = new SessionLogger({
            sessionId: sessionToken.substring(0, 8),
            userId: 'initializing',
            logDir: '/logs',
            logLevel: process.env.LOG_LEVEL || 'info'
        });
        
        // Log session creation
        this.logger.info('Enhanced session created', { 
            sessionToken: this.sessionToken.substring(0, 20) + '...',
            timestamp: new Date().toISOString() 
        });
        
        // Rest of the constructor...
    }
    
    // Update the logger once we have the real session ID and user ID
    async getSessionConfig() {
        try {
            this.logger.info(`Fetching session config from N8N`);
            
            // Existing code to fetch session config...
            
            // After getting the session ID and user ID, update the logger
            this.logger = new SessionLogger({
                sessionId: this.sessionId,
                userId: this.userId,
                logDir: '/logs',
                logLevel: process.env.LOG_LEVEL || 'info'
            });
            
            this.logger.info('Session configured successfully', { 
                sessionId: this.sessionId, 
                userId: this.userId, 
                model: this.sessionConfigFromN8n?.model || 'not_provided' 
            });
            
        } catch (error) {
            this.logger.error('Failed to get session configuration', null, error);
            throw error;
        }
    }
    
    // Replace the existing log method with one that uses SessionLogger
    log(message, data = null, isError = false) {
        if (isError) {
            this.logger.error(message, data);
        } else {
            this.logger.info(message, data);
        }
        
        // Keep the console output and client debug messages
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
    
    // Log all messages sent to the client
    sendMessage(message) {
        if (this.ws.readyState === this.ws.OPEN) {
            try {
                // Log the message being sent to the client
                this.logger.debug('Sending message to client', {
                    type: message.type,
                    hasAudioData: !!message.audioData,
                    audioDataLength: message.audioData?.length || 0,
                    timestamp: message.timestamp
                });
                
                this.ws.send(JSON.stringify(message));
            } catch (error) {
                this.logger.error('Error sending message', { error: error.message });
            }
        } else {
            this.logger.warn('Cannot send message, WebSocket not open', { 
                readyState: this.ws.readyState, 
                messageType: message.type 
            });
        }
    }
    
    // Log all client messages
    async handleClientMessage(data) {
        try {
            this.resetTimeout();
            if (data.length > MAX_MESSAGE_SIZE) throw new Error(`Message too large: ${data.length} bytes`);
            
            const message = JSON.parse(data);
            
            // Log the received client message
            this.logger.debug(`Received client message: ${message.type}`, { 
                hasAudioData: !!message.audioData, 
                audioDataLength: message.audioData?.length || 0, 
                textLength: message.text?.length || 0, 
                sampleRate: message.sampleRate, 
                timestamp: message.timestamp 
            });
            
            // Process the message as before...
            switch (message.type) {
                case 'connect_gemini': 
                    this.logger.info('Client requested Gemini connection');
                    await this.connectToGemini(); 
                    break;
                // Other cases...
            }
        } catch (error) {
            this.logger.error('Error handling client message', null, error);
            this.sendMessage({ 
                type: 'error', 
                message: 'Failed to process message: ' + error.message, 
                modelType: this.modelType, 
                timestamp: new Date().toISOString() 
            });
        }
    }
    
    // Log all Gemini API messages
    async handleGeminiMessage(message) {
        // Log the raw message from Gemini
        this.logger.debug('Raw Gemini message received', {
            type: message.type || 'unknown',
            hasSetupComplete: !!message.setupComplete,
            hasServerContent: !!message.serverContent,
            hasToolCall: !!message.toolCall,
            hasToolCallResult: !!message.toolCallResult,
            hasFunctionCalls: !!(message.toolCall && message.toolCall.functionCalls)
        });
        
        // Log the full message in development mode
        if (process.env.NODE_ENV === 'development') {
            this.logger.debug('Full Gemini message', message);
        }
        
        // Send the raw message to the client for debugging
        this.sendMessage({ 
            type: 'gemini_raw_output', 
            data: message, 
            timestamp: new Date().toISOString() 
        });
        
        // Process the message as before...
        try {
            if (message.setupComplete) {
                this.logger.info('Gemini setup completed');
                this.sendMessage({ 
                    type: 'gemini_setup_complete', 
                    modelType: this.modelType, 
                    timestamp: new Date().toISOString() 
                });
                return;
            }
            
            // Rest of the processing...
        } catch (error) {
            this.logger.error('Error handling Gemini message', null, error);
            this.sendMessage({ 
                type: 'error', 
                message: 'Error processing Gemini response: ' + error.message, 
                modelType: this.modelType, 
                timestamp: new Date().toISOString() 
            });
        }
    }
    
    // Log all API calls to Gemini
    async connectToGemini() {
        if (!this.initializationComplete) {
            this.logger.error('Session initialization not complete');
            throw new Error('Session initialization not complete');
        }
        
        try {
            this.logger.info(`Connecting to Gemini Live API (${this.modelType})...`);
            
            const modelName = this.sessionConfigFromN8n?.model || this.getDefaultModelForType();
            const liveConnectConfig = this.buildConnectionConfig();
            
            this.logger.info('Using connection config', { 
                model: modelName, 
                configKeys: Object.keys(liveConnectConfig) 
            });
            
            // Log the full config in development mode
            if (process.env.NODE_ENV === 'development') {
                this.logger.debug('Full connection config', liveConnectConfig);
            }
            
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
            
            this.logger.info(`Gemini Live session created successfully`);
        } catch (error) {
            this.logger.error(`Failed to connect to Gemini`, null, error);
            this.sendMessage({ 
                type: 'gemini_connection_failed', 
                message: error.message, 
                modelType: this.modelType, 
                timestamp: new Date().toISOString(), 
                retryable: true 
            });
            throw error;
        }
    }
    
    // Log all audio processing
    async handleAudioInputPCM(message) {
        if (!this.isConnected || !this.liveSession) {
            this.logger.warn('Cannot process PCM audio input, not connected to Gemini.');
            this.sendMessage({ 
                type: 'error', 
                message: 'Not connected to Gemini, cannot process PCM audio.', 
                modelType: this.modelType, 
                retryable: true 
            });
            return;
        }
        
        if (!message.audioData) {
            this.logger.warn('Received audio_input_pcm without audioData, ignoring.');
            return;
        }
        
        this.resetTimeout();
        try {
            const sampleRate = message.sampleRate || 16000;
            this.logger.info(`Processing PCM audio input`, { 
                audioDataLength: message.audioData.length, 
                sampleRate: sampleRate, 
                timestamp: message.timestamp 
            });

            const audioInput = {
                audio: {
                    data: message.audioData,
                    mimeType: `audio/pcm;rate=${sampleRate}`
                }
            };
            
            // Log the audio input in development mode (without the actual audio data)
            if (process.env.NODE_ENV === 'development') {
                this.logger.debug('Sending audio input to Gemini', {
                    mimeType: `audio/pcm;rate=${sampleRate}`,
                    dataLength: message.audioData.length
                });
            }
            
            await this.liveSession.sendRealtimeInput(audioInput);
            this.logger.debug('PCM audio sent to Gemini successfully');
        } catch (error) {
            this.logger.error('Error sending PCM audio input to Gemini', null, error);
            this.sendMessage({ 
                type: 'error', 
                message: 'Failed to process PCM audio: ' + error.message, 
                modelType: this.modelType, 
                timestamp: new Date().toISOString() 
            });
        }
    }
    
    // Log all text inputs
    async handleTextInput(message) {
        if (!this.isConnected || !this.liveSession) {
            this.logger.warn('Cannot send text input, not connected to Gemini.');
            this.sendMessage({ 
                type: 'error', 
                message: 'Not connected to Gemini. Cannot send text.', 
                modelType: this.modelType, 
                retryable: true 
            });
            return;
        }
        
        if (!message.text || message.text.trim().length === 0) {
            this.logger.warn('Received empty text_input from client, ignoring.');
            return;
        }
        
        this.resetTimeout();
        try {
            this.logger.info(`Processing text input: "${message.text}"`);
            this.logger.debug(`Connection state: isConnected=${this.isConnected}, liveSession=${!!this.liveSession}`);
            
            this.conversationHistory.push({ 
                type: 'user_text', 
                text: message.text, 
                timestamp: new Date(message.timestamp || Date.now()).toISOString() 
            });

            // Send debug message back to client
            this.sendMessage({ 
                type: 'debug_log', 
                level: 'INFO', 
                message: `Backend received text: "${message.text}"`, 
                timestamp: new Date().toISOString() 
            });

            if (this.currentUtteranceWebmChunks.length > 0) {
                this.logger.info('User sent text while audio chunks were buffered. Processing buffered audio first...');
                await this.processEndOfSpeech();
            }

            // First send the text input
            this.logger.debug(`Sending text to Gemini: "${message.text}"`);
            await this.liveSession.sendRealtimeInput({ parts: [{ text: message.text }] });
            this.logger.debug(`Text sent to Gemini successfully`);
            
            // Then signal end of turn (equivalent to end_of_turn=True in Python)
            this.logger.debug(`Sending audioStreamEnd signal to Gemini`);
            await this.liveSession.sendRealtimeInput({ audioStreamEnd: true });
            this.logger.debug(`audioStreamEnd signal sent to Gemini successfully`);
            
            // Send confirmation to client
            this.sendMessage({ 
                type: 'text_input_received', 
                text: message.text, 
                timestamp: new Date().toISOString() 
            });
            
            this.logger.info('Text input sent to Gemini successfully with end-of-turn signal.');
        } catch (error) {
            this.logger.error('Error sending text input to Gemini', null, error);
            this.sendMessage({ 
                type: 'error', 
                message: 'Failed to send text to AI: ' + error.message, 
                modelType: this.modelType, 
                timestamp: new Date().toISOString() 
            });
        }
    }
    
    // Log cleanup and session end
    cleanup(reason = 'Unknown') {
        this.logger.info(`Cleaning up session: ${reason}`);
        
        // Existing cleanup code...
        
        // Log final session stats
        this.logger.info('Session ended', {
            sessionId: this.sessionId,
            userId: this.userId,
            reason: reason,
            duration: Date.now() - this.createdAt,
            conversationTurns: this.conversationHistory.length,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Example of how to set up log rotation and cleanup
 * 
 * This should be added to the main server file (gemini_websocket_proxy.js)
 */

const fs = require('fs').promises;
const path = require('path');

// Set up log rotation and cleanup (run once a day)
async function cleanupOldLogs() {
    try {
        const logDir = '/logs';
        const files = await fs.readdir(logDir);
        const now = Date.now();
        const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000; // 48 hours in milliseconds
        
        let deletedCount = 0;
        
        for (const file of files) {
            if (file.endsWith('.log')) {
                const filePath = path.join(logDir, file);
                const stats = await fs.stat(filePath);
                const fileAge = now - stats.mtime.getTime();
                
                // Delete files older than 48 hours
                if (fileAge > TWO_DAYS_MS) {
                    await fs.unlink(filePath);
                    deletedCount++;
                    console.log(`Deleted old log file: ${file}`);
                }
            }
        }
        
        console.log(`Log cleanup complete. Deleted ${deletedCount} files older than 48 hours.`);
    } catch (error) {
        console.error('Error cleaning up old logs:', error);
    }
}

// Run log cleanup once a day
setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

// Also run it once at startup
cleanupOldLogs();

/**
 * Example of how to create a log viewer endpoint
 * 
 * This should be added to the main server file (gemini_websocket_proxy.js)
 */

// Add this to the Express app setup
app.get('/logs', async (req, res) => {
    try {
        // Check for authentication (you should implement proper auth)
        const apiKey = req.query.key;
        if (apiKey !== process.env.ADMIN_API_KEY) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const logDir = '/logs';
        const files = await fs.readdir(logDir);
        const logFiles = files.filter(file => file.endsWith('.log'));
        
        // Sort by modification time (newest first)
        const fileStats = await Promise.all(
            logFiles.map(async file => {
                const filePath = path.join(logDir, file);
                const stats = await fs.stat(filePath);
                return { file, mtime: stats.mtime };
            })
        );
        
        fileStats.sort((a, b) => b.mtime - a.mtime);
        
        // Get the requested file or the newest one
        const requestedFile = req.query.file || fileStats[0]?.file;
        
        if (!requestedFile) {
            return res.json({ files: fileStats.map(f => ({ name: f.file, mtime: f.mtime })) });
        }
        
        // Read the log file
        const filePath = path.join(logDir, requestedFile);
        const content = await fs.readFile(filePath, 'utf8');
        
        // Parse the log entries
        const entries = content.split('\n')
            .filter(line => line.trim())
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return { error: 'Invalid JSON', raw: line };
                }
            });
        
        res.json({
            file: requestedFile,
            entries,
            files: fileStats.map(f => ({ name: f.file, mtime: f.mtime }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add a simple HTML log viewer
app.get('/logs/viewer', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Log Viewer</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
                .container { max-width: 1200px; margin: 0 auto; }
                .file-list { margin-bottom: 20px; }
                .file-item { cursor: pointer; padding: 5px; margin: 2px; background: #f0f0f0; display: inline-block; }
                .file-item:hover { background: #e0e0e0; }
                .log-entry { margin-bottom: 10px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; }
                .log-entry.error { border-color: #f88; background-color: #fee; }
                .log-entry.warn { border-color: #fd8; background-color: #ffe; }
                .log-entry.debug { border-color: #8df; background-color: #eef; }
                .timestamp { color: #666; font-size: 0.9em; }
                .message { font-weight: bold; }
                .data { margin-top: 5px; font-family: monospace; white-space: pre-wrap; }
                .controls { margin-bottom: 20px; }
                #apiKey { width: 300px; padding: 5px; }
                button { padding: 5px 10px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Log Viewer</h1>
                <div class="controls">
                    <input type="password" id="apiKey" placeholder="Admin API Key" />
                    <button onclick="loadFiles()">Load Files</button>
                </div>
                <div class="file-list" id="fileList"></div>
                <div id="logEntries"></div>
            </div>
            
            <script>
                async function loadFiles() {
                    const apiKey = document.getElementById('apiKey').value;
                    if (!apiKey) {
                        alert('Please enter the admin API key');
                        return;
                    }
                    
                    try {
                        const response = await fetch(\`/logs?key=\${apiKey}\`);
                        const data = await response.json();
                        
                        if (data.error) {
                            alert('Error: ' + data.error);
                            return;
                        }
                        
                        const fileList = document.getElementById('fileList');
                        fileList.innerHTML = '';
                        
                        data.files.forEach(file => {
                            const fileItem = document.createElement('div');
                            fileItem.className = 'file-item';
                            fileItem.textContent = file.name;
                            fileItem.onclick = () => loadLogFile(file.name);
                            fileList.appendChild(fileItem);
                        });
                    } catch (error) {
                        alert('Error: ' + error.message);
                    }
                }
                
                async function loadLogFile(fileName) {
                    const apiKey = document.getElementById('apiKey').value;
                    if (!apiKey) {
                        alert('Please enter the admin API key');
                        return;
                    }
                    
                    try {
                        const response = await fetch(\`/logs?key=\${apiKey}&file=\${fileName}\`);
                        const data = await response.json();
                        
                        if (data.error) {
                            alert('Error: ' + data.error);
                            return;
                        }
                        
                        const logEntries = document.getElementById('logEntries');
                        logEntries.innerHTML = \`<h2>Log: \${fileName}</h2>\`;
                        
                        data.entries.forEach(entry => {
                            const entryDiv = document.createElement('div');
                            entryDiv.className = \`log-entry \${entry.level || ''}\`;
                            
                            const timestamp = document.createElement('div');
                            timestamp.className = 'timestamp';
                            timestamp.textContent = entry.timestamp || 'No timestamp';
                            entryDiv.appendChild(timestamp);
                            
                            const message = document.createElement('div');
                            message.className = 'message';
                            message.textContent = entry.message || 'No message';
                            entryDiv.appendChild(message);
                            
                            if (entry.data) {
                                const data = document.createElement('div');
                                data.className = 'data';
                                data.textContent = JSON.stringify(entry.data, null, 2);
                                entryDiv.appendChild(data);
                            }
                            
                            logEntries.appendChild(entryDiv);
                        });
                    } catch (error) {
                        alert('Error: ' + error.message);
                    }
                }
            </script>
        </body>
        </html>
    `);
});
