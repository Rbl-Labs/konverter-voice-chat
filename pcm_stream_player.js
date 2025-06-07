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
        let pcmData = this._base64PCM16toFloat32(base64PcmData);
        if (pcmData.length === 0) return;

        // Resample if necessary
        if (this.audioContext.sampleRate !== sampleRate) {
            this.log(`Resampling audio from ${sampleRate}Hz to ${this.audioContext.sampleRate}Hz.`);
            pcmData = this._resampleLinear(pcmData, sampleRate, this.audioContext.sampleRate);
            // After resampling, the 'sampleRate' for queue and playbackChunkSizeSamples should be the context's rate
            sampleRate = this.audioContext.sampleRate; 
        }

        const newBuffer = new Float32Array(this.processingBuffer.length + pcmData.length);
        newBuffer.set(this.processingBuffer);
        newBuffer.set(pcmData, this.processingBuffer.length);
        this.processingBuffer = newBuffer;

        // Use the AudioContext's sample rate for chunking after potential resampling
        const contextSampleRate = this.audioContext.sampleRate;
        const playbackChunkSizeSamples = Math.floor(contextSampleRate * (this.chunkProcessSizeMs / 1000));

        while (this.processingBuffer.length >= playbackChunkSizeSamples) {
            const bufferToPlay = this.processingBuffer.slice(0, playbackChunkSizeSamples);
            this.audioQueue.push({ data: bufferToPlay, sampleRate: contextSampleRate }); // Use context's SR
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
            // Check if remaining processingBuffer is enough to form a chunk
            const contextSampleRate = this.audioContext.sampleRate;
            const playbackChunkSizeSamples = Math.floor(contextSampleRate * (this.chunkProcessSizeMs / 1000));
            if (this.processingBuffer.length > 0 && this.processingBuffer.length < playbackChunkSizeSamples) {
                // If there's a small remnant, and we are not expecting more data soon, play it out after a short delay
                // This part needs careful handling to avoid cutting off audio or waiting too long.
                // For now, we'll rely on the main loop to push it to audioQueue if it becomes large enough.
            }
            setTimeout(() => this._scheduleNextBuffer(), 50); // Check again soon
            return;
        }

        const audioChunk = this.audioQueue.shift(); // audioChunk.sampleRate is now context's rate
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
        if (this.audioContext && !this.options?.audioContext && this.audioContext.state !== 'closed') { 
            this.audioContext.close().then(() => this.log('AudioContext closed by PCMStreamPlayer.')).catch(e => this.log('Error closing AudioContext', true, e));
        }
        this.isInitialized = false;
    }

    _resampleLinear(inputBuffer, fromRate, toRate) {
        if (fromRate === toRate) {
            return inputBuffer;
        }
        const outputLength = Math.round(inputBuffer.length * toRate / fromRate);
        const outputBuffer = new Float32Array(outputLength);
        const ratio = fromRate / toRate;

        for (let i = 0; i < outputLength; i++) {
            const inputIndexFloat = i * ratio;
            const inputIndexFloor = Math.floor(inputIndexFloat);
            const inputIndexCeil = Math.min(inputBuffer.length - 1, Math.ceil(inputIndexFloat));
            const fraction = inputIndexFloat - inputIndexFloor;

            if (inputIndexFloor === inputIndexCeil) { // Exact match or at the very end
                outputBuffer[i] = inputBuffer[inputIndexFloor];
            } else {
                // Linear interpolation
                const val1 = inputBuffer[inputIndexFloor];
                const val2 = inputBuffer[inputIndexCeil];
                outputBuffer[i] = val1 + (val2 - val1) * fraction;
            }
        }
        this.log(`Resampled chunk from ${inputBuffer.length} (${fromRate}Hz) to ${outputBuffer.length} (${toRate}Hz) samples.`);
        return outputBuffer;
    }
}
