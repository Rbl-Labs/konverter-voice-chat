# Google Live API Documentation for Live Voice Applications

This documentation provides a comprehensive guide to integrating the Google Live API into your Telegram voice application. The Live API enables low-latency, bidirectional voice interactions with Gemini, allowing for natural, human-like voice conversations.

## 1. Introduction to the Google Live API

The Live API operates on a streaming model over a WebSocket connection, facilitating real-time, continuous input (audio, video, or text) to the Gemini model and immediate responses (text or audio) back. This bidirectional streaming ensures low latency and supports features crucial for voice applications like voice activity detection (VAD), tool usage, and real-time speech generation.

### 1.1 How the Live API Works

*   **Streaming:** A persistent WebSocket connection is established. Your application streams user input (audio or text) to Gemini, and Gemini streams its responses back continuously.
*   **Output Generation:** The API processes multimodal input to generate text or audio in real-time.
    *   **Half Cascade:** Processes native audio input through a specialized cascade of distinct models.
    *   **Native Audio (Gemini 2.5+):** Directly generates audio output, offering more natural-sounding, expressive voices with better context awareness and proactive responses. Recommended for high-quality voice interactions.

## 2. Prerequisites

Before you begin, ensure you have the following set up:

*   **Google Cloud Project:** A Google Cloud project with the Gemini API enabled.
*   **Google API Key:** An API key from your Google Cloud project (ensure it has access to the Generative AI API).
*   **Node.js Environment:** Your development environment should have Node.js installed.
*   **Required Libraries:** Install the necessary Google GenAI SDK and audio processing library.

    ```bash
    npm install @google/genai wavefile
    ```

    (For Python examples provided in the source, `pip install google-generativeai wavefile` would be needed, but this document focuses on JS for the Telegram bot context as per the original code.)

## 3. Establishing a Connection

To begin interacting with the Live API, you first need to establish a WebSocket connection.

### 3.1 Initializing the API Client

```javascript
import { GoogleGenAI, Modality } from '@google/genai';

// Replace "YOUR_GOOGLE_API_KEY" with your actual Google API Key
const ai = new GoogleGenAI({ apiKey: "YOUR_GOOGLE_API_KEY" });

// Choose the appropriate model for your application.
// 'gemini-2.0-flash-live-001' is a general-purpose live model.
// For native audio output, consider 'gemini-2.5-flash-preview-native-audio-dialog'.
const model = 'gemini-2.0-flash-live-001';

// Configure response modalities. For a voice app, you'll primarily use Modality.AUDIO
// or Modality.TEXT if you process audio separately after transcription.
const config = { responseModalities: [Modality.TEXT] }; // Example: Initial config for text responses.
```

### 3.2 Connecting to the Live API

The `ai.live.connect()` method establishes the WebSocket connection. It requires the `model`, `callbacks` for handling connection events, and `config` for session parameters.

```javascript
// ... (Previous initialization code)

async function connectToLiveAPI() {
    const session = await ai.live.connect({
        model: model,
        callbacks: {
            onopen: function () {
                console.debug('Live API connection opened.');
            },
            onmessage: function (message) {
                // This callback receives all messages from the server.
                // You'll parse these messages to handle text, audio,
                // and other server events.
                console.debug('Received message:', message);
            },
            onerror: function (e) {
                console.error('Live API connection error:', e.message);
            },
            onclose: function (e) {
                console.debug('Live API connection closed. Reason:', e.reason);
            },
        },
        config: config,
    });

    // The 'session' object is now ready for sending and receiving data.
    // Example: send initial content or start audio streaming.
    // session.sendClientContent({ turns: "Hello Gemini." });

    // Remember to close the session when done.
    // session.close();
    return session;
}

// Example usage:
// connectToLiveAPI().then(session => {
//     console.log('Session connected. You can now send data.');
//     // Perform actions with the session
//     // session.close(); // Close when processing is complete
// }).catch(err => {
//     console.error('Failed to connect:', err);
// });
```

## 4. Sending and Receiving Text

While a voice app primarily deals with audio, understanding how to send and receive text is essential, especially for transcribed input or when dealing with responses that are initially text-based before audio synthesis.

### 4.1 Helper Functions for Asynchronous Message Handling

These helper functions (`waitMessage`, `handleTurn`) manage the asynchronous flow of messages from the Live API, ensuring messages are processed in order and turns are completed.

```javascript
// ... (Imports and ai/model/config setup)

// This queue stores incoming messages until they are processed.
const responseQueue = [];

async function waitMessage() {
    let done = false;
    let message = undefined;
    while (!done) {
        message = responseQueue.shift(); // Get the next message from the queue
        if (message) {
            done = true;
        } else {
            // Wait a short period if no message is available
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    return message;
}

async function handleTurn() {
    const turns = [];
    let done = false;
    while (!done) {
        const message = await waitMessage();
        turns.push(message);
        // A turn is complete when the serverContent indicates 'turnComplete'
        if (message.serverContent && message.serverContent.turnComplete) {
            done = true;
        }
    }
    return turns;
}
```

### 4.2 Sending Text Input and Receiving Text Output

```javascript
// ... (Previous setup, responseQueue, waitMessage, handleTurn)

async function sendAndReceiveTextExample() {
    const session = await ai.live.connect({
        model: model,
        callbacks: {
            onopen: function () { console.debug('Text session opened'); },
            onmessage: function (message) { responseQueue.push(message); }, // Push messages to queue
            onerror: function (e) { console.error('Text session error:', e.message); },
            onclose: function (e) { console.debug('Text session closed:', e.reason); },
        },
        config: { responseModalities: [Modality.TEXT] }, // Ensure TEXT modality for text output
    });

    const simpleTextInput = 'Hello, how are you today?';
    console.debug('Sending text:', simpleTextInput);
    session.sendClientContent({ turns: simpleTextInput });

    const receivedTurns = await handleTurn(); // Wait for the model's response turn to complete
    for (const turn of receivedTurns) {
        if (turn.text) {
            console.debug('Received text from model:', turn.text);
        } else if (turn.data) {
            console.debug('Received inline data:', turn.data); // For richer content if applicable
        }
    }

    session.close();
    console.debug('Text session closed successfully.');
}

// Call the example function
// sendAndReceiveTextExample().catch((e) => console.error('Error in text example:', e));
```

## 5. Sending and Receiving Audio

This is critical for a Telegram voice app. The API requires audio in a specific format: 16-bit PCM, 16kHz, mono.

### 5.1 Sending Audio Input

The sample code shows how to read a WAV file, convert it to the required format using `wavefile`, and send it. In a live Telegram application, you would capture audio from the user's microphone/voice message and stream it in chunks.

```javascript
import { GoogleGenAI, Modality } from '@google/genai';
import * as fs from "node:fs";
import pkg from 'wavefile';
const { WaveFile } = pkg; // Using default export for wavefile

// ... (Previous setup like ai, model, responseQueue, waitMessage, handleTurn)

async function sendAudioExample(audioFilePath = "sample.wav") {
    const session = await ai.live.connect({
        model: model,
        callbacks: {
            onopen: function () { console.debug('Audio input session opened'); },
            onmessage: function (message) { responseQueue.push(message); },
            onerror: function (e) { console.error('Audio input session error:', e.message); },
            onclose: function (e) { console.debug('Audio input session closed:', e.reason); },
        },
        config: { responseModalities: [Modality.TEXT] }, // We expect text transcription back for this example
    });

    try {
        console.debug('Reading audio file:', audioFilePath);
        const fileBuffer = fs.readFileSync(audioFilePath);

        // Ensure audio conforms to API requirements (16-bit PCM, 16kHz, mono)
        const wav = new WaveFile();
        wav.fromBuffer(fileBuffer);
        wav.toSampleRate(16000); // Resample to 16kHz
        wav.toBitDepth("16");   // Convert to 16-bit
        // Note: wavefile handles mono conversion implicitly if input is stereo
        // or you can explicitly convert: wav.toMono();
        const base64Audio = wav.toBase64(); // Encode to Base64

        // If your audio is already 16-bit PCM, 16kHz, mono (e.g., from a raw PCM stream),
        // you can directly convert the buffer to Base64:
        // const rawAudioBuffer = fs.readFileSync("sample.pcm");
        // const base64Audio = Buffer.from(rawAudioBuffer).toString('base64');

        console.debug('Sending audio chunk...');
        session.sendRealtimeInput(
            {
                audio: {
                    data: base64Audio,
                    mimeType: "audio/pcm;rate=16000" // Specify MIME type and sample rate
                }
            }
        );

        const receivedTurns = await handleTurn();
        for (const turn of receivedTurns) {
            if (turn.text) {
                console.debug('Received text transcription from model:', turn.text);
            }
            else if (turn.data) {
                console.debug('Received inline data (e.g., tool outputs):', turn.data);
            }
        }
    } catch (error) {
        console.error('Error sending audio:', error);
    } finally {
        session.close();
        console.debug('Audio input session closed successfully.');
    }
}

// To run this, you need a 'sample.wav' file in the same directory.
// You can download one from: https://storage.googleapis.com/generativeai-downloads/data/16000.wav
// sendAudioExample("sample.wav").catch((e) => console.error('Error in audio send example:', e));
```

**Key Considerations for Live Audio Capture:**
*   **Chunking:** For live streaming from a microphone, you'll need to continuously capture audio chunks, convert each chunk to the required format, and send it via `session.sendRealtimeInput()`.
*   **Silence Detection:** Implement client-side silence detection or rely on VAD to determine when a user has finished speaking.

### 5.2 Receiving Audio Output

To receive audio responses from Gemini, you must set `Modality.AUDIO` in the session's `responseModalities`. The example saves the received audio as a WAV file.

```javascript
// ... (Imports like GoogleGenAI, Modality, fs, WaveFile)
// ... (Previous setup like ai, model, responseQueue, waitMessage, handleTurn)

async function receiveAudioExample(outputFilePath = "output.wav") {
    const session = await ai.live.connect({
        model: model,
        callbacks: {
            onopen: function () { console.debug('Audio output session opened'); },
            onmessage: function (message) { responseQueue.push(message); },
            onerror: function (e) { console.error('Audio output session error:', e.message); },
            onclose: function (e) { console.debug('Audio output session closed:', e.reason); },
        },
        config: { responseModalities: [Modality.AUDIO] }, // Crucial: Request audio response
    });

    try {
        const textInput = 'Hello, how can I assist you today?';
        console.debug('Sending text for audio synthesis:', textInput);
        session.sendClientContent({ turns: textInput });

        const receivedTurns = await handleTurn(); // Wait for the full audio response turn
        console.debug('Processing received audio chunks...');

        // Combine audio data strings received from the model
        // The model typically sends audio in base64 encoded chunks.
        const combinedAudioInt16Arrays = receivedTurns.reduce((acc, turn) => {
            if (turn.data) {
                // Decode base64 to Buffer
                const buffer = Buffer.from(turn.data, 'base64');
                // Convert Buffer to Int16Array (raw PCM 16-bit samples)
                const intArray = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Int16Array.BYTES_PER_ELEMENT);
                return acc.concat(Array.from(intArray));
            }
            return acc;
        }, []);

        if (combinedAudioInt16Arrays.length === 0) {
            console.warn('No audio data received.');
            return;
        }

        const audioBuffer = new Int16Array(combinedAudioInt16Arrays);

        // Save as WAV file
        const wf = new WaveFile();
        // Live API audio output is always 24kHz, 16-bit PCM, mono (1 channel)
        wf.fromScratch(1, 24000, '16', audioBuffer);
        fs.writeFileSync(outputFilePath, wf.toBuffer());
        console.debug(`Audio saved to ${outputFilePath}`);

    } catch (error) {
        console.error('Error receiving audio:', error);
    } finally {
        session.close();
        console.debug('Audio output session closed successfully.');
    }
}

// receiveAudioExample("gemini_response.wav").catch((e) => console.error('Error in audio receive example:', e));
```

**Integrate with Telegram:**
For a Telegram bot, after receiving the `output.wav` file, you would send this audio file back to the user using the Telegram Bot API (`bot.sendVoice`, `bot.sendAudio`, etc.).

### 5.3 Audio Formats and Requirements

*   **Input Audio:** Always raw, little-endian, 16-bit PCM. While 16kHz is native, the API will resample other rates. You **must** specify the sample rate in the MIME type (e.g., `audio/pcm;rate=16000`).
*   **Output Audio:** Always raw, little-endian, 16-bit PCM at a sample rate of 24kHz.

## 6. Advanced Features for Voice Applications

Leverage these features to enhance the naturalness and responsiveness of your Telegram voice application.

### 6.1 Receiving Audio Transcriptions

You can enable transcriptions for both model output and user input.

#### 6.1.1 Model Output Transcriptions

Get text transcription of the model's generated audio.

```python
# Python example provided in source. Logic applies to JS:
# When Modality.AUDIO is enabled, you can also request a text transcription
# of the audio generated by the model.

# config = {"response_modalities": ["AUDIO"], "output_audio_transcription": {}}
#
# async for response in session.receive():
#     if response.server_content.output_transcription:
#         print("Transcript:", response.server_content.output_transcription.text)
```

#### 6.1.2 Input Audio Transcriptions

Get text transcription of the user's audio input.

```python
# Python example provided in source. Logic applies to JS:
# This allows you to display the user's transcribed speech in your UI.

# config = {
#     "response_modalities": ["TEXT"],
#     "realtime_input_config": {"automatic_activity_detection": {"disabled": True}}, # Can be used with VAD config
#     "input_audio_transcription": {},
# }
#
# async for msg in session.receive():
#     if msg.server_content.input_transcription:
#         print('User Transcript:', msg.server_content.input_transcription.text)
```

### 6.2 System Instructions

System instructions guide the model's behavior and persona throughout the session.

```javascript
import { GoogleGenAI, Modality } from '@google/genai';
// Assuming `types` is available if using the full client library,
// otherwise define content structure directly.
// For the JS SDK, `SystemInstruction` directly takes a string or parts array.

const systemInstructionConfig = {
    responseModalities: [Modality.AUDIO], // Or Modality.TEXT
    systemInstruction: {
        parts: [
            { text: "You are a friendly and helpful Telegram bot, always ready to assist users with their queries. Keep responses concise." }
        ]
    }
};

// Use this config when connecting:
// const session = await ai.live.connect({ model: model, callbacks: ..., config: systemInstructionConfig });
```

### 6.3 Incremental Content Updates

For establishing or restoring session context, especially for long conversations.

```javascript
// Example for sending turn-by-turn context:
// This is typically used to provide chat history to the model.

// First turn (user asks, model responds):
const turns1 = [
    { role: "user", parts: [{ text: "What's the weather like today?" }] },
    { role: "model", parts: [{ text: "It's sunny and mild." }] },
];
await session.sendClientContent({ turns: turns1, turnComplete: false }); // False if more context follows

// Second turn (new user query, model responds):
const turns2 = [{ role: "user", parts: [{ text: "And tomorrow?" }] }];
await session.sendClientContent({ turns: turns2, turnComplete: true }); // True for final turn of context
```

### 6.4 Changing Voice and Language

Customize the voice and language of Gemini's audio output.

#### 6.4.1 Voice Customization

```javascript
import { GoogleGenAI, Modality } from '@google/genai';
// The Modality and LiveConnectConfig types are directly from the SDK
// Ensure `types` is correctly imported or inferred if needed for internal structures.

const voiceConfig = {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
        voiceConfig: {
            // Available voices: Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, Zephyr
            prebuiltVoiceConfig: { voiceName: "Kore" }
        }
    }
};

// Use this config when connecting:
// const session = await ai.live.connect({ model: model, callbacks: ..., config: voiceConfig });
```

#### 6.4.2 Language Customization

```javascript
import { GoogleGenAI, Modality } from '@google/genai';

const languageConfig = {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
        languageCode: "de-DE", // Example: German
    }
};

// Note: Native audio output models automatically choose the appropriate language.
// Only use for `gemini-2.0-flash-live-001` or similar models.
// const session = await ai.live.connect({ model: model, callbacks: ..., config: languageConfig });
```

### 6.5 Native Audio Output

For higher quality and more natural audio responses. Use models like `gemini-2.5-flash-preview-native-audio-dialog`.

```javascript
// ... (Initial setup)

const nativeAudioModel = 'gemini-2.5-flash-preview-native-audio-dialog';
const nativeAudioConfig = { responseModalities: [Modality.AUDIO] };

async function connectNativeAudio() {
    const session = await ai.live.connect({
        model: nativeAudioModel,
        config: nativeAudioConfig,
        callbacks: {
            onopen: () => console.debug('Native audio session opened.'),
            onmessage: (m) => console.debug('Native audio message:', m),
            onerror: (e) => console.error('Native audio error:', e),
            onclose: (e) => console.debug('Native audio closed:', e),
        },
    });
    console.debug('Native audio model connected.');
    // You can now send audio input or text for native audio output.
    // session.close();
    return session;
}

// connectNativeAudio().catch(console.error);
```

### 6.6 Affective Dialog and Proactive Audio

These features, available with `v1alpha` API version and native audio models, enhance conversational flow.

*   **Affective Dialog:** Gemini adapts its response style to input expression and tone.
*   **Proactive Audio:** Gemini can proactively decide not to respond if content is irrelevant.

```javascript
import { GoogleGenAI, Modality } from '@google/genai';

// Important: Set API version to v1alpha for these features
const aiAlpha = new GoogleGenAI({ apiKey: "YOUR_GOOGLE_API_KEY", httpOptions: { "apiVersion": "v1alpha" } });

const affectiveProactiveConfig = {
    responseModalities: [Modality.AUDIO],
    enableAffectiveDialog: true,       // Enable affective dialog
    proactivity: { proactiveAudio: true } // Enable proactive audio
};

// Use with a native audio model
const specialFeaturesModel = 'gemini-2.5-flash-preview-native-audio-dialog';

async function connectWithSpecialFeatures() {
    const session = await aiAlpha.live.connect({
        model: specialFeaturesModel,
        config: affectiveProactiveConfig,
        callbacks: { /* ... */ },
    });
    console.debug('Connected with affective dialog and proactive audio.');
    // session.close();
    return session;
}

// connectWithSpecialFeatures().catch(console.error);
```

### 6.7 Native Audio Output with Thinking

A dedicated model `gemini-2.5-flash-exp-native-audio-thinking-dialog` provides thinking capabilities.

```javascript
// ... (Initial setup)

const thinkingModel = 'gemini-2.5-flash-exp-native-audio-thinking-dialog';
const thinkingConfig = { responseModalities: [Modality.AUDIO] };

async function connectThinkingAudio() {
    const session = await ai.live.connect({
        model: thinkingModel,
        config: thinkingConfig,
        callbacks: { /* ... */ },
    });
    console.debug('Thinking audio model connected.');
    // session.close();
    return session;
}

// connectThinkingAudio().catch(console.error);
```

### 6.8 Handling Interruptions

When VAD detects an interruption (e.g., user starts speaking before model finishes), the generation is cancelled.

```javascript
// In your onmessage callback or async message loop:
// Check for the 'interrupted' flag in server content.
// This example assumes a loop structure (like handleTurn or session.receive() for Python)

/*
async function receiveMessagesAndHandleInterruptions(session) {
    for await (const response of session.receive()) { // Conceptual, actual needs a loop based on responseQueue
        if (response.serverContent && response.serverContent.interrupted === true) {
            console.debug('Model generation was interrupted by user input.');
            // Implement logic to stop playing model audio,
            // or re-prompt/process user input.
        }
        // ... process other message types (text, audio, etc.)
    }
}
*/
```

### 6.9 Voice Activity Detection (VAD)

VAD helps detect when speech starts and ends.

#### 6.9.1 Using Automatic VAD (Default)

The model automatically performs VAD. Send `audioStreamEnd` when the audio stream is paused.

```javascript
// Python example adapted to JS conceptual:
// This assumes you are continuously streaming audio.

/*
// In an audio streaming loop (e.g., from a microphone):
while (hasAudioToStream) {
    const audioChunk = getNextAudioChunk(); // Your function to get audio
    session.sendRealtimeInput({
        audio: {
            data: Buffer.from(audioChunk).toString('base64'),
            mimeType: "audio/pcm;rate=16000"
        }
    });
    await sleep(chunkDurationMs); // Adjust based on your chunking
}

// If your audio stream temporarily pauses (e.g., user stops speaking briefly,
// but you expect them to speak again without closing the connection).
// This flushes any cached audio and helps the model understand end of utterance.
await session.sendRealtimeInput({ audioStreamEnd: true });
*/
```

#### 6.9.2 Configuring Automatic VAD

Fine-tune VAD sensitivity.

```javascript
import { GoogleGenAI, Modality } from '@google/genai';
// Assuming `types` is available for these enum values.

const vadConfig = {
    responseModalities: [Modality.TEXT], // Or AUDIO
    realtimeInputConfig: {
        automaticActivityDetection: {
            disabled: false, // Default
            startOfSpeechSensitivity: /* types.StartSensitivity.START_SENSITIVITY_LOW */ 'LOW', // LOW, MEDIUM, HIGH
            endOfSpeechSensitivity: /* types.EndSensitivity.END_SENSITIVITY_LOW */ 'LOW',     // LOW, MEDIUM, HIGH
            prefixPaddingMs: 20,    // Milliseconds of silence before start
            silenceDurationMs: 100, // Milliseconds of silence to trigger end of speech
        }
    }
};

// const session = await ai.live.connect({ model: model, callbacks: ..., config: vadConfig });
```

#### 6.9.3 Disabling Automatic VAD

If you have your own VAD or activity detection logic, disable the API's automatic VAD and manually send `activityStart` and `activityEnd` messages.

```javascript
import { GoogleGenAI, Modality } from '@google/genai';

const disabledVadConfig = {
    responseModalities: [Modality.TEXT], // Or AUDIO
    realtimeInputConfig: {
        automaticActivityDetection: { disabled: true },
    }
};

// Connect with this config
// const session = await ai.live.connect({ model: model, callbacks: ..., config: disabledVadConfig });

// Then, manually signal speech start/end:
/*
// When your client-side VAD detects start of speech:
session.sendRealtimeInput({ activityStart: {} });

// Stream audio chunks:
session.sendRealtimeInput({
    audio: {
        data: base64AudioChunk,
        mimeType: "audio/pcm;rate=16000"
    }
});

// When your client-side VAD detects end of speech:
session.sendRealtimeInput({ activityEnd: {} });
*/
```

### 6.10 Token Count

Track token usage for billing and optimization.

```javascript
// In your onmessage callback or async message loop:
/*
async function handleLiveMessages(session) {
    for await (const message of session.receive()) { // Conceptual, actual needs response queue processing
        if (message.usageMetadata) {
            const usage = message.usageMetadata;
            console.debug(`Total tokens used: ${usage.totalTokenCount}`);
            for (const detail of usage.responseTokensDetails) {
                console.debug(`  Modality: ${detail.modality}, Tokens: ${detail.tokenCount}`);
            }
        }
        // ... process other message types
    }
}
*/
```

## 7. Session Management and Resilience

For long-running conversations in your Telegram bot, manage session duration effectively.

### 7.1 Extending Session Duration

Enable context window compression and/or session resumption.

#### 7.1.1 Context Window Compression

Reduces context window size for longer sessions.

```javascript
import { GoogleGenAI, Modality } from '@google/genai';

const compressionConfig = {
    responseModalities: [Modality.AUDIO],
    contextWindowCompression: {
        slidingWindow: {}, // Configures compression with default sliding window parameters
        // You might define 'tokens' or other parameters here
    }
};

// const session = await ai.live.connect({ model: model, callbacks: ..., config: compressionConfig });
```

#### 7.1.2 Session Resumption

Allows your client to resume a session after a WebSocket connection reset.

```javascript
import { GoogleGenAI, Modality } from '@google/genai';

let previousSessionHandle = undefined; // Persist this handle across reconnections

async function resumeSessionExample() {
    const liveConfig = {
        responseModalities: [Modality.AUDIO],
        sessionResumption: {
            handle: previousSessionHandle, // Pass the last known handle, or undefined for new session
        },
    };

    console.debug(`Connecting to service with handle: ${previousSessionHandle || 'new session'}`);
    const session = await ai.live.connect({
        model: model,
        config: liveConfig,
        callbacks: {
            onopen: () => console.debug('Session opened.'),
            onmessage: (message) => {
                // Periodically, the server will send update messages that may contain a new handle.
                if (message.sessionResumptionUpdate) {
                    const update = message.sessionResumptionUpdate;
                    if (update.resumable && update.newHandle) {
                        console.debug('New session handle received:', update.newHandle);
                        previousSessionHandle = update.newHandle; // Store this for future reconnections
                    }
                }
                // ... process other messages
            },
            onerror: (e) => console.error('Session error:', e),
            onclose: (e) => console.debug('Session closed:', e),
        },
    });

    // Example of sending content (replace with your app logic)
    session.sendClientContent({ turns: "Hi, remember me?" })
    session.close(); // Example: Close after a simple interaction

    return previousSessionHandle; // Return the latest handle
}

// Example usage:
// (async () => {
//     // First connection (previousSessionHandle will be undefined)
//     await resumeSessionExample();
//     console.log('First interaction done. Stored handle:', previousSessionHandle);

//     // Simulate a disconnection and reconnection using the stored handle
//     console.log('Simulating re-connection...');
//     await new Promise(resolve => setTimeout(resolve, 2000)); // Wait a bit
//     await resumeSessionExample(); // Connect again using previousSessionHandle
//     console.log('Second interaction done. Stored handle:', previousSessionHandle);
// })();
```

### 7.2 Receiving a GoAway Message

The server sends `goAway` to signal imminent connection termination.

```javascript
// In your onmessage callback or async message loop:
/*
async function handleLiveMessages(session) {
    for await (const response of session.receive()) {
        if (response.goAway) {
            console.warn(`Connection will terminate soon! Time left: ${response.goAway.timeLeft}ms`);
            // Implement graceful shutdown, session resumption, or re-establishment logic here.
        }
        // ... process other messages
    }
}
*/
```

### 7.3 Receiving a GenerationComplete Message

Signals that the model has finished generating its response.

```javascript
// In your onmessage callback or async message loop:
/*
async function handleLiveMessages(session) {
    for await (const response of session.receive()) {
        if (response.serverContent && response.serverContent.generationComplete === true) {
            console.debug('Model has completed its generation for the current turn.');
            // This is a good point to stop playing audio or update UI.
        }
        // ... process other messages
    }
}
*/
```

### 7.4 Media Resolution

Specify media resolution for input media.

```javascript
import { GoogleGenAI, Modality } from '@google/genai';
// Assuming `types` provides `MediaResolution` enum.

const mediaResolutionConfig = {
    responseModalities: [Modality.AUDIO],
    mediaResolution: /* types.MediaResolution.MEDIA_RESOLUTION_LOW */ 'LOW', // Options: LOW, MEDIUM, HIGH (conceptual)
};

// const session = await ai.live.connect({ model: model, callbacks: ..., config: mediaResolutionConfig });
```

## 8. Limitations and Best Practices

Keep these in mind when designing your Telegram voice application.

### 8.1 Response Modalities

*   You can set **only one** response modality (`TEXT` or `AUDIO`) per session in the session configuration. You cannot receive both text and audio output in the same session. If you need both, you'll need two separate sessions or to rely on transcriptions for the text part.

### 8.2 Client Authentication (Crucial for Telegram Bots)

*   The Live API is designed for **server-to-server authentication** and is **not recommended for direct client use**.
*   **Best Practice for Telegram Bots:** Your Telegram bot server should act as an **intermediate application server**. User input from Telegram (voice messages, text) should be routed to *your server*, which then securely authenticates with the Google Live API. Responses from the API are received by your server and then sent back to the Telegram user. This protects your API key and provides a secure application layer.

### 8.3 Session Duration

*   **Audio-only sessions:** Limited to 15 minutes without compression.
*   **Audio plus video sessions:** Limited to 2 minutes without compression.
*   Exceeding these limits without **Context Window Compression** or **Session Resumption** will terminate the connection. Implement these features for long conversations.

### 8.4 Context Window

*   **Native audio output models:** 128k tokens.
*   **Other Live API models:** 32k tokens.
*   These limits apply to the model's memory of the conversation history. For very long conversations, consider summarizing parts of the history or using context window compression to manage token usage.

This comprehensive documentation should enable your team to effectively build a robust and engaging Telegram voice application using the Google Live API.