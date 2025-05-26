/**
 * Modern TelegramAudioBridge with enhanced mobile compatibility and permission handling
 * Version: 3.0.0
 */

class TelegramAudioBridge {
    constructor(options = {}) {
        this.config = {
            debug: options.debug || false,
            audioBufferSize: options.audioBufferSize || 4096,
            sampleRate: options.sampleRate || 16000,
            outputSampleRate: options.outputSampleRate || 24000, // Gemini outputs at 24kHz
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
            permissionTimeout: options.permissionTimeout || 15000,
            ...options
        };

        // Enhanced state management
        this.state = {
            initialized: false,
            isRecording: false,
            isPlaying: false,
            isMobile: this._detectMobileDevice(),
            isIOS: this._detectIOSDevice(),
            audioUnlocked: false,
            permissionState: 'unknown', // 'unknown', 'granted', 'denied', 'prompt'
            recordingStartTime: null,
            playbackQueue: [],
            currentAudio: null,
            initializationAttempts: 0,
            maxInitializationAttempts: 3,
            permissionPromptDisplayed: false
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
            dataArray: null,
            gainNode: null
        };
        
        // VAD (Voice Activity Detection) components
        this.vad = {
            currentEnergy: 0.0,
            silenceStartTime: 0,
            monitoringInterval: null,
            isMonitoring: false,
            consecutiveSilenceFrames: 0,
            minSilenceFrames: Math.ceil(this.config.vadRequiredSilenceDuration / 100) // 100ms per frame
        };
        
        // Event callbacks with error handling
        this.callbacks = {
            onAudioStart: this.safeCallback(options.onAudioStart),
            onAudioEnd: this.safeCallback(options.onAudioEnd),
            onAudioData: this.safeCallback(options.onAudioData),
            onPlaybackStart: this.safeCallback(options.onPlaybackStart),
            onPlaybackEnd: this.safeCallback(options.onPlaybackEnd),
            onVADSilenceDetected: this.safeCallback(options.onVADSilenceDetected),
            onPermissionChange: this.safeCallback(options.onPermissionChange),
            onError: this.safeCallback(options.onError, (error) => console.error('TelegramAudioBridge error:', error))
        };
        
        this.log('Modern TelegramAudioBridge initialized', {
            mobile: this.state.isMobile,
            ios: this.state.isIOS,
            telegramAvailable: this.telegram.isAvailable,
            config: this.config
        });
        
        // Setup Telegram optimizations
        this._setupTelegramOptimizations();
        
        // Create audio pool
        this._createAudioPool();
        
        // Check permission status immediately
        this._checkPermissionStatus();
        
        // Auto-initialize on first user interaction
        this._setupAutoInitialization();
    }
    
    /**
     * Safe callback wrapper to prevent errors
     */
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
    
    /**
     * Initialize the audio bridge
     * This is the main entry point for setting up audio
     */
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
            
            // Check permission status
            await this._checkPermissionStatus();
            
            // If permission is denied, show guidance
            if (this.state.permissionState === 'denied') {
                this._showPermissionGuidance();
                throw new Error('Microphone permission denied');
            }
            
            // If permission is unknown or prompt, request it
            if (this.state.permissionState === 'unknown' || this.state.permissionState === 'prompt') {
                const permissionGranted = await this._requestMicrophoneAccess();
                if (!permissionGranted) {
                    throw new Error('Failed to get microphone permission');
                }
            }
            
            // Unlock audio on mobile
            if (this.state.isMobile) {
                const unlocked = await this._unlockAudioOnMobile();
                if (!unlocked) {
                    throw new Error('Failed to unlock audio on mobile device');
                }
            }
            
            // Setup audio analysis for VAD
            this._setupAudioAnalysis();
            
            this.state.initialized = true;
            this.log('Modern TelegramAudioBridge successfully initialized');
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
    
    /**
     * Create the audio context with appropriate settings
     */
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
            
            // Create gain node for volume control
            this.audio.gainNode = this.audio.context.createGain();
            this.audio.gainNode.gain.value = 1.0;
            this.audio.gainNode.connect(this.audio.context.destination);
            
            // Resume audio context if suspended
            if (this.audio.context.state === 'suspended') {
                try {
                    await this.audio.context.resume();
                    this.log('Audio context resumed during creation');
                } catch (e) {
                    this.log('Could not resume audio context during creation, will try later', false);
                }
            }
            
            this.log('Audio context created successfully', {
                state: this.audio.context.state,
                sampleRate: this.audio.context.sampleRate
            });
            
        } catch (error) {
            throw new Error(`Failed to create audio context: ${error.message}`);
        }
    }
    
    /**
     * Check the current microphone permission status
     */
    async _checkPermissionStatus() {
        try {
            // Only available in secure contexts and modern browsers
            if (navigator.permissions && navigator.permissions.query) {
                const result = await navigator.permissions.query({ name: 'microphone' });
                this.state.permissionState = result.state;
                
                // Listen for permission changes
                result.onchange = () => {
                    this.state.permissionState = result.state;
                    this.log(`Permission state changed to: ${result.state}`);
                    this.callbacks.onPermissionChange(result.state);
                };
                
                this.log(`Current microphone permission state: ${this.state.permissionState}`);
                return this.state.permissionState;
            } else {
                // Fallback for browsers that don't support permissions API
                this.log('Permissions API not available, assuming permission prompt required');
                this.state.permissionState = 'prompt';
                return 'prompt';
            }
        } catch (error) {
            this.log('Error checking permission status:', error, false);
            this.state.permissionState = 'unknown';
            return 'unknown';
        }
    }
    
    /**
     * Show guidance for enabling microphone permissions
     * This is platform-specific
     */
    _showPermissionGuidance() {
        if (this.state.permissionPromptDisplayed) return;
        
        let message = 'Microphone access is required for voice chat. ';
        
        if (this.state.isIOS) {
            message += 'On iOS, tap the "AA" button in the address bar, then select "Website Settings" and enable the microphone.';
        } else if (this.state.isMobile) {
            message += 'Please check your browser settings to allow microphone access for this site.';
        } else {
            message += 'Please click the camera/microphone icon in your browser\'s address bar and allow access.';
        }
        
        // Use Telegram's native alert if available
        if (this.telegram.webApp && this.telegram.webApp.showAlert) {
            this.telegram.webApp.showAlert(message);
        } else {
            alert(message);
        }
        
        this.state.permissionPromptDisplayed = true;
    }
    
    /**
     * Request microphone access with enhanced error handling
     */
    async _requestMicrophoneAccess() {
        try {
            this.log('Explicitly requesting microphone permission...');
            
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
                },
                video: false // Explicitly set video to false
            };
            
            // Additional mobile constraints
            if (this.state.isMobile) {
                constraints.audio.googEchoCancellation = true;
                constraints.audio.googAutoGainControl = true;
                constraints.audio.googNoiseSuppression = true;
                constraints.audio.googHighpassFilter = true;
            }
            
            // Create a timeout promise
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Permission request timed out')), this.config.permissionTimeout);
            });
            
            // Force immediate permission prompt by directly calling getUserMedia
            let permissionPromise;
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                this.log('Using navigator.mediaDevices.getUserMedia for permissions');
                permissionPromise = navigator.mediaDevices.getUserMedia(constraints);
            } else if (navigator.getUserMedia) {
                // Legacy API fallback
                this.log('Using legacy navigator.getUserMedia API');
                permissionPromise = new Promise((resolve, reject) => {
                    navigator.getUserMedia(constraints, resolve, reject);
                });
            } else {
                throw new Error('No getUserMedia support available on this browser');
            }
            
            // Race the permission request against the timeout
            this.audio.audioStream = await Promise.race([permissionPromise, timeoutPromise]);
            
            // Update permission state
            this.state.permissionState = 'granted';
            this.callbacks.onPermissionChange('granted');
            
            this.log('Microphone access granted', {
                tracks: this.audio.audioStream.getTracks().length,
                settings: this.audio.audioStream.getTracks()[0]?.getSettings()
            });
            
            return true;
            
        } catch (error) {
            // Specific error handling for permission denials
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                this.log('Microphone permission explicitly denied by user', true);
                this.state.permissionState = 'denied';
                this.callbacks.onPermissionChange('denied');
                this._showPermissionGuidance();
                throw new Error('Microphone permission denied by user. Please check browser settings.');
            } else if (error.message === 'Permission request timed out') {
                this.log('Microphone permission request timed out', true);
                throw new Error('Permission request timed out. Please try again.');
            } else {
                this.log(`Failed to access microphone: ${error.message}`, true);
                throw new Error(`Failed to access microphone: ${error.message}`);
            }
            
            return false;
        }
    }
    
    /**
     * Setup audio analysis for VAD
     */
    _setupAudioAnalysis() {
        try {
            this.audio.analyser = this.audio.context.createAnalyser();
            this.audio.analyser.fftSize = 1024; // Increased for better frequency resolution
            this.audio.analyser.smoothingTimeConstant = 0.8; // Smoother analysis
            this.audio.dataArray = new Uint8Array(this.audio.analyser.frequencyBinCount);
            
            this.log('Audio analysis setup completed');
        } catch (error) {
            this.log('Audio analysis setup failed:', error, true);
        }
    }
    
    /**
     * Start recording audio
     */
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
                this.log('Audio context resumed before recording');
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
    
    /**
     * Stop recording audio
     */
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
    
    /**
     * Play audio from base64 string
     * Enhanced to handle Gemini's 24kHz PCM audio output
     */
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
            
            // Check if this is PCM audio from Gemini (which needs special handling)
            if (mimeType.includes('pcm')) {
                return this._playPCMAudio(audioBuffer, mimeType);
            }
            
            // For other formats (WAV, MP3, etc.), use standard audio element playback
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
    
    /**
     * Play PCM audio using Web Audio API
     * Specifically designed for Gemini's 24kHz PCM output
     */
    async _playPCMAudio(audioBuffer, mimeType) {
        try {
            // Extract sample rate from mime type (default to 24000 for Gemini)
            const sampleRateMatch = mimeType.match(/rate=(\d+)/);
            const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1]) : this.config.outputSampleRate;
            
            this.log(`Playing PCM audio with sample rate: ${sampleRate}Hz`);
            
            // Resume audio context if suspended
            if (this.audio.context.state === 'suspended') {
                await this.audio.context.resume();
            }
            
            // Convert the raw PCM buffer to an AudioBuffer
            const audioArrayBuffer = audioBuffer.buffer;
            const pcmData = new Int16Array(audioArrayBuffer);
            
            // Convert Int16Array to Float32Array for Web Audio API
            const floatData = new Float32Array(pcmData.length);
            for (let i = 0; i < pcmData.length; i++) {
                // Convert from 16-bit integer to float
                floatData[i] = pcmData[i] / 32768.0;
            }
            
            // Create an AudioBuffer with the correct sample rate
            const audioCtxBuffer = this.audio.context.createBuffer(1, floatData.length, sampleRate);
            
            // Fill the AudioBuffer with our float data
            const channelData = audioCtxBuffer.getChannelData(0);
            channelData.set(floatData);
            
            // Create a source node
            const source = this.audio.context.createBufferSource();
            source.buffer = audioCtxBuffer;
            
            // Connect to gain node for volume control
            source.connect(this.audio.gainNode);
            
            // Set up callbacks
            this.callbacks.onPlaybackStart();
            this.state.isPlaying = true;
            
            source.onended = () => {
                this.state.isPlaying = false;
                this.callbacks.onPlaybackEnd();
            };
            
            // Start playback
            source.start();
            this._triggerHapticFeedback('light');
            
            return true;
        } catch (error) {
            this.log('PCM audio playback error:', error, true);
            return false;
        }
    }
    
    /**
     * Configure audio element for playback
     */
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
    
    /**
     * Process the audio playback queue
     */
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
    
    /**
     * Play a single audio item from the queue
     */
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
    
    /**
     * Stop all audio playback
     */
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
    
    /**
     * Clean up an audio item
     */
    _cleanupAudioItem(item) {
        if (item.url) URL.revokeObjectURL(item.url);
        if (item.audio) this._returnAudioToPool(item.audio);
    }
    
    // VAD (Voice Activity Detection) methods
    /**
     * Start VAD monitoring
     * Enhanced with better silence detection
     */
    _startVADMonitoring() {
        this._stopVADMonitoring();
        this.vad.silenceStartTime = 0;
        this.vad.currentEnergy = 0.0;
        this.vad.isMonitoring = true;
        this.vad.consecutiveSilenceFrames = 0;
        
        if (!this.audio.analyser) {
            this.log('VAD: Analyser not ready');
            return;
        }
        
        this.log(`VAD: Starting monitoring. Threshold: ${this.config.vadSilenceThreshold}, Duration: ${this.config.vadRequiredSilenceDuration}ms`);
        
        this.vad.monitoringInterval = setInterval(() => {
            this._checkVAD();
        }, 100); // Check every 100ms
    }
    
    /**
     * Check VAD for silence detection
     * Enhanced with better energy calculation and frame counting
     */
    _checkVAD() {
        if (!this.state.isRecording || !this.audio.analyser || !this.audio.dataArray || !this.vad.isMonitoring) {
            return;
        }
        
        try {
            this.audio.analyser.getByteFrequencyData(this.audio.dataArray);
            
            // Calculate energy focusing on speech frequencies (300Hz-3000Hz)
            // For 16kHz sample rate with 1024 FFT size, this is roughly bins 20-180
            const speechStart = Math.floor(300 * this.audio.analyser.fftSize / this.audio.context.sampleRate);
            const speechEnd = Math.floor(3000 * this.audio.analyser.fftSize / this.audio.context.sampleRate);
            
            let sum = 0;
            let count = 0;
            
            for (let i = speechStart; i < speechEnd && i < this.audio.dataArray.length; i++) {
                sum += this.audio.dataArray[i];
                count++;
            }
            
            const average = count > 0 ? sum / count : 0;
            const normalizedEnergy = average / 255;
            
            // Smooth the energy value
            this.vad.currentEnergy = (this.vad.currentEnergy * (1 - this.config.vadEnergySmoothing)) + 
                                   (normalizedEnergy * this.config.vadEnergySmoothing);
            
            // Check for silence with frame counting for stability
            if (this.vad.currentEnergy < this.config.vadSilenceThreshold) {
                this.vad.consecutiveSilenceFrames++;
                
                if (this.vad.silenceStartTime === 0) {
                    this.vad.silenceStartTime = Date.now();
                }
                
                const silenceDuration = Date.now() - this.vad.silenceStartTime;
                
                // Detect end of speech when we have enough consecutive silent frames
                // AND the total silence duration exceeds our threshold
                if (this.vad.consecutiveSilenceFrames >= this.vad.minSilenceFrames && 
                    silenceDuration >= this.config.vadRequiredSilenceDuration) {
                    this.log(`VAD: End of speech detected. Silence: ${silenceDuration}ms, Frames: ${this.vad.consecutiveSilenceFrames}`);
                    this.callbacks.onVADSilenceDetected();
                    this.stopRecording();
                }
            } else {
                // Reset silence detection on speech
                this.vad.silenceStartTime = 0;
                this.vad.consecutiveSilenceFrames = 0;
            }
            
        } catch (error) {
            this.log('VAD check error:', error, true);
        }
    }
    
    /**
     * Stop VAD monitoring
     */
    _stopVADMonitoring() {
        if (this.vad.monitoringInterval) {
            clearInterval(this.vad.monitoringInterval);
            this.vad.monitoringInterval = null;
            this.vad.isMonitoring = false;
            this.log('VAD: Monitoring stopped');
        }
    }
    
    // Telegram integration methods
    /**
     * Setup Telegram optimizations
     */
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
    
    /**
     * Setup auto-initialization on user interaction
     */
    _setupAutoInitialization() {
        // Auto-initialize on first user interaction
        const initOnInteraction = () => {
            if (!this.state.initialized) {
                this.log('Auto-initializing on user interaction');
                this.initialize();
            }
        };
        
        // Use capture phase to ensure we get the event first
        document.addEventListener('touchstart', initOnInteraction, { once: true, capture: true });
        document.addEventListener('click', initOnInteraction, { once: true, capture: true });
        
        // Special handling for iOS Safari
        if (this.state.isIOS) {
            document.addEventListener('touchend', () => {
                if (this.audio.context && this.audio.context.state === 'suspended') {
                    this.audio.context.resume().then(() => {
                        this.log('Audio context resumed on iOS touchend');
                    }).catch(e => {
                        this.log('Failed to resume audio context on iOS touchend', false);
                    });
                }
            }, { capture: true });
        }
    }
    
    /**
     * Unlock audio on mobile devices
     * Uses multiple techniques for maximum compatibility
     */
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
    
    /**
     * Unlock audio by playing a silent audio file
     */
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
    
    /**
     * Unlock audio by using the audio context
     */
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
    
    /**
     * Unlock audio with user gesture
     */
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
    /**
     * Create a pool of audio elements for playback
     */
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
    
    /**
     * Get an audio element from the pool
     */
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
    
    /**
     * Return an audio element to the pool
     */
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
    /**
     * Convert array buffer to base64
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
     */
    _base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }
    
    /**
     * Trigger haptic feedback
     */
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
    
    /**
     * Detect if running on a mobile device
     */
    _detectMobileDevice() {
        return /iPhone|iPad|iPod|Android|webOS|BlackBerry|Windows Phone/i.test(navigator.userAgent);
    }
    
    /**
     * Detect if running on iOS
     */
    _detectIOSDevice() {
        return /iPhone|iPad|iPod/i.test(navigator.userAgent);
    }
    
    // Error handling
    /**
     * Handle errors
     */
    handleError(error) {
        this.log('AudioBridge error:', error, true);
        this.callbacks.onError(error);
        
        // Global debug integration
        if (typeof window.debugLog === 'function') {
            window.debugLog(`[AudioBridge] Error: ${error.message}`, true, error);
        }
    }
    
    // Cleanup and disposal
    /**
     * Dispose of all resources
     */
    dispose() {
        this.log('Disposing Modern TelegramAudioBridge...');
        
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
        this.log('Modern TelegramAudioBridge disposed');
    }
    
    // Logging
    /**
     * Log messages with optional error flag
     */
    log(message, data = null, isError = false) {
        if (this.config.debug) {
            const logMethod = isError ? console.error : console.log;
            logMethod('[Modern TelegramAudioBridge]', message, data || '');
            
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
    
    get permissionState() {
        return this.state.permissionState;
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
