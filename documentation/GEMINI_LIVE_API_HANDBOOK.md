# Gemini Live API Handbook

## Table of Contents

1. [Introduction](#1-introduction)
2. [API Overview](#2-api-overview)
3. [Architecture & Integration](#3-architecture--integration)
4. [Implementation Guide](#4-implementation-guide)
5. [Advanced Features](#5-advanced-features)
6. [Troubleshooting & Best Practices](#6-troubleshooting--best-practices)
7. [Reference](#7-reference)
8. [Examples](#8-examples)

## 1. Introduction

### 1.1 Purpose of This Handbook

This handbook serves as the definitive guide for understanding and implementing Google's Gemini Live API within our Telegram Voice Chat application. It consolidates information from multiple sources into a single, structured reference that addresses both high-level concepts and practical implementation details.

### 1.2 What is Gemini Live API?

The Gemini Live API enables real-time, bidirectional communication with Google's Gemini models through WebSocket connections. Unlike traditional REST APIs, the Live API supports streaming of multimodal inputs (audio, text, video) and outputs (audio, text), making it ideal for voice-based applications that require natural, conversational interactions.

Key capabilities include:
- Low-latency, bidirectional streaming
- Voice activity detection (VAD)
- Real-time audio transcription and synthesis
- Function calling for extended capabilities
- Native audio output for natural-sounding voices
- Proactive and affective dialog features

### 1.3 Why We're Using It

Our Telegram Voice Chat application requires:
- Real-time voice conversations with minimal latency
- Natural-sounding AI responses
- Ability to interrupt the AI mid-response (barge-in)
- High-quality audio processing
- Seamless integration with Telegram's voice messaging features

The Gemini Live API, particularly with the Gemini 2.5 models, provides all these capabilities in a single, powerful package.

## 2. API Overview

### 2.1 Core Concepts

#### 2.1.1 Session-Based Interaction

The Live API operates on a session model:
- A WebSocket connection establishes a "session"
- The initial message configures the session parameters
- The session maintains state throughout the conversation
- Sessions can be extended using context window compression or session resumption

#### 2.1.2 Bidirectional Streaming

Both the client and server continuously stream data:
- Client sends user input (audio, text, video)
- Server streams back responses (text or audio)
- Messages can be sent and received asynchronously

#### 2.1.3 Input/Output Modalities

**Input:**
- Audio: 16-bit PCM, 16kHz, mono (preferred format)
- Text: For text-based interactions or commands
- Video: For multimodal interactions (not used in our current implementation)

**Output:**
- Audio: 16-bit PCM, 24kHz, mono
- Text: For transcriptions or text-only responses

**Important:** A session can be configured for either text or audio output, but not both simultaneously.

#### 2.1.4 Turn-Based Conversation

Interactions are managed in "turns":
- User provides input (a "user turn")
- Model responds (a "model turn")
- Turns can be interrupted (e.g., user speaks while model is responding)

### 2.2 Available Models

For our Telegram Voice Chat application, we primarily use:

| Model | Description | Best For |
|-------|-------------|----------|
| `gemini-2.5-flash-preview-native-audio-dialog` | Latest model with native audio capabilities | Production voice interactions |
| `gemini-2.0-flash-live-001` | General-purpose live model | Testing or fallback |

### 2.3 Authentication

**Critical Security Note:** The Live API is designed for server-to-server authentication. Never expose API keys in client-side code.

Our implementation uses a backend proxy architecture:
1. Telegram client sends requests to our backend server
2. Our server authenticates with Google using API keys stored securely
3. Our server proxies the WebSocket connection to Gemini

## 3. Architecture & Integration

### 3.1 System Architecture

Our Telegram Voice Chat application uses a three-tier architecture:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  Telegram Bot   │◄────┤  n8n Workflows  │◄────┤  Frontend App   │
│                 │     │                 │     │  (GitHub Pages) │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │                       │                       │
         │                       ▼                       │
         │              ┌─────────────────┐              │
         └─────────────►│  WebSocket      │◄─────────────┘
                        │  Proxy Server   │
                        │  (AWS)          │
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │                 │
                        │  Google Gemini  │
                        │  Live API       │
                        │                 │
                        └─────────────────┘
```

### 3.2 Data Flow

1. **User Input Flow:**
   - User sends voice message via Telegram
   - Frontend captures audio and sends to WebSocket Proxy
   - Proxy transcodes audio to required format (16-bit PCM, 16kHz, mono)
   - Proxy forwards audio to Gemini Live API via WebSocket

2. **Response Flow:**
   - Gemini generates audio response (16-bit PCM, 24kHz, mono)
   - WebSocket Proxy receives audio chunks
   - Proxy forwards audio to Frontend
   - Frontend plays audio to user

3. **Function Calling Flow:**
   - Gemini may request function execution (e.g., sending emails)
   - WebSocket Proxy receives function call request
   - Proxy routes request to appropriate n8n workflow
   - n8n executes function and returns result
   - Proxy sends result back to Gemini
   - Gemini continues conversation

### 3.3 Integration Points

#### 3.3.1 Telegram Integration

Our application integrates with Telegram through:
- Telegram Bot API for message handling
- Telegram Mini App for the user interface
- WebSocket connections for real-time audio streaming

#### 3.3.2 WebSocket Proxy

The WebSocket Proxy (`gemini_websocket_proxy.js`) serves as the bridge between our frontend and the Gemini Live API:
- Handles WebSocket connections from the frontend
- Authenticates with Gemini using API keys
- Transcodes audio between formats
- Routes function calls to n8n workflows

#### 3.3.3 n8n Workflows

Our n8n workflows handle:
- Telegram webhook processing
- Session management
- Function execution (e.g., email sending)
- User data storage

## 4. Implementation Guide

### 4.1 Setting Up the WebSocket Connection

#### 4.1.1 Backend Implementation (Node.js)

```javascript
// From gemini_websocket_proxy.js
const WebSocket = require('ws');
const { GoogleGenerativeAI } = require('@google/genai');

// Initialize the Google GenAI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Create a WebSocket server
const wss = new WebSocket.Server({ port: 8003 });

wss.on('connection', async (ws, req) => {
  // Parse session token from URL
  const url = new URL(req.url, 'http://localhost');
  const sessionToken = url.searchParams.get('session');
  
  // Validate session token (implementation details omitted)
  
  // Connect to Gemini Live API
  const model = 'gemini-2.5-flash-preview-native-audio-dialog';
  const config = {
    responseModalities: ['AUDIO'],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: 'Kore' }
      },
      languageCode: 'en-US'
    },
    realtimeInputConfig: {
      automaticActivityDetection: {
        endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
        silenceDurationMs: 700
      }
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {}
  };
  
  try {
    const session = await genAI.live.connect({
      model: model,
      config: config,
      callbacks: {
        onopen: () => console.log('Gemini connection opened'),
        onmessage: (message) => {
          // Forward messages to the client
          ws.send(JSON.stringify(message));
        },
        onerror: (error) => console.error('Gemini error:', error),
        onclose: () => console.log('Gemini connection closed')
      }
    });
    
    // Handle messages from the client
    ws.on('message', (message) => {
      const data = JSON.parse(message);
      
      if (data.type === 'audio') {
        // Process and forward audio to Gemini
        session.sendRealtimeInput({
          audio: {
            data: data.audio,
            mimeType: 'audio/pcm;rate=16000'
          }
        });
      } else if (data.type === 'text') {
        // Forward text to Gemini
        session.sendClientContent({
          turns: data.text,
          turnComplete: true
        });
      } else if (data.type === 'audioStreamEnd') {
        // Signal end of audio stream
        session.sendRealtimeInput({ audioStreamEnd: true });
      }
    });
    
    // Handle client disconnect
    ws.on('close', () => {
      session.close();
    });
  } catch (error) {
    console.error('Failed to connect to Gemini:', error);
    ws.close();
  }
});
```

#### 4.1.2 Frontend Implementation (JavaScript)

```javascript
// From gemini_telegram_client.js
class GeminiTelegramClient {
  constructor(config) {
    this.config = config;
    this.ws = null;
    this.audioRecorder = new AdvancedAudioRecorder();
    this.pcmPlayer = new PCMStreamPlayer();
    this.connected = false;
  }
  
  connect() {
    const sessionToken = this.getSessionToken();
    const wsUrl = `wss://gemini-proxy.lomeai.com/ws?session=${sessionToken}`;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('WebSocket connection established');
      this.connected = true;
      this.ws.send(JSON.stringify({ type: 'websocket_ready' }));
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.text) {
        // Handle text response
        console.log('Received text:', message.text);
      } else if (message.data) {
        // Handle audio response
        const audioData = message.data;
        this.pcmPlayer.streamAudioChunk(audioData, 24000);
      } else if (message.serverContent) {
        // Handle server content (transcriptions, etc.)
        if (message.serverContent.inputTranscription) {
          console.log('Input transcription:', message.serverContent.inputTranscription.text);
        }
        if (message.serverContent.outputTranscription) {
          console.log('Output transcription:', message.serverContent.outputTranscription.text);
        }
        if (message.serverContent.interrupted) {
          console.log('Model output interrupted');
          this.pcmPlayer.stopPlayback();
        }
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket connection closed');
      this.connected = false;
    };
  }
  
  startConversation() {
    if (!this.connected) {
      console.error('Cannot start conversation: WebSocket not connected');
      return;
    }
    
    this.audioRecorder.start((audioChunk) => {
      if (this.connected) {
        this.ws.send(JSON.stringify({
          type: 'audio',
          audio: audioChunk
        }));
      }
    });
  }
  
  stopConversation() {
    this.audioRecorder.stop();
    if (this.connected) {
      this.ws.send(JSON.stringify({ type: 'audioStreamEnd' }));
    }
  }
  
  sendTextMessage(text) {
    if (this.connected) {
      this.ws.send(JSON.stringify({
        type: 'text',
        text: text
      }));
    }
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
  
  getSessionToken() {
    // Implementation details omitted
    // This would extract the session token from URL parameters
    // or generate a new one
  }
}
```

### 4.2 Audio Processing

#### 4.2.1 Recording Audio (Frontend)

```javascript
// From advanced_audio_recorder.js
class AdvancedAudioRecorder {
  constructor() {
    this.audioContext = null;
    this.workletNode = null;
    this.mediaStream = null;
    this.isRecording = false;
  }
  
  async start(callback) {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      
      // Load audio worklet for processing
      await this.audioContext.audioWorklet.addModule('audio_processor_worklet.js');
      
      // Get microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      // Create audio worklet node
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');
      
      // Connect nodes
      source.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);
      
      // Set up message handling
      this.workletNode.port.onmessage = (event) => {
        if (event.data.eventType === 'audio') {
          const audioData = event.data.audioData;
          callback(audioData);
        }
      };
      
      this.isRecording = true;
    } catch (error) {
      console.error('Error starting audio recorder:', error);
    }
  }
  
  stop() {
    if (this.isRecording) {
      if (this.workletNode) {
        this.workletNode.disconnect();
        this.workletNode = null;
      }
      
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }
      
      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }
      
      this.isRecording = false;
    }
  }
  
  suspendMic() {
    if (this.audioContext) {
      this.audioContext.suspend();
    }
  }
  
  resumeMic() {
    if (this.audioContext) {
      this.audioContext.resume();
    }
  }
}
```

#### 4.2.2 Audio Worklet Processor

```javascript
// From audio_processor_worklet.js
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 1024;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }
  
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    
    const inputChannel = input[0];
    
    // Fill buffer with incoming audio
    for (let i = 0; i < inputChannel.length; i++) {
      this.buffer[this.bufferIndex++] = inputChannel[i];
      
      // When buffer is full, send it to the main thread
      if (this.bufferIndex >= this.bufferSize) {
        // Convert Float32Array to Int16Array for PCM
        const int16Buffer = new Int16Array(this.bufferSize);
        for (let j = 0; j < this.bufferSize; j++) {
          // Convert float [-1.0, 1.0] to int16 [-32768, 32767]
          int16Buffer[j] = Math.max(-1, Math.min(1, this.buffer[j])) * 0x7FFF;
        }
        
        // Send to main thread
        this.port.postMessage({
          eventType: 'audio',
          audioData: int16Buffer.buffer
        }, [int16Buffer.buffer]);
        
        // Reset buffer
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
      }
    }
    
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
```

#### 4.2.3 Playing Audio (Frontend)

```javascript
// From pcm_stream_player.js
class PCMStreamPlayer {
  constructor() {
    this.audioContext = null;
    this.audioQueue = [];
    this.isPlaying = false;
    this.volume = 1.0;
  }
  
  initialize() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    }
  }
  
  streamAudioChunk(base64PcmData, sampleRate = 24000) {
    this.initialize();
    
    // Decode base64 to ArrayBuffer
    const binaryString = window.atob(base64PcmData);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Convert to Int16Array
    const int16Data = new Int16Array(bytes.buffer);
    
    // Convert to Float32Array for Web Audio API
    const floatData = new Float32Array(int16Data.length);
    for (let i = 0; i < int16Data.length; i++) {
      floatData[i] = int16Data[i] / 0x7FFF;
    }
    
    // Create audio buffer
    const audioBuffer = this.audioContext.createBuffer(1, floatData.length, sampleRate);
    audioBuffer.getChannelData(0).set(floatData);
    
    // Add to queue
    this.audioQueue.push(audioBuffer);
    
    // Start playing if not already
    if (!this.isPlaying) {
      this.playNextChunk();
    }
  }
  
  playNextChunk() {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      return;
    }
    
    this.isPlaying = true;
    const audioBuffer = this.audioQueue.shift();
    
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    
    // Apply volume
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = this.volume;
    
    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    
    source.onended = () => {
      this.playNextChunk();
    };
    
    source.start();
  }
  
  stopPlayback() {
    this.audioQueue = [];
    this.isPlaying = false;
  }
  
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
  }
}
```

### 4.3 Session Management

#### 4.3.1 Session Token Generation (n8n)

Our n8n workflow (`Voice_Session_API.json`) handles session token generation:

1. Receive request from frontend
2. Generate a unique session ID
3. Create a session token with user data
4. Return the token and WebSocket URL to the frontend

#### 4.3.2 Session Token Validation (Backend)

```javascript
// From gemini_websocket_proxy.js (simplified)
function validateSessionToken(token) {
  try {
    // Decode Base64 token
    const decodedToken = Buffer.from(token, 'base64').toString('utf-8');
    const [userId, sessionId, timestamp, userData] = decodedToken.split(':');
    
    // Check if token is expired (e.g., 1 hour)
    const tokenTime = parseInt(timestamp, 10);
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime - tokenTime > 3600) {
      return { valid: false, reason: 'Token expired' };
    }
    
    // Parse user data
    const user = userData ? JSON.parse(userData) : {};
    
    return {
      valid: true,
      userId,
      sessionId,
      user
    };
  } catch (error) {
    return { valid: false, reason: 'Invalid token format' };
  }
}
```

#### 4.3.3 Session Resumption

For long conversations, we implement session resumption:

```javascript
// Backend implementation (simplified)
const sessionHandles = new Map();

// When receiving a session resumption update
if (message.sessionResumptionUpdate && message.sessionResumptionUpdate.newHandle) {
  const sessionId = getSessionIdFromToken(sessionToken);
  sessionHandles.set(sessionId, message.sessionResumptionUpdate.newHandle);
}

// When reconnecting
const sessionId = getSessionIdFromToken(sessionToken);
const resumptionHandle = sessionHandles.get(sessionId);

if (resumptionHandle) {
  config.sessionResumption = {
    handle: resumptionHandle
  };
}
```

## 5. Advanced Features

### 5.1 Voice Activity Detection (VAD)

Our implementation uses server-side VAD with customized sensitivity:

```javascript
// Backend configuration
const vadConfig = {
  realtimeInputConfig: {
    automaticActivityDetection: {
      disabled: false, // Enable automatic detection
      endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
      silenceDurationMs: 700 // Shorter silence for quicker turn-ending
    }
  }
};
```

### 5.2 Barge-In (Interruptions)

We enable barge-in to allow users to interrupt the model:

```javascript
// Backend configuration
const bargeInConfig = {
  realtimeInputConfig: {
    activityHandling: 'START_OF_ACTIVITY_INTERRUPTS' // Enable barge-in
  }
};

// Frontend handling
if (message.serverContent && message.serverContent.interrupted) {
  console.log('Model output interrupted');
  this.pcmPlayer.stopPlayback(); // Stop playing current audio
}
```

### 5.3 Function Calling

Our implementation supports function calling for extended capabilities:

```javascript
// Backend configuration
const toolsConfig = {
  tools: [
    {
      functionDeclarations: [
        {
          name: 'send_konverter_email',
          description: 'Send an email with Konverter information',
          parameters: {
            type: 'object',
            properties: {
              recipient_email: {
                type: 'string',
                description: 'Email address of the recipient'
              },
              subject: {
                type: 'string',
                description: 'Email subject'
              },
              message: {
                type: 'string',
                description: 'Email message body'
              }
            },
            required: ['recipient_email']
          }
        }
      ]
    }
  ]
};

// Backend handling of function calls
if (message.toolCall) {
  const toolCall = message.toolCall;
  
  // Route to n8n webhook
  const response = await fetch('https://n8n.lomeai.com/webhook/email-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: toolCall.requestId,
      functionCalls: toolCall.functionCalls
    })
  });
  
  const result = await response.json();
  
  // Send result back to Gemini
  session.sendToolResponse({
    requestId: toolCall.requestId,
    functionResponses: result.functionResponses
  });
}
```

### 5.4 Native Audio Output

We use Gemini 2.5's native audio capabilities for higher quality voice:

```javascript
// Backend configuration
const nativeAudioConfig = {
  model: 'gemini-2.5-flash-preview-native-audio-dialog',
  responseModalities: ['AUDIO'],
  speechConfig: {
    voiceConfig: {
      prebuiltVoiceConfig: { voiceName: 'Kore' }
    },
    languageCode: 'en-US'
  }
};
```

### 5.5 Context Window Compression

For longer conversations, we implement context window compression:

```javascript
// Backend configuration
const compressionConfig = {
  contextWindowCompression: {
    triggerTokens: 25600,
    slidingWindow: {
      targetTokens: 12800
    }
  }
};
```

## 6. Troubleshooting & Best Practices

### 6.1 Common Issues

#### 6.1.1 Audio Format Issues

**Problem:** Audio not being processed correctly by Gemini.

**Solution:**
- Ensure audio is 16-bit PCM, 16kHz, mono
- Check that Base64 encoding/decoding is correct
- Verify MIME type is set to `audio/pcm;rate=16000`

#### 6.1.2 WebSocket Connection Issues

**Problem:** WebSocket connection fails or disconnects frequently.

**Solution:**
- Check network connectivity
- Verify API key is valid
- Implement reconnection logic with exponential backoff
- Use session resumption for seamless reconnection

#### 6.1.3 High Latency

**Problem:** Voice responses have high latency.

**Solution:**
- Optimize audio chunk size (smaller chunks = lower latency but more overhead)
- Ensure server has sufficient resources
- Consider using a CDN for WebSocket proxy
- Implement streaming playback (play audio as it arrives)

### 6.2 Best Practices

#### 6.2.1 Security

- **Never expose API keys in client-side code**
- Use a backend proxy for all Gemini API calls
- Implement proper session token validation
- Use HTTPS for all connections

#### 6.2.2 Performance

- Process audio in small chunks (1024-4096 samples)
- Use AudioWorklet for off-main-thread audio processing
- Implement audio buffering to handle network jitter
- Use binary WebSocket messages for audio data

#### 6.2.3 User Experience

- Provide visual feedback during voice interactions
- Display transcriptions for accessibility
- Implement graceful error handling
- Allow users to interrupt the AI (barge-in)

## 7. Reference

### 7.1 API Endpoints

- **WebSocket URL:** `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`
- **Our WebSocket Proxy:** `wss://gemini-proxy.lomeai.com/ws`

### 7.2 Message Types

#### 7.2.1 Client to Server

- `setup`: Initial session configuration
- `clientContent`: Text content for conversation turns
- `realtimeInput`: Real-time audio, video, or text input
- `toolResponse`: Response to a function call

#### 7.2.2 Server to Client

- `setupComplete`: Confirmation of setup
- `serverContent`: Model-generated content
- `toolCall`: Request for function execution
- `toolCallCancellation`: Cancellation of a function call
- `goAway`: Notification of impending disconnection
- `sessionResumptionUpdate`: Updated session handle

### 7.3 Configuration Options

#### 7.3.1 Model Configuration

- `model`: The Gemini model to use
- `generationConfig`: Parameters for text generation
- `responseModalities`: Output type (`TEXT` or `AUDIO`)
- `speechConfig`: Voice configuration for audio output
- `systemInstruction`: Instructions for the model's behavior

#### 7.3.2 Real-time Input Configuration

- `automaticActivityDetection`: VAD settings
- `activityHandling`: How to handle user interruptions
- `turnCoverage`: What constitutes a user turn

### 7.4 Audio Formats

- **Input Audio:** 16-bit PCM, 16kHz, mono
- **Output Audio:** 16-bit PCM, 24kHz, mono

## 8. Examples

### 8.1 Complete WebSocket Session Example

```javascript
// Backend example (simplified)
const WebSocket = require('ws');
const { GoogleGenerativeAI } = require('@google/genai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function handleSession(clientWs) {
  try {
    const session = await genAI.live.connect({
      model: 'gemini-2.5-flash-preview-native-audio-dialog',
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' }
          }
        },
        realtimeInputConfig: {
          automaticActivityDetection: {}
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {}
      },
      callbacks: {
        onopen: () => console.log('Gemini connection opened'),
        onmessage: (message) => clientWs.send(JSON.stringify(message)),
        onerror: (error) => console.error('Gemini error:', error),
        onclose: () => console.log('Gemini connection closed')
      }
    });
    
    clientWs.on('message', (message) => {
      const data = JSON.parse(message);
      
      if (data.type === 'audio') {
        // Process and forward audio to Gemini
        session.sendRealtimeInput({
          audio: {
            data: data.audio,
            mimeType: 'audio/pcm;rate=16000'
          }
        });
      } else if (data.type === 'text') {
        // Forward text to Gemini
        session.sendClientContent({
          turns: data.text,
          turnComplete: true
        });
      } else if (data.type === 'audioStreamEnd') {
        // Signal end of audio stream
        session.sendRealtimeInput({ audioStreamEnd: true });
      }
    });
    
    clientWs.on('close', () => {
      session.close();
      console.log('Client disconnected, closing Gemini session');
    });
  } catch (error) {
    console.error('Failed to connect to Gemini:', error);
    clientWs.close();
  }
}
```

### 8.2 Function Calling Example

```javascript
// Backend function calling example
async function handleFunctionCall(message, session) {
  if (!message.toolCall) return;
  
  const toolCall = message.toolCall;
  console.log('Received function call:', toolCall);
  
  try {
    // Extract function call details
    const requestId = toolCall.requestId;
    const functionCall = toolCall.functionCalls[0];
    const functionName = functionCall.name;
    const args = functionCall.args;
    
    let result;
    
    // Handle different functions
    if (functionName === 'send_konverter_email') {
      // Call n8n webhook for email sending
      const response = await fetch('https://n8n.lomeai.com/webhook/email-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: args.recipient_email,
          subject: args.subject || 'Information from Konverter',
          message: args.message || 'Thank you for your interest in Konverter.'
        })
      });
      
      result = await response.json();
    } else if (functionName === 'get_user_data') {
      // Fetch user data from database
      result = {
        name: 'John Doe',
        email: 'john@example.com',
        preferences: {
          notifications: true,
          language: 'en-US'
        }
      };
    }
    
    // Send response back to Gemini
    await session.sendToolResponse({
      requestId: requestId,
      functionResponses: [
        {
          name: functionName,
          response: result
        }
      ]
    });
    
    console.log('Sent function response for:', functionName);
  } catch (error) {
    console.error('Error handling function call:', error);
    
    // Send error response
    await session.sendToolResponse({
      requestId: toolCall.requestId,
      functionResponses: [
        {
          name: toolCall.functionCalls[0].name,
          error: error.message
        }
      ]
    });
  }
}
```

### 8.3 Audio Processing Example

```javascript
// Audio processing utility functions

// Convert PCM audio from 44.1kHz to 16kHz (simplified example)
function downsampleAudio(audioBuffer, originalSampleRate, targetSampleRate) {
  if (originalSampleRate === targetSampleRate) {
    return audioBuffer;
  }
  
  const ratio = originalSampleRate / targetSampleRate;
  const newLength = Math.round(audioBuffer.length / ratio);
  const result = new Int16Array(newLength);
  
  for (let i = 0; i < newLength; i++) {
    const originalIndex = Math.floor(i * ratio);
    result[i] = audioBuffer[originalIndex];
  }
  
  return result;
}

// Convert Int16Array PCM to Base64
function pcmToBase64(pcmData) {
  const buffer = new ArrayBuffer(pcmData.length * 2); // 2 bytes per sample
  const view = new DataView(buffer);
  
  for (let i = 0; i < pcmData.length; i++) {
    view.setInt16(i * 2, pcmData[i], true); // true for little-endian
  }
  
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  
  return btoa(binary);
}

// Convert Base64 to Int16Array PCM
function base64ToPcm(base64Data) {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return new Int16Array(bytes.buffer);
}
```

### 8.4 Session Resumption Example

```javascript
// Session resumption implementation

// Store for session handles
const sessionHandles = new Map();

// Function to handle session resumption
async function connectWithResumption(userId, sessionId) {
  const resumptionKey = `${userId}:${sessionId}`;
  const resumptionHandle = sessionHandles.get(resumptionKey);
  
  let config = {
    responseModalities: ['AUDIO'],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: 'Kore' }
      }
    },
    realtimeInputConfig: {
      automaticActivityDetection: {}
    }
  };
  
  // Add resumption config if we have a handle
  if (resumptionHandle) {
    console.log(`Attempting to resume session with handle: ${resumptionHandle}`);
    config.sessionResumption = {
      handle: resumptionHandle
    };
  }
  
  try {
    const session = await genAI.live.connect({
      model: 'gemini-2.5-flash-preview-native-audio-dialog',
      config: config,
      callbacks: {
        onopen: () => console.log('Gemini connection opened'),
        onmessage: (message) => {
          // Store new resumption handle if provided
          if (message.sessionResumptionUpdate && message.sessionResumptionUpdate.newHandle) {
            const newHandle = message.sessionResumptionUpdate.newHandle;
            console.log(`Received new session handle: ${newHandle}`);
            sessionHandles.set(resumptionKey, newHandle);
          }
          
          // Process other message types...
        },
        onerror: (error) => console.error('Gemini error:', error),
        onclose: () => console.log('Gemini connection closed')
      }
    });
    
    return session;
  } catch (error) {
    console.error('Failed to connect or resume session:', error);
    // Clear invalid handle
    if (resumptionHandle) {
      console.log('Clearing invalid resumption handle');
      sessionHandles.delete(resumptionKey);
    }
    throw error;
  }
}
```

## 9. Additional Resources

### 9.1 Official Documentation

- [Google Gemini API Documentation](https://ai.google.dev/docs/gemini_api)
- [Gemini Live API Reference](https://ai.google.dev/api/live)
- [Google GenAI SDK for JavaScript](https://googleapis.github.io/js-genai/release_docs/)

### 9.2 Internal Documentation

- [WebSocket Proxy Implementation](../backend/gemini_websocket_proxy.js)
- [Frontend Client Implementation](../front_end/gemini_telegram_client.js)
- [n8n Workflow Documentation](../n8n/README.md)

### 9.3 Support Resources

- [Google AI Discord Community](https://discord.gg/google-ai)
- [Google AI Support](https://ai.google.dev/community)
- [Internal Support Contacts](../SUPPORT.md)

## 10. Conclusion

This handbook provides a comprehensive guide to understanding and implementing the Gemini Live API in our Telegram Voice Chat application. By following the guidelines and best practices outlined here, engineers can effectively work with the API to create seamless, natural voice interactions.

As the API and our implementation evolve, this handbook will be updated to reflect the latest changes and improvements. If you encounter any issues or have suggestions for improving this documentation, please contact the CTO or technical lead.
