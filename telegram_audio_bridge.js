/**
 * TelegramAudioBridge - A WebRTC-based audio bridge for Telegram Mini Apps
 * 
 * This component provides seamless audio integration between Telegram's WebApp
 * and Gemini Live API, handling audio capture, processing, and playback
 * optimized for mobile devices.
 * 
 * Version: 1.0.0
 */

class TelegramAudioBridge {
    constructor(options = {}) {
        // Configuration
        this.config = {
            debug: options.debug || false,
            audioBufferSize: options.audioBufferSize || 4096,
            sampleRate: options.sampleRate || 16000,
            channels: options.channels || 1,
            enableEchoCancellation: options.enableEchoCancellation !== false,
            enableNoiseSuppression: options.enableNoiseSuppression !== false,
            enableAutoGainControl: options.enableAutoGainControl !== false,
            vadSilenceThreshold: options.vadSilenceThreshold || 0.01,
            vadRequiredSilenceDuration: options.vadRequiredSilenceDuration || 1500,
            vadEnergySmoothing: options.vadEnergySmoothing || 0.1,
            hapticFeedbackEnabled: options.hapticFeedbackEnabled !== false,
            ...options
        };

        // State
        this.initialized = false;
        this.isRecording = false;
        this.isPlaying = false;
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.audioUnlocked = false;
        this.telegramWebApp = window.Telegram?.WebApp;
        this.hapticFeedback = this.telegramWebApp?.HapticFeedback;
        
        // Audio components
        this.audioContext = null;
        this.mediaRecorder = null;
        this.audioStream = null;
        this.audioQueue = [];
        this.audioWorklet = null;
        this.audioBuffers = [];
        this.currentAudio = null;
        this.audioPool = [];
        
        // VAD components
        this.analyser = null;
        this.dataArray = null;
        this.currentEnergy = 0.0;
        this.silenceStartTime = 0;
        this.vadMonitoringInterval = null;
        
        // Event callbacks
        this.onAudioStart = options.onAudioStart || (() => {});
        this.onAudioEnd = options.onAudioEnd || (() => {});
        this.onAudioData = options.onAudioData || (() => {});
        this.onPlaybackStart = options.onPlaybackStart || (() => {});
        this.onPlaybackEnd = options.onPlaybackEnd || (() => {});
        this.onVADSilenceDetected = options.onVADSilenceDetected || (() => {});
        this.onError = options.onError || ((error) => console.error('TelegramAudioBridge error:', error));
        
        // Debug logging
        this.log('TelegramAudioBridge initialized with config:', this.config);
        
        // Initialize
        this._setupTelegramOptimizations();
        this._createAudioPool();
    }
    
    /**
     * Initialize the audio context and request necessary permissions
     * @returns {Promise<boolean>} Whether initialization was successful
     */
    async initialize() {
        if (this.initialized) return true;
        
        try {
            // Create audio context
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext({
                latencyHint: 'interactive',
                sampleRate: this.config.sampleRate
            });
            
            // Unlock audio on mobile
            if (this.isMobile) {
                const unlocked = await this._unlockAudioOnMobile();
                if (!unlocked) {
                    this.log('Failed to unlock audio on mobile');
                    return false;
                }
            }
            
            // Request microphone permissions
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: this.config.channels,
                    sampleRate: this.config.sampleRate,
                    echoCancellation: this.config.enableEchoCancellation,
                    noiseSuppression: this.config.enableNoiseSuppression,
                    autoGainControl: this.config.enableAutoGainControl
                }
            });
            
            // Store stream for later use
            this.audioStream = stream;
            
            // Setup audio analyzer for VAD
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            
            this.initialized = true;
            this.log('TelegramAudioBridge successfully initialized');
            return true;
        } catch (error) {
            this.onError(error);
            return false;
        }
    }
    
    /**
     * Start recording audio from the microphone
     * @returns {Promise<boolean>} Whether recording started successfully
     */
    async startRecording() {
        if (!this.initialized) {
            const initialized = await this.initialize();
            if (!initialized) return false;
        }
        
        if (this.isRecording) return true;
        
        try {
            // Connect microphone to analyzer for VAD
            const source = this.audioContext.createMediaStreamSource(this.audioStream);
            source.connect(this.analyser);
            
            // Create media recorder
            this.mediaRecorder = new MediaRecorder(this.audioStream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            
            // Set up data handling
            this.audioBuffers = [];
            this.mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    const buffer = await event.data.arrayBuffer();
                    const base64Audio = this._arrayBufferToBase64(buffer);
                    this.onAudioData(base64Audio, false);
                }
            };
            
            // Start recording with small chunks for low latency
            this.mediaRecorder.start(500);
            this.isRecording = true;
            
            // Start VAD monitoring
            this._startVADMonitoring();
            
            // Provide haptic feedback
            this._triggerHapticFeedback('medium');
            
            this.onAudioStart();
            this.log('Recording started');
            return true;
        } catch (error) {
            this.onError(error);
            return false;
        }
    }
    
    /**
     * Stop recording audio
     * @returns {Promise<boolean>} Whether recording stopped successfully
     */
    async stopRecording() {
        if (!this.isRecording) return true;
        
        try {
            // Stop VAD monitoring
            this._stopVADMonitoring();
            
            // Stop media recorder
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.onstop = () => {
                    this.onAudioData(null, true); // Signal end of speech
                    this.onAudioEnd();
                };
                this.mediaRecorder.stop();
            } else {
                this.onAudioData(null, true); // Signal end of speech
                this.onAudioEnd();
            }
            
            this.isRecording = false;
            this.log('Recording stopped');
            
            // Provide haptic feedback
            this._triggerHapticFeedback('light');
            
            return true;
        } catch (error) {
            this.onError(error);
            return false;
        }
    }
    
    /**
     * Play audio data received from the server
     * @param {string} base64Audio - Base64-encoded audio data
     * @param {string} mimeType - MIME type of the audio data
     * @returns {Promise<boolean>} Whether playback started successfully
     */
    async playAudio(base64Audio, mimeType = 'audio/pcm;rate=24000') {
        try {
            // Validate input
            if (!base64Audio || base64Audio.length === 0) {
                this.log('Empty audio data provided');
                return false;
            }
            
            // Convert base64 to array buffer
            const audioBuffer = this._base64ToArrayBuffer(base64Audio);
            
            // Create blob URL
            const blob = new Blob([audioBuffer], { type: mimeType });
            const audioUrl = URL.createObjectURL(blob);
            
            // Get audio element from pool
            const audio = this._getAudioFromPool();
            
            // Configure audio element
            if (this.isMobile) {
                audio.volume = 0.9;
                audio.playsInline = true;
            } else {
                audio.volume = 1.0;
            }
            
            audio.src = audioUrl;
            
            // Add to queue
            this.audioQueue.push({
                audio: audio,
                url: audioUrl,
                timestamp: Date.now()
            });
            
            // Start playback if not already playing
            if (!this.isPlaying) {
                this._processAudioQueue();
            }
            
            return true;
        } catch (error) {
            this.onError(error);
            return false;
        }
    }
    
    /**
     * Process the audio queue for playback
     * @private
     */
    async _processAudioQueue() {
        if (this.audioQueue.length === 0) {
            this.isPlaying = false;
            this.onPlaybackEnd();
            return;
        }
        
        this.isPlaying = true;
        const audioItem = this.audioQueue.shift();
        this.currentAudio = audioItem.audio;
        
        // Provide haptic feedback for first audio chunk
        if (this.audioQueue.length === 0) {
            this._triggerHapticFeedback('light');
            this.onPlaybackStart();
        }
        
        let retryCount = 0;
        const maxRetries = this.isMobile ? 2 : 1;
        
        const playWithRetry = async () => {
            try {
                await new Promise((resolve, reject) => {
                    audioItem.audio.onended = () => {
                        URL.revokeObjectURL(audioItem.url);
                        this._returnAudioToPool(audioItem.audio);
                        this.currentAudio = null;
                        resolve();
                    };
                    
                    audioItem.audio.onerror = (e) => {
                        this.log('Audio playback error:', e, audioItem.audio.error);
                        if (retryCount < maxRetries) {
                            retryCount++;
                            this.log(`Retrying playback (${retryCount}/${maxRetries})`);
                            setTimeout(() => playWithRetry().catch(reject), 100);
                            return;
                        }
                        URL.revokeObjectURL(audioItem.url);
                        this._returnAudioToPool(audioItem.audio);
                        this.currentAudio = null;
                        reject(new Error('Audio playback failed after retries'));
                    };
                    
                    // Mobile-optimized play
                    if (this.isMobile) {
                        setTimeout(() => {
                            audioItem.audio.play().catch(err => {
                                this.log('audio.play() rejected (mobile):', err);
                                if (retryCount >= maxRetries) reject(err);
                            });
                        }, 50);
                    } else {
                        audioItem.audio.play().catch(err => {
                            this.log('audio.play() rejected (desktop):', err);
                            if (retryCount >= maxRetries) reject(err);
                        });
                    }
                });
                
                this._processAudioQueue();
                
            } catch (error) {
                this.log('Failed to play audio after retries:', error);
                if (audioItem.url) URL.revokeObjectURL(audioItem.url);
                if (audioItem.audio) this._returnAudioToPool(audioItem.audio);
                this.currentAudio = null;
                this._processAudioQueue();
            }
        };
        
        await playWithRetry();
    }
    
    /**
     * Stop all audio playback
     */
    stopPlayback() {
        // Stop current audio
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this._returnAudioToPool(this.currentAudio);
            this.currentAudio = null;
        }
        
        // Clear queue
        for (const item of this.audioQueue) {
            URL.revokeObjectURL(item.url);
            this._returnAudioToPool(item.audio);
        }
        
        this.audioQueue = [];
        this.isPlaying = false;
        this.onPlaybackEnd();
        this.log('Playback stopped');
    }
    
    /**
     * Release all resources
     */
    dispose() {
        this.stopRecording();
        this.stopPlayback();
        
        // Close audio context
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close().catch(e => this.log('Error closing AudioContext:', e));
        }
        
        // Stop audio stream
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
        }
        
        this.initialized = false;
        this.log('TelegramAudioBridge disposed');
    }
    
    /**
     * Start VAD monitoring
     * @private
     */
    _startVADMonitoring() {
        this._stopVADMonitoring();
        this.silenceStartTime = 0;
        this.currentEnergy = 0.0;
        
        if (!this.analyser) {
            this.log('VAD: Analyser not ready');
            return;
        }
        
        this.log(`VAD: Starting. Threshold: ${this.config.vadSilenceThreshold}, Duration: ${this.config.vadRequiredSilenceDuration}ms`);
        this.vadMonitoringInterval = setInterval(() => this._checkVAD(), 100);
    }
    
    /**
     * Check VAD for silence detection
     * @private
     */
    _checkVAD() {
        if (!this.isRecording || !this.analyser || !this.dataArray) return;
        
        this.analyser.getByteFrequencyData(this.dataArray);
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i];
        const average = this.dataArray.length > 0 ? sum / this.dataArray.length : 0;
        const normalizedEnergy = average / 255;
        this.currentEnergy = (this.currentEnergy * (1 - this.config.vadEnergySmoothing)) + 
                            (normalizedEnergy * this.config.vadEnergySmoothing);
        
        if (this.currentEnergy < this.config.vadSilenceThreshold) {
            if (this.silenceStartTime === 0) this.silenceStartTime = Date.now();
            if ((Date.now() - this.silenceStartTime) >= this.config.vadRequiredSilenceDuration) {
                this.log(`VAD: End of speech detected. Silence: ${Date.now() - this.silenceStartTime}ms`);
                this.onVADSilenceDetected();
                this.stopRecording();
            }
        } else {
            this.silenceStartTime = 0;
        }
    }
    
    /**
     * Stop VAD monitoring
     * @private
     */
    _stopVADMonitoring() {
        if (this.vadMonitoringInterval) {
            clearInterval(this.vadMonitoringInterval);
            this.vadMonitoringInterval = null;
            this.log('VAD: Monitoring stopped');
        }
    }
    
    /**
     * Set up Telegram-specific optimizations
     * @private
     */
    _setupTelegramOptimizations() {
        if (this.telegramWebApp) {
            try {
                this.telegramWebApp.ready();
                this.telegramWebApp.expand();
                
                this.log('Telegram WebApp optimizations enabled');
                
                // Handle viewport changes
                this.telegramWebApp.onEvent('viewportChanged', (eventData) => {
                    if (eventData.isStateStable) {
                        this.log(`Telegram viewport changed: Height ${this.telegramWebApp.viewportStableHeight}, Width ${window.innerWidth}`);
                    }
                });
                
                // Handle theme changes
                this.telegramWebApp.onEvent('themeChanged', () => {
                    this.log(`Telegram theme changed`);
                });
                
            } catch (e) {
                this.log(`Error setting up Telegram WebApp features: ${e.message}`);
            }
        } else {
            this.log('Telegram WebApp context not found');
        }
    }
    
    /**
     * Unlock audio on mobile devices
     * @private
     * @returns {Promise<boolean>} Whether audio was unlocked successfully
     */
    async _unlockAudioOnMobile() {
        if (!this.isMobile || this.audioUnlocked) return true;
        
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
                this.log('Mobile audio unlocked successfully (Method 1)');
                this.audioUnlocked = true;
                return true;
            }
        } catch (error) {
            this.log('Method 1 failed:', error.message);
        }
        
        try {
            // Method 2: Try with AudioContext
            if (this.audioContext) {
                const buffer = this.audioContext.createBuffer(1, 1, 22050);
                const source = this.audioContext.createBufferSource();
                source.buffer = buffer;
                source.connect(this.audioContext.destination);
                source.start(0);
                
                if (this.audioContext.state === 'running') {
                    this.log('Mobile audio unlocked successfully (Method 2)');
                    this.audioUnlocked = true;
                    return true;
                }
            }
        } catch (error) {
            this.log('Method 2 failed:', error.message);
        }
        
        this.log('All unlock methods failed');
        return false;
    }
    
    /**
     * Create a pool of audio elements for playback
     * @private
     */
    _createAudioPool() {
        // Pre-create Audio objects to reduce latency
        for (let i = 0; i < 3; i++) {
            const audio = new Audio();
            audio.preload = 'auto';
            if (this.isMobile) {
                audio.crossOrigin = 'anonymous';
            }
            this.audioPool.push(audio);
        }
        this.log('Created audio pool with 3 elements');
    }
    
    /**
     * Get an audio element from the pool
     * @private
     * @returns {HTMLAudioElement} Audio element
     */
    _getAudioFromPool() {
        if (this.audioPool.length > 0) {
            return this.audioPool.shift();
        }
        
        // Create new if pool is empty
        const audio = new Audio();
        audio.preload = 'auto';
        if (this.isMobile) audio.crossOrigin = 'anonymous';
        return audio;
    }
    
    /**
     * Return an audio element to the pool
     * @private
     * @param {HTMLAudioElement} audio - Audio element to return
     */
    _returnAudioToPool(audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.src = '';
        
        if (this.audioPool.length < 5) {
            this.audioPool.push(audio);
        }
    }
    
    /**
     * Convert array buffer to base64
     * @private
     * @param {ArrayBuffer} buffer - Array buffer to convert
     * @returns {string} Base64-encoded string
     */
    _arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
    
    /**
     * Convert base64 to array buffer
     * @private
     * @param {string} base64 - Base64-encoded string
     * @returns {ArrayBuffer} Array buffer
     */
    _base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
    
    /**
     * Trigger haptic feedback
     * @private
     * @param {string} type - Type of haptic feedback ('light', 'medium', 'heavy', 'selection', 'success', 'warning', 'error')
     */
    _triggerHapticFeedback(type = 'light') {
        if (!this.config.hapticFeedbackEnabled || !this.hapticFeedback) return;
        
        try {
            switch (type) {
                case 'light':
                    this.hapticFeedback.impactOccurred('light');
                    break;
                case 'medium':
                    this.hapticFeedback.impactOccurred('medium');
                    break;
                case 'heavy':
                    this.hapticFeedback.impactOccurred('heavy');
                    break;
                case 'selection':
                    this.hapticFeedback.selectionChanged();
                    break;
                case 'success':
                    this.hapticFeedback.notificationOccurred('success');
                    break;
                case 'warning':
                    this.hapticFeedback.notificationOccurred('warning');
                    break;
                case 'error':
                    this.hapticFeedback.notificationOccurred('error');
                    break;
            }
        } catch (e) {
            this.log('Haptic feedback error:', e);
        }
    }
    
    /**
     * Log debug messages
     * @private
     */
    log(...args) {
        if (this.config.debug) {
            console.log('[TelegramAudioBridge]', ...args);
        }
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TelegramAudioBridge;
} else if (typeof define === 'function' && define.amd) {
    define([], function() { return TelegramAudioBridge; });
} else {
    window.TelegramAudioBridge = TelegramAudioBridge;
}
