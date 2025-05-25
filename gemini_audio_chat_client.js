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

        this.playbackAudioContext = null; // For playing Gemini's audio
        this.currentPlaybackSource = null;
        this.pendingAudioData = []; // To accumulate incoming audio chunks from Gemini
        this.minPlaybackDurationThreshold = 0.5; // Play after 0.5s of audio accumulated, or on turn_complete

        // VAD properties
        this.vadSilenceThreshold = 0.01; 
        this.vadRequiredSilenceDuration = 1500; 
        this.vadEnergySmoothing = 0.1; 
        this.currentEnergy = 0.0;
        this.silenceStartTime = 0;
        this.vadMonitoringInterval = null;
        
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.audioInitializedOnInteraction = false;

        this.initializeUI();
        this.initializeSession();
        this.setupMobileAudioUnlock();
    }

    setupMobileAudioUnlock() {
        if (this.isMobile) {
            const unlockAudio = async () => {
                if (!this.audioInitializedOnInteraction) {
                    if (!this.playbackAudioContext || this.playbackAudioContext.state === 'closed') {
                        this.playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)();
                        this.addDebugInfo(`Playback AudioContext created on interaction (default rate: ${this.playbackAudioContext.sampleRate}Hz)`);
                    }
                    if (this.playbackAudioContext.state === 'suspended') {
                        try {
                            await this.playbackAudioContext.resume();
                            this.addDebugInfo('Playback AudioContext resumed on interaction.');
                        } catch (e) {
                            this.addDebugInfo(`Error resuming playback AudioContext on interaction: ${e.message}`);
                        }
                    }
                    // Also for microphone audio context if it's separate and used
                    if (this.audioContext && this.audioContext.state === 'suspended') {
                         try {
                            await this.audioContext.resume();
                            this.addDebugInfo('Microphone visualization AudioContext resumed on interaction.');
                        } catch (e) {
                            this.addDebugInfo(`Error resuming mic AudioContext on interaction: ${e.message}`);
                        }
                    }
                    this.audioInitializedOnInteraction = true;
                    document.removeEventListener('click', unlockAudio);
                    document.removeEventListener('touchstart', unlockAudio);
                }
            };
            document.addEventListener('click', unlockAudio);
            document.addEventListener('touchstart', unlockAudio);
            this.addDebugInfo('Mobile: Audio unlock handler set up. Tap screen to enable audio.');
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
            if (!this.isMobile && (!this.playbackAudioContext || this.playbackAudioContext.state === 'closed')) {
                this.playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.addDebugInfo(`Playback AudioContext created (default rate: ${this.playbackAudioContext.sampleRate}Hz)`);
                 if (this.playbackAudioContext.state === 'suspended') {
                    await this.playbackAudioContext.resume();
                 }
            }

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
            case 'audio_response':
                if (message.audioData) {
                    this.pendingAudioData.push(message.audioData);
                    this.processPendingAudio(false); // Process, but don't force play unless threshold met
                }
                break;
            case 'text_response':
                this.addMessage('🤖 ' + message.text, 'ai');
                break;
            case 'error':
                this.addDebugInfo(`Server error: ${message.message}`);
                this.updateStatus(message.message, 'error');
                break;
            case 'turn_complete':
                this.addDebugInfo('Turn completed by Gemini.');
                this.processPendingAudio(true); // Force play remaining audio
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
    
    async processPendingAudio(forcePlay) {
        if (this.pendingAudioData.length === 0) return;

        // Assuming MP3 chunks are self-contained enough or backend sends one MP3 per utterance part
        // For simplicity now, we'll play each MP3 chunk as it meets the criteria,
        // rather than trying to concatenate raw MP3 byte streams (which is complex).
        // If Gemini sends audio in multiple 'audio_response' messages for a single logical utterance,
        // this will play them sequentially.

        // Let's estimate duration based on typical MP3 bitrate if needed, though decodeAudioData is better
        // For now, we'll rely on forcePlay or a simple chunk count.
        const estimatedTotalDuration = this.pendingAudioData.reduce((acc, b64) => acc + (b64.length * 6 / 8) / (128000 / 8), 0); // Rough estimate for 128kbps MP3

        if (forcePlay || estimatedTotalDuration >= this.minPlaybackDurationThreshold || this.pendingAudioData.length >= 1) { // Play if any MP3 chunk is ready or forced
            const mp3Base64ToPlay = this.pendingAudioData.join(''); // Concatenate if backend ever sends partial base64 MP3s (unlikely for MP3)
            this.pendingAudioData = []; // Clear pending chunks
            if (mp3Base64ToPlay) {
                await this.playMp3Data(mp3Base64ToPlay);
            }
        } else {
            this.addDebugInfo(`MP3 audio accumulated: ${this.pendingAudioData.length} chunks, est. duration ${estimatedTotalDuration.toFixed(2)}s. Waiting for more or turn_complete.`);
        }
    }

    async playMp3Data(mp3Base64) {
        try {
            this.addDebugInfo(`playMp3Data called. MP3 Base64 length: ${mp3Base64.length}`);
            if (!mp3Base64) {
                this.addDebugInfo('No MP3 data to play.');
                return;
            }

            if (!this.playbackAudioContext || this.playbackAudioContext.state === 'closed') {
                this.playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.addDebugInfo(`Playback AudioContext re/initialized (default rate: ${this.playbackAudioContext.sampleRate}Hz)`);
            }
            
            if (this.playbackAudioContext.state === 'suspended') {
                this.addDebugInfo('Playback AudioContext is suspended, attempting to resume...');
                try {
                    await this.playbackAudioContext.resume();
                    this.addDebugInfo(`Playback AudioContext state after resume: ${this.playbackAudioContext.state}`);
                } catch (resumeError) {
                    this.addDebugInfo(`Error resuming AudioContext: ${resumeError.message}. Playback may fail.`);
                    console.error("Error resuming AudioContext:", resumeError);
                    this.updateStatus('Audio resume failed. Tap screen?', 'error');
                    return;
                }
            }
            
            const binaryString = window.atob(mp3Base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            this.addDebugInfo(`MP3 data decoded from Base64. Total size: ${bytes.byteLength} bytes.`);

            // Use slice(0) to pass a detached ArrayBuffer, which is required by decodeAudioData in some browsers
            this.playbackAudioContext.decodeAudioData(bytes.buffer.slice(0),
                (decodedBuffer) => {
                    this.addDebugInfo(`MP3 decodeAudioData successful. Decoded SR: ${decodedBuffer.sampleRate}Hz, Duration: ${decodedBuffer.duration.toFixed(3)}s`);
                    if (this.currentPlaybackSource) {
                        try { this.currentPlaybackSource.stop(); } catch(e){ this.addDebugInfo("Error stopping previous source: " + e.message); }
                    }
                    const source = this.playbackAudioContext.createBufferSource();
                    source.buffer = decodedBuffer;
                    
                    // No playbackRate adjustment needed for MP3s, browser handles it.
                    this.addDebugInfo(`Playing MP3 at native sample rate of buffer: ${decodedBuffer.sampleRate}Hz, Context SR: ${this.playbackAudioContext.sampleRate}Hz`);
                    
                    source.connect(this.playbackAudioContext.destination);
                    source.start();
                    this.currentPlaybackSource = source;
                    this.addMessage('🔊 [Playing audio response]', 'ai');
                    
                    source.onended = () => {
                        this.addDebugInfo('MP3 playback finished.');
                        if (this.currentPlaybackSource === source) {
                            this.currentPlaybackSource = null;
                        }
                         // If there's more in the queue (e.g. from rapid turn_complete), process it
                        if (this.pendingAudioData.length > 0) {
                           this.processPendingAudio(true); // Force play next if available
                        }
                    };
                },
                (error) => {
                    this.addDebugInfo(`MP3 decodeAudioData error: ${error.message || error}`);
                    console.error('Error decoding MP3 audio data:', error);
                }
            );
        } catch (error) {
            this.addDebugInfo(`MP3 playback error: ${error.message}. Stack: ${error.stack}`);
            console.error('Error playing MP3 audio:', error);
        }
    }

    // createWavHeader and writeStringView are no longer needed as we are using MP3
    // Removed createWavHeader
    // Removed writeStringView

    async sendAudioToServer(audioData, isEndOfSpeech = false) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.addDebugInfo('WebSocket not connected for sendAudioToServer');
            return;
        }
        const messagePayload = {
            type: 'audio_input',
            audioData: audioData,
            mimeType: 'audio/webm;codecs=opus',
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
        if (this.isMobile && !this.audioInitializedOnInteraction) {
            this.addDebugInfo('Mobile audio not yet unlocked by user interaction. Please tap screen.');
            await this.setupMobileAudioUnlock(); 
            if (!this.audioInitializedOnInteraction) {
                 this.updateStatus('Tap screen to enable audio', 'error');
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
        if (this.currentPlaybackSource) {
            try { this.currentPlaybackSource.stop(); } catch(e){}
            this.currentPlaybackSource = null;
        }
        this.pendingAudioData = []; // Clear pending audio on disconnect
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
