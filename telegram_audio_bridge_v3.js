/**
 * Enhanced Telegram Audio Bridge with improved mobile compatibility
 * Version: 3.0.4 (Sends single complete audio blob on stop)
 * 
 * This module handles audio recording and playback in the Telegram WebApp environment,
 * with special optimizations for mobile devices and permission handling.
 */

class TelegramAudioBridge {
    constructor(options = {}) {
        console.log('🔄 [AudioBridge] TelegramAudioBridge v3.0.4 constructor called with options:', options);
        
        this.options = options; 
        this.config = {
            debug: options.debug || true,
            vadSilenceThreshold: options.vadSilenceThreshold || 0.01,
            vadRequiredSilenceDuration: options.vadRequiredSilenceDuration || 1500,
            vadEnergySmoothing: options.vadEnergySmoothing || 0.1,
            maxInitializationAttempts: options.maxInitializationAttempts || 3
        };
        
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
        
        this.state = {
            isRecording: false,
            isPlaying: false,
            permissionState: 'unknown',
            initializationAttempts: 0,
            initialized: false, 
            initializing: false,
            audioContextReady: false
        };
        
        this.stream = null;
        this.mediaRecorder = null;
        this.audioContext = (options.audioContext && options.audioContext.state === 'running') ? options.audioContext : null;
        if (this.audioContext) {
            this.log(`Constructor: Using provided AudioContext in '${this.audioContext.state}' state.`);
            this.state.audioContextReady = true;
        } else {
            this.log('Constructor: No valid pre-existing AudioContext provided or it was not running.');
        }
        
        this.analyser = null;
        this.dataArray = null;
        this.audioChunks = []; // Stores Blobs directly
        
        this.vad = {
            silenceStartTime: 0,
            currentEnergy: 0.0,
            monitoringInterval: null
        };
        
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.audioUnlocked = this.state.audioContextReady;
        
        this.liveAudioPlayer = new LiveAudioPlayer();
        this.telegramWebApp = window.Telegram?.WebApp;
        this.hapticFeedback = this.telegramWebApp?.HapticFeedback;
        
        this.log('TelegramAudioBridge core components initialized');
        this.setupTelegramOptimizations();
        this.checkMicrophonePermission(); 
    }
    
    async initialize() {
        if (this.state.initializing) { this.log('Initialization already in progress.'); return false; }
        if (this.state.initialized) { this.log('Already initialized.'); return true; }
        
        this.state.initializing = true;
        this.log('Starting basic initialization (AudioContext setup)...');

        try {
            if (this.audioContext && this.audioContext.state === 'running') {
                this.log('Using pre-existing and running AudioContext.');
                this.state.audioContextReady = true;
                this.audioUnlocked = true;
            } else {
                if (this.audioContext && this.audioContext.state === 'closed') {
                    this.log('Provided AudioContext was closed, will create a new one if needed.');
                    this.audioContext = null;
                }
                if (!this.audioContext) {
                    this.log('Creating new AudioContext...');
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    this.log(`New AudioContext created. Initial state: ${this.audioContext.state}`);
                }
            }
            this.state.initialized = true; 
            this.log('Basic initialization complete.');
            return true;
        } catch (error) {
            this.log(`Basic initialization failed: ${error.message}`, true);
            if (this.callbacks.onError) this.callbacks.onError(error);
            return false;
        } finally {
            this.state.initializing = false;
        }
    }

    async requestPermissionAndResumeContext() {
        this.log('Attempting to request permission and resume/unlock AudioContext...');
        if (!this.state.initialized) await this.initialize(); // Ensure AudioContext object exists
        if (!this.audioContext) { this.log('AudioContext object does not exist, cannot proceed.', true); return false; }

        const permissionGranted = await this.requestMicrophonePermission(); // This now only requests, doesn't update internal state directly
        if (!permissionGranted) { 
            this.log('Microphone permission was not granted by user/system.', true);
            // updatePermissionState is called within requestMicrophonePermission
            return false; 
        }
        // If permissionGranted is true, requestMicrophonePermission already called updatePermissionState('granted')

        if (this.audioContext.state === 'suspended') {
            this.log(`AudioContext is '${this.audioContext.state}'. Attempting to resume...`);
            try { await this.audioContext.resume(); this.log(`AudioContext.resume() called. New state: ${this.audioContext.state}`); }
            catch (resumeError) { this.log(`Error resuming AudioContext: ${resumeError.message}`, true); }
        }

        if (this.isMobile && this.audioContext.state !== 'running') {
            this.log(`AudioContext not running on mobile (state: ${this.audioContext.state}). Trying silent audio play...`);
            try {
                const silentAudio = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
                silentAudio.volume = 0; await silentAudio.play(); this.log('Silent audio played.');
                if (this.audioContext.state === 'suspended') { await this.audioContext.resume(); this.log(`AudioContext state after silent play resume: ${this.audioContext.state}`); }
            } catch (playError) { this.log(`Error playing silent audio: ${playError.message}`, true); }
        }
        
        this.audioUnlocked = this.audioContext.state === 'running';
        this.state.audioContextReady = this.audioUnlocked;

        if (this.audioUnlocked) this.log('✅ Permission granted and AudioContext is RUNNING.');
        else this.log(`❌ Permission granted, but AudioContext is NOT RUNNING (state: ${this.audioContext.state}).`, true);
        
        return this.audioUnlocked;
    }
    
    setupTelegramOptimizations() {
        if (this.telegramWebApp) {
            try {
                this.telegramWebApp.ready(); this.telegramWebApp.expand();
                this.log('Telegram WebApp optimizations enabled (ready, expand)');
                this.telegramWebApp.onEvent('viewportChanged', (eventData) => {
                    if (eventData.isStateStable) this.log(`Telegram viewport changed: ${window.innerWidth}x${this.telegramWebApp.viewportStableHeight}`);
                });
            } catch (error) { this.log(`Error setting up Telegram WebApp features: ${error.message}`, true); }
        } else { this.log('Telegram WebApp context not found'); }
    }
    
    async checkMicrophonePermission() {
        try {
            if (!navigator.permissions || !navigator.permissions.query) {
                this.log('Permissions API not supported, assuming prompt for initial state.');
                this.updatePermissionState('prompt'); return;
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
        if (this.state.permissionState !== state) {
            this.state.permissionState = state;
            this.log(`Microphone permission state changed to: ${state}`);
            if (this.callbacks.onPermissionChange) this.callbacks.onPermissionChange(state);
        }
    }
    
    async requestMicrophonePermission() {
        this.log('Requesting microphone permission from user...');
        try {
            if (this.telegramWebApp && typeof this.telegramWebApp.requestMicrophoneAccess === 'function') {
                this.log('Using Telegram.WebApp.requestMicrophoneAccess...');
                const granted = await new Promise(resolve => this.telegramWebApp.requestMicrophoneAccess(resolve));
                this.updatePermissionState(granted ? 'granted' : 'denied');
                if(granted) this.log('Telegram microphone permission GRANTED by user.');
                else this.log('Telegram microphone permission DENIED by user.', true);
                return granted;
            }
            
            this.log('Using navigator.mediaDevices.getUserMedia for permission fallback...');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
            this.log('Microphone access GRANTED via getUserMedia.');
            stream.getTracks().forEach(track => track.stop());
            this.updatePermissionState('granted');
            return true;
        } catch (error) {
            this.log(`Microphone permission request error: ${error.name} - ${error.message}`, true);
            this.updatePermissionState(error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' ? 'denied' : 'prompt');
            if (this.callbacks.onError) this.callbacks.onError(new Error(`Microphone access request failed: ${error.message}`));
            return false;
        }
    }
    
    async startRecording() {
        if (this.state.isRecording) return true;
        this.log('Attempting to start recording...');
        try {
            if (this.state.permissionState !== 'granted' || !this.state.audioContextReady) {
                this.log('Permissions not granted or AudioContext not ready. Attempting to acquire/resume...');
                const ready = await this.requestPermissionAndResumeContext();
                if (!ready) throw new Error('Failed to acquire permissions or make AudioContext ready.');
            }
            if (!this.audioContext || this.audioContext.state !== 'running') {
                 throw new Error(`Cannot start recording: AudioContext not running (state: ${this.audioContext?.state})`);
            }
            
            this.log('Requesting microphone stream for recording...');
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
            } catch (error) {
                this.log(`getUserMedia failed: ${error.message}`, true);
                throw new Error(`Microphone access error: ${error.message}`);
            }
            
            this.stream = stream;
            this.log('Microphone stream acquired.');
            
            if (this.audioContext && this.audioContext.state === 'running') {
                if (!this.analyser) { 
                    this.analyser = this.audioContext.createAnalyser();
                    this.analyser.fftSize = 256;
                    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
                    this.log('Audio analyzer components created.');
                }
                const source = this.audioContext.createMediaStreamSource(this.stream);
                source.connect(this.analyser); 
                this.log('Audio analyzer source connected.');
            } else {
                this.log('AudioContext not running, VAD will not function.', true);
            }
            
            this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus' });
            this.audioChunks = []; 
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data); 
                }
            };
            
            this.mediaRecorder.onstart = () => {
                this.state.isRecording = true;
                this.log('MediaRecorder started successfully');
                if (this.callbacks.onAudioStart) this.callbacks.onAudioStart();
                if (this.hapticFeedback) try { this.hapticFeedback.impactOccurred('light'); } catch (e) { this.log(`Haptic feedback error: ${e.message}`, true); }
            };
            
            this.mediaRecorder.onstop = async () => {
                this.state.isRecording = false;
                this.log('MediaRecorder stopped. Processing collected audio chunks...');
                
                if (this.audioChunks.length > 0) {
                    const completeAudioBlob = new Blob(this.audioChunks, { type: 'audio/webm;codecs=opus' });
                    this.log(`Combined audio blob size: ${completeAudioBlob.size} bytes`);
                    try {
                        const base64Audio = await this.blobToBase64(completeAudioBlob);
                        if (this.callbacks.onAudioData) {
                            this.callbacks.onAudioData(base64Audio, true); 
                        }
                    } catch (error) {
                        this.log(`Error converting blob to base64: ${error.message}`, true);
                        if (this.callbacks.onError) this.callbacks.onError(error);
                    }
                } else {
                    this.log('No audio chunks recorded to send.');
                    if (this.callbacks.onAudioData) { 
                        this.callbacks.onAudioData(null, true);
                    }
                }
                this.audioChunks = []; 
                
                if (this.callbacks.onAudioEnd) this.callbacks.onAudioEnd();
            };
            
            this.mediaRecorder.onerror = (event) => {
                this.log(`MediaRecorder error: ${event.error?.message || event.error}`, true);
                if (this.callbacks.onError) this.callbacks.onError(new Error(`MediaRecorder error: ${event.error?.message || event.error}`));
            };
            
            this.mediaRecorder.start(500); 
            this.startVADMonitoring();
            this.log('Recording process started successfully.');
            return true;
        } catch (error) {
            this.log(`Error starting recording: ${error.message}`, true);
            if (this.callbacks.onError) this.callbacks.onError(error);
            return false;
        }
    }
    
    async stopRecording() {
        if (!this.state.isRecording) {
            this.log('Not recording, stopRecording call ignored.');
            return true;
        }
        this.log('Stopping recording...');
        try {
            this.stopVADMonitoring();
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop(); 
            }
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null;
                this.log('Microphone stream stopped.');
            }
            return true;
        } catch (error) {
            this.log(`Error stopping recording: ${error.message}`, true);
            if (this.callbacks.onError) this.callbacks.onError(error);
            return false;
        }
    }

    async blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result.split(',')[1];
                resolve(base64String);
            };
            reader.onerror = (error) => {
                reject(error);
            };
            reader.readAsDataURL(blob);
        });
    }
    
    startVADMonitoring() { this.stopVADMonitoring(); this.vad.silenceStartTime = 0; this.vad.currentEnergy = 0.0; if (!this.analyser) { this.log('VAD: Analyser not ready', true); return; } this.log(`VAD: Starting. Threshold: ${this.config.vadSilenceThreshold}, Duration: ${this.config.vadRequiredSilenceDuration}ms`); this.vad.monitoringInterval = setInterval(() => this.checkVAD(), 100); }
    checkVAD() { if (!this.state.isRecording || !this.analyser || !this.dataArray) return; this.analyser.getByteFrequencyData(this.dataArray); let sum = 0; for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i]; const average = this.dataArray.length > 0 ? sum / this.dataArray.length : 0; const normalizedEnergy = average / 255; this.vad.currentEnergy = (this.vad.currentEnergy * (1 - this.config.vadEnergySmoothing)) + (normalizedEnergy * this.config.vadEnergySmoothing); if (this.vad.currentEnergy < this.config.vadSilenceThreshold) { if (this.vad.silenceStartTime === 0) this.vad.silenceStartTime = Date.now(); if ((Date.now() - this.vad.silenceStartTime) >= this.config.vadRequiredSilenceDuration) { this.log(`VAD: End of speech detected. Silence: ${Date.now() - this.vad.silenceStartTime}ms`); if (this.callbacks.onVADSilenceDetected) this.callbacks.onVADSilenceDetected(); this.stopRecording(); } } else { this.vad.silenceStartTime = 0; } }
    stopVADMonitoring() { if (this.vad.monitoringInterval) { clearInterval(this.vad.monitoringInterval); this.vad.monitoringInterval = null; this.log('VAD: Monitoring stopped');} }
    playAudio(audioData, mimeType) { try { if (!audioData) { this.log('No audio data to play', true); return; } if (this.hapticFeedback && !this.state.isPlaying) try { this.hapticFeedback.impactOccurred('light'); } catch (e) { this.log(`Haptic feedback error: ${e.message}`, true); } this.state.isPlaying = true; if (this.callbacks.onPlaybackStart) this.callbacks.onPlaybackStart(); this.liveAudioPlayer.playChunk(audioData, mimeType, () => { this.state.isPlaying = false; if (this.callbacks.onPlaybackEnd) this.callbacks.onPlaybackEnd(); }); } catch (error) { this.log(`Error playing audio: ${error.message}`, true); this.state.isPlaying = false; if (this.callbacks.onError) this.callbacks.onError(error); } }
    stopPlayback() { this.liveAudioPlayer.stopPlayback(); this.state.isPlaying = false; if (this.callbacks.onPlaybackEnd) this.callbacks.onPlaybackEnd(); }
    arrayBufferToBase64(buffer) { const bytes = new Uint8Array(buffer); let binary = ''; for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]); return window.btoa(binary); }
    log(message, isError = false) { if (!this.config.debug) return; const prefix = '[AudioBridge]'; if (isError) console.error(`${prefix} ${message}`); else console.log(`${prefix} ${message}`); }
    dispose() { this.log('Audio bridge disposing...'); this.stopRecording(); this.stopPlayback(); this.stopVADMonitoring(); if (this.audioContext && this.audioContext.state !== 'closed' && !this.options.audioContext) { this.audioContext.close().catch(e => this.log(`Error closing internally created audio context: ${e.message}`, true)); this.log('Internally created AudioContext closed.'); } else if (this.options.audioContext) { this.log('External AudioContext will not be closed by AudioBridge.'); } this.log('Audio bridge disposed'); }
}

class LiveAudioPlayer {
    constructor() { this.audioQueue = []; this.isPlaying = false; this.currentAudio = null; this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent); this.audioPool = []; this.setupMobileOptimizations(); }
    setupMobileOptimizations() { for (let i = 0; i < 3; i++) { const audio = new Audio(); audio.preload = 'auto'; if (this.isMobile) audio.crossOrigin = 'anonymous'; this.audioPool.push(audio); } }
    async unlockAudio() { if (!this.isMobile) { console.log('[LiveAudioPlayer] Desktop - no explicit unlock needed.'); return true; } console.log('[LiveAudioPlayer] 🔓 Attempting to unlock mobile audio (silent play)...'); try { const audio = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='); audio.volume = 0; await audio.play(); audio.pause(); console.log('[LiveAudioPlayer] ✅ Mobile audio unlocked successfully via silent play.'); return true; } catch (error) { console.warn('[LiveAudioPlayer] ⚠️ Silent play unlock failed:', error.message); return false; } }
    playChunk(base64Audio, mimeType, onComplete) { try { const audioBuffer = this.base64ToArrayBuffer(base64Audio); const blob = new Blob([audioBuffer], { type: mimeType }); const audioUrl = URL.createObjectURL(blob); const audio = this.getAudioFromPool(); audio.volume = this.isMobile ? 0.9 : 1.0; if (this.isMobile) audio.playsInline = true; audio.src = audioUrl; this.audioQueue.push({ audio, url: audioUrl, onComplete }); if (!this.isPlaying) this.processAudioQueue(); } catch (error) { console.error('[LiveAudioPlayer] Failed to play audio chunk:', error); if (onComplete) onComplete(); } }
    async processAudioQueue() { if (this.audioQueue.length === 0) { this.isPlaying = false; return; } this.isPlaying = true; const item = this.audioQueue.shift(); this.currentAudio = item.audio; try { await new Promise((resolve, reject) => { item.audio.onended = resolve; item.audio.onerror = (e) => reject(new Error(`Audio playback error: ${e.target.error?.message || 'Unknown error'}`)); item.audio.play().catch(reject); }); } catch (error) { console.error('[LiveAudioPlayer] Playback error in queue:', error.message); } finally { URL.revokeObjectURL(item.url); this.returnAudioToPool(item.audio); this.currentAudio = null; if (item.onComplete) item.onComplete(); this.processAudioQueue(); } }
    getAudioFromPool() { if (this.audioPool.length > 0) return this.audioPool.shift(); const audio = new Audio(); audio.preload = 'auto'; if (this.isMobile) audio.crossOrigin = 'anonymous'; return audio; }
    returnAudioToPool(audio) { audio.onended = null; audio.onerror = null; audio.src = ''; if (this.audioPool.length < 5) this.audioPool.push(audio); }
    stopPlayback() { if (this.currentAudio) { this.currentAudio.pause(); this.currentAudio.currentTime = 0; } this.audioQueue.forEach(item => { URL.revokeObjectURL(item.url); this.returnAudioToPool(item.audio); if (item.onComplete) item.onComplete(); }); this.audioQueue = []; this.isPlaying = false; }
    base64ToArrayBuffer(base64) { const binaryString = window.atob(base64); const len = binaryString.length; const bytes = new Uint8Array(len); for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i); return bytes.buffer; }
}

window.TelegramAudioBridge = TelegramAudioBridge;
