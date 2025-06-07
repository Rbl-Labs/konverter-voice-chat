/**
 * AdvancedAudioRecorder manages microphone input using Web Audio API and an AudioWorklet.
 * It provides a continuous stream of PCM audio chunks.
 * Inspired by: https://github.com/ViaAnthroposBenevolentia/gemini-2-live-api-demo
 */
export class AdvancedAudioRecorder {
    constructor(options = {}) {
        this.audioContext = null;
        this.mediaStream = null;
        this.mediaStreamSource = null;
        this.workletNode = null;
        this.onAudioDataCallback = null;

        this.isRecording = false;
        this.isSuspended = true; // Start in suspended state

        this.targetSampleRate = options.targetSampleRate || 16000;
        this.workletBufferSize = options.workletBufferSize || 2048; // Number of Int16 samples

        this.log = options.logger || ((message, isError = false, data = null) => {
            const prefix = '[AdvAudioRec]';
            if (isError) console.error(prefix, message, data);
            else console.log(prefix, message, data);
        });

        this.onPermissionChange = options.onPermissionChange || (() => {});
    }

    async _initializeAudioContext() {
        if (!this.audioContext || this.audioContext.state === 'closed') {
            this.audioContext = new AudioContext({ sampleRate: this.targetSampleRate });
            this.log(`AudioContext initialized/reinitialized. State: ${this.audioContext.state}, SampleRate: ${this.audioContext.sampleRate}`);
        }
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
            this.log(`AudioContext resumed. State: ${this.audioContext.state}`);
        }
    }

    async requestPermissionAndInitialize() {
        try {
            this.log('Requesting microphone permission...');
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: this.targetSampleRate, // Request desired sample rate
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            this.log('Microphone permission granted.');
            this.onPermissionChange('granted');
            await this._initializeAudioContext();
            return true;
        } catch (err) {
            this.log('Microphone permission denied or error.', true, err);
            this.onPermissionChange('denied');
            throw new Error(`Microphone permission denied: ${err.message}`);
        }
    }

    async start(onAudioDataCallback) {
        if (this.isRecording) {
            this.log('Already recording. Call resumeMic() to unsuspend if needed.', true);
            return;
        }
        if (!onAudioDataCallback || typeof onAudioDataCallback !== 'function') {
            throw new Error('onAudioDataCallback function is required to start recording.');
        }
        this.onAudioDataCallback = onAudioDataCallback;

        try {
            if (!this.mediaStream) {
                await this.requestPermissionAndInitialize();
            } else {
                await this._initializeAudioContext(); // Ensure context is active
            }

            this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.mediaStream);

            try {
                await this.audioContext.audioWorklet.addModule('audio_processor_worklet.js');
            } catch (e) {
                this.log('Error adding AudioWorklet module. Make sure path is correct.', true, e);
                throw e;
            }
            
            this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor-worklet', {
                processorOptions: {
                    bufferSize: this.workletBufferSize,
                    targetSampleRate: this.targetSampleRate 
                }
            });

            this.workletNode.port.onmessage = (event) => {
                if (event.data.eventType === 'audioChunk' && this.onAudioDataCallback && !this.isSuspended) {
                    // event.data.audioChunk is an Int16Array
                    this.onAudioDataCallback(event.data.audioChunk);
                } else if (event.data.eventType === 'error') {
                    this.log('Error from AudioProcessorWorklet:', true, event.data.error);
                }
            };

            this.mediaStreamSource.connect(this.workletNode);
            // It's common not to connect the worklet to destination if its only purpose is to capture/process data.
            // If you wanted to hear the raw mic input (processed by worklet), you would connect it:
            // this.workletNode.connect(this.audioContext.destination);

            this.isRecording = true;
            this.isSuspended = false; // Start in active state once started
            this.log('AdvancedAudioRecorder started successfully.');

        } catch (error) {
            this.log('Failed to start AdvancedAudioRecorder.', true, error);
            this.isRecording = false;
            throw error;
        }
    }

    suspendMic() {
        if (!this.isRecording || this.isSuspended) {
            this.log(`Cannot suspend: Not recording or already suspended. Recording: ${this.isRecording}, Suspended: ${this.isSuspended}`);
            return;
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => {
                if (track.readyState === 'live') { // Check if track is live before trying to disable
                    track.enabled = false;
                }
            });
            this.isSuspended = true;
            this.log('Microphone tracks disabled (suspended).');
        } else {
            this.log('No mediaStream to suspend tracks on.', true);
        }
        // Optionally, suspend AudioContext if no other audio is playing and power saving is critical.
        // For rapid turn-taking, keeping context running might be better.
        // if (this.audioContext && this.audioContext.state === 'running') {
        //     this.audioContext.suspend().then(() => this.log('AudioContext suspended for mic pause.'));
        // }
    }

    resumeMic() {
        if (!this.isRecording || !this.isSuspended) {
            this.log(`Cannot resume: Not recording or not suspended. Recording: ${this.isRecording}, Suspended: ${this.isSuspended}`);
            return;
        }
        if (this.mediaStream) {
            // Ensure AudioContext is running
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume().then(() => {
                    this.log('AudioContext resumed for mic.');
                    // Enable tracks after context is confirmed running
                    this.mediaStream.getTracks().forEach(track => track.enabled = true);
                    this.isSuspended = false;
                    this.log('Microphone tracks enabled (resumed).');
                }).catch(e => this.log('Error resuming AudioContext for mic', true, e));
            } else if (this.audioContext && this.audioContext.state === 'running') {
                this.mediaStream.getTracks().forEach(track => track.enabled = true);
                this.isSuspended = false;
                this.log('Microphone tracks enabled (resumed).');
            } else {
                this.log('AudioContext not in a resumable state.', true);
            }
        } else {
             this.log('No mediaStream to resume tracks on.', true);
        }
    }
    
    // isMediaStreamSourceConnected() can be removed as we are not disconnecting/reconnecting nodes.

    stop() {
        if (!this.isRecording) {
            this.log('Not recording, nothing to stop.');
            return;
        }
        this.log('Stopping AdvancedAudioRecorder...');
        this.isRecording = false;
        this.isSuspended = true;

        if (this.workletNode) {
            this.workletNode.port.postMessage('stop'); // Inform worklet if it needs cleanup
            this.workletNode.disconnect();
            this.workletNode = null;
            this.log('AudioWorkletNode disconnected.');
        }
        if (this.mediaStreamSource) {
            this.mediaStreamSource.disconnect();
            this.mediaStreamSource = null;
            this.log('MediaStreamSource disconnected.');
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
            this.log('MediaStream tracks stopped.');
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close().then(() => {
                this.log('AudioContext closed.');
                this.audioContext = null;
            }).catch(e => this.log('Error closing AudioContext.', true, e));
        }
        this.onAudioDataCallback = null;
    }
}
