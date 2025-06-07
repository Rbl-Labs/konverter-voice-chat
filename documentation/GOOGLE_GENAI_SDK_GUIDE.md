# Google GenAI SDK for JavaScript - Developer Guide

## Table of Contents

1. [Introduction](#1-introduction)
2. [SDK Architecture](#2-sdk-architecture)
3. [Installation and Setup](#3-installation-and-setup)
4. [Core Components](#4-core-components)
5. [Live API Implementation](#5-live-api-implementation)
6. [Advanced Usage Patterns](#6-advanced-usage-patterns)
7. [Troubleshooting](#7-troubleshooting)
8. [SDK Version Management](#8-sdk-version-management)
9. [Best Practices](#9-best-practices)
10. [Reference](#10-reference)

## 1. Introduction

The Google GenAI SDK for JavaScript (`@google/genai`) provides a structured interface for interacting with Google's Generative AI models, including Gemini. This guide focuses specifically on the Live API functionality within the SDK, which is essential for our Telegram voice chat application.

### 1.1 Purpose of This Guide

This document serves as the definitive reference for working with the Google GenAI SDK in our project. It provides:

- Detailed explanations of SDK components and their relationships
- Practical implementation patterns specific to our use case
- Troubleshooting guidance for common issues
- Best practices for efficient and secure SDK usage

### 1.2 SDK Overview

The `@google/genai` SDK is organized into several modules, with the `live` module being particularly important for our real-time voice application. The SDK abstracts away many of the complexities of the underlying WebSocket protocol, providing a clean, typed interface for JavaScript/TypeScript developers.

Key features include:
- Type-safe interfaces for request and response objects
- Callback-based event handling
- Helper methods for sending different types of input (text, audio)
- Error handling and connection management

## 2. SDK Architecture

### 2.1 High-Level Architecture

The SDK follows a layered architecture:

```
┌─────────────────────────────────────────┐
│              Application                │
└───────────────────┬─────────────────────┘
                    │
┌───────────────────▼─────────────────────┐
│            @google/genai SDK            │
├─────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│  │   live  │  │  chat   │  │  model  │  │
│  └─────────┘  └─────────┘  └─────────┘  │
└───────────────────┬─────────────────────┘
                    │
┌───────────────────▼─────────────────────┐
│         Google Generative AI API        │
└─────────────────────────────────────────┘
```

### 2.2 Key Classes and Relationships

The main classes involved in Live API interactions are:

- `GoogleGenerativeAI`: The entry point to the SDK
- `Live`: Accessed via `genAI.live`, provides methods to establish live sessions
- `Session`: Represents an active WebSocket connection with the Gemini model

The relationship flow is:
```
GoogleGenerativeAI → Live → Session → WebSocket Connection
```

## 3. Installation and Setup

### 3.1 Installation

```bash
npm install @google/genai
# or
yarn add @google/genai
```

### 3.2 Basic Initialization

```javascript
import { GoogleGenerativeAI } from '@google/genai';

// Initialize the client with your API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Access the live module
const live = genAI.live;
```

### 3.3 API Version Selection

The SDK supports different API versions:

```javascript
// For v1beta (default)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// For v1alpha (needed for some advanced features)
const genAIAlpha = new GoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  apiVersion: 'v1alpha'
});
```

## 4. Core Components

### 4.1 GoogleGenerativeAI Class

The main entry point to the SDK.

**Key Properties:**
- `live`: Access to the Live API functionality
- `genText`: For generating text (non-streaming)
- `genChat`: For chat-based interactions (non-streaming)

**Example:**
```javascript
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const live = genAI.live;
```

### 4.2 Live Class

Provides methods to establish live sessions with Gemini models.

**Key Methods:**
- `connect(options)`: Establishes a WebSocket connection and returns a Session

**Example:**
```javascript
const session = await genAI.live.connect({
  model: 'gemini-2.5-flash-preview-native-audio-dialog',
  config: { /* configuration options */ },
  callbacks: { /* event handlers */ }
});
```

### 4.3 Session Class

Represents an active WebSocket connection with the Gemini model.

**Key Methods:**
- `sendClientContent(request)`: Sends text content to the model
- `sendRealtimeInput(request)`: Sends real-time data (audio, video, text)
- `sendToolResponse(request)`: Sends responses to function calls
- `close()`: Closes the WebSocket connection

**Example:**
```javascript
// Send audio data
session.sendRealtimeInput({
  audio: {
    data: base64EncodedAudio,
    mimeType: 'audio/pcm;rate=16000'
  }
});

// Close the session
session.close();
```

## 5. Live API Implementation

### 5.1 Establishing a Connection

The `connect` method is the entry point for Live API interactions. It takes an options object with the following properties:

- `model`: The Gemini model to use
- `config`: Configuration for the session
- `callbacks`: Event handlers for the WebSocket connection

```javascript
const session = await genAI.live.connect({
  model: 'gemini-2.5-flash-preview-native-audio-dialog',
  config: {
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
  },
  callbacks: {
    onopen: () => console.log('Connection opened'),
    onmessage: (message) => console.log('Received message:', message),
    onerror: (error) => console.error('Error:', error),
    onclose: () => console.log('Connection closed')
  }
});
```

### 5.2 Configuration Options

The `config` object supports numerous options for customizing the session:

#### 5.2.1 Response Modalities

```javascript
const config = {
  responseModalities: ['AUDIO'] // or ['TEXT']
};
```

#### 5.2.2 Speech Configuration

```javascript
const config = {
  responseModalities: ['AUDIO'],
  speechConfig: {
    voiceConfig: {
      prebuiltVoiceConfig: { voiceName: 'Kore' } // Available voices: Kore, Echo, Zephyr, etc.
    },
    languageCode: 'en-US' // BCP-47 language code
  }
};
```

#### 5.2.3 Real-time Input Configuration

```javascript
const config = {
  realtimeInputConfig: {
    automaticActivityDetection: {
      disabled: false, // Set to true to disable automatic VAD
      endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', // Options: LOW, MEDIUM, HIGH
      silenceDurationMs: 700 // Duration of silence to trigger end of speech
    },
    activityHandling: 'START_OF_ACTIVITY_INTERRUPTS' // Enable barge-in
  }
};
```

#### 5.2.4 System Instructions

```javascript
const config = {
  systemInstruction: {
    parts: [
      { text: "You are a helpful assistant named Chloe who specializes in investment advice." }
    ]
  }
};
```

#### 5.2.5 Function Calling

```javascript
const config = {
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
```

#### 5.2.6 Context Window Compression

```javascript
const config = {
  contextWindowCompression: {
    triggerTokens: 25600,
    slidingWindow: {
      targetTokens: 12800
    }
  }
};
```

#### 5.2.7 Session Resumption

```javascript
const config = {
  sessionResumption: {
    handle: previousSessionHandle // Obtained from sessionResumptionUpdate message
  }
};
```

### 5.3 Callback Handlers

The `callbacks` object contains handlers for WebSocket events:

#### 5.3.1 onopen

Called when the WebSocket connection is established.

```javascript
const callbacks = {
  onopen: () => {
    console.log('Connection established');
    // You might want to update UI state here
  }
};
```

#### 5.3.2 onmessage

Called when a message is received from the server. This is the most important callback as it handles all responses from the model.

```javascript
const callbacks = {
  onmessage: (message) => {
    // Handle different message types
    if (message.text) {
      console.log('Received text:', message.text);
    } else if (message.data) {
      console.log('Received binary data (e.g., audio)');
      // Process audio data
    } else if (message.serverContent) {
      // Handle server content
      if (message.serverContent.inputTranscription) {
        console.log('Input transcription:', message.serverContent.inputTranscription.text);
      }
      if (message.serverContent.outputTranscription) {
        console.log('Output transcription:', message.serverContent.outputTranscription.text);
      }
      if (message.serverContent.interrupted) {
        console.log('Model output interrupted');
        // Stop audio playback
      }
    } else if (message.toolCall) {
      console.log('Received function call:', message.toolCall);
      // Handle function call
    } else if (message.sessionResumptionUpdate) {
      console.log('Session resumption update:', message.sessionResumptionUpdate);
      // Store the new handle for future resumption
    } else if (message.goAway) {
      console.log('Server is disconnecting:', message.goAway);
      // Prepare for disconnection
    }
  }
};
```

#### 5.3.3 onerror

Called when an error occurs on the WebSocket connection.

```javascript
const callbacks = {
  onerror: (error) => {
    console.error('WebSocket error:', error);
    // Handle error, update UI, etc.
  }
};
```

#### 5.3.4 onclose

Called when the WebSocket connection is closed.

```javascript
const callbacks = {
  onclose: (event) => {
    console.log('Connection closed:', event);
    // Clean up resources, update UI, etc.
  }
};
```

### 5.4 Sending Data

Once a session is established, you can send data to the model using the session methods.

#### 5.4.1 Sending Audio

```javascript
// Send audio data
session.sendRealtimeInput({
  audio: {
    data: base64EncodedAudio,
    mimeType: 'audio/pcm;rate=16000'
  }
});

// Signal end of audio stream
session.sendRealtimeInput({
  audioStreamEnd: true
});
```

#### 5.4.2 Sending Text

```javascript
// Send text
session.sendClientContent({
  turns: "What's the weather like today?",
  turnComplete: true
});

// Or with more structure
session.sendClientContent({
  turns: [
    {
      role: 'user',
      parts: [{ text: "What's the weather like today?" }]
    }
  ],
  turnComplete: true
});
```

#### 5.4.3 Sending Function Responses

```javascript
// Respond to a function call
session.sendToolResponse({
  requestId: toolCall.requestId,
  functionResponses: [
    {
      name: 'send_konverter_email',
      response: {
        success: true,
        message: 'Email sent successfully'
      }
    }
  ]
});
```

### 5.5 Processing Responses

The `onmessage` callback receives various types of messages from the server. Here's how to handle the most common ones:

#### 5.5.1 Text Responses

```javascript
if (message.text) {
  console.log('Received text:', message.text);
  // Update UI with text
}
```

#### 5.5.2 Audio Responses

```javascript
if (message.data) {
  // message.data is a base64-encoded string of audio data
  const audioData = message.data;
  
  // Play the audio (using our PCMStreamPlayer)
  pcmPlayer.streamAudioChunk(audioData, 24000);
}
```

#### 5.5.3 Transcriptions

```javascript
if (message.serverContent) {
  if (message.serverContent.inputTranscription) {
    const transcription = message.serverContent.inputTranscription.text;
    console.log('User said:', transcription);
    // Update UI with user transcription
  }
  
  if (message.serverContent.outputTranscription) {
    const transcription = message.serverContent.outputTranscription.text;
    console.log('AI said:', transcription);
    // Update UI with AI transcription
  }
}
```

#### 5.5.4 Function Calls

```javascript
if (message.toolCall) {
  const toolCall = message.toolCall;
  const requestId = toolCall.requestId;
  const functionCalls = toolCall.functionCalls;
  
  // Process each function call
  for (const functionCall of functionCalls) {
    const functionName = functionCall.name;
    const args = functionCall.args;
    
    console.log(`Function call: ${functionName}`, args);
    
    // Execute the function
    let result;
    if (functionName === 'send_konverter_email') {
      result = await sendEmail(args.recipient_email, args.subject, args.message);
    }
    
    // Send the result back
    session.sendToolResponse({
      requestId: requestId,
      functionResponses: [
        {
          name: functionName,
          response: result
        }
      ]
    });
  }
}
```

#### 5.5.5 Session Resumption Updates

```javascript
if (message.sessionResumptionUpdate) {
  const newHandle = message.sessionResumptionUpdate.newHandle;
  console.log('New session handle:', newHandle);
  
  // Store the handle for future resumption
  localStorage.setItem('sessionHandle', newHandle);
}
```

#### 5.5.6 GoAway Messages

```javascript
if (message.goAway) {
  const reason = message.goAway.reason;
  const timeLeft = message.goAway.timeLeft;
  
  console.log(`Server is disconnecting in ${timeLeft}ms. Reason: ${reason}`);
  
  // Prepare for disconnection
  // e.g., save state, notify user, etc.
}
```

## 6. Advanced Usage Patterns

### 6.1 Session Resumption

Session resumption allows you to reconnect to a previous session after a disconnection.

```javascript
// Store session handles when received
let currentSessionHandle = null;

const callbacks = {
  onmessage: (message) => {
    if (message.sessionResumptionUpdate && message.sessionResumptionUpdate.newHandle) {
      currentSessionHandle = message.sessionResumptionUpdate.newHandle;
      console.log('Stored new session handle:', currentSessionHandle);
    }
    // Handle other messages...
  }
};

// Function to connect or reconnect
async function connectWithResumption() {
  let config = {
    responseModalities: ['AUDIO'],
    // Other config options...
  };
  
  // Add resumption config if we have a handle
  if (currentSessionHandle) {
    config.sessionResumption = {
      handle: currentSessionHandle
    };
    console.log('Attempting to resume session with handle:', currentSessionHandle);
  }
  
  try {
    const session = await genAI.live.connect({
      model: 'gemini-2.5-flash-preview-native-audio-dialog',
      config: config,
      callbacks: callbacks
    });
    
    return session;
  } catch (error) {
    console.error('Failed to connect or resume session:', error);
    
    // If resumption failed, clear the handle and try a fresh connection
    if (currentSessionHandle) {
      console.log('Resumption failed, clearing handle');
      currentSessionHandle = null;
      return connectWithResumption(); // Retry without handle
    }
    
    throw error;
  }
}
```

### 6.2 Handling Interruptions

When a user interrupts the model (barge-in), you need to handle the interruption gracefully.

```javascript
const callbacks = {
  onmessage: (message) => {
    if (message.serverContent && message.serverContent.interrupted) {
      console.log('Model output interrupted by user');
      
      // Stop audio playback
      pcmPlayer.stopPlayback();
      
      // Clear any queued audio
      audioQueue = [];
      
      // Update UI to show user is speaking
      updateUIForUserSpeaking();
    }
    // Handle other messages...
  }
};
```

### 6.3 Context Window Compression

For long conversations, you can use context window compression to manage token usage.

```javascript
const config = {
  contextWindowCompression: {
    triggerTokens: 25600, // When to trigger compression
    slidingWindow: {
      targetTokens: 12800 // Target token count after compression
    }
  }
};
```

### 6.4 Native Audio Features

Gemini 2.5 models with native audio support offer enhanced features.

```javascript
// For v1alpha API (required for some features)
const genAIAlpha = new GoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  apiVersion: 'v1alpha'
});

const config = {
  responseModalities: ['AUDIO'],
  enableAffectiveDialog: true, // Model adapts response style to input tone
  proactivity: { proactiveAudio: true } // Model can decide not to respond to irrelevant input
};

const session = await genAIAlpha.live.connect({
  model: 'gemini-2.5-flash-preview-native-audio-dialog',
  config: config,
  callbacks: { /* ... */ }
});
```

## 7. Troubleshooting

### 7.1 Connection Issues

**Problem**: Unable to establish WebSocket connection.

**Solutions**:
- Verify API key is valid and has access to the Gemini API
- Check network connectivity
- Ensure the model name is correct
- Verify you're using the correct API version for the features you need

**Example Diagnostic Code**:
```javascript
try {
  const session = await genAI.live.connect({
    model: 'gemini-2.5-flash-preview-native-audio-dialog',
    config: { /* ... */ },
    callbacks: {
      onopen: () => console.log('Connection successful'),
      onerror: (error) => console.error('Connection error:', error),
      onclose: (event) => console.log('Connection closed:', event.code, event.reason)
    }
  });
} catch (error) {
  console.error('Failed to connect:', error);
  
  // Check for specific error types
  if (error.message.includes('API key')) {
    console.error('API key issue detected');
  } else if (error.message.includes('model')) {
    console.error('Model name issue detected');
  }
}
```

### 7.2 Audio Format Issues

**Problem**: Audio not being processed correctly by Gemini.

**Solutions**:
- Ensure audio is 16-bit PCM, 16kHz, mono
- Verify MIME type is set correctly: `audio/pcm;rate=16000`
- Check Base64 encoding is correct

**Example Diagnostic Code**:
```javascript
// Verify audio format before sending
function validateAudioFormat(audioBuffer) {
  // Check if it's an ArrayBuffer or similar
  if (!(audioBuffer instanceof ArrayBuffer) && 
      !(audioBuffer instanceof Int16Array) && 
      !(typeof audioBuffer === 'string')) {
    console.error('Invalid audio buffer type:', typeof audioBuffer);
    return false;
  }
  
  // If it's a string, assume it's already Base64 encoded
  if (typeof audioBuffer === 'string') {
    try {
      // Try to decode a small sample to verify it's valid Base64
      atob(audioBuffer.substring(0, 10));
    } catch (e) {
      console.error('Invalid Base64 encoding:', e);
      return false;
    }
  }
  
  return true;
}

// Use before sending
if (validateAudioFormat(audioData)) {
  session.sendRealtimeInput({
    audio: {
      data: audioData,
      mimeType: 'audio/pcm;rate=16000'
    }
  });
} else {
  console.error('Invalid audio format, not sending');
}
```

### 7.3 Message Handling Issues

**Problem**: Not receiving expected messages or unable to process them correctly.

**Solutions**:
- Add detailed logging to the `onmessage` callback
- Check message structure against expected format
- Verify you're handling all relevant message types

**Example Diagnostic Code**:
```javascript
const callbacks = {
  onmessage: (message) => {
    console.log('Raw message:', JSON.stringify(message));
    
    // Check for expected fields
    if (message.text) {
      console.log('Text message received');
    } else if (message.data) {
      console.log('Binary data received, length:', message.data.length);
    } else if (message.serverContent) {
      console.log('Server content received:', Object.keys(message.serverContent));
    } else if (message.toolCall) {
      console.log('Tool call received:', message.toolCall.functionCalls.map(fc => fc.name));
    } else if (message.sessionResumptionUpdate) {
      console.log('Session resumption update received');
    } else if (message.goAway) {
      console.log('GoAway message received');
    } else {
      console.warn('Unknown message type:', Object.keys(message));
    }
    
    // Process message normally...
  }
};
```

### 7.4 Function Calling Issues

**Problem**: Function calls not working as expected.

**Solutions**:
- Verify function declarations match the expected format
- Check that function responses are correctly formatted
- Ensure you're handling the `toolCall` message correctly

**Example Diagnostic Code**:
```javascript
// Log function call details
if (message.toolCall) {
  const toolCall = message.toolCall;
  console.log('Tool call request ID:', toolCall.requestId);
  
  for (const functionCall of toolCall.functionCalls) {
    console.log('Function name:', functionCall.name);
    console.log('Function args:', JSON.stringify(functionCall.args, null, 2));
    
    // Verify function exists in our declarations
    const functionExists = config.tools[0].functionDeclarations.some(
      decl => decl.name === functionCall.name
    );
    
    if (!functionExists) {
      console.error('Function not declared:', functionCall.name);
    }
  }
}
```

## 8. SDK Version Management

### 8.1 Checking SDK Version

```javascript
import { version } from '@google/genai/package.json';
console.log('Using @google/genai version:', version);
```

### 8.2 Version Compatibility

| SDK Version | API Version | Key Features |
|-------------|-------------|--------------|
| 0.1.x       | v1beta      | Basic Live API support |
| 0.2.x       | v1beta, v1alpha | Enhanced Live API, native audio |
| 0.3.x+      | v1beta, v1alpha, v1 | Full feature set |

### 8.3 Upgrading the SDK

When upgrading the SDK, check for breaking changes:

```bash
# Install a specific version
npm install @google/genai@0.2.1

# Update to latest
npm install @google/genai@latest
```

## 9. Best Practices

### 9.1 Security

- **Never expose API keys in client-side code**
- Use a backend proxy for all Gemini API calls
- Implement proper session token validation
- Use HTTPS for all connections

### 9.2 Performance

- Initialize the SDK once and reuse the instance
- Close sessions when they're no longer needed
- Use binary WebSocket messages for audio data when possible
- Implement connection pooling for high-traffic applications

### 9.3 Error Handling

- Implement robust error handling for all SDK operations
- Use try/catch blocks around async operations
- Implement reconnection logic with exponential backoff
- Log errors with sufficient context for debugging

### 9.4 Resource Management

- Close sessions when they're no longer needed
- Implement proper cleanup in the `onclose` callback
- Monitor token usage to avoid quota issues
- Use context window compression for long conversations

## 10. Reference

### 10.1 Official Documentation

- [Google GenAI SDK for JavaScript](https://googleapis.github.io/js-genai/release_docs/)
- [Live Module Documentation](https://googleapis.github.io/js-genai/release_docs/modules/live.html)
- [Live Class Documentation](https://googleapis.github.io/js-genai/release_docs/classes/live.Live.html)
- [Session Class Documentation](https://googleapis.github.io/js-genai/release_docs/classes/live.Session.html)

### 10.2 SDK GitHub Repository

- [googleapis/nodejs-genai](https://github.com/googleapis/nodejs-genai)

### 10.3 API References

- [Gemini API Documentation](https://ai.google.dev/docs/gemini_api)
- [Live API Reference](https://ai.google.dev/api/live)

### 10.4 Type Definitions

For TypeScript users, the SDK provides comprehensive type definitions:

```typescript
import { 
  GoogleGenerativeAI,
  LiveConnectConfig,
  LiveCallbacks,
  SendClientContentRequest,
  SendRealtimeInputRequest,
  SendToolResponseRequest
} from '@google/genai';
```

### 10.5 Project-Specific Implementation

For our Telegram voice chat application, refer to:

- [WebSocket Proxy Implementation](../backend/gemini_websocket_proxy.js)
- [Frontend Client Implementation](../front_end/gemini_telegram_client.js)
- [Audio Processing Implementation](../front_end/advanced_audio_recorder.js)
