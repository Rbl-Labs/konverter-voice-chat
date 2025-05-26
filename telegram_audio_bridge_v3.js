/**
 * Enhanced Telegram Audio Bridge with improved mobile compatibility
 * Version: 3.0.0
 * 
 * This module handles audio recording and playback in the Telegram WebApp environment,
 * with special optimizations for mobile devices and permission handling.
 */

class TelegramAudioBridge {
    constructor(options = {}) {
        console.log('🔄 [AudioBridge] TelegramAudioBridge v3.0 constructor called');
        
        // Configuration
        this.config = {
            debug: options.debug || true,
            vadSilenceThreshold: options.vadSilenceThreshold || 0.01,
            vadRequiredSilenceDuration: options.vadRequiredSilenceDuration || 1500,
            vadEnergySmoothing: options.vadEnergySmoothing || 0.1,
            maxInitializationAttempts: options.maxInitializationAttempts || 3
        };
        
        // Callbacks
        this.callbacks = {
            onAudioStart: options.onAudioStart || (() => {}),
            onAudioEnd: options.onAudioEnd || (() => {}),
            onAudioData: options.onAudioData || (() => {}),
            onPlaybackStart: options.onPlaybackStart || (() => {}),
            onPlaybackEnd: options.onPlaybackEnd || (() => {}),
            onVADSilenceDetected: options.onVADSilenceDetected || (() => {}),
            onPermissionChange: options.onPermissionChange || (() => {}),
            onError: options.onError || (() => {})
        };
        
        // State
        this.state = {
            isRecording: false,
            isPlaying: false,
            permissionState: 'unknown',
            initializationAttempts: 0,
            initialized: false,
            initializing: false
        };
        
        // Audio components
        this.stream = null;
        this.mediaRecorder = null;
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.audioChunks = [];
        
        // VAD (Voice Activity Detection)
        this.vad = {
            silenceStartTime: 0,
            currentEnergy: 0.0,
            monitoringInterval: null
        };
        
        // Mobile detection
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.audioUnlocked = false;
        
        // Audio player for playback
        this.liveAudioPlayer = new LiveAudioPlayer();
        
        // Telegram integration
        this.telegramWebApp = window.Telegram?.WebApp;
        this.hapticFeedback = this.telegramWebApp?.HapticFeedback;
        
        this.log('TelegramAudioBridge initialized');
        this.setupTelegramOptimizations();
        this.checkMicrophonePermission();
    }
    
    /**
     * Initialize the audio bridge
     * @returns {Promise<boolean>} Whether initialization was successful
     */
    async initialize() {
        if (this.state.initializing) return false;
        if (this.state.initialized) return true;
        
        this.state.initializing = true;
        this.state.initializationAttempts++;
        
        try {
            this.log(`Initialization attempt ${this.state.initializationAttempts}/${this.config.maxInitializationAttempts}`);
            
            if (this.state.initializationAttempts > this.config.maxInitializationAttempts) {
                throw new Error('Maximum initialization attempts exceeded');
            }
            
            // CRITICAL FIX: First unlock audio on mobile before anything else
            if (this.isMobile && !this.audioUnlocked) {
                this.log('CRITICAL: Attempting to unlock audio on mobile FIRST...');
                try {
                    // Method 1: Try with a silent audio element
                    const audio = new Audio();
                    audio.volume = 0;
                    audio.src = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='; // Tiny silent WAV
                    
                    const playPromise = audio.play();
                    if (playPromise !== undefined) {
                        await playPromise;
                        audio.pause();
                        audio.currentTime = 0;
                        this.audioUnlocked = true;
                        this.log('✅ Mobile audio unlocked successfully (Direct Method)');
                    }
                } catch (error) {
                    this.log(`⚠️ Direct audio unlock failed: ${error.message}`, true);
                }
            }
            
            // Create audio context for visualization
            if (!this.audioContext || this.audioContext.state === 'closed') {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                
                if (this.audioContext.state === 'suspended') {
                    try {
                        await this.audioContext.resume();
                        this.log('Audio context resumed during creation', { state: this.audioContext.state, sampleRate: this.audioContext.sampleRate });
                    } catch (error) {
                        this.log(`Failed to resume audio context: ${error.message}`, true);
                        // Continue anyway, we'll try again later
                    }
                } else {
                    this.log('Audio context created successfully', { state: this.audioContext.state, sampleRate: this.audioContext.sampleRate });
                }
            }
            
            // Check and request microphone permission
            const permissionGranted = await this.requestMicrophonePermission();
            if (!permissionGranted) {
                throw new Error('Microphone permission denied');
            }
            
            // Try unlocking audio again with LiveAudioPlayer if needed
            if (this.isMobile && !this.audioUnlocked) {
                this.log('Attempting to unlock audio via LiveAudioPlayer...');
                const unlocked = await this.liveAudioPlayer.unlockAudio();
                if (unlocked) {
                    this.audioUnlocked = true;
                    this.log('Audio unlocked successfully via LiveAudioPlayer');
                } else {
                    this.log('Failed to unlock audio on mobile via LiveAudioPlayer');
                    // Continue anyway, we'll try again when recording starts
                }
            }
            
            this.state.initialized = true;
            this.state.initializing = false;
            return true;
            
        } catch (error) {
            this.log(`Initialization failed: ${error.message}`, true);
            this.state.initializing = false;
            
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
            
            return false;
        }
    }
    
    /**
     * Set up Telegram-specific optimizations
     */
    setupTelegramOptimizations() {
        if (this.telegramWebApp) {
            try {
                this.telegramWebApp.ready();
                this.telegramWebApp.expand();
                this.log('Telegram WebApp optimizations enabled (ready, expand)');
                
                // Handle viewport changes
                this.telegramWebApp.onEvent('viewportChanged', (eventData) => {
                    if (eventData.isStateStable) {
                        const width = window.innerWidth;
                        const height = this.telegramWebApp.viewportStableHeight;
                        this.log(`Telegram viewport changed: ${width}x${height}`);
                    }
                });
                
            } catch (error) {
                this.log(`Error setting up Telegram WebApp features: ${error.message}`, true);
            }
        } else {
            this.log('Telegram WebApp context not found');
        }
    }
    
    /**
     * Check current microphone permission state
     */
    async checkMicrophonePermission() {
        try {
            if (!navigator.permissions || !navigator.permissions.query) {
                this.log('Permissions API not supported, assuming prompt');
                this.updatePermissionState('prompt');
                return;
            }
            
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
            this.updatePermissionState(permissionStatus.state);
            
            permissionStatus.onchange = () => {
                this.updatePermissionState(permissionStatus.state);
            };
            
        } catch (error) {
            this.log(`Error checking microphone permission: ${error.message}`, true);
            this.updatePermissionState('prompt'); // Assume prompt if we can't check
        }
    }
    
    /**
     * Update permission state and trigger callback
     * @param {string} state - Permission state ('granted', 'denied', 'prompt')
     */
    updatePermissionState(state) {
        this.state.permissionState = state;
        this.log(`Current microphone permission state: ${state}`);
        
        if (this.callbacks.onPermissionChange) {
            this.callbacks.onPermissionChange(state);
        }
    }
    
    /**
     * Request microphone permission
     * @returns {Promise<boolean>} Whether permission was granted
     */
    async requestMicrophonePermission() {
        this.log('Explicitly requesting microphone permission...');
        
        try {
            // First try Telegram's API if available
            if (this.telegramWebApp && this.telegramWebApp.requestMicrophone) {
                this.log('Using Telegram.WebApp.requestMicrophone for permissions');
                try {
                    await this.telegramWebApp.requestMicrophone();
                    this.log('Telegram microphone permission granted');
                    this.updatePermissionState('granted');
                    return true;
                } catch (error) {
                    this.log(`Telegram microphone permission error: ${error.message}`, true);
                    // Fall back to standard API
                }
            }
            
            // Standard browser API
            this.log('Using navigator.mediaDevices.getUserMedia for permissions');
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: { 
                    channelCount: 1, 
                    sampleRate: 16000, 
                    echoCancellation: true, 
                    noiseSuppression: true, 
                    autoGainControl: true 
                } 
            });
            
            this.log('Microphone access granted', { 
                tracks: stream.getAudioTracks().length,
                settings: stream.getAudioTracks()[0]?.getSettings()
            });
            
            // Stop the stream since we're just checking permission
            stream.getTracks().forEach(track => track.stop());
            
            this.updatePermissionState('granted');
            
            // Unlock audio on mobile
            if (this.isMobile && !this.audioUnlocked) {
                this.log('Attempting to unlock audio on mobile...');
                const unlocked = await this.liveAudioPlayer.unlockAudio();
                if (unlocked) {
                    this.audioUnlocked = true;
                    this.log('Audio unlocked successfully');
                }
            }
            
            return true;
            
        } catch (error) {
            this.log(`Microphone permission error: ${error.message}`, true);
            this.updatePermissionState('denied');
            
            if (this.callbacks.onError) {
                this.callbacks.onError(new Error(`Microphone access denied: ${error.message}`));
            }
            
            return false;
        }
    }
    
    /**
     * Start recording audio
     * @returns {Promise<boolean>} Whether recording started successfully
     */
    async startRecording() {
        if (this.state.isRecording) return true;
        
        try {
            // Make sure we're initialized
            if (!this.state.initialized) {
                this.log('Audio bridge not initialized, initializing now...');
                const initialized = await this.initialize();
                if (!initialized) {
                    throw new Error('Audio bridge initialization failed');
                }
            }
            
            // CRITICAL FIX: For mobile, try to unlock audio again if needed
            if (this.isMobile && !this.audioUnlocked) {
                this.log('CRITICAL: Mobile audio not yet unlocked, attempting again before recording...');
                try {
                    // Direct unlock attempt
                    const audio = new Audio();
                    audio.volume = 0;
                    audio.src = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
                    await audio.play();
                    audio.pause();
                    this.audioUnlocked = true;
                    this.log('✅ Mobile audio unlocked successfully during recording start');
                } catch (error) {
                    this.log(`⚠️ Mobile audio unlock attempt failed: ${error.message}`, true);
                    // Continue anyway, getUserMedia might still work
                }
            }
            
            // Make sure AudioContext is resumed
            if (this.audioContext && this.audioContext.state === 'suspended') {
                try {
                    await this.audioContext.resume();
                    this.log('Audio context resumed before recording');
                } catch (error) {
                    this.log(`Failed to resume audio context: ${error.message}`, true);
                    // Continue anyway
                }
            }
            
            // Request microphone access with robust error handling
            this.log('Requesting microphone access for recording...');
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ 
                    audio: { 
                        channelCount: 1, 
                        sampleRate: 16000, 
                        echoCancellation: true, 
                        noiseSuppression: true, 
                        autoGainControl: true 
                    } 
                });
            } catch (error) {
                // Special handling for common permission errors
                if (error.name === 'NotAllowedError') {
                    throw new Error('Microphone permission denied by user. Please check browser settings.');
                } else if (error.name === 'NotFoundError') {
                    throw new Error('No microphone found. Please connect a microphone and try again.');
                } else {
                    throw new Error(`Microphone access error: ${error.message}`);
                }
            }
            
            this.stream = stream;
            this.log('Microphone access granted successfully', { 
                tracks: stream.getAudioTracks().length,
                settings: stream.getAudioTracks()[0]?.getSettings()
            });
            
            // Set up analyzer for VAD
            if (!this.analyser && this.audioContext) {
                this.analyser = this.audioContext.createAnalyser();
                const source = this.audioContext.createMediaStreamSource(stream);
                source.connect(this.analyser);
                this.analyser.fftSize = 256;
                const bufferLength = this.analyser.frequencyBinCount;
                this.dataArray = new Uint8Array(bufferLength);
                this.log('Audio analyzer set up successfully');
            }
            
            // Set up media recorder with error handling
            try {
                this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus' });
            } catch (error) {
                throw new Error(`Failed to create MediaRecorder: ${error.message}`);
            }
            
            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    try {
                        const audioBuffer = await event.data.arrayBuffer();
                        const base64Audio = this.arrayBufferToBase64(audioBuffer);
                        
                        if (this.callbacks.onAudioData) {
                            this.callbacks.onAudioData(base64Audio, false);
                        }
                    } catch (error) {
                        this.log(`Error processing audio data: ${error.message}`, true);
                    }
                }
            };
            
            this.mediaRecorder.onstart = () => {
                this.state.isRecording = true;
                this.log('MediaRecorder started successfully');
                
                if (this.callbacks.onAudioStart) {
                    this.callbacks.onAudioStart();
                }
                
                // Provide haptic feedback if available
                if (this.hapticFeedback) {
                    try {
                        this.hapticFeedback.impactOccurred('light');
                    } catch (e) {
                        this.log(`Haptic feedback error: ${e.message}`, true);
                    }
                }
            };
            
            this.mediaRecorder.onstop = () => {
                this.state.isRecording = false;
                this.log('MediaRecorder stopped');
                
                if (this.callbacks.onAudioEnd) {
                    this.callbacks.onAudioEnd();
                }
            };
            
            this.mediaRecorder.onerror = (event) => {
                this.log(`MediaRecorder error: ${event.error}`, true);
                
                if (this.callbacks.onError) {
                    this.callbacks.onError(new Error(`MediaRecorder error: ${event.error}`));
                }
            };
            
            // Start recording
            this.log('Starting MediaRecorder...');
            this.mediaRecorder.start(500);
            this.startVADMonitoring();
            this.log('Recording started successfully');
            
            return true;
            
        } catch (error) {
            this.log(`Error starting recording: ${error.message}`, true);
            
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
            
            return false;
        }
    }
    
    /**
     * Stop recording audio
     * @returns {Promise<boolean>} Whether recording stopped successfully
     */
    async stopRecording() {
        if (!this.state.isRecording) return true;
        
        try {
            this.stopVADMonitoring();
            
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            
            // Send end-of-speech signal
            if (this.callbacks.onAudioData) {
                this.callbacks.onAudioData(null, true);
            }
            
            // Clean up
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null;
            }
            
            return true;
            
        } catch (error) {
            this.log(`Error stopping recording: ${error.message}`, true);
            
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
            
            return false;
        }
    }
    
    /**
     * Start VAD monitoring
     */
    startVADMonitoring() {
        this.stopVADMonitoring();
        this.vad.silenceStartTime = 0;
        this.vad.currentEnergy = 0.0;
        
        if (!this.analyser) {
            this.log('VAD: Analyser not ready', true);
            return;
        }
        
        this.log(`VAD: Starting. Threshold: ${this.config.vadSilenceThreshold}, Duration: ${this.config.vadRequiredSilenceDuration}ms`);
        this.vad.monitoringInterval = setInterval(() => this.checkVAD(), 100);
    }
    
    /**
     * Check VAD for silence
     */
    checkVAD() {
        if (!this.state.isRecording || !this.analyser || !this.dataArray) return;
        
        this.analyser.getByteFrequencyData(this.dataArray);
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i];
        const average = this.dataArray.length > 0 ? sum / this.dataArray.length : 0;
        const normalizedEnergy = average / 255;
        this.vad.currentEnergy = (this.vad.currentEnergy * (1 - this.config.vadEnergySmoothing)) + 
                                (normalizedEnergy * this.config.vadEnergySmoothing);
        
        if (this.vad.currentEnergy < this.config.vadSilenceThreshold) {
            if (this.vad.silenceStartTime === 0) this.vad.silenceStartTime = Date.now();
            if ((Date.now() - this.vad.silenceStartTime) >= this.config.vadRequiredSilenceDuration) {
                this.log(`VAD: End of speech detected. Silence: ${Date.now() - this.vad.silenceStartTime}ms`);
                
                if (this.callbacks.onVADSilenceDetected) {
                    this.callbacks.onVADSilenceDetected();
                }
                
                this.stopRecording();
            }
        } else {
            this.vad.silenceStartTime = 0;
        }
    }
    
    /**
     * Stop VAD monitoring
     */
    stopVADMonitoring() {
        if (this.vad.monitoringInterval) {
            clearInterval(this.vad.monitoringInterval);
            this.vad.monitoringInterval = null;
            this.log('VAD: Monitoring stopped');
        }
    }
    
    /**
     * Play audio data
     * @param {string} audioData - Base64 encoded audio data
     * @param {string} mimeType - MIME type of the audio data
     */
    playAudio(audioData, mimeType) {
        try {
            if (!audioData) {
                this.log('No audio data to play', true);
                return;
            }
            
            // Provide haptic feedback if available
            if (this.hapticFeedback && !this.state.isPlaying) {
                try {
                    this.hapticFeedback.impactOccurred('light');
                } catch (e) {
                    this.log(`Haptic feedback error: ${e.message}`, true);
                }
            }
            
            this.state.isPlaying = true;
            
            if (this.callbacks.onPlaybackStart) {
                this.callbacks.onPlaybackStart();
            }
            
            // Play audio using LiveAudioPlayer
            this.liveAudioPlayer.playChunk(audioData, mimeType, () => {
                this.state.isPlaying = false;
                
                if (this.callbacks.onPlaybackEnd) {
                    this.callbacks.onPlaybackEnd();
                }
            });
            
        } catch (error) {
            this.log(`Error playing audio: ${error.message}`, true);
            this.state.isPlaying = false;
            
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
        }
    }
    
    /**
     * Stop audio playback
     */
    stopPlayback() {
        this.liveAudioPlayer.stopPlayback();
        this.state.isPlaying = false;
        
        if (this.callbacks.onPlaybackEnd) {
            this.callbacks.onPlaybackEnd();
        }
    }
    
    /**
     * Convert ArrayBuffer to Base64
     * @param {ArrayBuffer} buffer - ArrayBuffer to convert
     * @returns {string} Base64 string
     */
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
    
    /**
     * Log message to console
     * @param {string} message - Message to log
     * @param {boolean} isError - Whether this is an error message
     */
    log(message, isError = false) {
        if (!this.config.debug) return;
        
        const prefix = '[AudioBridge]';
        if (isError) {
            console.error(`${prefix} ${message}`);
        } else {
            console.log(`${prefix} ${message}`);
        }
    }
    
    /**
     * Clean up resources
     */
    dispose() {
        this.stopRecording();
        this.stopPlayback();
        this.stopVADMonitoring();
        
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close().catch(e => this.log(`Error closing audio context: ${e.message}`, true));
        }
        
        this.log('Audio bridge disposed');
    }
}

/**
 * Live Audio Player for handling audio playback
 */
class LiveAudioPlayer {
    constructor() {
        this.audioQueue = [];
        this.isPlaying = false;
        this.currentAudio = null;
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.audioPool = [];
        this.audioContextForUnlock = null;
        
        this.setupMobileOptimizations();
    }
    
    /**
     * Set up mobile optimizations
     */
    setupMobileOptimizations() {
        // Pre-create Audio objects for mobile to reduce latency
        for (let i = 0; i < 3; i++) {
            const audio = new Audio();
            audio.preload = 'auto';
            if (this.isMobile) {
                audio.crossOrigin = 'anonymous';
            }
            this.audioPool.push(audio);
        }
    }
    
    /**
     * Unlock audio on mobile devices
     * @returns {Promise<boolean>} Whether audio was unlocked successfully
     */
    async unlockAudio() {
        if (this.isMobile) {
            console.log('[LiveAudioPlayer] 🔓 Attempting to unlock mobile audio...');
            
            try {
                // Method 1: Try with a silent audio element
                const audio = new Audio();
                audio.volume = 0;
                audio.src = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='; // Tiny silent WAV
                
                const playPromise = audio.play();
                if (playPromise !== undefined) {
                    await playPromise;
                    audio.pause();
                    audio.currentTime = 0;
                    console.log('[LiveAudioPlayer] ✅ Mobile audio unlocked successfully (Method 1)');
                    return true;
                }
            } catch (error) {
                console.warn('[LiveAudioPlayer] ⚠️ Method 1 failed:', error.message);
            }
            
            try {
                // Method 2: Try with blob URL and a pooled audio element
                const audioBuffer = new ArrayBuffer(44);
                const view = new DataView(audioBuffer);
                // Create minimal WAV header
                const writeString = (offset, string) => {
                    for (let i = 0; i < string.length; i++) {
                        view.setUint8(offset + i, string.charCodeAt(i));
                    }
                };
                writeString(0, 'RIFF');
                view.setUint32(4, 36, true); // ChunkSize
                writeString(8, 'WAVE');
                writeString(12, 'fmt '); // Subchunk1ID
                view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
                view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
                view.setUint16(22, 1, true);  // NumChannels (mono)
                view.setUint32(24, 8000, true); // SampleRate (e.g., 8kHz, can be anything valid)
                view.setUint32(28, 16000, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
                view.setUint16(32, 2, true);  // BlockAlign (NumChannels * BitsPerSample/8)
                view.setUint16(34, 16, true); // BitsPerSample
                writeString(36, 'data');      // Subchunk2ID
                view.setUint32(40, 0, true);  // Subchunk2Size (0 for no actual data)
                
                const blob = new Blob([audioBuffer], { type: 'audio/wav' });
                const url = URL.createObjectURL(blob);
                
                const audio2 = this.getAudioFromPool();
                audio2.volume = 0;
                audio2.src = url;
                
                await audio2.play();
                audio2.pause();
                audio2.currentTime = 0;
                URL.revokeObjectURL(url);
                this.returnAudioToPool(audio2);
                
                console.log('[LiveAudioPlayer] ✅ Mobile audio unlocked with method 2');
                return true;
                
            } catch (error) {
                console.warn('[LiveAudioPlayer] ⚠️ Method 2 failed:', error.message);
            }
            
            console.warn('[LiveAudioPlayer] ❌ All unlock methods failed');
            return false;
        }
        
        console.log('[LiveAudioPlayer] 💻 Desktop - no unlock needed');
        return true;
    }
    
    /**
     * Play an audio chunk
     * @param {string} base64Audio - Base64 encoded audio data
     * @param {string} mimeType - MIME type of the audio data
     * @param {Function} onComplete - Callback when playback is complete
     */
    playChunk(base64Audio, mimeType, onComplete) {
        try {
            // Validate chunk size for mobile
            if (this.isMobile && base64Audio.length > 500000) {
                console.warn('[LiveAudioPlayer] Large audio chunk on mobile, may cause issues. Size:', base64Audio.length);
            }
            
            const audioBuffer = this.base64ToArrayBuffer(base64Audio);
            const blob = new Blob([audioBuffer], { type: mimeType });
            const audioUrl = URL.createObjectURL(blob);
            
            const audio = this.getAudioFromPool();
            
            // Mobile-specific audio settings
            if (this.isMobile) {
                audio.volume = 0.9;
                audio.playsInline = true;
            } else {
                audio.volume = 1.0;
            }
            
            audio.src = audioUrl;
            
            this.audioQueue.push({
                audio: audio,
                url: audioUrl,
                onComplete: onComplete
            });
            
            if (!this.isPlaying) {
                this.processAudioQueue();
            }
        } catch (error) {
            console.error('[LiveAudioPlayer] Failed to play audio chunk:', error);
            if (onComplete) onComplete();
        }
    }
    
    /**
     * Process the audio queue
     */
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
                        if (audioItem.onComplete) audioItem.onComplete();
                        resolve();
                    };
                    
                    audioItem.audio.onerror = (e) => {
                        console.error('[LiveAudioPlayer] Audio error:', e, audioItem.audio.error);
                        if (retryCount < maxRetries) {
                            retryCount++;
                            console.log(`[LiveAudioPlayer] Retrying playback (${retryCount}/${maxRetries})`);
                            setTimeout(() => playWithRetry().catch(reject), 100);
                            return;
                        }
                        URL.revokeObjectURL(audioItem.url);
                        this.returnAudioToPool(audioItem.audio);
                        this.currentAudio = null;
                        if (audioItem.onComplete) audioItem.onComplete();
                        reject(new Error('Audio playback failed after retries'));
                    };
                    
                    // Mobile-optimized play
                    if (this.isMobile) {
                        setTimeout(() => {
                            audioItem.audio.play().catch(err => {
                                console.error('[LiveAudioPlayer] audio.play() rejected (mobile):', err);
                                if (retryCount >= maxRetries) reject(err);
                            });
                        }, 50);
                    } else {
                        audioItem.audio.play().catch(err => {
                            console.error('[LiveAudioPlayer] audio.play() rejected (desktop):', err);
                            if (retryCount >= maxRetries) reject(err);
                        });
                    }
                });
                
                this.processAudioQueue();
                
            } catch (error) {
                console.error('[LiveAudioPlayer] Failed to play audio after retries or critical error:', error);
                if (audioItem.url) URL.revokeObjectURL(audioItem.url);
                if (audioItem.audio) this.returnAudioToPool(audioItem.audio);
                this.currentAudio = null;
                this.processAudioQueue();
            }
        };
        
        await playWithRetry();
    }
    
    /**
     * Get an audio element from the pool
     * @returns {HTMLAudioElement} Audio element
     */
    getAudioFromPool() {
        if (this.audioPool.length > 0) {
            return this.audioPool.shift();
        }
        const audio = new Audio();
        audio.preload = 'auto';
        if (this.isMobile) audio.crossOrigin = 'anonymous';
        return audio;
    }
    
    /**
     * Return an audio element to the pool
     * @param {HTMLAudioElement} audio - Audio element to return
     */
    returnAudioToPool(audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.src = '';
        if (this.audioPool.length < 5) {
            this.audioPool.push(audio);
        }
    }
    
    /**
     * Stop playback
     */
    stopPlayback() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.returnAudioToPool(this.currentAudio);
            this.currentAudio = null;
        }
        
        // Clear the queue
        this.audioQueue.forEach(item => {
            if (item.url) URL.revokeObjectURL(item.url);
            this.returnAudioToPool(item.audio);
            if (item.onComplete) item.onComplete();
        });
        
        this.audioQueue = [];
        this.isPlaying = false;
    }
    
    /**
     * Convert Base64 to ArrayBuffer
     * @param {string} base64 - Base64 string
     * @returns {ArrayBuffer} ArrayBuffer
     */
    base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
    
    /**
     * Finalize the audio stream
     */
    finalizeStream() {
        console.log('[LiveAudioPlayer] Audio stream complete signal received.');
    }
}

// Export the TelegramAudioBridge class
window.TelegramAudioBridge = TelegramAudioBridge;
