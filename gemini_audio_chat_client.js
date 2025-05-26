class GeminiNativeAudioChat {
    constructor() {
        this.sessionToken = null;
        this.isRecording = false;
        this.isConnected = false;
        this.mediaRecorder = null;
        this.audioContext = null; // For mic visualization
        this.analyser = null;
        this.dataArray = null;
        this.animationId = null;
        this.audioChunks = []; // For user's outgoing audio

        // VAD properties
        this.vadSilenceThreshold = 0.01; 
        this.vadRequiredSilenceDuration = 1500; 
        this.vadEnergySmoothing = 0.1; 
        this.currentEnergy = 0.0;
        this.silenceStartTime = 0;
        this.vadMonitoringInterval = null;
        
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.audioInitializedOnInteraction = false; // For the old AudioContext unlock
        this.audioUnlocked = false; // For the new LiveAudioPlayer unlock

        this.liveAudioPlayer = new LiveAudioPlayer(); // Instantiate new player
        this.hapticFeedback = null; // For Telegram haptics

        this.initializeUI();
        this.initializeSession();
        this.setupMobileAudioUnlock(); 
        this.setupTelegramOptimizations(); // New call
    }

    setupTelegramOptimizations() {
        if (window.Telegram?.WebApp) {
            const tg = window.Telegram.WebApp;
            try {
                tg.ready();
                tg.expand(); // Expand the Mini App to full height
                // tg.enableClosingConfirmation(); // Enable confirmation before closing
                this.addDebugInfo('Telegram WebApp optimizations enabled (ready, expand).');

                // Store haptic feedback object
                if (tg.HapticFeedback) {
                    this.hapticFeedback = tg.HapticFeedback;
                    this.addDebugInfo('Telegram HapticFeedback available.');
                } else {
                    this.addDebugInfo('Telegram HapticFeedback not available on this version/platform.');
                }

                // Example: Handle viewport changes (optional, if your UI needs to adapt)
                tg.onEvent('viewportChanged', (eventData) => {
                    if (eventData.isStateStable) {
                        this.addDebugInfo(`Telegram viewport changed: Height ${tg.viewportStableHeight}, Width ${window.innerWidth}`);
                        // You could adjust UI elements here if needed
                    }
                });
                 tg.onEvent('themeChanged', () => {
                    this.addDebugInfo(`Telegram theme changed. Current: ${JSON.stringify(tg.themeParams)}`);
                    // You could adapt your UI to tg.themeParams.bg_color, tg.themeParams.text_color etc.
                });


            } catch (e) {
                this.addDebugInfo(`Error setting up Telegram WebApp features: ${e.message}`, true);
            }
        } else {
            this.addDebugInfo('Telegram WebApp context not found.');
        }
    }

    setupMobileAudioUnlock() { // This method might be simplified or removed if LiveAudioPlayer handles unlock robustly
        if (this.isMobile && !this.audioUnlocked) { // Check new flag
            const unlockHandler = async () => {
                if (!this.audioUnlocked) { // Double check
                    const unlocked = await this.liveAudioPlayer.unlockAudio();
                    if (unlocked) {
                        this.audioUnlocked = true;
                        this.addDebugInfo('Audio unlocked via LiveAudioPlayer.');
                    } else {
                        this.addDebugInfo('Failed to unlock audio via LiveAudioPlayer. User interaction might still be needed.');
                    }
                    // Also ensure mic visualization context is handled if separate
                    if (this.audioContext && this.audioContext.state === 'suspended') {
                         try {
                            await this.audioContext.resume();
                            this.addDebugInfo('Microphone visualization AudioContext resumed on interaction.');
                        } catch (e) {
                            this.addDebugInfo(`Error resuming mic AudioContext on interaction: ${e.message}`);
                        }
                    }
                    document.removeEventListener('click', unlockHandler);
                    document.removeEventListener('touchstart', unlockHandler);
                }
            };
            document.addEventListener('click', unlockHandler, { once: true });
            document.addEventListener('touchstart', unlockHandler, { once: true });
            this.addDebugInfo('Mobile: LiveAudioPlayer unlock handler set up. Tap screen to enable audio.');
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

        this.micButton.addEventListener('click', () => this.toggleRecording());
        this.connectBtn.addEventListener('click', () => this.connectToWebSocket());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
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
            const urlParams = new URLSearchParams(window.location.search);
            this.sessionToken = urlParams.get('session');
            if (!this.sessionToken) throw new Error('No session token provided');

            this.addDebugInfo(`Session token: ${this.sessionToken.substring(0, 20)}...`);
            this.updateStatus('Getting session config...');
            
            const apiUrl = `https://n8n.lomeai.com/webhook/voice-session?session=${this.sessionToken}&action=initialize`;
            this.addDebugInfo(`Calling API: ${apiUrl}`);
            
            const response = await fetch(apiUrl);
            const rawData = await response.json();
            this.addDebugInfo(`Raw response: ${JSON.stringify(rawData).substring(0, 200)}...`);
            
            let data = Array.isArray(rawData) && rawData.length > 0 ? rawData[0] : rawData;
            if (!data || !data.success) throw new Error(data?.error || 'Failed to initialize session');

            this.sessionConfig = data.config;
            this.sessionInfo.textContent = `Session: ${data.sessionId} | User: ${data.userId}`;
            this.addDebugInfo(`Model: ${this.sessionConfig.model}, API Key: ${this.sessionConfig.apiKey ? 'Present' : 'Missing'}`);
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
            // PlaybackAudioContext is no longer managed directly here for playback
            // LiveAudioPlayer handles its own audio elements.
            // Mic visualization AudioContext is handled separately if needed.

            const wsUrl = this.sessionConfig.websocketProxyUrl;
            if (!wsUrl) throw new Error('No WebSocket proxy URL provided');
            
            this.ws = new WebSocket(`${wsUrl}&session=${this.sessionToken}`);
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
                this.addDebugInfo(`WebSocket error: ${error.message || 'Unknown error'}`);
                this.updateStatus('Connection error', 'error');
                this.handleDisconnection();
            };
            this.ws.onclose = (event) => {
                this.addDebugInfo(`WebSocket closed: ${event.code} ${event.reason}`);
                this.updateStatus('Connection closed', 'error');
                this.handleDisconnection(event.reason || 'Closed by server');
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
                this.ws.send(JSON.stringify({ type: 'connect_gemini' }));
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
                this.handleDisconnection(message.reason);
                this.addMessage(`🔌 Disconnected from Gemini: ${message.reason}`, 'ai');
                break;
            case 'live_audio_chunk':
                this.addDebugInfo(`Received live_audio_chunk. MimeType: ${message.mimeType}, SampleRate: ${message.sampleRate}, Length: ${message.audioData?.length}`);
                if (this.hapticFeedback && !this.liveAudioPlayer.isPlaying) { // Check if player isn't already playing (first chunk of a turn)
                    try { this.hapticFeedback.impactOccurred('light'); } catch(e) { console.warn("Haptic error:", e); }
                }
                if (message.audioData && message.mimeType === 'audio/wav') { // Expecting WAV now
                    this.liveAudioPlayer.playChunk(message.audioData, message.mimeType);
                    this.animateWaveformForAudio(); // Visual feedback
                } else {
                    this.addDebugInfo('Received live_audio_chunk with unexpected data or mimeType. Discarding.');
                }
                break;
            case 'audio_stream_complete':
                this.addDebugInfo('Received audio_stream_complete. Finalizing stream.');
                this.liveAudioPlayer.finalizeStream();
                // If in continuous conversation, this might be a good place to re-enable mic or VAD
                // For now, let VAD handle re-triggering or manual toggle.
                break;
            case 'text_response':
                this.addMessage('🤖 ' + message.text, 'ai');
                break;
            case 'error':
                this.addDebugInfo(`Server error: ${message.message}`);
                this.updateStatus(message.message, 'error');
                break;
            case 'gemini_setup_complete':
                this.addDebugInfo('Received gemini_setup_complete message from backend.');
                break;
            case 'input_transcription':
                this.addDebugInfo(`Input transcription: ${message.text}`);
                this.addMessage(`🎤 You: ${message.text}`, 'user');
                break;
            case 'output_transcription':
                this.addDebugInfo(`Output transcription: ${message.text}`);
                this.addMessage(`🤖 AI: ${message.text}`, 'ai');
                break;
            default:
                this.addDebugInfo(`Unknown message type: ${message.type}`);
        }
    }
    
    // Removed processPendingAudio and playMp3Data
    // REMOVED: async playRawPcmData(pcmDataArray) { ... } - LiveAudioPlayer handles this now.

    async sendAudioToServer(audioData, isEndOfSpeech = false) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.addDebugInfo('WebSocket not connected for sendAudioToServer');
            return;
        }
        const messagePayload = {
            type: 'audio_input',
            audioData: audioData,
            mimeType: 'audio/webm;codecs=opus', // User input is still WebM/Opus
            isEndOfSpeech: isEndOfSpeech
        };
        this.ws.send(JSON.stringify(messagePayload));
        this.addDebugInfo(`Audio sent: ${audioData ? audioData.length : 0} bytes, EOS: ${isEndOfSpeech}`);
    }

    async toggleRecording() {
        if (!this.isConnected) {
            this.updateStatus('Please connect first', 'error');
            return;
        }
        if (this.isMobile && !this.audioUnlocked) { // Check new flag
            this.addDebugInfo('Mobile audio not yet unlocked by user interaction. Attempting to unlock...');
            const unlocked = await this.liveAudioPlayer.unlockAudio();
            if (unlocked) {
                this.audioUnlocked = true;
                this.addDebugInfo('Audio unlocked successfully on toggle.');
            } else {
                this.addDebugInfo('Failed to unlock audio on toggle. User might need to tap again.');
                this.updateStatus('Tap screen/button again to enable audio', 'error');
                return;
            }
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
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
            });
            this.addDebugInfo('Microphone access granted.');

            if (!this.audioContext || this.audioContext.state === 'closed') {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.addDebugInfo(`Mic visualization AudioContext created (default rate: ${this.audioContext.sampleRate}Hz)`);
            }
            if (this.audioContext.state === 'suspended') await this.audioContext.resume();


            this.analyser = this.audioContext.createAnalyser();
            const source = this.audioContext.createMediaStreamSource(stream);
            source.connect(this.analyser);
            this.analyser.fftSize = 256;
            const bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(bufferLength);

            this.stream = stream;
            this.isRecording = true;
            this.micButton.classList.add('recording');
            this.micButton.innerHTML = '⏹️';
            this.updateStatus('Conversation active - Speak naturally', 'recording');
            this.startWaveAnimation();
            this.addMessage('🎤 Continuous conversation started...', 'user');
            
            this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus' });
            this.audioChunks = []; // Clear previous user audio chunks
            this.mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    // No need to push to this.audioChunks if sending immediately
                    const audioBuffer = await event.data.arrayBuffer();
                    const base64Audio = this.arrayBufferToBase64(audioBuffer);
                    await this.sendAudioToServer(base64Audio, false);
                }
            };
            this.mediaRecorder.start(500); 
            this.addDebugInfo('MediaRecorder started for continuous streaming.');
            this.startVADMonitoring();
        } catch (error) {
            this.addDebugInfo(`Recording start error: ${error.message}`);
            console.error('Failed to start recording:', error);
            this.updateStatus('Microphone access denied: ' + error.message, 'error');
        }
    }

    stopRecording() {
        if (this.isRecording) {
            this.addDebugInfo('Stopping conversation...');
            this.stopVADMonitoring();
            this.isRecording = false;
            
            if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
                this.mediaRecorder.onstop = async () => { 
                    this.addDebugInfo('MediaRecorder stopped. Sending final EOS signal.');
                    await this.sendAudioToServer(null, true); 
                };
                try {
                    this.mediaRecorder.stop();
                } catch(e) {
                     this.addDebugInfo(`Error stopping mediaRecorder: ${e.message}. Still sending EOS.`);
                     this.sendAudioToServer(null, true); // Ensure EOS is sent
                }
            } else {
                this.addDebugInfo('MediaRecorder inactive or not found. Sending EOS signal directly.');
                this.sendAudioToServer(null, true);
            }
            
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null;
            }
            if (this.audioContext && this.audioContext.state !== 'closed') {
                 // Optionally close the mic visualization context
                 // this.audioContext.close().catch(e => this.addDebugInfo("Error closing mic AC: " + e.message));
                 // this.audioContext = null;
            }
                    
            this.micButton.classList.remove('recording');
            this.micButton.innerHTML = '🎤';
            this.updateStatus('Connected! Click microphone to talk', 'connected');
            this.stopWaveAnimation();
            this.addMessage('🎤 Conversation ended.', 'user');
        }
    }

    startVADMonitoring() {
        this.stopVADMonitoring(); 
        this.silenceStartTime = 0;
        this.currentEnergy = 0.0;
        if (!this.analyser) {
            this.addDebugInfo("VAD: Analyser not ready.");
            return;
        }
        this.addDebugInfo(`VAD: Starting. Threshold: ${this.vadSilenceThreshold}, Duration: ${this.vadRequiredSilenceDuration}ms`);
        this.vadMonitoringInterval = setInterval(() => this.checkVAD(), 100);
    }

    checkVAD() {
        if (!this.isRecording || !this.analyser || !this.dataArray) return;

        this.analyser.getByteFrequencyData(this.dataArray);
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i];
        const average = this.dataArray.length > 0 ? sum / this.dataArray.length : 0;
        const normalizedEnergy = average / 255;
        this.currentEnergy = (this.currentEnergy * (1 - this.vadEnergySmoothing)) + (normalizedEnergy * this.vadEnergySmoothing);

        if (this.currentEnergy < this.vadSilenceThreshold) {
            if (this.silenceStartTime === 0) this.silenceStartTime = Date.now();
            if ((Date.now() - this.silenceStartTime) >= this.vadRequiredSilenceDuration) {
                this.addDebugInfo(`VAD: End of speech detected. Silence: ${Date.now() - this.silenceStartTime}ms`);
                this.stopRecording(); 
            }
        } else {
            this.silenceStartTime = 0;
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
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return window.btoa(binary);
    }

    startWaveAnimation() {
        const animate = () => {
            if (!this.isRecording || !this.analyser || !this.dataArray) return;
            this.analyser.getByteFrequencyData(this.dataArray);
            const bars = this.waveform.querySelectorAll('.wave-bar');
            bars.forEach((bar, index) => {
                const value = this.dataArray[index] || 0;
                bar.style.height = Math.max(5, (value / 255) * 50) + 'px';
            });
            this.animationId = requestAnimationFrame(animate);
        };
        animate();
    }

    stopWaveAnimation() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        this.animationId = null;
        const bars = this.waveform.querySelectorAll('.wave-bar');
        bars.forEach(bar => bar.style.height = '10px');
    }

    disconnect(reason = 'User disconnected') {
        this.addDebugInfo(`Disconnecting... Reason: ${reason}`);
        // No need to stop this.currentSource as it's managed by LiveAudioPlayer now.
        // this.currentTurnAudioData is also removed.
        if (this.ws) this.ws.close(1000, reason);
        this.handleDisconnection(reason);
    }

    handleDisconnection(reason = 'Unknown reason') {
        this.isConnected = false;
        this.isRecording = false;
        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
            this.mediaRecorder.stop();
        }
        if (this.stream) this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
        this.stopVADMonitoring();
        this.stopWaveAnimation();
        
        this.micButton.disabled = true;
        this.micButton.classList.remove('connected', 'recording');
        this.micButton.innerHTML = '🎤';
        this.connectBtn.disabled = false;
        this.disconnectBtn.disabled = true;
        this.updateStatus(`Disconnected: ${reason}. Click Connect.`, 'error');
    }

    updateStatus(message, type = '') {
        this.statusEl.textContent = message;
        this.statusEl.className = 'status ' + type;
    }

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
    
    animateWaveformForAudio() {
        // Placeholder - actual animation might be tied to isPlaying or specific audio events
    }
}

window.addEventListener('load', () => {
    new GeminiNativeAudioChat();
});

class LiveAudioPlayer {
    constructor() {
        this.audioQueue = [];
        this.isPlaying = false;
        this.currentAudio = null; // Reference to the currently playing HTMLAudioElement
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.audioPool = []; // Pool of reusable HTMLAudioElement
        this.audioContextForUnlock = null; // Minimal AudioContext for unlocking on mobile

        this.setupMobileOptimizations();
    }

    setupMobileOptimizations() {
        // Pre-create Audio objects for mobile to reduce latency
        for (let i = 0; i < 3; i++) { // Create a small pool
            const audio = new Audio();
            audio.preload = 'auto';
            if (this.isMobile) {
                audio.crossOrigin = 'anonymous'; // May help with some CORS issues if audio is from different origin
                // audio.volume = 0.8; // Example: Slightly lower for mobile speakers, adjust as needed
            }
            this.audioPool.push(audio);
        }
    }

    async unlockAudio() {
        if (this.isMobile) {
            // Direct HTML5 Audio unlock (more reliable for our use case)
            const audio = this.getAudioFromPool(); // Use a pooled one
            audio.volume = 0;
            // Tiny silent WAV data URL (1 sample, 1 channel, 8kHz, 8-bit)
            // Using a minimal valid WAV to avoid network requests or complex generation.
            audio.src = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
            
            try {
                await audio.play();
                audio.pause();
                audio.currentTime = 0; // Reset
                console.log('[LiveAudioPlayer] Mobile audio unlocked via HTML5 Audio.');
                this.returnAudioToPool(audio); // Return to pool after use
                return true;
            } catch (e) {
                console.warn('[LiveAudioPlayer] Could not unlock audio via HTML5 Audio:', e);
                this.returnAudioToPool(audio); // Still return it
                return false;
            }
        }
        return true; // Desktop doesn't need explicit unlock in this manner
    }

    playChunk(base64Audio, mimeType) {
        try {
            // Validate chunk size for mobile
            if (this.isMobile && base64Audio.length > 500000) { // ~500KB limit for base64 string
                console.warn('[LiveAudioPlayer] Large audio chunk on mobile, may cause issues. Size:', base64Audio.length);
            }
        
            const audioBuffer = this.base64ToArrayBuffer(base64Audio);
            const blob = new Blob([audioBuffer], { type: mimeType });
            const audioUrl = URL.createObjectURL(blob);

            const audio = this.getAudioFromPool();
            
            // Mobile-specific audio settings
            if (this.isMobile) {
                audio.volume = 0.9; // Slightly lower for mobile speakers, or 1.0 if preferred
                audio.playsInline = true; // Prevent fullscreen on iOS, ensure it's set
            } else {
                audio.volume = 1.0; 
            }
            
            audio.src = audioUrl;

            this.audioQueue.push({
                audio: audio,
                url: audioUrl,
                timestamp: Date.now()
            });

            if (!this.isPlaying) {
                this.processAudioQueue();
            }
        } catch (error) {
            console.error('[LiveAudioPlayer] Failed to play audio chunk:', error);
        }
    }

    async processAudioQueue() {
        if (this.audioQueue.length === 0) {
            this.isPlaying = false;
            return;
        }

        this.isPlaying = true;
        const audioItem = this.audioQueue.shift();
        this.currentAudio = audioItem.audio;
        let retryCount = 0;
        const maxRetries = this.isMobile ? 2 : 1;

        const playWithRetry = async () => {
            try {
                await new Promise((resolve, reject) => {
                    audioItem.audio.onended = () => {
                        URL.revokeObjectURL(audioItem.url);
                        this.returnAudioToPool(audioItem.audio);
                        this.currentAudio = null;
                        resolve();
                    };
                    
                    audioItem.audio.onerror = (e) => {
                        console.error('[LiveAudioPlayer] Audio error:', e, audioItem.audio.error);
                        if (retryCount < maxRetries) {
                            retryCount++;
                            console.log(`[LiveAudioPlayer] Retrying playback (${retryCount}/${maxRetries})`);
                            // No need to revoke/return here, will be handled by next attempt or final failure
                            setTimeout(() => playWithRetry().catch(reject), 100); // Catch rejection of retry
                            return; // Don't reject outer promise yet
                        }
                        URL.revokeObjectURL(audioItem.url);
                        this.returnAudioToPool(audioItem.audio);
                        this.currentAudio = null;
                        reject(new Error('Audio playback failed after retries'));
                    };

                    // Mobile-optimized play
                    if (this.isMobile) {
                        setTimeout(() => {
                            audioItem.audio.play().catch(err => { // Catch play() promise rejection
                                console.error('[LiveAudioPlayer] audio.play() rejected (mobile):', err);
                                // onerror should handle this, but as a fallback:
                                if (retryCount >= maxRetries) reject(err);
                            });
                        }, 50); // Small delay for mobile audio processing
                    } else {
                        audioItem.audio.play().catch(err => { // Catch play() promise rejection
                            console.error('[LiveAudioPlayer] audio.play() rejected (desktop):', err);
                             if (retryCount >= maxRetries) reject(err);
                        });
                    }
                });
                
                this.processAudioQueue(); // Success - continue
                
            } catch (error) { // This catch is for the Promise from new Promise(...)
                console.error('[LiveAudioPlayer] Failed to play audio after retries or critical error:', error);
                // Ensure URL is revoked and audio returned if not already handled by onerror
                if (audioItem.url) URL.revokeObjectURL(audioItem.url);
                if (audioItem.audio) this.returnAudioToPool(audioItem.audio);
                this.currentAudio = null;
                this.processAudioQueue(); // Continue despite failure of this item
            }
        };

        await playWithRetry();
    }

    getAudioFromPool() {
        if (this.audioPool.length > 0) {
            return this.audioPool.shift();
        }
        // Create new if pool is empty, though ideally pool should be managed
        const audio = new Audio();
        audio.preload = 'auto';
        if (this.isMobile) audio.crossOrigin = 'anonymous';
        return audio;
    }

    returnAudioToPool(audio) {
        audio.onended = null; // Clear listeners
        audio.onerror = null;
        audio.src = ''; // Release resource
        if (this.audioPool.length < 5) { // Limit pool size to prevent memory issues
            this.audioPool.push(audio);
        }
    }

    finalizeStream() {
        // This method is called when the backend signals 'audio_stream_complete'.
        // The queue will naturally empty. If any special cleanup per stream is needed, add here.
        console.log('[LiveAudioPlayer] Audio stream complete signal received.');
    }

    base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
}

class ParticleAnimation {
    constructor() {
        this.particles = [];
        this.container = document.getElementById('particles');
        if (!this.container) return; 
        this.containerWidth = this.container.clientWidth;
        this.containerHeight = this.container.clientHeight;
        this.createParticles();
        this.animate();
        window.addEventListener('resize', () => {
            if (!this.container) return;
            this.containerWidth = this.container.clientWidth;
            this.containerHeight = this.container.clientHeight;
            this.createParticles(); 
        });
    }
    
    createParticles() {
        if (!this.container) return;
        this.container.innerHTML = '';
        this.particles = [];
        const particleCount = Math.min(50, Math.floor(this.containerWidth * this.containerHeight / 15000));
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            const size = Math.random() * 5 + 2;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            particle.style.left = `${Math.random() * this.containerWidth}px`;
            particle.style.top = `${Math.random() * this.containerHeight}px`;
            particle.style.opacity = Math.random() * 0.2 + 0.1; 
            this.container.appendChild(particle);
            this.particles.push({
                element: particle,
                x: parseFloat(particle.style.left),
                y: parseFloat(particle.style.top),
                speedX: (Math.random() - 0.5) * 0.3,
                speedY: (Math.random() - 0.5) * 0.3,
                size
            });
        }
    }
    
    animate() {
        if (!this.container || this.particles.length === 0) {
            requestAnimationFrame(() => this.animate()); // Keep trying if particles not ready
            return;
        }
        this.particles.forEach(p => {
            p.x += p.speedX;
            p.y += p.speedY;
            if (p.x < -p.size) p.x = this.containerWidth;
            if (p.x > this.containerWidth) p.x = -p.size;
            if (p.y < -p.size) p.y = this.containerHeight;
            if (p.y > this.containerHeight) p.y = -p.size;
            p.element.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
        });
        requestAnimationFrame(() => this.animate());
    }
}

window.addEventListener('load', () => {
    new ParticleAnimation();
});
