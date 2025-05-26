/**
 * Enhanced Telegram Audio Bridge with improved mobile compatibility
 * Version: 3.0.1 (Patched for external AudioContext)
 * 
 * This module handles audio recording and playback in the Telegram WebApp environment,
 * with special optimizations for mobile devices and permission handling.
 */

class TelegramAudioBridge {
    constructor(options = {}) {
        console.log('🔄 [AudioBridge] TelegramAudioBridge v3.0.1 constructor called with options:', options);
        
        // Store options
        this.options = options; 
        
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
        
        // Use provided audioContext if available and valid, otherwise null
        this.audioContext = (options.audioContext && options.audioContext.state === 'running') ? options.audioContext : null;
        if (this.audioContext) {
            this.log(`Constructor: Using provided AudioContext in '${this.audioContext.state}' state.`);
        } else {
            this.log('Constructor: No valid pre-existing AudioContext provided or it was not running. Will create one if needed.');
        }
        
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
        this.audioUnlocked = !!(this.audioContext && this.audioContext.state === 'running'); // If context is running, assume unlocked
        
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
        if (this.state.initializing) {
            this.log('Initialization already in progress.');
            return false;
        }
        if (this.state.initialized) {
            this.log('Already initialized.');
            return true;
        }
        
        this.state.initializing = true;
        this.state.initializationAttempts++;
        
        try {
            this.log(`Initialization attempt ${this.state.initializationAttempts}/${this.config.maxInitializationAttempts}`);
            
            if (this.state.initializationAttempts > this.config.maxInitializationAttempts) {
                throw new Error('Maximum initialization attempts exceeded');
            }
            
            // Handle AudioContext
            if (this.audioContext && this.audioContext.state === 'running') {
                this.log('Using pre-existing and running AudioContext.');
                this.audioUnlocked = true; // Mark as unlocked if context is running
            } else {
                this.log('No pre-existing running AudioContext. Attempting to create/resume.');
                if (this.audioContext && this.audioContext.state === 'closed') {
                    this.log('Provided AudioContext was closed, creating a new one.');
                    this.audioContext = null; // Force creation of a new one
                }
                if (!this.audioContext) {
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    this.log(`Created new AudioContext. Initial state: ${this.audioContext.state}`);
                }

                if (this.audioContext.state === 'suspended') {
                    this.log('AudioContext is suspended. Attempting to resume...');
                    try {
                        await this.audioContext.resume();
                        this.log(`AudioContext resumed. State: ${this.audioContext.state}`);
                        if (this.audioContext.state === 'running') {
                            this.audioUnlocked = true;
                        }
                    } catch (error) {
                        this.log(`Failed to resume AudioContext: ${error.message}`, true);
                        // This is a critical failure point if it's still suspended after user gesture
                    }
                } else if (this.audioContext.state === 'running') {
                     this.log('AudioContext is already running.');
                     this.audioUnlocked = true;
                }
            }

            // If after all attempts, context is not running, this is an issue.
            if (!this.audioContext || this.audioContext.state !== 'running') {
                 this.log('AudioContext is not in a running state after initialization attempts.', true);
                 // Do not throw error yet, let permission check proceed, but this is a bad sign.
            }
            
            // CRITICAL FIX: Unlock audio on mobile if not already unlocked by a running context
            if (this.isMobile && !this.audioUnlocked) {
                this.log('CRITICAL: Attempting to unlock audio on mobile (AudioContext not running or unlock flag false)...');
                try {
                    const audio = new Audio();
                    audio.volume = 0;
                    audio.src = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='; 
                    const playPromise = audio.play();
                    if (playPromise !== undefined) {
                        await playPromise;
                        audio.pause();
                        audio.currentTime = 0;
                        this.audioUnlocked = true; // Set flag
                        this.log('✅ Mobile audio unlocked successfully (Direct Method during init)');
                        // If context exists and is suspended, try to resume again now that we've played audio
                        if (this.audioContext && this.audioContext.state === 'suspended') {
                            this.log('Attempting to resume AudioContext again after silent play...');
                            await this.audioContext.resume();
                            this.log(`AudioContext state after silent play resume: ${this.audioContext.state}`);
                        }
                    }
                } catch (error) {
                    this.log(`⚠️ Direct audio unlock during init failed: ${error.message}`, true);
                }
            }
            
            const permissionGranted = await this.requestMicrophonePermission();
            if (!permissionGranted) {
                throw new Error('Microphone permission denied');
            }
            
            // Try unlocking audio again with LiveAudioPlayer if still not unlocked
            if (this.isMobile && !this.audioUnlocked && (!this.audioContext || this.audioContext.state !== 'running')) {
                this.log('Attempting to unlock audio via LiveAudioPlayer (fallback)...');
                const unlockedByPlayer = await this.liveAudioPlayer.unlockAudio();
                if (unlockedByPlayer) {
                    this.audioUnlocked = true;
                    this.log('Audio unlocked successfully via LiveAudioPlayer');
                     if (this.audioContext && this.audioContext.state === 'suspended') {
                        this.log('Attempting to resume AudioContext again after LiveAudioPlayer unlock...');
                        await this.audioContext.resume();
                        this.log(`AudioContext state after LiveAudioPlayer unlock resume: ${this.audioContext.state}`);
                    }
                } else {
                    this.log('Failed to unlock audio on mobile via LiveAudioPlayer');
                }
            }

            // Final check for AudioContext state
            if (!this.audioContext || this.audioContext.state !== 'running') {
                this.log('Critical: AudioContext is NOT RUNNING after all initialization and unlock attempts.', true);
                // Not throwing error here to allow UI to show message, but recording will likely fail.
            } else {
                 this.log('AudioContext is RUNNING. Initialization seems successful.');
            }
            
            this.state.initialized = true;
            return true;
            
        } catch (error) {
            this.log(`Initialization failed: ${error.message}`, true);
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
            return false;
        } finally {
            this.state.initializing = false;
        }
    }
    
    setupTelegramOptimizations() {
        if (this.telegramWebApp) {
            try {
                this.telegramWebApp.ready();
                this.telegramWebApp.expand();
                this.log('Telegram WebApp optimizations enabled (ready, expand)');
                this.telegramWebApp.onEvent('viewportChanged', (eventData) => {
                    if (eventData.isStateStable) {
                        this.log(`Telegram viewport changed: ${window.innerWidth}x${this.telegramWebApp.viewportStableHeight}`);
                    }
                });
            } catch (error) {
                this.log(`Error setting up Telegram WebApp features: ${error.message}`, true);
            }
        } else {
            this.log('Telegram WebApp context not found');
        }
    }
    
    async checkMicrophonePermission() {
        try {
            if (!navigator.permissions || !navigator.permissions.query) {
                this.log('Permissions API not supported, assuming prompt');
                this.updatePermissionState('prompt');
                return;
            }
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
            this.updatePermissionState(permissionStatus.state);
            permissionStatus.onchange = () => this.updatePermissionState(permissionStatus.state);
        } catch (error) {
            this.log(`Error checking microphone permission: ${error.message}`, true);
            this.updatePermissionState('prompt');
        }
    }
    
    updatePermissionState(state) {
        this.state.permissionState = state;
        this.log(`Current microphone permission state: ${state}`);
        if (this.callbacks.onPermissionChange) this.callbacks.onPermissionChange(state);
    }
    
    async requestMicrophonePermission() {
        this.log('Explicitly requesting microphone permission...');
        try {
            if (this.telegramWebApp && this.telegramWebApp.requestMicrophoneAccess) { // Updated API name
                this.log('Using Telegram.WebApp.requestMicrophoneAccess for permissions');
                return new Promise((resolve) => {
                    this.telegramWebApp.requestMicrophoneAccess((granted) => {
                        if (granted) {
                            this.log('Telegram microphone permission granted');
                            this.updatePermissionState('granted');
                            resolve(true);
                        } else {
                            this.log('Telegram microphone permission denied', true);
                            this.updatePermissionState('denied');
                            resolve(false);
                        }
                    });
                });
            }
            
            this.log('Using navigator.mediaDevices.getUserMedia for permissions');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
            this.log('Microphone access granted via getUserMedia');
            stream.getTracks().forEach(track => track.stop());
            this.updatePermissionState('granted');
            
            if (this.isMobile && !this.audioUnlocked && (!this.audioContext || this.audioContext.state !== 'running')) {
                this.log('Attempting to unlock audio on mobile after getUserMedia grant...');
                const unlocked = await this.liveAudioPlayer.unlockAudio(); // unlockAudio now part of LiveAudioPlayer
                if (unlocked) {
                    this.audioUnlocked = true;
                    this.log('Audio unlocked successfully after getUserMedia');
                }
            }
            return true;
        } catch (error) {
            this.log(`Microphone permission error: ${error.message}`, true);
            this.updatePermissionState('denied');
            if (this.callbacks.onError) this.callbacks.onError(new Error(`Microphone access denied: ${error.message}`));
            return false;
        }
    }
    
    async startRecording() {
        if (this.state.isRecording) return true;
        
        try {
            if (!this.state.initialized) {
                this.log('Audio bridge not initialized, initializing now...');
                const initialized = await this.initialize();
                if (!initialized) throw new Error('Audio bridge initialization failed prior to recording');
            }

            if (!this.audioContext || this.audioContext.state !== 'running') {
                this.log('AudioContext is not running. Attempting to resume/unlock before recording.', true);
                // Try to resume if suspended
                if (this.audioContext && this.audioContext.state === 'suspended') {
                    try {
                        await this.audioContext.resume();
                        this.log(`AudioContext resumed before recording. New state: ${this.audioContext.state}`);
                    } catch (e) {
                        this.log(`Failed to resume AudioContext before recording: ${e.message}`, true);
                    }
                }
                // Try silent audio play if still not running (especially for mobile)
                if (this.isMobile && (!this.audioContext || this.audioContext.state !== 'running')) {
                     this.log('Attempting silent audio play to unlock before recording...');
                     const silentAudio = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
                     silentAudio.volume = 0;
                     try {
                         await silentAudio.play();
                         this.log('Silent audio played before recording.');
                         if (this.audioContext && this.audioContext.state === 'suspended') await this.audioContext.resume(); // Try resume again
                     } catch (e) {
                         this.log(`Silent audio play failed before recording: ${e.message}`, true);
                     }
                }
                if (!this.audioContext || this.audioContext.state !== 'running') {
                    throw new Error(`AudioContext not running. State: ${this.audioContext?.state}. Cannot start recording.`);
                }
            }
            
            this.log('Requesting microphone access for recording...');
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
            } catch (error) {
                if (error.name === 'NotAllowedError') throw new Error('Microphone permission denied by user.');
                else if (error.name === 'NotFoundError') throw new Error('No microphone found.');
                else throw new Error(`Microphone access error: ${error.message}`);
            }
            
            this.stream = stream;
            this.log('Microphone access granted successfully for recording');
            
            if (this.audioContext && this.audioContext.state === 'running') {
                if (!this.analyser) { // Initialize analyser if not already
                    this.analyser = this.audioContext.createAnalyser();
                    this.analyser.fftSize = 256;
                    const bufferLength = this.analyser.frequencyBinCount;
                    this.dataArray = new Uint8Array(bufferLength);
                    this.log('Audio analyzer components created.');
                }
                // Connect stream to analyser
                const source = this.audioContext.createMediaStreamSource(this.stream);
                source.connect(this.analyser);
                this.log('Audio analyzer source connected.');
            } else {
                this.log('AudioContext not running, VAD will not function.', true);
            }
            
            this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus' });
            this.audioChunks = [];
            this.mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    const audioBuffer = await event.data.arrayBuffer();
                    if (this.callbacks.onAudioData) this.callbacks.onAudioData(this.arrayBufferToBase64(audioBuffer), false);
                }
            };
            this.mediaRecorder.onstart = () => {
                this.state.isRecording = true;
                this.log('MediaRecorder started successfully');
                if (this.callbacks.onAudioStart) this.callbacks.onAudioStart();
                if (this.hapticFeedback) try { this.hapticFeedback.impactOccurred('light'); } catch (e) { this.log(`Haptic feedback error: ${e.message}`, true); }
            };
            this.mediaRecorder.onstop = () => {
                this.state.isRecording = false;
                this.log('MediaRecorder stopped');
                if (this.callbacks.onAudioEnd) this.callbacks.onAudioEnd();
            };
            this.mediaRecorder.onerror = (event) => {
                this.log(`MediaRecorder error: ${event.error}`, true);
                if (this.callbacks.onError) this.callbacks.onError(new Error(`MediaRecorder error: ${event.error}`));
            };
            
            this.mediaRecorder.start(500);
            this.startVADMonitoring();
            this.log('Recording started successfully');
            return true;
        } catch (error) {
            this.log(`Error starting recording: ${error.message}`, true);
            if (this.callbacks.onError) this.callbacks.onError(error);
            return false;
        }
    }
    
    async stopRecording() {
        if (!this.state.isRecording) return true;
        try {
            this.stopVADMonitoring();
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            if (this.callbacks.onAudioData) this.callbacks.onAudioData(null, true); // End of speech
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null;
            }
            // Attempt to disconnect analyser source if it exists and audioContext is valid
            if (this.analyser && this.analyser.numberOfInputs > 0) {
                 // This is tricky as MediaStreamSourceNode doesn't have a direct disconnect without reference
                 // For simplicity, we often rely on the stream stopping or context closing.
                 // If issues arise, a more robust disconnect for the analyser source might be needed.
                 this.log('Analyser source will be disconnected when stream stops or context closes.');
            }
            return true;
        } catch (error) {
            this.log(`Error stopping recording: ${error.message}`, true);
            if (this.callbacks.onError) this.callbacks.onError(error);
            return false;
        }
    }
    
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
    
    checkVAD() {
        if (!this.state.isRecording || !this.analyser || !this.dataArray) return;
        this.analyser.getByteFrequencyData(this.dataArray);
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i];
        const average = this.dataArray.length > 0 ? sum / this.dataArray.length : 0;
        const normalizedEnergy = average / 255;
        this.vad.currentEnergy = (this.vad.currentEnergy * (1 - this.config.vadEnergySmoothing)) + (normalizedEnergy * this.config.vadEnergySmoothing);
        if (this.vad.currentEnergy < this.config.vadSilenceThreshold) {
            if (this.vad.silenceStartTime === 0) this.vad.silenceStartTime = Date.now();
            if ((Date.now() - this.vad.silenceStartTime) >= this.config.vadRequiredSilenceDuration) {
                this.log(`VAD: End of speech detected. Silence: ${Date.now() - this.vad.silenceStartTime}ms`);
                if (this.callbacks.onVADSilenceDetected) this.callbacks.onVADSilenceDetected();
                this.stopRecording();
            }
        } else {
            this.vad.silenceStartTime = 0;
        }
    }
    
    stopVADMonitoring() {
        if (this.vad.monitoringInterval) {
            clearInterval(this.vad.monitoringInterval);
            this.vad.monitoringInterval = null;
            this.log('VAD: Monitoring stopped');
        }
    }
    
    playAudio(audioData, mimeType) {
        try {
            if (!audioData) { this.log('No audio data to play', true); return; }
            if (this.hapticFeedback && !this.state.isPlaying) try { this.hapticFeedback.impactOccurred('light'); } catch (e) { this.log(`Haptic feedback error: ${e.message}`, true); }
            this.state.isPlaying = true;
            if (this.callbacks.onPlaybackStart) this.callbacks.onPlaybackStart();
            this.liveAudioPlayer.playChunk(audioData, mimeType, () => {
                this.state.isPlaying = false;
                if (this.callbacks.onPlaybackEnd) this.callbacks.onPlaybackEnd();
            });
        } catch (error) {
            this.log(`Error playing audio: ${error.message}`, true);
            this.state.isPlaying = false;
            if (this.callbacks.onError) this.callbacks.onError(error);
        }
    }
    
    stopPlayback() {
        this.liveAudioPlayer.stopPlayback();
        this.state.isPlaying = false;
        if (this.callbacks.onPlaybackEnd) this.callbacks.onPlaybackEnd();
    }
    
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return window.btoa(binary);
    }
    
    log(message, isError = false) {
        if (!this.config.debug) return;
        const prefix = '[AudioBridge]';
        if (isError) console.error(`${prefix} ${message}`);
        else console.log(`${prefix} ${message}`);
    }
    
    dispose() {
        this.log('Audio bridge disposing...');
        this.stopRecording();
        this.stopPlayback();
        this.stopVADMonitoring();
        if (this.audioContext && this.audioContext.state !== 'closed' && !this.options.audioContext) { // Only close if not externally provided
            this.audioContext.close().catch(e => this.log(`Error closing audio context: ${e.message}`, true));
            this.log('Internally created AudioContext closed.');
        } else if (this.options.audioContext) {
            this.log('External AudioContext will not be closed by AudioBridge.');
        }
        this.log('Audio bridge disposed');
    }
}

class LiveAudioPlayer {
    constructor() {
        this.audioQueue = [];
        this.isPlaying = false;
        this.currentAudio = null;
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.audioPool = [];
        this.setupMobileOptimizations();
    }
    
    setupMobileOptimizations() {
        for (let i = 0; i < 3; i++) {
            const audio = new Audio();
            audio.preload = 'auto';
            if (this.isMobile) audio.crossOrigin = 'anonymous';
            this.audioPool.push(audio);
        }
    }
    
    async unlockAudio() { // This method is crucial for iOS
        if (!this.isMobile) {
            console.log('[LiveAudioPlayer] Desktop - no explicit unlock needed.');
            return true;
        }
        console.log('[LiveAudioPlayer] 🔓 Attempting to unlock mobile audio...');
        try {
            const audio = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
            audio.volume = 0;
            await audio.play();
            audio.pause();
            console.log('[LiveAudioPlayer] ✅ Mobile audio unlocked successfully (silent play).');
            return true;
        } catch (error) {
            console.warn('[LiveAudioPlayer] ⚠️ Silent play unlock failed:', error.message);
            return false;
        }
    }
    
    playChunk(base64Audio, mimeType, onComplete) {
        try {
            const audioBuffer = this.base64ToArrayBuffer(base64Audio);
            const blob = new Blob([audioBuffer], { type: mimeType });
            const audioUrl = URL.createObjectURL(blob);
            const audio = this.getAudioFromPool();
            audio.volume = this.isMobile ? 0.9 : 1.0;
            if (this.isMobile) audio.playsInline = true;
            audio.src = audioUrl;
            this.audioQueue.push({ audio, url: audioUrl, onComplete });
            if (!this.isPlaying) this.processAudioQueue();
        } catch (error) {
            console.error('[LiveAudioPlayer] Failed to play audio chunk:', error);
            if (onComplete) onComplete();
        }
    }
    
    async processAudioQueue() {
        if (this.audioQueue.length === 0) { this.isPlaying = false; return; }
        this.isPlaying = true;
        const item = this.audioQueue.shift();
        this.currentAudio = item.audio;
        try {
            await new Promise((resolve, reject) => {
                item.audio.onended = resolve;
                item.audio.onerror = (e) => reject(new Error(`Audio playback error: ${e.target.error?.message || 'Unknown error'}`));
                item.audio.play().catch(reject);
            });
        } catch (error) {
            console.error('[LiveAudioPlayer] Playback error in queue:', error.message);
        } finally {
            URL.revokeObjectURL(item.url);
            this.returnAudioToPool(item.audio);
            this.currentAudio = null;
            if (item.onComplete) item.onComplete();
            this.processAudioQueue(); // Process next
        }
    }
    
    getAudioFromPool() {
        if (this.audioPool.length > 0) return this.audioPool.shift();
        const audio = new Audio();
        audio.preload = 'auto';
        if (this.isMobile) audio.crossOrigin = 'anonymous';
        return audio;
    }
    
    returnAudioToPool(audio) {
        audio.onended = null; audio.onerror = null; audio.src = '';
        if (this.audioPool.length < 5) this.audioPool.push(audio);
    }
    
    stopPlayback() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            // URL is revoked and audio returned to pool in processAudioQueue's finally block
        }
        this.audioQueue.forEach(item => { // Clear pending queue
            URL.revokeObjectURL(item.url);
            this.returnAudioToPool(item.audio);
            if (item.onComplete) item.onComplete();
        });
        this.audioQueue = [];
        this.isPlaying = false;
    }
    
    base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
        return bytes.buffer;
    }
}

window.TelegramAudioBridge = TelegramAudioBridge;
