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
        this.playbackAudioContext = null; // Used for playing Gemini's audio

        // VAD properties
        this.vadSilenceThreshold = 0.01; // Normalized energy; adjust based on testing
        this.vadRequiredSilenceDuration = 1500; // ms of silence before triggering EOS
        this.vadEnergySmoothing = 0.1; // Smoothing factor for energy readings
        this.currentEnergy = 0.0;
        this.silenceStartTime = 0;
        this.vadMonitoringInterval = null;
        
        this.initializeUI();
        this.initializeSession();
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
                
                // Don't send connect_gemini here - wait for session_initialized message
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
                break;
            
            case 'gemini_setup_complete':
                this.addDebugInfo('Received gemini_setup_complete message from backend.');
                // You can add any UI updates here if needed when Gemini setup is fully complete.
                break;

            case 'input_transcription':
                this.addDebugInfo(`Input transcription: ${message.text}`);
                this.addMessage(`🎤 You (interim): ${message.text}`, 'user');
                break;

            case 'output_transcription':
                this.addDebugInfo(`Output transcription: ${message.text}`);
                this.addMessage(`🤖 AI (interim): ${message.text}`, 'ai');
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

    async handleGeminiMessage(message) {
        // Handle different message types from Gemini Live API
        if (message.text) {
            this.addMessage('🤖 ' + message.text, 'ai');
            this.addDebugInfo(`Text response: ${message.text.substring(0, 50)}...`);
        }
        
        if (message.data) {
            // Handle native audio response (24kHz PCM as per docs)
            this.addDebugInfo(`Audio response received: ${message.data.length} bytes`);
            await this.playAudioResponse(message.data);
        }
        
        if (message.serverContent) {
            this.addDebugInfo('Server content received');
            if (message.serverContent.turnComplete) {
                this.addDebugInfo('Turn completed');
            }
        }
    }

            async playAudioResponse(audioData) {
                try {
                    this.addDebugInfo(`Playing audio response using WAV construction. Data length (Base64): ${audioData ? audioData.length : 0}`);
                    if (!audioData) {
                        this.addDebugInfo('No audio data to play.');
                        return;
                    }

                    if (!this.playbackAudioContext) {
                        try {
                            this.playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
                            this.addDebugInfo(`Attempted to create playback AudioContext with 24000Hz. Actual rate: ${this.playbackAudioContext.sampleRate}Hz.`);
                        } catch (e) {
                            this.addDebugInfo(`Failed to create AudioContext with 24000Hz (${e.message}), falling back to default rate.`);
                            this.playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)();
                            this.addDebugInfo(`Fallback playback AudioContext created with default rate: ${this.playbackAudioContext.sampleRate}Hz.`);
                        }
                    }
                    
                    if (this.playbackAudioContext.state === 'suspended') {
                        this.addDebugInfo('Playback AudioContext is suspended, attempting to resume...');
                        await this.playbackAudioContext.resume();
                        this.addDebugInfo(`Playback AudioContext state after resume: ${this.playbackAudioContext.state}`);
                    }
                    
                    const pcmData = Uint8Array.from(atob(audioData), c => c.charCodeAt(0));
                    
                    if (pcmData.length === 0) {
                        this.addDebugInfo('Decoded PCM data is empty.');
                        return;
                    }

                    const sampleRate = 24000;
                    const numChannels = 1;
                    const bitsPerSample = 16;
                    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
                    const blockAlign = numChannels * bitsPerSample / 8;
                    const dataSize = pcmData.length;
                    const fileSize = 36 + dataSize; // 36 bytes for header (excluding RIFF and WAVE chunks) + dataSize

                    const wavBuffer = new ArrayBuffer(44 + dataSize); // 44 bytes for a standard WAV header
                    const view = new DataView(wavBuffer);

                    // RIFF chunk descriptor
                    this.writeString(view, 0, 'RIFF');
                    view.setUint32(4, fileSize, true); // fileSize
                    this.writeString(view, 8, 'WAVE');
                    // FMT sub-chunk
                    this.writeString(view, 12, 'fmt ');
                    view.setUint32(16, 16, true); // 16 for PCM
                    view.setUint16(20, 1, true);  // AudioFormat = 1 (PCM)
                    view.setUint16(22, numChannels, true);
                    view.setUint32(24, sampleRate, true);
                    view.setUint32(28, byteRate, true);
                    view.setUint16(32, blockAlign, true);
                    view.setUint16(34, bitsPerSample, true);
                    // DATA sub-chunk
                    this.writeString(view, 36, 'data');
                    view.setUint32(40, dataSize, true);

                    // Write PCM data
                    new Uint8Array(wavBuffer, 44).set(pcmData);

                    this.addDebugInfo(`WAV header created. Total WAV size: ${wavBuffer.byteLength} bytes.`);

                    this.playbackAudioContext.decodeAudioData(wavBuffer, 
                        (decodedBuffer) => {
                            this.addDebugInfo(`decodeAudioData successful. Decoded buffer SR: ${decodedBuffer.sampleRate}Hz, Length: ${decodedBuffer.length} samples, Duration: ${decodedBuffer.duration.toFixed(3)}s`);
                            const source = this.playbackAudioContext.createBufferSource();
                            source.buffer = decodedBuffer;

                            if (decodedBuffer.sampleRate !== this.playbackAudioContext.sampleRate) {
                                const rateAdjustment = decodedBuffer.sampleRate / this.playbackAudioContext.sampleRate;
                                source.playbackRate.value = rateAdjustment;
                                this.addDebugInfo(`Adjusting playback rate. Buffer SR: ${decodedBuffer.sampleRate}, Context SR: ${this.playbackAudioContext.sampleRate}, Rate: ${rateAdjustment.toFixed(3)}`);
                            } else {
                                 this.addDebugInfo(`Playback rate matches. Buffer SR: ${decodedBuffer.sampleRate}, Context SR: ${this.playbackAudioContext.sampleRate}`);
                            }
                            
                            source.connect(this.playbackAudioContext.destination);
                            source.start();
                            this.addMessage('🔊 [Playing audio response via WAV]', 'ai');
                            this.addDebugInfo(`Audio playback started. Effective SR: ${decodedBuffer.sampleRate / source.playbackRate.value}Hz`);

                            source.onended = () => {
                                this.addDebugInfo('Audio playback finished (WAV).');
                                try {
                                    source.disconnect();
                                } catch (e) {
                                    this.addDebugInfo(`Error disconnecting source (WAV): ${e.message}`);
                                }
                            };
                        },
                        (error) => {
                            this.addDebugInfo(`decodeAudioData error (WAV): ${error.message ? error.message : error}`);
                            console.error('Error decoding WAV audio data:', error);
                            this.addMessage('🔊 [Received audio - WAV decoding failed]', 'ai');
                        }
                    );

                } catch (error) {
                    this.addDebugInfo(`Audio playback error (WAV construction): ${error.message}. Stack: ${error.stack}`);
                    console.error('Error playing audio with WAV:', error);
                    this.addMessage('🔊 [Received audio - WAV playback failed]', 'ai');
                }
            }

            writeString(view, offset, string) {
                for (let i = 0; i < string.length; i++) {
                    view.setUint8(offset + i, string.charCodeAt(i));
                }
            }

            async toggleRecording() {
        if (!this.isConnected) {
            this.updateStatus('Please connect first', 'error');
            return;
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
            // Input audio is natively 16kHz but API will resample as needed
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
    // this.addDebugInfo("VAD: Not recording or analyser not ready.");
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

// this.addDebugInfo(`VAD Energy: ${this.currentEnergy.toFixed(3)}`); // Optional: for debugging energy levels

if (this.currentEnergy < this.vadSilenceThreshold) {
    if (this.silenceStartTime === 0) {
        this.silenceStartTime = Date.now();
        // this.addDebugInfo('VAD: Silence period started.');
    }
    
    if ((Date.now() - this.silenceStartTime) >= this.vadRequiredSilenceDuration) {
        this.addDebugInfo(`VAD: End of speech detected. Silence duration: ${Date.now() - this.silenceStartTime}ms`);
        this.stopVADMonitoring(); // Stop VAD before calling stopRecording
        this.stopRecording(); // This will handle sending EOS
    }
} else {
    if (this.silenceStartTime !== 0) {
        // this.addDebugInfo('VAD: Speech detected, resetting silence timer.');
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
        
        // Animate waveform when AI is speaking
        if (sender === 'ai' && text.includes('[Playing native audio response]')) {
            this.animateWaveformForAudio();
        }
    }
    
    animateWaveformForAudio() {
        // Simulate audio waveform animation when AI is speaking
        let animationDuration = 0;
        const animate = () => {
            if (animationDuration > 3000) return; // Stop after 3 seconds
            
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
