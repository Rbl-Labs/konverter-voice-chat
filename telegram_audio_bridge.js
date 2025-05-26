/**
 * Enhanced TelegramAudioBridge with improved mobile compatibility and error handling
 * Version: 2.0.0 
 */

class TelegramAudioBridge {
    constructor(options = {}) {
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
            maxRetries: options.maxRetries || 3,
            retryDelay: options.retryDelay || 1000,
            audioTimeout: options.audioTimeout || 10000,
            ...options
        };

        // Enhanced state management
        this.state = {
            initialized: false,
            isRecording: false,
            isPlaying: false,
            isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
            audioUnlocked: false,
            recordingStartTime: null,
            playbackQueue: [],
            currentAudio: null,
            initializationAttempts: 0,
            maxInitializationAttempts: 3
        };
        
        // Telegram integration
        this.telegram = {
            webApp: window.Telegram?.WebApp,
            hapticFeedback: window.Telegram?.WebApp?.HapticFeedback,
            isAvailable: typeof window.Telegram !== 'undefined'
        };
        
        // Audio components
        this.audio = {
            context: null,
            mediaRecorder: null,
            audioStream: null,
            audioPool: [],
            worklet: null,
            analyser: null,
            dataArray: null
        };
        
        // VAD (Voice Activity Detection) components
        this.vad = {
            currentEnergy: 0.0,
            silenceStartTime: 0,
            monitoringInterval: null,
            isMonitoring: false
        };
        
        // Event callbacks with error handling
        this.callbacks = {
            onAudioStart: this.safeCallback(options.onAudioStart),
            onAudioEnd: this.safeCallback(options.onAudioEnd),
            onAudioData: this.safeCallback(options.onAudioData),
            onPlaybackStart: this.safeCallback(options.onPlaybackStart),
            onPlaybackEnd: this.safeCallback(options.onPlaybackEnd),
            onVADSilenceDetected: this.safeCallback(options.onVADSilenceDetected),
            onError: this.safeCallback(options.onError, (error) => console.error('TelegramAudioBridge error:', error))
        };
        
        this.log('Enhanced TelegramAudioBridge initialized', {
            mobile: this.state.isMobile,
            telegramAvailable: this.telegram.isAvailable,
            config: this.config
        });
        
        // Setup Telegram optimizations
        this._setupTelegramOptimizations();
        
        // Create audio pool
        this._createAudioPool();
        
        // Auto-initialize on first user interaction if mobile
        if (this.state.isMobile) {
            this._setupAutoInitialization();
        }
    }
    
    safeCallback(callback, defaultCallback = null) {
        return (...args) => {
            try {
                if (typeof callback === 'function') {
                    return callback(...args);
                } else if (typeof defaultCallback === 'function') {
                    return defaultCallback(...args);
                }
            } catch (error) {
                this.log('Callback error:', error, true);
            }
        };
    }
    
    async initialize() {
        if (this.state.initialized) return true;
        
        this.state.initializationAttempts++;
        
        if (this.state.initializationAttempts > this.state.maxInitializationAttempts) {
            const error = new Error('Maximum initialization attempts exceeded');
            this.handleError(error);
            return false;
        }
        
        try {
            this.log(`Initialization attempt ${this.state.initializationAttempts}/${this.state.maxInitializationAttempts}`);
            
            // Create audio context with mobile optimization
            await this._createAudioContext();
            
            // Unlock audio on mobile
            if (this.state.isMobile) {
                const unlocked = await this._unlockAudioOnMobile();
                if (!unlocked) {
                    throw new Error('Failed to unlock audio on mobile device');
                }
            }
            
            // Request microphone permissions with enhanced constraints
            await this._requestMicrophoneAccess();
            
            // Setup audio analysis for VAD
            this._setupAudioAnalysis();
            
            this.state.initialized = true;
            this.log('Enhanced TelegramAudioBridge successfully initialized');
            return true;
            
        } catch (error) {
            this.log('Initialization failed:', error, true);
            this.handleError(error);
            
            // Retry after delay if not max attempts
            if (this.state.initializationAttempts < this.state.maxInitializationAttempts) {
                setTimeout(() => {
                    this.log(`Retrying initialization in ${this.config.retryDelay}ms...`);
                    this.initialize();
                }, this.config.retryDelay);
            }
            
            return false;
        }
    }
    
    async _createAudioContext() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            
            // Enhanced audio context options for mobile
            const contextOptions = {
                latencyHint: 'interactive',
                sampleRate: this.config.sampleRate
            };
            
            // Additional mobile optimizations
            if (this.state.isMobile) {
                contextOptions.latencyHint = 'playback'; // Better for mobile
            }
            
            // Create audio context
            this.audio.context = new AudioContext(contextOptions);
            
            // Mobile Safari requires user interaction to resume audio context
            if (this.state.isMobile && this.audio.context.state === 'suspended') {
                document.addEventListener('touchstart', async () => {
                    if (this.audio.context.state === 'suspended') {
                        await this.audio.context.resume();
                        this.log('Audio context resumed after user interaction');
                    }
                }, { once: true });
            }
            
            this.log('Audio context created successfully', {
                state: this.audio.context.state,
                sampleRate: this.audio.context.sampleRate
            });
            
        } catch (error) {
            throw new Error(`Failed to create audio context: ${error.message}`);
        }
    }
    
    async _requestMicrophoneAccess() {
        try {
            // Enhanced constraints for better mobile compatibility
            const constraints = {
                audio: {
                    channelCount: this.config.channels,
                    sampleRate: { ideal: this.config.sampleRate },
                    echoCancellation: this.config.enableEchoCancellation,
                    noiseSuppression: this.config.enableNoiseSuppression,
                    autoGainControl: this.config.enableAutoGainControl,
                    latency: { ideal: 0.01 },
                    volume: { ideal: 1.0 }
                }
            };
            
            // Additional mobile constraints
            if (this.state.isMobile) {
                constraints.audio.googEchoCancellation = true;
                constraints.audio.googAutoGainControl = true;
                constraints.audio.googNoiseSuppression = true;
                constraints.audio.googHighpassFilter = true;
            }
            
            this.audio.audioStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            this.log('Microphone access granted', {
                tracks: this.audio.audioStream.getTracks().length,
                settings: this.audio.audioStream.getTracks()[0]?.getSettings()
            });
            
        } catch (error) {
            throw new Error(`Failed to access microphone: ${error.message}`);
        }
    }
    
    _setupAudioAnalysis() {
        try {
            this.audio.analyser = this.audio.context.createAnalyser();
            this.audio.analyser.fftSize = 256;
            this.audio.dataArray = new Uint8Array(this.audio.analyser.frequencyBinCount);
            
            this.log('Audio analysis setup completed');
        } catch (error) {
            this.log('Audio analysis setup failed:', error, true);
        }
    }
    
    async startRecording() {
        try {
            if (!this.state.initialized) {
                const initialized = await this.initialize();
                if (!initialized) return false;
            }
            
            if (this.state.isRecording) return true;
            
            this.log('Starting enhanced recording...');
            
            // Resume audio context if suspended
            if (this.audio.context.state === 'suspended') {
                await this.audio.context.resume();
            }
            
            // Connect microphone to analyzer for VAD
            const source = this.audio.context.createMediaStreamSource(this.audio.audioStream);
            source.connect(this.audio.analyser);
            
            // Create media recorder with enhanced options
            const mimeTypes = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus',
                'audio/mp4'
            ];
            
            let selectedMimeType = null;
            for (const mimeType of mimeTypes) {
                if (MediaRecorder.isTypeSupported(mimeType)) {
                    selectedMimeType = mimeType;
                    break;
                }
            }
            
            if (!selectedMimeType) {
                throw new Error('No supported audio format found');
            }
            
            const recorderOptions = {
                mimeType: selectedMimeType
            };
            
            // Mobile-specific optimizations
            if (this.state.isMobile) {
                recorderOptions.audioBitsPerSecond = 32000; // Lower bitrate for mobile
            }
            
            this.audio.mediaRecorder = new MediaRecorder(this.audio.audioStream, recorderOptions);
            
            // Enhanced data handling
            this.audio.mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    try {
                        const buffer = await event.data.arrayBuffer();
                        const base64Audio = this._arrayBufferToBase64(buffer);
                        this.callbacks.onAudioData(base64Audio, false);
                    } catch (error) {
                        this.log('Error processing audio data:', error, true);
                    }
                }
            };
            
            this.audio.mediaRecorder.onerror = (event) => {
                this.log('MediaRecorder error:', event.error, true);
                this.handleError(event.error);
            };
            
            this.audio.mediaRecorder.onstop = () => {
                this.log('MediaRecorder stopped');
                this.callbacks.onAudioData(null, true); // Signal end of speech
                this.callbacks.onAudioEnd();
            };
            
            // Start recording with optimized time slice
            const timeSlice = this.state.isMobile ? 1000 : 500; // Larger chunks for mobile
            this.audio.mediaRecorder.start(timeSlice);
            
            this.state.isRecording = true;
            this.state.recordingStartTime = Date.now();
            
            // Start VAD monitoring
            this._startVADMonitoring();
            
            // Provide haptic feedback
            this._triggerHapticFeedback('medium');
            
            this.callbacks.onAudioStart();
            this.log('Recording started successfully', {
                mimeType: selectedMimeType,
                timeSlice: timeSlice
            });
            
            return true;
            
        } catch (error) {
            this.log('Failed to start recording:', error, true);
            this.handleError(error);
            return false;
        }
    }
    
    async stopRecording() {
        if (!this.state.isRecording) return true;
        
        try {
            this.log('Stopping recording...');
            
            // Stop VAD monitoring
            this._stopVADMonitoring();
            
            // Stop media recorder
            if (this.audio.mediaRecorder && this.audio.mediaRecorder.state !== 'inactive') {
                this.audio.mediaRecorder.stop();
            } else {
                // Manual cleanup if recorder already stopped
                this.callbacks.onAudioData(null, true);
                this.callbacks.onAudioEnd();
            }
            
            this.state.isRecording = false;
            
            const recordingDuration = Date.now() - this.state.recordingStartTime;
            this.log('Recording stopped', { duration: recordingDuration + 'ms' });
            
            // Provide haptic feedback
            this._triggerHapticFeedback('light');
            
            return true;
            
        } catch (error) {
            this.log('Error stopping recording:', error, true);
            this.handleError(error);
            return false;
        }
    }
    
    async playAudio(base64Audio, mimeType = 'audio/pcm;rate=24000') {
        try {
            if (!base64Audio || base64Audio.length === 0) {
                this.log('Empty audio data provided');
                return false;
            }
            
            this.log('Playing audio', {
                mimeType: mimeType,
                dataLength: base64Audio.length
            });
            
            // Convert base64 to array buffer
            const audioBuffer = this._base64ToArrayBuffer(base64Audio);
            
            // Create blob with appropriate MIME type
            let finalMimeType = mimeType;
            
            // Mobile compatibility adjustments
            if (this.state.isMobile && mimeType.includes('pcm')) {
                finalMimeType = 'audio/wav'; // Better mobile support
            }
            
            const blob = new Blob([audioBuffer], { type: finalMimeType });
            const audioUrl = URL.createObjectURL(blob);
            
            // Get audio element from pool
            const audio = this._getAudioFromPool();
            
            // Enhanced audio configuration
            this._configureAudioElement(audio);
            
            audio.src = audioUrl;
            
            // Add to playback queue
            this.state.playbackQueue.push({
                audio: audio,
                url: audioUrl,
                timestamp: Date.now(),
                mimeType: finalMimeType
            });
            
            // Start playback if not already playing
            if (!this.state.isPlaying) {
                this._processPlaybackQueue();
            }
            
            return true;
            
        } catch (error) {
            this.log('Audio playback error:', error, true);
            this.handleError(error);
            return false;
        }
    }
    
    _configureAudioElement(audio) {
        // Reset audio element
        audio.currentTime = 0;
        audio.playbackRate = 1.0;
        
        // Mobile-specific configuration
        if (this.state.isMobile) {
            audio.volume = 0.9; // Slightly lower for mobile speakers
            audio.playsInline = true;
            audio.preload = 'auto';
            audio.crossOrigin = 'anonymous';
        } else {
            audio.volume = 1.0;
            audio.preload = 'auto';
        }
        
        // Enhanced error handling
        audio.addEventListener('error', (e) => {
            this.log('Audio element error:', {
                error: e.target.error,
                networkState: e.target.networkState,
                readyState: e.target.readyState
            }, true);
        });
        
        audio.addEventListener('stalled', () => {
            this.log('Audio playback stalled', false);
        });
        
        audio.addEventListener('waiting', () => {
            this.log('Audio waiting for data', false);
        });
    }
    
    async _processPlaybackQueue() {
        if (this.state.playbackQueue.length === 0) {
            this.state.isPlaying = false;
            this.callbacks.onPlaybackEnd();
            return;
        }
        
        this.state.isPlaying = true;
        const audioItem = this.state.playbackQueue.shift();
        this.state.currentAudio = audioItem.audio;
        
        // Provide haptic feedback for first audio chunk
        if (this.state.playbackQueue.length === 0) {
            this._triggerHapticFeedback('light');
            this.callbacks.onPlaybackStart();
        }
        
        try {
            await this._playAudioItem(audioItem);
            this._processPlaybackQueue(); // Continue with next item
            
        } catch (error) {
            this.log('Playback error:', error, true);
            this._cleanupAudioItem(audioItem);
            this._processPlaybackQueue(); // Try next item
        }
    }
    
    async _playAudioItem(audioItem, retryCount = 0) {
        const maxRetries = this.config.maxRetries;
        
        return new Promise((resolve, reject) => {
            const audio = audioItem.audio;
            const cleanup = () => {
                URL.revokeObjectURL(audioItem.url);
                this._returnAudioToPool(audio);
                this.state.currentAudio = null;
            };
            
            // Timeout handling
            const timeoutId = setTimeout(() => {
                cleanup();
                reject(new Error('Audio playback timeout'));
            }, this.config.audioTimeout);
            
            audio.onended = () => {
                clearTimeout(timeoutId);
                cleanup();
                resolve();
            };
            
            audio.onerror = (e) => {
                clearTimeout(timeoutId);
                this.log('Audio playback error:', e.target.error, true);
                
                if (retryCount < maxRetries) {
                    this.log(`Retrying playback (${retryCount + 1}/${maxRetries})`);
                    setTimeout(() => {
                        this._playAudioItem(audioItem, retryCount + 1)
                            .then(resolve)
                            .catch(reject);
                    }, this.config.retryDelay);
                } else {
                    cleanup();
                    reject(new Error('Audio playback failed after retries'));
                }
            };
            
            // Attempt to play
            const playPromise = audio.play();
            
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    this.log('audio.play() rejected:', err, true);
                    if (retryCount >= maxRetries) {
                        clearTimeout(timeoutId);
                        cleanup();
                        reject(err);
                    }
                });
            }
        });
    }
    
    stopPlayback() {
        this.log('Stopping all playback');
        
        // Stop current audio
        if (this.state.currentAudio) {
            this.state.currentAudio.pause();
            this.state.currentAudio.currentTime = 0;
            this._returnAudioToPool(this.state.currentAudio);
            this.state.currentAudio = null;
        }
        
        // Clear queue
        for (const item of this.state.playbackQueue) {
            this._cleanupAudioItem(item);
        }
        
        this.state.playbackQueue = [];
        this.state.isPlaying = false;
        this.callbacks.onPlaybackEnd();
    }
    
    _cleanupAudioItem(item) {
        if (item.url) URL.revokeObjectURL(item.url);
        if (item.audio) this._returnAudioToPool(item.audio);
    }
    
    // VAD (Voice Activity Detection) methods
    _startVADMonitoring() {
        this._stopVADMonitoring();
        this.vad.silenceStartTime = 0;
        this.vad.currentEnergy = 0.0;
        this.vad.isMonitoring = true;
        
        if (!this.audio.analyser) {
            this.log('VAD: Analyser not ready');
            return;
        }
        
        this.log(`VAD: Starting monitoring. Threshold: ${this.config.vadSilenceThreshold}, Duration: ${this.config.vadRequiredSilenceDuration}ms`);
        
        this.vad.monitoringInterval = setInterval(() => {
            this._checkVAD();
        }, 100);
    }
    
    _checkVAD() {
        if (!this.state.isRecording || !this.audio.analyser || !this.audio.dataArray || !this.vad.isMonitoring) {
            return;
        }
        
        try {
            this.audio.analyser.getByteFrequencyData(this.audio.dataArray);
            
            let sum = 0;
            for (let i = 0; i < this.audio.dataArray.length; i++) {
                sum += this.audio.dataArray[i];
            }
            
            const average = this.audio.dataArray.length > 0 ? sum / this.audio.dataArray.length : 0;
            const normalizedEnergy = average / 255;
            
            // Smooth the energy value
            this.vad.currentEnergy = (this.vad.currentEnergy * (1 - this.config.vadEnergySmoothing)) + 
                                   (normalizedEnergy * this.config.vadEnergySmoothing);
            
            // Check for silence
            if (this.vad.currentEnergy < this.config.vadSilenceThreshold) {
                if (this.vad.silenceStartTime === 0) {
                    this.vad.silenceStartTime = Date.now();
                }
                
                const silenceDuration = Date.now() - this.vad.silenceStartTime;
                if (silenceDuration >= this.config.vadRequiredSilenceDuration) {
                    this.log(`VAD: End of speech detected. Silence: ${silenceDuration}ms`);
                    this.callbacks.onVADSilenceDetected();
                    this.stopRecording();
                }
            } else {
                this.vad.silenceStartTime = 0;
            }
            
        } catch (error) {
            this.log('VAD check error:', error, true);
        }
    }
    
    _stopVADMonitoring() {
        if (this.vad.monitoringInterval) {
            clearInterval(this.vad.monitoringInterval);
            this.vad.monitoringInterval = null;
            this.vad.isMonitoring = false;
            this.log('VAD: Monitoring stopped');
        }
    }
    
    // Telegram integration methods
    _setupTelegramOptimizations() {
        if (!this.telegram.isAvailable) {
            this.log('Telegram WebApp context not available');
            return;
        }
        
        try {
            this.telegram.webApp.ready();
            this.telegram.webApp.expand();
            
            this.log('Telegram WebApp optimizations enabled');
            
            // Handle viewport changes
            this.telegram.webApp.onEvent?.('viewportChanged', (eventData) => {
                if (eventData.isStateStable) {
                    this.log(`Telegram viewport changed: ${this.telegram.webApp.viewportStableHeight}x${window.innerWidth}`);
                }
            });
            
            // Handle theme changes
            this.telegram.webApp.onEvent?.('themeChanged', () => {
                this.log('Telegram theme changed');
            });
            
        } catch (error) {
            this.log('Error setting up Telegram WebApp features:', error, true);
        }
    }
    
    _setupAutoInitialization() {
        // Auto-initialize on first user interaction for mobile
        const initOnInteraction = () => {
            if (!this.state.initialized) {
                this.log('Auto-initializing on user interaction');
                this.initialize();
            }
            // Remove listeners after first interaction
            document.removeEventListener('touchstart', initOnInteraction);
            document.removeEventListener('click', initOnInteraction);
        };
        
        document.addEventListener('touchstart', initOnInteraction, { once: true });
        document.addEventListener('click', initOnInteraction, { once: true });
    }
    
    async _unlockAudioOnMobile() {
        if (!this.state.isMobile || this.state.audioUnlocked) return true;
        
        this.log('Attempting to unlock audio on mobile...');
        
        const unlockMethods = [
            () => this._unlockWithSilentAudio(),
            () => this._unlockWithAudioContext(),
            () => this._unlockWithUserGesture()
        ];
        
        for (const method of unlockMethods) {
            try {
                const success = await method();
                if (success) {
                    this.state.audioUnlocked = true;
                    this.log('Mobile audio unlocked successfully');
                    return true;
                }
            } catch (error) {
                this.log('Audio unlock method failed:', error, false);
            }
        }
        
        this.log('All audio unlock methods failed', true);
        return false;
    }
    
    async _unlockWithSilentAudio() {
        const audio = new Audio();
        audio.volume = 0;
        audio.src = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
        
        try {
            await audio.play();
            audio.pause();
            audio.currentTime = 0;
            return true;
        } catch (error) {
            return false;
        }
    }
    
    async _unlockWithAudioContext() {
        if (!this.audio.context) return false;
        
        try {
            const buffer = this.audio.context.createBuffer(1, 1, 22050);
            const source = this.audio.context.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audio.context.destination);
            source.start(0);
            
            return this.audio.context.state === 'running';
        } catch (error) {
            return false;
        }
    }
    
    async _unlockWithUserGesture() {
        // This requires an actual user gesture, so it may not work in all contexts
        return new Promise((resolve) => {
            const handler = async () => {
                try {
                    if (this.audio.context && this.audio.context.state === 'suspended') {
                        await this.audio.context.resume();
                    }
                    resolve(this.audio.context?.state === 'running');
                } catch (error) {
                    resolve(false);
                }
                document.removeEventListener('touchstart', handler);
                document.removeEventListener('click', handler);
            };
            
            document.addEventListener('touchstart', handler, { once: true });
            document.addEventListener('click', handler, { once: true });
            
            // Timeout after 5 seconds
            setTimeout(() => resolve(false), 5000);
        });
    }
    
    // Audio pool management
    _createAudioPool() {
        const poolSize = this.state.isMobile ? 2 : 3; // Smaller pool for mobile
        
        for (let i = 0; i < poolSize; i++) {
            const audio = new Audio();
            audio.preload = 'auto';
            
            if (this.state.isMobile) {
                audio.playsInline = true;
                audio.crossOrigin = 'anonymous';
            }
            
            this.audio.audioPool.push(audio);
        }
        
        this.log(`Created audio pool with ${poolSize} elements`);
    }
    
    _getAudioFromPool() {
        if (this.audio.audioPool.length > 0) {
            return this.audio.audioPool.shift();
        }
        
        // Create new if pool is empty
        const audio = new Audio();
        audio.preload = 'auto';
        if (this.state.isMobile) {
            audio.playsInline = true;
            audio.crossOrigin = 'anonymous';
        }
        return audio;
    }
    
    _returnAudioToPool(audio) {
        // Clean up the audio element
        audio.onended = null;
        audio.onerror = null;
        audio.src = '';
        audio.load(); // Reset the element
        
        // Return to pool if not too large
        if (this.audio.audioPool.length < 5) {
            this.audio.audioPool.push(audio);
        }
    }
    
    // Utility methods
    _arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
    
    _base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
    
    _triggerHapticFeedback(type = 'light') {
        if (!this.config.hapticFeedbackEnabled || !this.telegram.hapticFeedback) return;
        
        try {
            switch (type) {
                case 'light':
                    this.telegram.hapticFeedback.impactOccurred('light');
                    break;
                case 'medium':
                    this.telegram.hapticFeedback.impactOccurred('medium');
                    break;
                case 'heavy':
                    this.telegram.hapticFeedback.impactOccurred('heavy');
                    break;
                case 'selection':
                    this.telegram.hapticFeedback.selectionChanged();
                    break;
                case 'success':
                    this.telegram.hapticFeedback.notificationOccurred('success');
                    break;
                case 'warning':
                    this.telegram.hapticFeedback.notificationOccurred('warning');
                    break;
                case 'error':
                    this.telegram.hapticFeedback.notificationOccurred('error');
                    break;
            }
        } catch (error) {
            this.log('Haptic feedback error:', error, false);
        }
    }
    
    // Error handling
    handleError(error) {
        this.log('AudioBridge error:', error, true);
        this.callbacks.onError(error);
        
        // Global debug integration
        if (typeof window.debugLog === 'function') {
            window.debugLog(`[AudioBridge] Error: ${error.message}`, true, error);
        }
    }
    
    // Cleanup and disposal
    dispose() {
        this.log('Disposing Enhanced TelegramAudioBridge...');
        
        // Stop all activities
        this.stopRecording();
        this.stopPlayback();
        
        // Stop VAD monitoring
        this._stopVADMonitoring();
        
        // Close audio context
        if (this.audio.context && this.audio.context.state !== 'closed') {
            this.audio.context.close().catch(e => 
                this.log('Error closing AudioContext:', e, false)
            );
        }
        
        // Stop audio stream
        if (this.audio.audioStream) {
            this.audio.audioStream.getTracks().forEach(track => track.stop());
            this.audio.audioStream = null;
        }
        
        // Clear audio pool
        this.audio.audioPool = [];
        
        this.state.initialized = false;
        this.log('Enhanced TelegramAudioBridge disposed');
    }
    
    // Logging
    log(message, data = null, isError = false) {
        if (this.config.debug) {
            const logMethod = isError ? console.error : console.log;
            logMethod('[Enhanced TelegramAudioBridge]', message, data || '');
            
            // Global debug integration
            if (typeof window.debugLog === 'function') {
                window.debugLog(`[AudioBridge] ${message}`, isError, data);
            }
        }
    }
    
    // Public getters
    get isRecording() {
        return this.state.isRecording;
    }
    
    get isPlaying() {
        return this.state.isPlaying;
    }
    
    get audioUnlocked() {
        return this.state.audioUnlocked;
    }
    
    get initialized() {
        return this.state.initialized;
    }
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TelegramAudioBridge;
} else if (typeof define === 'function' && define.amd) {
    define([], function() { return TelegramAudioBridge; });
} else {
    window.TelegramAudioBridge = TelegramAudioBridge;
}
