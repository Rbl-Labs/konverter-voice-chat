class GeminiNativeAudioChat {
    constructor() {
        this.sessionToken = null;
        this.geminiClient = null;
        this.liveSession = null;
        this.isRecording = false;
        this.isConnected = false;
        this.mediaRecorder = null;
        this.audioContext = null; // Used for mic visualization
        this.analyser = null;
        this.dataArray = null;
        this.animationId = null;
        this.responseQueue = [];
        this.audioChunks = [];
        
        // Audio playback system
        this.playbackAudioContext = null;
        this.isPlaying = false;
        this.currentSource = null; // Renamed from currentPlaybackSource for clarity
        this.audioInitialized = false;
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.currentTurnAudioData = []; // Stores Base64 PCM strings for the current turn
        
        // VAD properties
        this.vadSilenceThreshold = 0.01;
        this.vadRequiredSilenceDuration = 1500;
        this.vadEnergySmoothing = 0.1;
        this.currentEnergy = 0.0;
        this.silenceStartTime = 0;
        this.vadMonitoringInterval = null;
        
        this.initializeUI();
        this.initializeSession();
        this.setupMobileAudioHandler();
    }

    setupMobileAudioHandler() {
        if (this.isMobile) {
            // Add a one-time click handler to initialize audio on mobile
            const initAudio = async () => {
                if (!this.audioInitialized) {
                    await this.initializeAudioContext();
                    document.removeEventListener('click', initAudio);
                    document.removeEventListener('touchstart', initAudio);
                }
            };
            
            document.addEventListener('click', initAudio);
            document.addEventListener('touchstart', initAudio);
            
            this.addDebugInfo('Mobile device detected. Audio will initialize on first user interaction.');
        }
    }

    async initializeAudioContext() {
        try {
            if (this.playbackAudioContext && this.playbackAudioContext.state !== 'closed') {
                if (this.playbackAudioContext.state === 'suspended') {
                    await this.playbackAudioContext.resume();
                    this.addDebugInfo('Playback AudioContext resumed.');
                }
                return; 
            }
            
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.playbackAudioContext = new AudioContextClass(); // Let browser choose sample rate
            this.addDebugInfo(`Playback AudioContext initialized/re-initialized. Actual rate: ${this.playbackAudioContext.sampleRate}Hz`);
            
            if (this.playbackAudioContext.state === 'suspended') {
                await this.playbackAudioContext.resume();
                this.addDebugInfo('Playback AudioContext immediately resumed after creation.');
            }
            
            // GainNode for volume control (optional, but good practice)
            this.gainNode = this.playbackAudioContext.createGain();
            this.gainNode.connect(this.playbackAudioContext.destination);
            
            this.audioInitialized = true; // Mark as initialized
            this.addDebugInfo('Audio system (re)initialized successfully for playback.');
            
        } catch (error) {
            this.addDebugInfo(`Failed to initialize playback audio context: ${error.message}`);
            console.error('Playback AudioContext initialization error:', error);
        }
    }

    // Removed startAudioProcessingLoop, playNextInQueue, playProcessedAudio, queueAudioData, createAudioBufferFromPCM, finalizeAudioStream

    async playRawPcmData(pcmDataArray) {
        if (!pcmDataArray || pcmDataArray.length === 0) {
            this.addDebugInfo('playRawPcmData: No PCM data to play.');
            return;
        }

        try {
            if (!this.playbackAudioContext || this.playbackAudioContext.state === 'closed') {
                this.addDebugInfo('playRawPcmData: PlaybackAudioContext not ready. Attempting to initialize.');
                await this.initializeAudioContext();
                if (!this.playbackAudioContext || this.playbackAudioContext.state === 'closed') {
                     this.addDebugInfo('playRawPcmData: Failed to initialize AudioContext. Cannot play audio.');
                     this.updateStatus('Audio playback failed: Context error.', 'error');
                     return;
                }
            }
            
            if (this.playbackAudioContext.state === 'suspended') {
                this.addDebugInfo('playRawPcmData: Playback AudioContext is suspended, attempting to resume...');
                await this.playbackAudioContext.resume();
                this.addDebugInfo(`playRawPcmData: Playback AudioContext state after resume: ${this.playbackAudioContext.state}`);
                 if (this.playbackAudioContext.state === 'suspended') {
                    this.addDebugInfo('playRawPcmData: Failed to resume AudioContext. Playback aborted.');
                    this.updateStatus('Audio resume failed. Please interact with the page.', 'error');
                    return;
                 }
            }

            const inputSampleRate = 24000; // Gemini output is 24kHz PCM
            const numChannels = 1;
            const numSamples = pcmDataArray.length / 2; // 16-bit PCM (2 bytes per sample)

            if (numSamples === 0) {
                this.addDebugInfo('playRawPcmData: Decoded PCM data has 0 samples.');
                return;
            }

            const audioBuffer = this.playbackAudioContext.createBuffer(numChannels, numSamples, inputSampleRate);
            const channelData = audioBuffer.getChannelData(0);
            const dataView = new DataView(pcmDataArray.buffer, pcmDataArray.byteOffset, pcmDataArray.byteLength);

            for (let i = 0; i < numSamples; i++) {
                const pcmSample = dataView.getInt16(i * 2, true); // true for little-endian
                channelData[i] = pcmSample / 32768.0; // Normalize to [-1.0, 1.0]
            }
            
            this.addDebugInfo(`playRawPcmData: AudioBuffer created. SR: ${audioBuffer.sampleRate}Hz, Samples: ${audioBuffer.length}, Duration: ${audioBuffer.duration.toFixed(3)}s`);

            if (this.currentSource) {
                try { 
                    this.currentSource.onended = null; // Remove previous onended handler
                    this.currentSource.stop(); 
                    this.currentSource.disconnect();
                } catch(e) { this.addDebugInfo("Error stopping previous source: " + e.message); }
            }

            const source = this.playbackAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            
            const targetPlaybackRate = inputSampleRate / this.playbackAudioContext.sampleRate;
            if (Math.abs(source.playbackRate.value - targetPlaybackRate) > 0.001) { // Check if adjustment is needed
                 source.playbackRate.value = targetPlaybackRate;
                 this.addDebugInfo(`playRawPcmData: Adjusting playback rate. BufferSR: ${inputSampleRate}, ContextSR: ${this.playbackAudioContext.sampleRate}, Rate: ${targetPlaybackRate.toFixed(3)}`);
            } else {
                 this.addDebugInfo(`playRawPcmData: Playback rate fine. BufferSR: ${inputSampleRate}, ContextSR: ${this.playbackAudioContext.sampleRate}`);
            }
            
            source.connect(this.gainNode || this.playbackAudioContext.destination);
            source.start();
            this.currentSource = source;
            this.isPlaying = true;
            this.addMessage('🔊 [Playing audio response]', 'ai');
            this.animateWaveformForAudio();

            source.onended = () => {
                this.addDebugInfo('playRawPcmData: Audio playback finished.');
                if (this.currentSource === source) {
                    this.currentSource = null;
                }
                this.isPlaying = false;
                this.animateWaveformForAudio(); // To reset waveform
            };

        } catch (error) {
            this.addDebugInfo(`playRawPcmData error: ${error.message}. Stack: ${error.stack}`);
            console.error('Error playing raw PCM audio:', error);
            this.isPlaying = false;
        }
    }
    
    // playAudioResponse now just accumulates data for the current turn
    async playAudioResponse(audioData) { 
        if (audioData) { 
            this.addDebugInfo(`Received audio data chunk for current turn, length: ${audioData.length}`);
            this.currentTurnAudioData.push(audioData);
        }
    }
    
    initializeUI() {
        this.statusEl = document.getElementById('status');
        this.micButton = document.getElementById('micButton');
        this.connectBtn = document.getElementById('connectBtn');
        this.disconnectBtn = document.getElementById('disconnectBtn');
        this.conversationLog = document.getElementById('conversationLog');
        this.sessionInfo = document.getElementById('sessionInfo');
        this.waveform = document.getElementById('waveform');
        this.debugInfo = document.getElementById('debugInfo');

        // Event listeners
        this.micButton.addEventListener('click', () => this.toggleRecording());
        this.connectBtn.addEventListener('click', () => this.connectToWebSocket());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());

        // Generate wave bars
        this.generateWaveBars();
    }

    generateWaveBars() {
        this.waveform.innerHTML = '';
        for (let i = 0; i < 50; i++) {
            const bar = document.createElement('div');
            bar.className = 'wave-bar';
            bar.style.height = '10px';
            this.waveform.appendChild(bar);
        }
    }

    addDebugInfo(message) {
        const timestamp = new Date().toLocaleTimeString();
        this.debugInfo.innerHTML += `${timestamp}: ${message}<br>`;
        this.debugInfo.scrollTop = this.debugInfo.scrollHeight;
        console.log(message);
    }

    async initializeSession() {
        try {
            this.addDebugInfo('Starting session initialization...');
            
            // Get session token from URL
            const urlParams = new URLSearchParams(window.location.search);
            this.sessionToken = urlParams.get('session');
            
            if (!this.sessionToken) {
                throw new Error('No session token provided');
            }

            this.addDebugInfo(`Session token: ${this.sessionToken.substring(0, 20)}...`);
            this.updateStatus('Getting session config...');
            
            // Get session configuration from n8n
            const apiUrl = `https://n8n.lomeai.com/webhook/voice-session?session=${this.sessionToken}&action=initialize`;
            this.addDebugInfo(`Calling API: ${apiUrl}`);
            
            const response = await fetch(apiUrl);
            const rawData = await response.json();
            
            this.addDebugInfo(`Raw response: ${JSON.stringify(rawData).substring(0, 200)}...`);
            
            // Handle the response format from n8n
            let data;
            if (Array.isArray(rawData) && rawData.length > 0) {
                data = rawData[0];
                this.addDebugInfo('Parsed array response');
            } else {
                data = rawData;
                this.addDebugInfo('Direct response format');
            }
            
            if (!data || !data.success) {
                throw new Error(data?.error || 'Failed to initialize session');
            }

            this.sessionConfig = data.config;
            this.sessionInfo.textContent = `Session: ${data.sessionId} | User: ${data.userId}`;
            
            this.addDebugInfo(`Model: ${this.sessionConfig.model}`);
            this.addDebugInfo(`API Key: ${this.sessionConfig.apiKey ? 'Present' : 'Missing'}`);
            
            this.updateStatus('Ready to connect');
            this.connectBtn.disabled = false;
            
        } catch (error) {
            this.addDebugInfo(`Session init error: ${error.message}`);
            console.error('Session initialization failed:', error);
            this.updateStatus('Failed to initialize session: ' + error.message, 'error');
        }
    }

    async connectToWebSocket() {
        try {
            this.addDebugInfo('Connecting to WebSocket proxy...');
            
            // Initialize audio context early on desktop
            if (!this.isMobile && !this.audioInitialized) {
                await this.initializeAudioContext();
            }
            
            // Get the WebSocket URL from the session config
            const wsUrl = this.sessionConfig.websocketProxyUrl;
            if (!wsUrl) {
                throw new Error('No WebSocket proxy URL provided');
            }
            
            // Create WebSocket connection with session token
            this.ws = new WebSocket(`${wsUrl}&session=${this.sessionToken}`);
            
            // Set up WebSocket handlers
            this.ws.onopen = () => {
                this.addDebugInfo('WebSocket connection opened');
                this.updateStatus('WebSocket connected, waiting for session initialization...', '');
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleWebSocketMessage(message);
                } catch (error) {
                    this.addDebugInfo(`Failed to parse message: ${error.message}`);
                }
            };
            
            this.ws.onerror = (error) => {
                this.addDebugInfo(`WebSocket error: ${error.message}`);
                this.updateStatus('Connection error', 'error');
                this.handleDisconnection();
            };
            
            this.ws.onclose = (event) => {
                this.addDebugInfo(`WebSocket closed: ${event.reason}`);
                this.updateStatus('Connection closed', 'error');
                this.handleDisconnection();
            };
            
        } catch (error) {
            this.addDebugInfo(`Connection error: ${error.message}`);
            console.error('Failed to connect:', error);
            this.updateStatus('Connection failed: ' + error.message, 'error');
            this.connectBtn.disabled = false;
        }
    }

    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'session_initialized':
                this.addDebugInfo('Session initialized successfully');
                this.updateStatus('Session ready - Connecting to Gemini...', '');
                
                // Now it's safe to connect to Gemini
                this.ws.send(JSON.stringify({
                    type: 'connect_gemini'
                }));
                this.addDebugInfo('Sent connect_gemini message');
                break;
                
            case 'gemini_connected':
                this.addDebugInfo('Received gemini_connected message');
                this.isConnected = true;
                this.updateStatus('Connected! Click microphone to talk', 'connected');
                this.micButton.disabled = false;
                this.micButton.classList.add('connected');
                this.disconnectBtn.disabled = false;
                this.connectBtn.disabled = true;
                this.addMessage('🤖 Connected! I can hear you now. Click the microphone to start talking!', 'ai');
                break;
                
            case 'gemini_disconnected':
                this.addDebugInfo('Received gemini_disconnected message: ' + message.reason);
                this.isConnected = false;
                this.updateStatus('Disconnected from Gemini: ' + message.reason, 'error');
                this.micButton.disabled = true;
                this.micButton.classList.remove('connected');
                this.disconnectBtn.disabled = true;
                this.connectBtn.disabled = false;
                this.addMessage('🔌 Disconnected from Gemini: ' + message.reason, 'ai');
                break;
                
            case 'audio_response':
                this.playAudioResponse(message.audioData);
                break;
                
            case 'text_response':
                this.addMessage('🤖 ' + message.text, 'ai');
                break;
                
            case 'error':
                this.addDebugInfo(`Server error: ${message.message}`);
                this.updateStatus(message.message, 'error');
                break;
                
            case 'turn_complete':
                this.addDebugInfo('Turn completed');
                this.finalizeAudioStream();
                break;
            
            case 'gemini_setup_complete':
                this.addDebugInfo('Received gemini_setup_complete message from backend.');
                break;

            case 'input_transcription':
                this.addDebugInfo(`Input transcription: ${message.text}`);
                this.addMessage(`🎤 You: ${message.text}`, 'user'); // Display all input transcriptions
                break;

            case 'output_transcription':
                this.addDebugInfo(`Output transcription: ${message.text}`);
                this.addMessage(`🤖 AI: ${message.text}`, 'ai'); // Display all output transcriptions
                break;
                
            default:
                this.addDebugInfo(`Unknown message type: ${message.type}`);
        }
    }

    async sendAudioToServer(audioData, isEndOfSpeech = false) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.addDebugInfo('WebSocket not connected');
            return;
        }

        try {
            const messagePayload = {
                type: 'audio_input',
                audioData: audioData, // This is base64 encoded
                mimeType: 'audio/webm;codecs=opus' // Correct MIME type for MediaRecorder default
            };
            if (isEndOfSpeech) {
                messagePayload.isEndOfSpeech = true;
            }
            this.ws.send(JSON.stringify(messagePayload));
            
            this.addDebugInfo(`Audio sent: ${audioData ? audioData.length : 0} bytes, isEndOfSpeech: ${isEndOfSpeech}`);
            
        } catch (error) {
            this.addDebugInfo(`Failed to send audio: ${error.message}`);
            console.error('Error sending audio:', error);
        }
    }

    async toggleRecording() {
        if (!this.isConnected) {
            this.updateStatus('Please connect first', 'error');
            return;
        }

        // Ensure audio is initialized on mobile
        if (this.isMobile && !this.audioInitialized) {
            await this.initializeAudioContext();
        }

        if (this.isRecording) {
            this.stopRecording();
        } else {
            await this.startContinuousConversation();
        }
    }

    async startContinuousConversation() {
        try {
            this.addDebugInfo('Starting continuous conversation...');
            
            // Request microphone access with correct format for Gemini
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });

            this.addDebugInfo('Microphone access granted');

            // Set up audio context for visualization
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            const source = this.audioContext.createMediaStreamSource(stream);
            source.connect(this.analyser);

            this.analyser.fftSize = 256;
            const bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(bufferLength);

            // Start continuous recording for real-time streaming
            this.stream = stream;
            this.isRecording = true;
            
            this.micButton.classList.add('recording');
            this.micButton.innerHTML = '⏹️';
            this.updateStatus('Conversation active - Speak naturally', 'recording');
            
            this.startWaveAnimation();
            this.addMessage('🎤 Continuous conversation started - speak naturally and Gemini will respond automatically', 'user');
            
            // Start streaming audio to Gemini in real-time
            this.startContinuousAudioStreaming();
            // Start VAD monitoring
            this.startVADMonitoring();

        } catch (error) {
            this.addDebugInfo(`Recording start error: ${error.message}`);
            console.error('Failed to start recording:', error);
            this.updateStatus('Microphone access denied: ' + error.message, 'error');
        }
    }

    async startContinuousAudioStreaming() {
        try {
            // Create a media recorder for real-time streaming
            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            
            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                    // Send audio chunk to WebSocket server
                    const audioBuffer = await event.data.arrayBuffer();
                    const base64Audio = this.arrayBufferToBase64(audioBuffer);
                    // Send intermediate chunks with isEndOfSpeech: false
                    await this.sendAudioToServer(base64Audio, false);
                }
            };
            
            // Start recording with smaller time slices for more responsive streaming
            this.mediaRecorder.start(500); // 500ms chunks for better responsiveness
            
            this.addDebugInfo('Continuous audio streaming started with automatic VAD');
            
        } catch (error) {
            this.addDebugInfo(`Audio streaming error: ${error.message}`);
            console.error('Failed to start audio streaming:', error);
        }
    }

    stopRecording() {
        if (this.isRecording) {
            this.addDebugInfo('Stopping conversation (stopRecording called)...');
            this.stopVADMonitoring(); // Stop VAD first
            
            this.isRecording = false;
            
            if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
                this.mediaRecorder.onstop = async () => {
                    this.addDebugInfo('MediaRecorder stopped, sending final isEndOfSpeech signal.');
                    await this.sendAudioToServer(null, true); 
                };
                try {
                    this.mediaRecorder.stop(); // This will trigger onstop
                } catch (e) {
                    this.addDebugInfo(`Error stopping mediaRecorder: ${e.message}. Still attempting to send EOS.`);
                    // If stop fails, still try to send EOS, though audio might be incomplete.
                    this.sendAudioToServer(null, true);
                }
            } else {
                this.addDebugInfo('MediaRecorder inactive or not found, sending isEndOfSpeech signal directly.');
                this.sendAudioToServer(null, true); // Send EOS if recorder wasn't active
            }
            
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null; // Clear the stream
            }
            
            if (this.audioContext && this.audioContext.state !== 'closed') {
                // No need to close the mic visualization audioContext here, 
                // as it's tied to the stream which is now stopped.
                // It will be recreated on next recording start.
            }
                    
            this.micButton.classList.remove('recording');
            this.micButton.innerHTML = '🎤';
            this.updateStatus('Connected! Click microphone to start conversation', 'connected');
            
            this.stopWaveAnimation();
            this.addMessage('🎤 Conversation ended.', 'user');
        } else {
            this.addDebugInfo('stopRecording called but not currently recording.');
        }
    }

    startVADMonitoring() {
        this.stopVADMonitoring(); // Clear any existing interval
        this.silenceStartTime = 0;
        this.currentEnergy = 0.0;
        
        if (!this.analyser) {
            this.addDebugInfo("VAD: Analyser not ready, cannot start monitoring.");
            return;
        }
        this.addDebugInfo(`VAD: Starting monitoring. Threshold: ${this.vadSilenceThreshold}, Duration: ${this.vadRequiredSilenceDuration}ms`);
        
        this.vadMonitoringInterval = setInterval(() => this.checkVAD(), 100); // Check every 100ms
    }

    checkVAD() {
        if (!this.isRecording || !this.analyser || !this.dataArray) {
            return;
        }

        this.analyser.getByteFrequencyData(this.dataArray);
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i];
        }
        const average = this.dataArray.length > 0 ? sum / this.dataArray.length : 0;
        
        const normalizedEnergy = average / 255; // Normalize to 0-1 range
        this.currentEnergy = (this.currentEnergy * (1 - this.vadEnergySmoothing)) + (normalizedEnergy * this.vadEnergySmoothing);

        if (this.currentEnergy < this.vadSilenceThreshold) {
            if (this.silenceStartTime === 0) {
                this.silenceStartTime = Date.now();
            }
            
            if ((Date.now() - this.silenceStartTime) >= this.vadRequiredSilenceDuration) {
                this.addDebugInfo(`VAD: End of speech detected. Silence duration: ${Date.now() - this.silenceStartTime}ms`);
                this.stopVADMonitoring(); // Stop VAD before calling stopRecording
                this.stopRecording(); // This will handle sending EOS
            }
        } else {
            if (this.silenceStartTime !== 0) {
                // Speech detected, reset silence timer
            }
            this.silenceStartTime = 0; // Reset silence timer if energy is above threshold
        }
    }

    stopVADMonitoring() {
        if (this.vadMonitoringInterval) {
            clearInterval(this.vadMonitoringInterval);
            this.vadMonitoringInterval = null;
            this.addDebugInfo("VAD: Monitoring stopped.");
        }
    }

    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    startWaveAnimation() {
        const animate = () => {
            if (!this.isRecording) return;
            
            this.analyser.getByteFrequencyData(this.dataArray);
            
            const bars = this.waveform.querySelectorAll('.wave-bar');
            bars.forEach((bar, index) => {
                const value = this.dataArray[index] || 0;
                const height = Math.max(5, (value / 255) * 50);
                bar.style.height = height + 'px';
            });
            
            this.animationId = requestAnimationFrame(animate);
        };
        animate();
    }

    stopWaveAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        const bars = this.waveform.querySelectorAll('.wave-bar');
        bars.forEach(bar => {
            bar.style.height = '10px';
        });
    }

    disconnect() {
        this.addDebugInfo('Disconnecting...');
        
        // Clear audio queue
        this.audioQueue = [];
        this.isPlaying = false;
        this.nextPlayTime = 0;
        
        // Stop any current audio
        if (this.currentSource) {
            try {
                this.currentSource.stop();
            } catch (e) {
                // Ignore if already stopped
            }
        }
        
        if (this.ws) {
            this.ws.close();
        }
        this.handleDisconnection();
    }

    handleDisconnection() {
        this.isConnected = false;
        this.isRecording = false;
        
        this.micButton.disabled = true;
        this.micButton.classList.remove('connected', 'recording');
        this.micButton.innerHTML = '🎤';
        
        this.connectBtn.disabled = false;
        this.disconnectBtn.disabled = true;
        
        this.stopWaveAnimation();
        this.updateStatus('Disconnected. Click Connect to start again');
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
    }

    updateStatus(message, type = '') {
        this.statusEl.textContent = message;
        this.statusEl.className = 'status ' + type;
    }

    addMessage(text, sender) {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${sender}`;
        messageEl.textContent = text;
        
        // Add avatar to message
        const avatarEl = document.createElement('div');
        avatarEl.className = 'message-avatar';
        avatarEl.textContent = sender === 'ai' ? 'K' : 'U';
        messageEl.appendChild(avatarEl);
        
        this.conversationLog.appendChild(messageEl);
        this.conversationLog.scrollTop = this.conversationLog.scrollHeight;
    }
    
    animateWaveformForAudio() {
        // Simulate audio waveform animation when AI is speaking
        let animationDuration = 0;
        const animate = () => {
            // Ensure animation stops if isPlaying becomes false, regardless of duration
            if (!this.isPlaying || animationDuration > 3000) {
                // Reset bars to default state if animation stops
                const bars = this.waveform.querySelectorAll('.wave-bar');
                bars.forEach(b => b.style.height = '10px'); 
                return;
            }
            
            const bars = this.waveform.querySelectorAll('.wave-bar');
            bars.forEach((bar) => {
                const height = Math.max(5, Math.random() * 40);
                bar.style.height = height + 'px';
            });
            
            animationDuration += 100;
            setTimeout(animate, 100);
        };
        animate();
    }
}

// Initialize the app when the page loads
window.addEventListener('load', () => {
    new GeminiNativeAudioChat();
});

// Create animated particles
class ParticleAnimation {
    constructor() {
        this.particles = [];
        this.container = document.getElementById('particles');
        this.containerWidth = this.container.clientWidth;
        this.containerHeight = this.container.clientHeight;
        
        this.createParticles();
        this.animate();
        
        // Handle resize
        window.addEventListener('resize', () => {
            this.containerWidth = this.container.clientWidth;
            this.containerHeight = this.container.clientHeight;
        });
    }
    
    createParticles() {
        // Clear existing particles
        this.container.innerHTML = '';
        this.particles = [];
        
        // Create new particles
        const particleCount = Math.min(50, Math.floor(this.containerWidth * this.containerHeight / 10000));
        
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            
            // Random properties
            const size = Math.random() * 6 + 2;
            const x = Math.random() * this.containerWidth;
            const y = Math.random() * this.containerHeight;
            const speedX = (Math.random() - 0.5) * 0.5;
            const speedY = (Math.random() - 0.5) * 0.5;
            const opacity = Math.random() * 0.3 + 0.1;
            
            // Set styles
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            particle.style.left = `${x}px`;
            particle.style.top = `${y}px`;
            particle.style.opacity = opacity;
            
            // Store particle data
            this.particles.push({
                element: particle,
                x, y,
                speedX, speedY,
                size
            });
            
            // Add to DOM
            this.container.appendChild(particle);
        }
    }
    
    animate() {
        // Update particle positions
        this.particles.forEach(particle => {
            // Update position
            particle.x += particle.speedX;
            particle.y += particle.speedY;
            
            // Boundary check
            if (particle.x < -particle.size) particle.x = this.containerWidth;
            if (particle.x > this.containerWidth) particle.x = -particle.size;
            if (particle.y < -particle.size) particle.y = this.containerHeight;
            if (particle.y > this.containerHeight) particle.y = -particle.size;
            
            // Update DOM
            particle.element.style.left = `${particle.x}px`;
            particle.element.style.top = `${particle.y}px`;
        });
        
        // Continue animation
        requestAnimationFrame(() => this.animate());
    }
}

// Telegram WebApp specific code
if (window.Telegram?.WebApp) {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
}

// Initialize particle animation
window.addEventListener('load', () => {
    new ParticleAnimation();
});
