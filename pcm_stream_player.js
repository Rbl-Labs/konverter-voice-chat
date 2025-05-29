/**
 * PCMStreamPlayer manages real-time audio playback from a stream of PCM audio chunks.
 * It uses the Web Audio API for precise timing and efficient audio scheduling
 * to achieve low-latency playback.
 * Inspired by: https://github.com/ViaAnthroposBenevolentia/gemini-2-live-api-demo/blob/main/js/audio/streamer.js
 */
export class PCMStreamPlayer {
    constructor(options = {}) {
        this.audioContext = null;
        this.audioQueue = [];
        this.isPlaying = false;
        this.processingBuffer = new Float32Array(0);
        this.scheduledTime = 0;
        this.gainNode = null;
        this.isInitialized = false;
        this.minBufferDurationMs = options.minBufferDurationMs || 100; // Min audio in buffer before starting playback
        this.chunkProcessSizeMs = options.chunkProcessSizeMs || 320; // How large are the chunks we create for playback

        this.onPlaybackStart = options.onPlaybackStart || (() => {});
        this.onPlaybackEnd = options.onPlaybackEnd || (() => {}); // Called when queue is empty

        this.log = options.logger || ((message, isError = false, data = null) => {
            const prefix = '[PCMPlayer]';
            if (isError) console.error(prefix, message, data);
            else console.log(prefix, message, data);
        });
    }

    async initialize(audioContext) {
        if (this.isInitialized) return;

        if (audioContext && audioContext instanceof AudioContext) {
            this.audioContext = audioContext;
            this.log(`Using provided AudioContext. State: ${this.audioContext.state}, SampleRate: ${this.audioContext.sampleRate}`);
        } else {
            // Attempt to create AudioContext with 24000Hz sample rate, matching Gemini's output
            try {
                this.audioContext = new AudioContext({ sampleRate: 24000 });
                this.log(`AudioContext initialized with requested sampleRate: 24000Hz. Actual: ${this.audioContext.sampleRate}Hz`);
            } catch (e) {
                this.log('Failed to create AudioContext with 24kHz, falling back to default.', true, e);
                this.audioContext = new AudioContext(); // Fallback
            }
        }
        
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
        this.gainNode.gain.value = 1.0; // Default volume

        this.isInitialized = true;
        this.log('PCMStreamPlayer initialized. AudioContext state: ' + this.audioContext.state);
    }

    // Helper to convert base64 PCM (Int16) to Float32Array
    _base64PCM16toFloat32(base64String) {
        try {
            const binaryString = window.atob(base64String);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            const pcm16 = new Int16Array(bytes.buffer);
            const float32 = new Float32Array(pcm16.length);
            for (let i = 0; i < pcm16.length; i++) {
                float32[i] = pcm16[i] / 32768; // Convert Int16 to Float32 range [-1.0, 1.0]
            }
            return float32;
        } catch (e) {
            this.log('Error decoding/converting base64 PCM to Float32', true, e);
            return new Float32Array(0);
        }
    }

    streamAudioChunk(base64PcmData, sampleRate) {
        if (!this.isInitialized) {
            this.log('Player not initialized. Call initialize() first.', true);
            return;
        }
        if (this.audioContext.sampleRate !== sampleRate) {
            this.log(`Warning: AudioContext sample rate (${this.audioContext.sampleRate}Hz) does not match incoming chunk sample rate (${sampleRate}Hz). This may cause pitch/speed issues. Re-initializing context is complex; ideally, all audio is at context's rate or resampled before sending.`, true);
            // For simplicity, we'll proceed, but this is a potential issue.
            // A robust solution would involve resampling or ensuring consistent sample rates.
        }

        const float32Array = this._base64PCM16toFloat32(base64PcmData);
        if (float32Array.length === 0) return;

        const newBuffer = new Float32Array(this.processingBuffer.length + float32Array.length);
        newBuffer.set(this.processingBuffer);
        newBuffer.set(float32Array, this.processingBuffer.length);
        this.processingBuffer = newBuffer;

        const playbackChunkSizeSamples = Math.floor(sampleRate * (this.chunkProcessSizeMs / 1000));

        while (this.processingBuffer.length >= playbackChunkSizeSamples) {
            const bufferToPlay = this.processingBuffer.slice(0, playbackChunkSizeSamples);
            this.audioQueue.push({ data: bufferToPlay, sampleRate: sampleRate });
            this.processingBuffer = this.processingBuffer.slice(playbackChunkSizeSamples);
        }

        if (!this.isPlaying && this.audioQueue.length > 0) {
            // Check if enough initial audio is buffered
            const currentBufferedDuration = this.audioQueue.reduce((sum, item) => sum + (item.data.length / item.sampleRate), 0);
            if (currentBufferedDuration * 1000 >= this.minBufferDurationMs) {
                this.isPlaying = true;
                this.scheduledTime = this.audioContext.currentTime;
                this.onPlaybackStart();
                this._scheduleNextBuffer();
            }
        }
    }

    _scheduleNextBuffer() {
        if (!this.isPlaying && this.audioQueue.length === 0) {
            if (this.processingBuffer.length === 0) { // Truly empty
                this.onPlaybackEnd();
            }
            return;
        }
        if (this.audioQueue.length === 0) {
            // Not enough data to play, wait for more or for processingBuffer to fill
            setTimeout(() => this._scheduleNextBuffer(), 50); // Check again soon
            return;
        }

        const audioChunk = this.audioQueue.shift();
        const audioBuffer = this.audioContext.createBuffer(1, audioChunk.data.length, audioChunk.sampleRate);
        audioBuffer.getChannelData(0).set(audioChunk.data);

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.gainNode);

        const currentTime = this.audioContext.currentTime;
        if (this.scheduledTime < currentTime) {
            this.scheduledTime = currentTime;
        }
        
        source.start(this.scheduledTime);
        this.scheduledTime += audioBuffer.duration;

        source.onended = () => {
            if (this.audioQueue.length === 0 && this.processingBuffer.length < (audioChunk.sampleRate * (this.chunkProcessSizeMs / 1000))) {
                this.isPlaying = false;
                this.onPlaybackEnd();
                this.log('Playback queue empty and processing buffer too small, playback ended.');
            } else {
                this._scheduleNextBuffer();
            }
        };
    }

    stopPlayback() {
        this.log('Stopping playback and clearing queue.');
        this.isPlaying = false;
        this.audioQueue = [];
        this.processingBuffer = new Float32Array(0);
        // GainNode ramp down can be added here if abrupt stop is an issue
        // For now, existing sources will play out if already scheduled by browser.
        // A more forceful stop would iterate over scheduled sources and call .stop()
    }

    setVolume(volume) { // Volume from 0.0 to 1.0 (or more for amplification)
        if (this.gainNode) {
            this.gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
            this.log(`Volume set to ${volume}`);
        }
    }

    dispose() {
        this.stopPlayback();
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
        // If we created the AudioContext, we can close it.
        // If it was passed in, the owner should close it.
        // For now, assume we own it if we created it.
        if (this.audioContext && !this.options?.audioContext) { // A bit heuristic
            this.audioContext.close().then(() => this.log('AudioContext closed by PCMStreamPlayer.'));
        }
        this.isInitialized = false;
    }
}
