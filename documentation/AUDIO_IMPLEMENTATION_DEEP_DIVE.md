# Audio Implementation Deep Dive

## Table of Contents

1. [Introduction](#1-introduction)
2. [Architecture Overview](#2-architecture-overview)
3. [Audio Recording](#3-audio-recording)
4. [Audio Processing](#4-audio-processing)
5. [Audio Playback](#5-audio-playback)
6. [Cross-Platform Compatibility](#6-cross-platform-compatibility)
7. [Telegram Integration](#7-telegram-integration)
8. [Backend Audio Processing](#8-backend-audio-processing)
9. [Challenges and Solutions](#9-challenges-and-solutions)
10. [Performance Optimizations](#10-performance-optimizations)
11. [Future Improvements](#11-future-improvements)

## 1. Introduction

The Konverter Voice Chat application requires high-quality, low-latency audio processing to provide a seamless voice conversation experience with Google's Gemini models. Our audio implementation addresses several key challenges:

- Real-time audio capture and streaming
- Cross-platform compatibility (mobile and desktop)
- Low-latency audio playback
- Integration with Telegram's audio capabilities
- Efficient audio format conversion
- Voice Activity Detection (VAD)

This document provides a comprehensive overview of our audio implementation, detailing the components, their interactions, and the techniques used to ensure a smooth user experience across all platforms.

## 2. Architecture Overview

Our audio implementation consists of several key components that work together to provide a seamless voice chat experience:

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│                     │     │                     │     │                     │
│  AdvancedAudio      │────▶│  AudioProcessor     │────▶│  WebSocket          │
│  Recorder           │     │  Worklet            │     │  Connection         │
│                     │     │                     │     │                     │
└─────────────────────┘     └─────────────────────┘     └──────────┬──────────┘
                                                                   │
                                                                   ▼
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│                     │     │                     │     │                     │
│  PCMStreamPlayer    │◀────│  Backend Audio      │◀────│  Gemini Live API    │
│                     │     │  Processing         │     │                     │
│                     │     │                     │     │                     │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
        ▲
        │
┌───────┴───────────┐
│                   │
│  TelegramAudio    │
│  Bridge           │
│                   │
└───────────────────┘
```

### Key Components:

1. **AdvancedAudioRecorder**: Manages microphone input using the Web Audio API
2. **AudioProcessorWorklet**: Processes audio data in a separate thread for efficiency
3. **PCMStreamPlayer**: Handles real-time audio playback with buffering
4. **TelegramAudioBridge**: Provides Telegram-specific optimizations and compatibility
5. **Backend Audio Processing**: Handles audio format conversion and processing

## 3. Audio Recording

### 3.1 AdvancedAudioRecorder

The `AdvancedAudioRecorder` class is responsible for capturing audio from the user's microphone. It uses the Web Audio API to access the microphone and process the audio data.

Key features:

- **Sample Rate Control**: Initializes the AudioContext with a target sample rate (16kHz) to match Gemini's requirements
- **Permission Management**: Handles microphone permission requests and state changes
- **Suspension Control**: Allows pausing and resuming microphone input without releasing permissions
- **Error Handling**: Robust error handling for various failure scenarios
- **AudioWorklet Integration**: Uses an AudioWorklet for off-main-thread audio processing

```javascript
// Example of microphone initialization
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
```

### 3.2 Audio Capture Process

1. The recorder requests microphone permission using `navigator.mediaDevices.getUserMedia()`
2. Once permission is granted, it creates an AudioContext with the target sample rate (16kHz)
3. It then creates a MediaStreamSource from the microphone input
4. The MediaStreamSource is connected to an AudioWorkletNode
5. The AudioWorkletNode processes the audio data in a separate thread
6. Processed audio chunks are sent back to the main thread via message passing

## 4. Audio Processing

### 4.1 AudioProcessorWorklet

The `AudioProcessorWorklet` runs in a separate thread to process audio data without blocking the main UI thread. This is crucial for maintaining a responsive user interface during audio recording.

Key features:

- **Off-Main-Thread Processing**: Runs in a separate thread to avoid UI jank
- **Format Conversion**: Converts Float32 audio samples to Int16 PCM format
- **Chunking**: Divides audio into manageable chunks for streaming
- **Buffer Management**: Efficiently manages audio buffers to minimize memory usage

```javascript
// Audio processing in the worklet
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
```

### 4.2 Audio Format Conversion

Our audio processing pipeline handles several format conversions:

1. **Float32 to Int16**: The AudioWorklet converts Float32 audio samples (-1.0 to 1.0) to Int16 PCM samples (-32768 to 32767)
2. **WebM to PCM**: The backend converts WebM audio to PCM format using FFmpeg
3. **Sample Rate Conversion**: Resampling between different sample rates (e.g., 44.1kHz to 16kHz)

## 5. Audio Playback

### 5.1 PCMStreamPlayer

The `PCMStreamPlayer` class handles real-time audio playback from a stream of PCM audio chunks. It uses the Web Audio API for precise timing and efficient audio scheduling.

Key features:

- **Streaming Playback**: Plays audio as it arrives, without waiting for the complete file
- **Buffer Management**: Maintains a queue of audio chunks for smooth playback
- **Resampling**: Handles sample rate conversion when necessary
- **Volume Control**: Provides volume adjustment capabilities
- **Low-Latency Playback**: Minimizes delay between receiving audio and playing it

```javascript
// Streaming audio playback
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
        this.audioQueue.push({ data: bufferToPlay, sampleRate: contextSampleRate });
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
```

### 5.2 Audio Scheduling

The PCMStreamPlayer uses precise audio scheduling to ensure smooth playback:

1. Audio chunks are added to a queue as they arrive
2. The player waits until a minimum buffer duration is reached before starting playback
3. Audio buffers are scheduled to play at precise times using the AudioContext's timing system
4. Each buffer's playback is scheduled to start immediately after the previous buffer ends
5. If the queue runs empty, playback pauses until more audio arrives

## 6. Cross-Platform Compatibility

### 6.1 Mobile-Specific Challenges

Mobile browsers present unique challenges for audio processing:

1. **Audio Context Unlocking**: Mobile browsers require user interaction to unlock audio playback
2. **Autoplay Restrictions**: Audio playback can't start automatically without user interaction
3. **Background Processing**: Audio processing may be throttled when the app is in the background
4. **Permission Handling**: Permission UIs and behaviors differ across mobile platforms
5. **Performance Constraints**: Mobile devices have more limited processing power

### 6.2 Solutions Implemented

Our implementation addresses these challenges with several techniques:

#### 6.2.1 Audio Context Unlocking

```javascript
async unlockAudio() {
    if (!this.isMobile) {
        console.log('[LiveAudioPlayer] Desktop - no explicit unlock needed.');
        return true;
    }
    console.log('[LiveAudioPlayer] 🔓 Attempting to unlock mobile audio (silent play)...');
    try {
        const audio = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
        audio.volume = 0;
        await audio.play();
        audio.pause();
        console.log('[LiveAudioPlayer] ✅ Mobile audio unlocked successfully via silent play.');
        return true;
    } catch (error) {
        console.warn('[LiveAudioPlayer] ⚠️ Silent play unlock failed:', error.message);
        return false;
    }
}
```

#### 6.2.2 Telegram-Specific Optimizations

```javascript
setupTelegramOptimizations() {
    if (this.telegramWebApp) {
        try {
            this.telegramWebApp.ready();
            this.telegramWebApp.expand();
            this.log('Telegram WebApp optimizations enabled (ready, expand)');
            this.telegramWebApp.onEvent('viewportChanged', (eventData) => {
                if (eventData.isStateStable) this.log(`Telegram viewport changed: ${window.innerWidth}x${this.telegramWebApp.viewportStableHeight}`);
            });
        } catch (error) {
            this.log(`Error setting up Telegram WebApp features: ${error.message}`, true);
        }
    } else {
        this.log('Telegram WebApp context not found');
    }
}
```

#### 6.2.3 Adaptive Audio Pool

```javascript
setupMobileOptimizations() {
    for (let i = 0; i < 3; i++) {
        const audio = new Audio();
        audio.preload = 'auto';
        if (this.isMobile) audio.crossOrigin = 'anonymous';
        this.audioPool.push(audio);
    }
}
```

#### 6.2.4 Haptic Feedback

```javascript
// Haptic feedback for better user experience on mobile
if (this.hapticFeedback && !this.state.isPlaying) {
    try {
        this.hapticFeedback.impactOccurred('light');
    } catch (e) {
        this.log(`Haptic feedback error: ${e.message}`, true);
    }
}
```

## 7. Telegram Integration

### 7.1 TelegramAudioBridge

The `TelegramAudioBridge` class provides a specialized interface for audio recording and playback within the Telegram WebApp environment. It handles Telegram-specific optimizations and compatibility issues.

Key features:

- **Telegram WebApp Integration**: Uses Telegram WebApp APIs for optimal integration
- **Permission Handling**: Uses Telegram's permission APIs when available
- **Voice Activity Detection (VAD)**: Implements VAD to automatically detect end of speech
- **Haptic Feedback**: Provides haptic feedback for user interactions
- **Audio Format Conversion**: Handles conversion between different audio formats

```javascript
// Example of Telegram-specific permission handling
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
```

### 7.2 Voice Activity Detection (VAD)

The TelegramAudioBridge implements a simple but effective Voice Activity Detection system to automatically detect when the user has stopped speaking:

```javascript
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
```

## 8. Backend Audio Processing

### 8.1 WebSocket Proxy

The backend WebSocket proxy (`gemini_websocket_proxy.js`) handles audio format conversion and communication with the Gemini Live API.

Key features:

- **WebM to PCM Conversion**: Converts WebM audio to PCM format using FFmpeg
- **Audio Streaming**: Streams audio data to and from the Gemini Live API
- **Session Management**: Manages WebSocket sessions and connections
- **Error Handling**: Provides robust error handling and recovery

### 8.2 Audio Format Conversion

The backend uses FFmpeg to convert WebM audio to PCM format:

```javascript
async transcodeWebmStreamToPcmViaStdIn(fullWebmBuffer) {
    this.log(`Attempting to transcode ${fullWebmBuffer.length} bytes of WebM data via stdin`);
    let pcmDataBuffer = null;

    try {
        pcmDataBuffer = await new Promise((resolve, reject) => {
            const ffmpegArgs = [
                '-f', 'webm',
                '-c:a', 'libopus',
                '-i', 'pipe:0',
                '-f', 's16le',
                '-ar', '16000',
                '-ac', '1',
                '-'
            ];
            this.log('Spawning ffmpeg with stdin piping, args:', ffmpegArgs);
            const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
            
            const outputBuffers = [];
            const errorOutput = [];
            
            ffmpegProcess.stdin.on('error', (err) => {
                this.log('ffmpeg stdin error:', { error: err.message }, true);
            });

            ffmpegProcess.stdout.on('data', (data) => outputBuffers.push(data));
            ffmpegProcess.stderr.on('data', (data) => {
                const errStr = data.toString();
                this.log(`ffmpeg stderr: ${errStr.trim()}`); 
                errorOutput.push(errStr);
            });
            
            ffmpegProcess.on('close', (code) => {
                if (code === 0) {
                    const resultBuffer = Buffer.concat(outputBuffers);
                    this.log(`ffmpeg stdin transcoding successful, PCM size: ${resultBuffer.length}`);
                    resolve(resultBuffer.length > 0 ? resultBuffer : Buffer.alloc(0));
                } else {
                    const fullErrorString = errorOutput.join('');
                    this.log(`ffmpeg (stdin) exited with code ${code}. Full Error: ${fullErrorString}`, null, true);
                    reject(new Error(`ffmpeg (stdin) exited with code ${code}. Error: ${fullErrorString.substring(0, 1000)}`));
                }
            });
            
            ffmpegProcess.on('error', (err) => {
                this.log(`ffmpeg process error (stdin): ${err.message}`, null, true);
                reject(new Error(`ffmpeg process error (stdin): ${err.message}`));
            });

            ffmpegProcess.stdin.write(fullWebmBuffer);
            ffmpegProcess.stdin.end();
        });
        
    } catch (error) {
        this.log('Error during stdin transcoding process', { error: error.message }, true);
    }
    return pcmDataBuffer;
}
```

### 8.3 Audio Streaming to Gemini

The backend streams audio data to the Gemini Live API:

```javascript
// Send audio data to Gemini
const audioInput = { 
    audio: { 
        data: base64PcmData, 
        mimeType: 'audio/pcm;rate=16000' 
    } 
};
await this.liveSession.sendRealtimeInput(audioInput);
```

## 9. Challenges and Solutions

### 9.1 Mobile Browser Compatibility

**Challenge**: Mobile browsers have strict autoplay policies and require user interaction to unlock audio.

**Solution**: We implemented a comprehensive audio unlocking strategy that:
- Plays a silent audio file on user interaction
- Uses Telegram's WebApp APIs when available
- Provides clear feedback when audio is blocked
- Implements retry mechanisms for failed unlocks

### 9.2 Audio Format Compatibility

**Challenge**: Different platforms and browsers support different audio formats and sample rates.

**Solution**: We implemented a multi-stage format conversion pipeline:
- Frontend: Float32 to Int16 PCM conversion
- Backend: WebM to PCM conversion using FFmpeg
- Resampling between different sample rates
- Format detection and adaptation

### 9.3 Latency Management

**Challenge**: Minimizing latency in audio recording and playback is crucial for a natural conversation experience.

**Solution**: We implemented several latency reduction techniques:
- Using AudioWorklet for off-main-thread processing
- Streaming audio in small chunks
- Precise audio scheduling
- Buffer management to balance latency and playback stability
- Adaptive buffer sizes based on network conditions

### 9.4 Permission Handling

**Challenge**: Different platforms handle audio permission requests differently.

**Solution**: We implemented a unified permission handling system:
- Uses Telegram's permission APIs when available
- Falls back to standard browser permissions
- Provides clear feedback on permission state
- Implements retry mechanisms for permission requests

## 10. Performance Optimizations

### 10.1 AudioWorklet

Using AudioWorklet instead of ScriptProcessorNode provides several performance benefits:
- Runs in a separate thread, avoiding main thread blocking
- More efficient audio processing
- Lower latency
- Better handling of audio discontinuities

### 10.2 Audio Pooling

To improve performance and reduce memory usage, we implemented an audio pooling system:

```javascript
getAudioFromPool() {
    if (this.audioPool.length > 0) return this.audioPool.shift();
    const audio = new Audio();
    audio.preload = 'auto';
    if (this.isMobile) audio.crossOrigin = 'anonymous';
    return audio;
}

returnAudioToPool(audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.src = '';
    if (this.audioPool.length < 5) this.audioPool.push(audio);
}
```

### 10.3 Efficient Buffer Management

We implemented efficient buffer management to minimize memory usage and GC pressure:

```javascript
// Reuse buffers when possible
const newBuffer = new Float32Array(this.processingBuffer.length + pcmData.length);
newBuffer.set(this.processingBuffer);
newBuffer.set(pcmData, this.processingBuffer.length);
this.processingBuffer = newBuffer;
```

### 10.4 Backend Optimizations

On the backend, we implemented several optimizations:
- Using FFmpeg's stdin piping for efficient audio conversion
- Streaming audio in chunks to minimize memory usage
- Implementing connection pooling for WebSocket connections
- Using binary WebSocket messages for audio data

## 11. Future Improvements

### 11.1 Enhanced VAD

Our current VAD implementation is effective but could be improved with:
- Machine learning-based VAD for better accuracy
- Adaptive thresholds based on background noise
- Speaker diarization for multi-user scenarios

### 11.2 Audio Quality Improvements

Potential audio quality improvements include:
- Advanced noise suppression
- Echo cancellation
- Automatic gain control
- Audio normalization

### 11.3 Bandwidth Optimization

To reduce bandwidth usage, we could implement:
- Audio compression
- Variable bitrate encoding
- Adaptive quality based on network conditions
- Selective audio transmission based on speech detection

### 11.4 Offline Support

Adding offline support would improve reliability:
- Local audio caching
- Offline transcription
- Reconnection with session resumption
- Background processing

### 11.5 Advanced Audio Features

Future versions could include:
- Multi-channel audio support
- Spatial audio
- Audio effects and filters
- Voice transformation
- Background music and sound effects
