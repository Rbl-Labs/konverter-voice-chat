/**
 * AudioProcessingWorklet handles real-time audio processing in a dedicated thread.
 * It converts incoming Float32 audio samples to Int16 format (PCM)
 * and sends them in chunks to the main thread.
 * Inspired by: https://github.com/ViaAnthroposBenevolentia/gemini-2-live-api-demo
 */
class AudioProcessorWorklet extends AudioWorkletProcessor {
    constructor(options) {
        super(options);
        // Buffer size of 2048 samples for Int16.
        // At 16000Hz, this is 2048 samples / 16000 Hz = 0.128 seconds (128ms) of audio per chunk.
        // Each sample is 2 bytes (Int16). So, 4096 bytes per chunk.
        this.bufferSize = options?.processorOptions?.bufferSize || 2048; 
        this.buffer = new Int16Array(this.bufferSize);
        this.bufferWriteIndex = 0;
        
        // sampleRate is passed from the main thread via AudioWorkletNode options
        // but it's primarily for informational purposes here or if resampling were done.
        // The actual sample rate of incoming data is determined by the AudioContext.
        this.targetSampleRate = options?.processorOptions?.targetSampleRate || 16000;

        this.port.onmessage = (event) => {
            // Handle messages from the main thread if needed in the future
            // For example, to change parameters or stop.
            if (event.data === 'stop') {
                // Perform cleanup if necessary, though worklets are typically stopped by disconnecting them.
            }
        };
        console.log('[AudioProcessorWorklet] Initialized with buffer size:', this.bufferSize, 'Target SR:', this.targetSampleRate);
    }

    process(inputs, outputs, parameters) {
        // We expect a single input, with a single channel of Float32 audio data.
        const inputChannel = inputs[0]?.[0];

        if (inputChannel) {
            for (let i = 0; i < inputChannel.length; i++) {
                // Convert Float32 sample (range -1.0 to 1.0) to Int16 sample (range -32768 to 32767)
                const floatSample = inputChannel[i];
                const int16Sample = Math.max(-32768, Math.min(32767, Math.floor(floatSample * 32768)));
                this.buffer[this.bufferWriteIndex++] = int16Sample;

                // If the buffer is full, send it to the main thread
                if (this.bufferWriteIndex >= this.bufferSize) {
                    this.port.postMessage({
                        eventType: 'audioChunk',
                        audioChunk: this.buffer.slice(0, this.bufferWriteIndex) // Send a copy
                    });
                    this.bufferWriteIndex = 0; // Reset buffer index
                }
            }
        }
        // Return true to keep the processor alive
        return true;
    }
}

registerProcessor('audio-processor-worklet', AudioProcessorWorklet);
