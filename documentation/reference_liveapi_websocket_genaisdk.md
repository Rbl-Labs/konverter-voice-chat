## Document 1: Google Live API - Engineering Reference

**Audience:** Engineers building applications with real-time, multimodal interaction capabilities using Gemini models.
**Purpose:** To provide a comprehensive understanding of the Google Live API, its features, and how to leverage it, primarily through SDKs.

**Last Updated:** June 5, 2025

### 1. Introduction to Google Live API

The Google Live API enables developers to build applications with low-latency, bidirectional, and multimodal (audio, video, text) interactions with Google's Gemini models. It is designed for real-time conversational AI experiences, allowing users to speak to Gemini, stream video, or share their screen for dynamic and natural interactions. The API operates using a streaming model, typically over a WebSocket connection, facilitated by client SDKs.

**Key Capabilities:**
*   **Real-time Streaming:** Continuous, bidirectional streaming of audio, video, and text data.
*   **Low Latency:** Optimized for quick model responses essential for natural conversation.
*   **Multimodal Input/Output:** Accepts text, audio, and video as input. Can output text or audio.
*   **Voice Activity Detection (VAD):** Automatically detects when a user starts and stops speaking, improving interaction flow.
*   **Tool Integration:** Supports Function Calling, Code Execution, and Google Search for extended capabilities.
*   **Configurable Speech Output:** Offers options for different voices and languages for generated speech.
*   **Native Audio:** Provides higher quality, more natural-sounding audio input and output.

**Common Use Cases:**
*   Interactive voice assistants and chatbots.
*   Real-time translation and transcription services.
*   Live customer support and assistance applications.
*   Interactive educational tools and simulations.
*   Accessibility tools.

### 2. Core Concepts

*   **Session-Based Interaction:** A connection establishes a "session" for the interaction. The initial message configures this session (e.g., model, parameters).
*   **Bidirectional Streaming:** Both the client and the server continuously stream data over a persistent connection (WebSocket). The client sends user input, and the model streams back responses.
*   **Input/Output Modalities:**
    *   **Input:** Text, audio (e.g., PCM 16kHz mono), video.
    *   **Output:** Text or audio (e.g., PCM 24kHz mono). A session can be configured for *either* text or audio output, but not both simultaneously.
*   **Turn-Based Conversation:** Interactions are typically managed in "turns," where a user provides input, and the model responds.
*   **Context Management:** Sessions can be extended using techniques like context window compression or session resumption to handle longer conversations.

### 3. Getting Started

*   **API Key:** A Gemini API key is required.
    *   **Security:** **Crucially, avoid embedding API keys directly in client-side code for production applications.** Use server-side proxies or backends to manage API key security.
*   **SDKs:** Google provides SDKs (e.g., Python, JavaScript/TypeScript) that simplify interaction with the Live API.
*   **Model Selection:** Choose a model that supports live interactions (e.g., `gemini-2.0-flash-live-001`, `gemini-2.5-flash-preview-native-audio-dialog`).

### 4. Key API Functionalities (Illustrative SDK Usage)

The following functionalities are generally available through the SDKs. Refer to specific SDK documentation for exact implementation details.

#### 4.1. Establishing a Connection & Session Configuration

*   A connection is typically initiated by calling a `connect` method in the SDK.
*   **Configuration Parameters:**
    *   `model`: Specifies the Gemini model to use.
    *   `responseModalities`: An array specifying the desired output type, e.g., `["TEXT"]` or `["AUDIO"]`.
    *   `systemInstruction`: Provides context or instructions to guide the model's behavior.
    *   `tools`: Defines tools the model can use (Function Calling, Code Execution, Google Search).
    *   `speechConfig`: For audio output, configures voice (e.g., `voice_name`), language (`language_code`).
    *   `realtimeInputConfig`: Configures real-time input handling, including `automatic_activity_detection` for VAD.
    *   `contextWindowCompression`: Configures how context is managed for long sessions (e.g., `sliding_window`).
    *   `sessionResumption`: Enables the ability to resume a disconnected session.

```python
# Python SDK Example (Conceptual)
# from google.generativeai import GenerativeModel # and other relevant imports

# config = { "responseModalities": ["TEXT"], "systemInstruction": "Be a helpful assistant." }
# session = client.aio.live.connect(model="gemini-2.0-flash-live-001", config=config)
```

```javascript
// JavaScript SDK Example (Conceptual)
// import { GoogleGenAI, Modality } from '@google/genai';
// const ai = new GoogleGenAI({ apiKey: "YOUR_API_KEY" });
// const model = 'gemini-2.0-flash-live-001';
// const config = { responseModalities: [Modality.TEXT] };
// const session = await ai.live.connect({ model, config, callbacks: { /* ... */ } });
```

#### 4.2. Sending and Receiving Data

*   **Sending Text:**
    *   Use methods like `session.send_client_content()` (Python) or `session.sendClientContent()` (JavaScript) to send user text.
*   **Sending Audio:**
    *   Audio should typically be in 16-bit PCM, 16kHz, mono format.
    *   Use methods like `session.send_realtime_input()` (Python) or `session.sendRealtimeInput()` (JavaScript) with audio data and MIME type (e.g., `"audio/pcm;rate=16000"`).
*   **Receiving Data:**
    *   Responses are received as a stream.
    *   Python: Iterate through `session.receive()`.
    *   JavaScript: Use an `onmessage` callback.
    *   Responses can include text, audio data, transcriptions, tool calls, and metadata.

#### 4.3. Audio Features

*   **Input Audio Transcription:** Can be enabled in session config to get text transcripts of user audio.
*   **Output Audio Transcription:** Can be enabled to get text transcripts of model-generated audio.
*   **Native Audio Models:** (e.g., `gemini-2.5-flash-preview-native-audio-dialog`)
    *   Provide higher-quality, more natural-sounding voice interactions.
    *   Support features like **Affective Dialog** (adapts response style to input tone) and **Proactive Audio** (model decides if a response is needed). Available in `v1alpha` API versions.
    *   May automatically infer language.

#### 4.4. Tool Use (Function Calling, Code Execution, Google Search)

*   Define `tool_declarations` (or `function_declarations`) in the session configuration.
*   The model may respond with a `tool_call` (or `function_call`).
*   The client application executes the tool/function and sends back a `ToolResponse` (or `FunctionResponse`).
*   Asynchronous function calling is supported, allowing the model to continue processing while awaiting a tool response.

#### 4.5. Voice Activity Detection (VAD)

*   **Server-Side VAD:** Enabled by default (`automatic_activity_detection`). The server detects speech and silence.
    *   If an audio stream pauses, the client should signal `audio_stream_end=True` (Python) or `audioStreamEnd: true` (JavaScript).
*   **Client-Side VAD:** VAD can be disabled on the server, requiring the client to send explicit `activityStart` and `activityEnd` messages.
*   **Interruptions:** If a user speaks while the model is generating audio, VAD detects this, and the model's output is typically interrupted. The server sends a message indicating `interrupted: True`.

#### 4.6. Session Management & Duration

*   **Context Window Limits:** Models have token limits for context (e.g., 32k or 128k for native audio models).
*   **Context Window Compression:** Techniques like `sliding_window` can be enabled via `context_window_compression` in the session config to manage context in long conversations and extend effective session duration.
*   **Session Resumption:**
    *   Enable `session_resumption` in the config.
    *   The server may send `SessionResumptionUpdate` messages containing a `new_handle`. This handle can be used to reconnect and resume a session if the connection drops.
*   **`GoAway` Message:** Signals an impending server disconnect, often with `timeLeft` indicating how long until the connection closes.

#### 4.7. Token Usage

*   `usageMetadata` is often included in server messages, providing details like `promptTokenCount`, `responseTokenCount`, and `totalTokenCount`.

#### 4.8. Changing Voice and Language (for Audio Output)

*   Specify `voice_name` (e.g., "Kore", "Echo") within `speech_config.voice_config.prebuilt_voice_config`.
*   Set `language_code` (e.g., "en-US", "es-ES", "de-DE") within `speech_config`.
*   Native audio models might infer the language automatically from the input.

### 5. Limitations and Considerations

*   **Single Output Modality:** A session can output *either* text *or* audio, but not both simultaneously.
*   **Authentication:** Primarily designed for server-to-server authentication. For client-side applications, it's best practice to route API calls through a backend that securely manages the API key.
*   **Session Duration:** While extendable, sessions have practical limits. Default duration without compression can be around 15 minutes for audio-only.
*   **API Versions:** Features may vary between API versions (`v1beta`, `v1alpha`). Check documentation for feature availability.

### 6. Supported Languages (Examples)

The Live API supports a range of languages for speech input/output, typically specified using BCP-47 codes (e.g., "en-US", "es-ES", "fr-FR", "ja-JP", "ko-KR", "de-DE"). Native audio models may infer language. Consult the latest official documentation for a complete list.

### 7. Further Resources

*   **Official Google Live API Documentation:** [https://ai.google.dev/gemini-api/docs/live](https://ai.google.dev/gemini-api/docs/live)
*   **Google AI Studio:** Experiment with the Live API ("Stream" feature).
*   **SDK-Specific Documentation:**
    *   Python: Refer to Google Generative AI SDK for Python.
    *   JavaScript/TypeScript: [https://googleapis.github.io/js-genai/release_docs/](https://googleapis.github.io/js-genai/release_docs/) (especially the `live` module).
*   **Cookbooks and Examples:** Check official Google GitHub repositories for `generative-ai-docs` or SDK-specific examples.

---

## Document 2: Google Live API WebSocket - Engineering Reference

**Audience:** Engineers needing to interact with the Google Live API at the raw WebSocket protocol level, or those wishing to understand the underlying communication.
**Purpose:** To provide detailed specifications for the WebSocket interface of the Google Live API.

**Last Updated:** June 5, 2025

### 1. Overview

The Google Live API utilizes a WebSocket connection for real-time, bidirectional communication with Gemini models. This allows for streaming of input (audio, video, text) from the client and streaming of responses (text, audio, control messages) from the server. This document details the WebSocket endpoint, message structures, and key communication patterns.

### 2. Connection Endpoint

*   **WebSocket URL:** `wss://generativelanguage.googleapis.com/ws/google.ai.generative_language_service.v1beta.GenerativeService.BidiGenerateContent`
    *   *Note:* The version (`v1beta`) in the URL might change. Always refer to the latest official documentation.
    *   The service name is `google.ai.generativelanguage.v1beta.GenerativeService` and the method is `BidiGenerateContent`.

### 3. Authentication

*   **API Key:** An API key is required. It should be sent as an `x-goog-api-key` header during the WebSocket upgrade request.
    ```
    GET /ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent HTTP/1.1
    Host: generativelanguage.googleapis.com
    Upgrade: websocket
    Connection: Upgrade
    Sec-WebSocket-Key: [generated_key]
    Sec-WebSocket-Version: 13
    x-goog-api-key: YOUR_API_KEY
    ```
*   **Ephemeral Authentication Tokens:** For more constrained environments or client-side connections (though direct client-side WebSocket usage with API keys is generally discouraged for production security), ephemeral tokens can be used. These tokens can be obtained via `AuthTokenService.CreateToken` and passed in the `Authorization: Bearer <token>` header or as an `access_token` query parameter.

### 4. Message Format

All messages exchanged over the WebSocket are JSON objects.

*   **Client-to-Server Messages:** A JSON object with a single key, where the key indicates the message type and its value is the corresponding payload object.
*   **Server-to-Client Messages:** A JSON object that typically includes a `messageType` field (as part of a union-like structure) to distinguish different kinds of server messages, along with other relevant fields like `usageMetadata`.

### 5. Session Lifecycle and Initial Configuration

1.  **Establish Connection:** The client initiates a WebSocket connection to the endpoint.
2.  **Initial Client Message (`setup`):** Once the connection is established, the client MUST send an initial message to configure the session. This message is a JSON object with the key `setup`.

    ```json
    {
      "setup": {
        "model": "string", // e.g., "models/gemini-2.0-flash-live-001" or "models/gemini-2.5-flash-preview-native-audio-dialog"
        "generationConfig": {
          "candidateCount": "int32",
          "maxOutputTokens": "int32",
          "temperature": "float",
          "topP": "float",
          "topK": "int32",
          "responseModalities": ["TEXT" | "AUDIO"], // Array of strings
          "speechConfig": { // Required if responseModalities includes AUDIO
            "voiceConfig": {
              "prebuiltVoiceConfig": { // Or customVoiceConfig
                "voiceName": "string" // e.g., "Kore", "Echo"
              }
            },
            "languageCode": "string" // e.g., "en-US"
          }
        },
        "systemInstruction": { // Optional
          "parts": [{ "text": "string" }]
        },
        "tools": [ // Optional
          {
            "functionDeclarations": [ /* ... FunctionDeclaration objects ... */ ],
            "codeExecution": {}, // For enabling code execution
            "googleSearch": {} // For enabling Google Search grounding
          }
        ],
        "realtimeInputConfig": { // Optional
          "automaticActivityDetection": { // Server-side VAD
            "minSilenceDuration": "string (duration format, e.g., '1.5s')",
            "speechEndSensitivity": "float (0.0-1.0)"
          },
          "inputAudioTranscription": {}, // Enable input audio transcription
          "outputAudioTranscription": {} // Enable output audio transcription
        },
        "sessionResumption": { // Optional
          "mode": "RESUME_ONLY" | "RECONNECT_ONLY" | "RESUME_OR_RECONNECT",
          "handle": "string" // Previous handle to resume a session
        },
        "contextWindowCompression": { // Optional
          "mode": "SLIDING_WINDOW" | "NO_COMPRESSION"
        }
        // ... other setup fields
      }
    }
    ```

3.  **Server Response (`setupComplete`):** The server acknowledges the setup.
    ```json
    {
      "setupComplete": {
        "sessionHandle": "string" // Handle for this session, useful for resumption
        // ... other setup complete fields
      },
      "usageMetadata": { /* ... */ }
    }
    ```

### 6. Client-to-Server Message Types (after setup)

#### 6.1. `clientContent`

Used for sending textual content, typically conversational turns.

```json
{
  "clientContent": {
    "turns": [
      {
        "role": "user", // or "model" if providing history
        "parts": [{ "text": "string" }]
      }
    ],
    "turnComplete": "boolean" // True if this is the end of the user's turn
  }
}
```

#### 6.2. `realtimeInput`

Used for streaming real-time data like audio, video, or text fragments.

```json
{
  "realtimeInput": {
    "audio": { // If sending audio
      "data": "string (base64 encoded)", // e.g., 16-bit PCM, 16kHz, mono
      "mimeType": "string" // e.g., "audio/pcm;rate=16000"
    },
    "video": { /* ... VideoData ... */ },
    "text": "string", // For streaming text input fragments
    "activityStart": {}, // Send if client is managing VAD
    "activityEnd": {},   // Send if client is managing VAD
    "audioStreamEnd": "boolean" // True if the current audio input stream segment has ended (e.g., user paused)
  }
}
```

#### 6.3. `toolResponse`

Used to send the result of a function call requested by the server.

```json
{
  "toolResponse": {
    "requestId": "string", // Matches the requestId from the server's toolCall
    "functionResponses": [
      {
        "name": "string", // Function name
        "response": { // JSON object representing the function's output
          // ... structure defined by the function
        }
      }
    ]
  }
}
```

### 7. Server-to-Client Message Types

Server messages are JSON objects. The primary content is usually within a field that corresponds to the type of message (e.g., `serverContent`, `toolCall`). All server messages may also contain a top-level `usageMetadata` field.

#### 7.1. `serverContent`

Contains content generated by the model (text or audio data), and related metadata.

```json
{
  "serverContent": {
    "parts": [
      {
        "text": "string" // If text output
      },
      {
        "audioData": { // If audio output
          "data": "string (base64 encoded)", // e.g., 16-bit PCM, typically 24kHz, mono
          "mimeType": "string" // e.g., "audio/pcm;rate=24000"
        }
      }
    ],
    "generationComplete": "boolean", // True if the model has finished generating for this request
    "turnComplete": "boolean",       // True if the model considers its current conversational turn complete
    "interrupted": "boolean",        // True if the model's output was interrupted (e.g., by user speech)
    "inputTranscription": { // If input audio transcription was enabled
      "text": "string",
      "isFinal": "boolean"
    },
    "outputTranscription": { // If output audio transcription was enabled
      "text": "string",
      "isFinal": "boolean"
    },
    "groundingMetadata": { /* ... GroundingAttribution, WebSource, etc. ... */ }
  },
  "usageMetadata": { /* ... Token counts ... */ }
}
```

#### 7.2. `toolCall`

Requests the client to execute one or more functions.

```json
{
  "toolCall": {
    "requestId": "string", // ID for this tool call, client must include in toolResponse
    "functionCalls": [
      {
        "name": "string", // Name of the function to call
        "args": { // JSON object with arguments for the function
          // ... structure depends on the function declaration
        }
      }
    ],
    "processingOptions": {
      "isAsync": "boolean" // If true, client can send toolResponse later without blocking other interactions
    }
  },
  "usageMetadata": { /* ... */ }
}
```

#### 7.3. `toolCallCancellation`

Notifies the client that a previously issued `toolCall` should be canceled if possible.

```json
{
  "toolCallCancellation": {
    "requestId": "string" // The ID of the toolCall to cancel
  },
  "usageMetadata": { /* ... */ }
}
```

#### 7.4. `goAway`

Indicates that the server is about to close the WebSocket connection.

```json
{
  "goAway": {
    "reason": "string", // e.g., "SESSION_EXPIRED", "CLIENT_ERROR"
    "timeLeft": "string (duration format, e.g., '30s')" // Estimated time before disconnection
  }
  // No usageMetadata typically
}
```

#### 7.5. `sessionResumptionUpdate`

Provides a new handle for resuming the session if it gets disconnected.

```json
{
  "sessionResumptionUpdate": {
    "newHandle": "string" // The new session handle to use for resumption
  },
  "usageMetadata": { /* ... */ }
}
```

### 8. Key Message Fields and Events

*   **`usageMetadata`**: Appears in most server messages.
    *   `promptTokenCount`: Tokens in the prompt.
    *   `responseTokenCount`: Tokens in the generated response part.
    *   `totalTokenCount`: Cumulative tokens for the session or request.
    *   `candidatesTokenCount`: Tokens for candidate responses.
*   **`ActivityStart` / `ActivityEnd`**: Part of `realtimeInput` if client manages VAD. Marks start/end of user activity.
*   **`AudioStreamEnd`**: Part of `realtimeInput`'s audio data. Client signals end of a continuous audio segment.
*   **`Interrupted`**: In `serverContent`, indicates model output was cut short.

### 9. Error Handling

Errors might be communicated via:
*   The `goAway` message with a reason.
*   Abrupt WebSocket connection closure with specific close codes.
*   Error details within message payloads (less common for fatal errors, more for recoverable issues).

Clients should implement robust error handling and reconnection logic, potentially using session resumption.

### 10. Further Resources

*   **Official Google Live API Documentation:** [https://ai.google.dev/gemini-api/docs/live](https://ai.google.dev/gemini-api/docs/live)
*   **Live API WebSocket Reference:** [https://ai.google.dev/api/live](https://ai.google.dev/api/live) (Primary source for schema details)

---

## Document 3: Google Gen AI SDK for Live API (JavaScript/TypeScript) - Engineering Reference

**Audience:** JavaScript/TypeScript engineers building applications using the `@google/genai` SDK to interact with the Google Live API.
**Purpose:** To provide a comprehensive guide to using the `live` functionalities of the `@google/genai` SDK.

**Last Updated:** June 5, 2025

### 1. Introduction

The `@google/genai` SDK provides a convenient JavaScript/TypeScript interface for interacting with Google's Gemini models, including the Live API for real-time, multimodal conversations. This document focuses on the `ai.live` submodule and its associated classes and methods for establishing and managing live sessions.

**Key SDK Features for Live API:**
*   Simplified WebSocket connection management.
*   Typed interfaces for request and response objects.
*   Callback-based event handling for asynchronous operations.
*   Helper methods for sending different types of input (text, audio).

### 2. Installation

Install the SDK using npm or yarn:

```bash
npm install @google/genai
# or
yarn add @google/genai
```

### 3. Initialization

Import and initialize the `GoogleGenAI` client.

```typescript
import { GoogleGenAI, HarmCategory, HarmBlockThreshold, Modality } from '@google/genai';

// For Gemini API (ai.google.dev)
const API_KEY = "YOUR_GEMINI_API_KEY"; // IMPORTANT: Securely manage your API key!
const ai = new GoogleGenAI({ apiKey: API_KEY });

// For Vertex AI, initialization differs (project, location, etc.)
// const ai = new GoogleAI({ project: "...", location: "..." });
```

**API Key Security:**
**NEVER embed your API key directly in client-side code that will be shipped to browsers.** For web applications, create a backend proxy that makes requests to the Gemini API using the key stored securely on the server. For Node.js applications running in a secure server environment, you can use the API key directly.

### 4. API Versioning

The SDK defaults to using `v1beta` API endpoints. You can specify a different API version during `GoogleGenAI` initialization if needed (e.g., for `v1alpha` features):

```typescript
const ai = new GoogleGenAI({
  apiKey: API_KEY,
  apiVersion: 'v1alpha' // or 'v1' for stable, 'v1beta' is default
});
```

### 5. The `ai.live` Submodule and `Session` Object

The core of Live API interaction through the JS SDK revolves around the `ai.live.connect()` method, which returns a `Session` object.

#### 5.1. Establishing a Live Session: `ai.live.connect()`

This asynchronous method establishes a WebSocket connection and returns a `Promise<Session>`.

```typescript
import { LiveConfig, LiveCallbacks, Modality } from '@google/genai'; // Assuming these types exist

async function startLiveSession() {
  const modelName = 'gemini-2.0-flash-live-001'; // Or other live-compatible models
  // Example: models/gemini-2.5-flash-preview-native-audio-dialog

  const config: LiveConfig = { // Type from SDK, example fields
    model: modelName,
    responseModalities: [Modality.TEXT], // Or [Modality.AUDIO]
    systemInstruction: "You are a helpful and concise assistant.",
    // Add other configurations: tools, speechConfig, realtimeInputConfig, etc.
    // Example for audio output:
    // responseModalities: [Modality.AUDIO],
    // speechConfig: {
    //   voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
    //   languageCode: "en-US"
    // }
  };

  const callbacks: LiveCallbacks = { // Type from SDK, example fields
    onopen: () => {
      console.log('Live session connection opened.');
    },
    onmessage: (message) => { // message type: LiveMessage or similar
      console.log('Received message:', message);
      if (message.text) {
        console.log('Text response:', message.text);
      }
      if (message.data) { // For audio data
        console.log('Audio data received (length):', message.data.byteLength);
        // Process ArrayBuffer message.data (e.g., play it)
      }
      if (message.serverContent) {
        // Process serverContent: parts, turnComplete, interrupted, transcriptions etc.
        if (message.serverContent.inputTranscription) {
          console.log('Input Transcription:', message.serverContent.inputTranscription.text);
        }
        if (message.serverContent.outputTranscription) {
          console.log('Output Transcription:', message.serverContent.outputTranscription.text);
        }
      }
      if (message.toolCall) {
        console.log('Tool call received:', message.toolCall);
        // Handle tool call, then respond with session.sendToolResponse()
      }
      if (message.usageMetadata) {
        console.log('Usage metadata:', message.usageMetadata);
      }
      // Check for sessionResumptionUpdate, goAway etc.
      if (message.sessionResumptionUpdate) {
        console.log('Session can be resumed with handle:', message.sessionResumptionUpdate.newHandle);
      }
      if (message.goAway) {
         console.warn('Server initiated disconnect:', message.goAway.reason);
      }
    },
    onerror: (error) => { // error type: Error
      console.error('Live session error:', error.message);
    },
    onclose: (event) => { // event type: CloseEvent
      console.log('Live session connection closed:', event.reason, event.code);
    },
  };

  try {
    const session: Session = await ai.live.connect({
      model: modelName, // Can also be passed directly here instead of in config
      config: config,
      callbacks: callbacks,
    });

    // Session is now active. Use session methods to interact.
    // e.g., session.sendClientContent({ turns: "Hello Gemini!" });

    return session;
  } catch (error) {
    console.error('Failed to connect to live session:', error);
    return null;
  }
}

// const liveSession = await startLiveSession();
```
*Refer to `live.html`, `classes/live.Live.html`, `classes/live.Session.html` in the JS SDK release docs for exact typings and parameters.*

#### 5.2. `Session` Object

The `Session` object ([`@google/genai/release_docs/classes/live.Session.html`](https://googleapis.github.io/js-genai/release_docs/classes/live.Session.html)) is your primary interface for an active live connection.

**Key `Session` Methods:**

*   **`session.sendClientContent(request: SendClientContentRequest): void`**
    *   Sends textual content to the model, typically as part of a conversational turn.
    *   `request`: `{ turns: string | Turn[], turnComplete?: boolean }`
    ```typescript
    // session.sendClientContent({ turns: "What's the weather like?" });
    // session.sendClientContent({
    //   turns: [{ role: "user", parts: [{ text: "Tell me a joke." }] }],
    //   turnComplete: true
    // });
    ```

*   **`session.sendRealtimeInput(request: SendRealtimeInputRequest): void`**
    *   Streams real-time data like audio, video, or text fragments.
    *   `request`: `{ audio?: AudioData, video?: VideoData, text?: string, activityStart?: boolean, activityEnd?: boolean, audioStreamEnd?: boolean }`
    *   `AudioData`: `{ data: string (base64) | ArrayBuffer, mimeType: string }`
    ```typescript
    // Example: Sending PCM audio (ensure it's correctly formatted and base64 encoded if string)
    // const pcmAudioBase64 = "..."; // Your base64 encoded 16-bit PCM, 16kHz, mono audio
    // session.sendRealtimeInput({
    //   audio: { data: pcmAudioBase64, mimeType: "audio/pcm;rate=16000" }
    // });

    // Example: Signaling audio stream end (when using server-side VAD and user pauses)
    // session.sendRealtimeInput({ audioStreamEnd: true });
    ```

*   **`session.sendToolResponse(request: SendToolResponseRequest): void`**
    *   Sends the results of function calls back to the model after receiving a `toolCall` message.
    *   `request`: `{ requestId: string, functionResponses: FunctionResponse[] }`
    *   `FunctionResponse`: `{ name: string, response: object }`
    ```typescript
    // Assuming a toolCall was received with requestId "123" for function "getCurrentWeather"
    // session.sendToolResponse({
    //   requestId: "123",
    //   functionResponses: [{
    //     name: "getCurrentWeather",
    //     response: { location: "Paris", temperature: "22C", condition: "Sunny" }
    //   }]
    // });
    ```

*   **`session.close(): void`**
    *   Closes the WebSocket connection and terminates the live session. This will trigger the `onclose` callback.

**Session Properties (Illustrative - check docs for actual available properties):**
*   `session.config`: The configuration used to start the session.
*   `session.state`: Current state of the WebSocket connection (e.g., "OPEN", "CLOSED").

### 6. Handling Server Messages (`onmessage` callback)

The `onmessage` callback receives various types of messages from the server. The structure of the `message` object will vary. Key fields to check:

*   `message.text`: If the model sends a simple text response directly.
*   `message.data`: For binary data, typically `ArrayBuffer` containing audio data.
*   `message.serverContent`: A more structured object containing `parts` (which can be text or audio data), `turnComplete`, `interrupted`, `inputTranscription`, `outputTranscription`, `groundingMetadata`.
*   `message.toolCall`: Contains `requestId` and `functionCalls` if the model is requesting function execution.
*   `message.toolCallCancellation`: If a previous tool call should be cancelled.
*   `message.usageMetadata`: Token counts and other usage information.
*   `message.setupComplete`: Confirms initial setup, may contain `sessionHandle`.
*   `message.sessionResumptionUpdate`: Contains `newHandle` for session resumption.
*   `message.goAway`: Indicates impending server disconnect with a `reason` and `timeLeft`.

### 7. Example Flow: Text-Based Chat

```typescript
async function runTextChat() {
  const ai = new GoogleGenAI({ apiKey: "YOUR_API_KEY" });
  const modelName = 'gemini-2.0-flash-live-001';

  try {
    const session = await ai.live.connect({
      model: modelName,
      config: { responseModalities: [Modality.TEXT] },
      callbacks: {
        onopen: () => console.log("Connected!"),
        onmessage: (msg) => {
          if (msg.text) console.log("Gemini:", msg.text);
          if (msg.serverContent?.parts) {
            msg.serverContent.parts.forEach(part => {
              if (part.text) console.log("Gemini (from parts):", part.text);
            });
          }
          if (msg.serverContent?.turnComplete) {
            console.log("Gemini's turn is complete.");
            // Prompt user for next input, or send next message if automated
          }
        },
        onerror: (e) => console.error("Error:", e.message),
        onclose: () => console.log("Disconnected."),
      },
    });

    // Start the conversation
    session.sendClientContent({ turns: "Hello, what can you do?" });

    // Simulate user input after a delay
    setTimeout(() => {
      session.sendClientContent({ turns: "Tell me about the Google Live API." });
    }, 5000);

    // Close session after some time (example)
    // setTimeout(() => {
    //   session.close();
    // }, 15000);

  } catch (e) {
    console.error("Failed to start chat:", e);
  }
}

// runTextChat();
```

### 8. Best Practices

*   **API Key Security:** Reiterate: **Do not expose API keys in frontend code.** Use a backend proxy.
*   **Error Handling:** Implement comprehensive error handling in `onerror` and for failed `connect` calls. Consider retry logic for transient network issues.
*   **Resource Management:** Always call `session.close()` when the session is no longer needed to free up resources on both client and server.
*   **User Experience:** For audio, manage microphone permissions and provide clear feedback to the user about the connection status and when the AI is listening or speaking.
*   **Throttling/Rate Limiting:** Be mindful of API rate limits.
*   **Consult Official Docs:** The JS SDK is actively developed. Always refer to the official release documentation for the most accurate and up-to-date information on types, methods, and features.
    *   [https://googleapis.github.io/js-genai/release_docs/index.html](https://googleapis.github.io/js-genai/release_docs/index.html)
    *   [https://googleapis.github.io/js-genai/release_docs/modules/live.html](https://googleapis.github.io/js-genai/release_docs/modules/live.html)
    *   [https://googleapis.github.io/js-genai/release_docs/classes/live.Live.html](https://googleapis.github.io/js-genai/release_docs/classes/live.Live.html)
    *   [https://googleapis.github.io/js-genai/release_docs/classes/live.Session.html](https://googleapis.github.io/js-genai/release_docs/classes/live.Session.html)

This SDK documentation should provide your JavaScript/TypeScript engineers with a strong starting point for building live, interactive experiences.