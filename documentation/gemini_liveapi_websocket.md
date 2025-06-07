Gemini Live API (WebSockets) for Telegram Voice Chats
1. Introduction
The Gemini Live API is a stateful API that leverages WebSockets to enable real-time, bidirectional communication with the Gemini server. This allows for dynamic conversational experiences, making it ideal for building features like AI-powered voice assistants within Telegram voice chats.

This documentation will cover:

Establishing and managing WebSocket sessions.
Configuring the Gemini model for real-time interactions.
Sending real-time audio input and receiving streaming responses.
Handling conversational turns, interruptions, and transcriptions.
Authentication mechanisms.
2. Key Concepts
WebSocket Connection: The persistent, bidirectional communication channel between our client (Telegram bot backend) and the Gemini server.
Session: A WebSocket connection establishes a session. This session maintains state, allowing for multi-turn conversations and dynamic changes to configuration (except the model).
Stateful API: Unlike typical REST APIs, the Live API maintains context across messages within a session, which is crucial for natural conversational flows.
Real-time Interaction: Designed for immediate processing of streaming audio/video/text input and delivering incremental responses.
3. Connection and Authentication
3.1. WebSocket Endpoint
To initiate a session, connect to the following WebSocket URL:

wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent
Note: The URL is for version v1beta.

3.2. Ephemeral Authentication Tokens
Authentication for the Live API uses ephemeral tokens. These tokens provide secure, short-lived access to the API.

Obtain Token: You must first call the AuthTokenService.CreateToken endpoint (likely a separate REST API call) to generate an ephemeral token. The documentation implies this is a different service, not part of the WebSocket stream itself.

The CreateAuthTokenRequest defines parameters like expireTime, newSessionExpireTime, and uses.
You can also configure bidiGenerateContentSetup within the token creation request to embed session configuration, potentially simplifying the first WebSocket message.
Use Token with WebSocket: Once you have the token, pass it to the WebSocket connection in one of two ways:

As an access_token query parameter:
wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?access_token=<YOUR_EPHEMERAL_TOKEN>
In an HTTP Authorization header with "Token" prefixed:
Authorization: Token <YOUR_EPHEMERAL_TOKEN>
(Note: How to pass HTTP headers during a WebSocket handshake depends on your WebSocket client library.)
Example (Conceptual CreateAuthTokenRequest for context):

{
  "authToken": {
    "expireTime": "2024-01-01T12:30:00Z", // Example: 30 mins from now
    "newSessionExpireTime": "2024-01-01T12:01:00Z", // Example: 60 seconds from now
    "uses": 1, // Token can be used once
    "bidiGenerateContentSetup": {
      "model": "models/gemini-1.5-pro-latest",
      "generationConfig": {
        "temperature": 0.7
      }
    }
  }
}
4. Session Lifecycle & Message Exchange
A typical session involves an initial setup, followed by continuous bidirectional message exchange.

4.1. Step 1: Establishing the Session - The BidiGenerateContentSetup Message
The very first message sent over a new WebSocket connection must be a BidiGenerateContentSetup message. This configures the session, including the model to use and various generation parameters.

Important: You can change parameters except the model during the session by sending another BidiGenerateContentSetup message (though this isn't explicitly stated, the session configuration section implies it by saying "You can change the configuration parameters except the model during the session"). However, for practical purposes, it's safer to consider BidiGenerateContentSetup primarily for initial configuration.

JSON Structure:

{
  "model": "string", // Required. The model's resource name, e.g., "models/gemini-1.5-flash-latest"
  "generationConfig": { // Optional. Model generation parameters.
    "candidateCount": 1, // integer, default 1. Number of response candidates to generate.
    "maxOutputTokens": 2048, // integer. Max tokens in the response.
    "temperature": 0.7, // number (0.0 - 1.0). Controls randomness. Higher = more creative.
    "topP": 0.95, // number. Nucleus sampling.
    "topK": 64, // integer. Top-k sampling.
    "presencePenalty": 0.0, // number. Penalizes new tokens based on their presence in the text.
    "frequencyPenalty": 0.0, // number. Penalizes new tokens based on their frequency in the text.
    "responseModalities": ["TEXT"], // [string]. E.g., ["TEXT", "AUDIO"].
    "speechConfig": {}, // object. Details for speech generation (e.g., voice, speaking rate). See SDK for options.
    "mediaResolution": {} // object. Resolution for video generation. See SDK for options.
  },
  "systemInstruction": "string", // Optional. Text-based system instructions for the model.
  "tools": [ // Optional. Tools the model can use (e.g., function calling).
    { /* object, see Tool definition */ }
  ],
  "realtimeInputConfig": { // Optional. Configures handling of real-time input.
    "automaticActivityDetection": { // Optional. Configures automatic detection of user activity (voice/text).
      "disabled": false, // boolean. If true, client must send activity signals. Default is enabled.
      "startOfSpeechSensitivity": "START_SENSITIVITY_HIGH", // Optional. How likely speech is to be detected.
      "prefixPaddingMs": 200, // Optional. Duration of detected speech before commit (lower = more sensitive).
      "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH", // Optional. How likely detected speech is ended.
      "silenceDurationMs": 1000 // Optional. Duration of non-speech before end-of-speech (larger = more tolerance for gaps).
    },
    "activityHandling": "START_OF_ACTIVITY_INTERRUPTS", // Optional. How activity affects model response.
    // ENUMs: "ACTIVITY_HANDLING_UNSPECIFIED", "START_OF_ACTIVITY_INTERRUPTS" (default, barge-in), "NO_INTERRUPTION"
    "turnCoverage": "TURN_INCLUDES_ONLY_ACTIVITY" // Optional. Which input is included in the user's turn.
    // ENUMs: "TURN_COVERAGE_UNSPECIFIED", "TURN_INCLUDES_ONLY_ACTIVITY" (default, excludes silence), "TURN_INCLUDES_ALL_INPUT"
  },
  "sessionResumption": { // Optional. Configures session resumption.
    "handle": "string" // Handle of a previous session to resume.
  },
  "contextWindowCompression": { // Optional. Configures context window compression.
    "slidingWindow": { // A sliding window mechanism.
      "targetTokens": 1024 // int64. Target tokens to keep after compression.
    },
    "triggerTokens": 2048 // int64. Tokens to trigger compression.
  },
  "inputAudioTranscription": {}, // Optional. If set, enables transcription of voice input.
  "outputAudioTranscription": {}, // Optional. If set, enables transcription of model's audio output.
  "proactivity": { // Optional. Configures model proactivity.
    "proactiveAudio": true // If enabled, model can reject responding to irrelevant input.
  }
}
Key fields for Voice Chat:

model: Choose an appropriate Gemini model (e.g., gemini-1.5-flash-latest for faster real-time responses).
realtimeInputConfig: Crucial for fine-tuning how the API detects and processes user speech (activity detection, barge-in).
inputAudioTranscription: Enable this to get transcriptions of user input.
outputAudioTranscription: Enable this to get transcriptions of the model's audio output.
generationConfig.speechConfig: While not detailed here, this is where you'd configure the voice for the model's output (e.g., voice gender, pitch, speaking rate). You'll need to consult the Python SDK or full API reference for specific options.
Example Code (Python with websockets library):

import asyncio
import websockets
import json

# Replace with your actual ephemeral token
EPHEMERAL_AUTH_TOKEN = "YOUR_EPHEMERAL_TOKEN_HERE" 
WEBSOCKET_URL = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?access_token={EPHEMERAL_AUTH_TOKEN}"

async def send_setup_message(websocket):
    setup_message = {
        "setup": {
            "model": "models/gemini-1.5-flash-latest", # Or "gemini-1.5-pro-latest"
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 2048,
                "responseModalities": ["TEXT", "AUDIO"], # Requesting both text and audio output
                # speechConfig options are highly model/API specific,
                # consult the Gemini API's BidiGenerateContentSetup documentation for detailed options.
                # Example (conceptual, actual structure may vary):
                # "speechConfig": {
                #     "synthesizer": {
                #         "voice": {
                #             "name": "en-US-Standard-C", # Example voice name
                #             "pitch": 0.0,
                #             "speakingRate": 1.0
                #         }
                #     }
                # }
            },
            "systemInstruction": "You are a helpful AI assistant for Telegram voice chats.",
            "realtimeInputConfig": {
                "automaticActivityDetection": {
                    "disabled": False, # Enable automatic detection
                    "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH",
                    "silenceDurationMs": 700 # Shorter silence for quicker turn-ending
                },
                "activityHandling": "START_OF_ACTIVITY_INTERRUPTS", # Enable barge-in
                "turnCoverage": "TURN_INCLUDES_ONLY_ACTIVITY" # Ignore silence in turns
            },
            "inputAudioTranscription": {}, # Enable transcription for user input
            "outputAudioTranscription": {} # Enable transcription for model output
        }
    }
    await websocket.send(json.dumps(setup_message))
    print("Sent BidiGenerateContentSetup message.")

    # Wait for setup complete confirmation
    response = json.loads(await websocket.recv())
    if "setupComplete" in response:
        print("Received BidiGenerateContentSetupComplete.")
    else:
        print(f"Unexpected response after setup: {response}")
        # Handle error or retry setup
4.2. Step 2: Sending Messages (Client to Server)
After setup, you can send various message types to the server. For voice chats, BidiGenerateContentRealtimeInput will be your primary method.

Messages must contain exactly one of the following top-level fields: setup, clientContent, realtimeInput, toolResponse.

4.2.1. BidiGenerateContentRealtimeInput (Primary for Voice Chat)
This message type is designed for continuous, real-time streams of audio, video, or text. It's crucial because it does not interrupt current model generation, allowing for incremental processing and low-latency responses.

Audio Input: Send raw audio bytes in audio field.
Activity Signals: Can be sent to manually signal start/end of user activity if automaticActivityDetection is disabled.
audioStreamEnd: Essential to signal that the client's audio stream has temporarily ended (e.g., user stopped speaking, microphone turned off). This prompts the model to finalize its understanding of the input turn. The client can then reopen the stream by sending another audio message.
JSON Structure (for audio input):

{
  "realtimeInput": {
    "audio": { // Required for audio input
      "data": "base64_encoded_audio_bytes" // Base64 encoded raw audio bytes
    },
    // OR "text": "string" for real-time text input
    // OR "video": {...} for video input (not covered for voice chat)

    // Optional activity signals (only if automatic detection is disabled)
    "activityStart": {},
    "activityEnd": {},

    "audioStreamEnd": true // Optional. Indicates the audio stream has ended for now.
                          // Should only be sent when automatic activity detection is enabled (default).
  }
}
Audio Format Considerations:
The documentation does not explicitly state required audio formats (e.g., sample rate, channels, encoding like LPCM, Opus). This is critical and must be determined through further documentation or experimentation. Typical requirements are 16kHz, 16-bit, mono PCM. You'll need to encode your audio to Base64 before sending.

Example Code (Sending Audio Chunks - Conceptual):

# Assuming you have an audio stream (e.g., from a microphone or file)
# that provides raw audio bytes in chunks.
# Make sure the audio format (e.g., sample rate, encoding) matches Gemini's requirements.

async def send_audio_stream(websocket, audio_source):
    while True:
        audio_chunk = await audio_source.read(4096) # Read a chunk of audio bytes
        if not audio_chunk:
            # End of audio stream (e.g., user stopped speaking, file ended)
            await websocket.send(json.dumps({
                "realtimeInput": {
                    "audioStreamEnd": True
                }
            }))
            print("Sent audioStreamEnd.")
            break

        # Base64 encode the audio chunk
        base64_audio = base64.b64encode(audio_chunk).decode('utf-8')
        await websocket.send(json.dumps({
            "realtimeInput": {
                "audio": {
                    "data": base64_audio
                }
            }
        }))
        # print(f"Sent audio chunk ({len(audio_chunk)} bytes)")
        await asyncio.sleep(0.05) # Adjust sleep for real-time flow

# Example for a simple "Hello world" turn using BidiGenerateContentRealtimeInput for text (less common for voice)
async def send_text_realtime_input(websocket, text):
    await websocket.send(json.dumps({
        "realtimeInput": {
            "text": text
        }
    }))
    print(f"Sent real-time text input: '{text}'")
    await websocket.send(json.dumps({
        "realtimeInput": {
            "audioStreamEnd": True # Signal end of user turn
        }
    }))
    print("Sent audioStreamEnd after text.")
4.2.2. BidiGenerateContentClientContent
This message type provides incremental updates to the conversation history. Crucially, sending this message will interrupt any current model generation. Use this when you want to explicitly append a turn (e.g., a transcribed sentence or a user's text input) to the conversation history and force the model to process it.

turns: Contains Content objects.
turnComplete: If true, indicates that the server should start generation based on the accumulated prompt.
JSON Structure:

{
  "clientContent": {
    "turns": [
      {
        "parts": [
          {
            "text": "The user said something here."
          }
        ],
        "role": "user" // Or "model" if you're injecting previous model turns
      }
    ],
    "turnComplete": true // Set to true to signal the end of the client's turn
  }
}
When to use ClientContent vs. RealtimeInput in Voice Chat:

RealtimeInput: Best for continuous audio streaming where you want the model to start responding even before the user finishes speaking (low latency, incremental). This is the default approach for voice assistants.
ClientContent: Useful for scenarios where you have a fully transcribed segment (e.g., a sentence) and want to explicitly add it to the conversation history, or if you need to inject complex conversational history directly. It's also suitable for explicit push-to-talk scenarios where you send the full audio after the user releases the button, then set turnComplete.
4.2.3. BidiGenerateContentToolResponse
This message is sent in response to a ToolCall message from the server. If the Gemini model requests a function call (e.g., to fetch external data or perform an action), your client executes it and sends the result back using this message.

JSON Structure:

{
  "toolResponse": {
    "functionResponses": [
      {
        "id": "tool_call_id_from_server", // Match the ID from the server's FunctionCall
        "response": {
          "name": "function_name",
          "content": { /* JSON object with function call result */ }
        }
      }
    ]
  }
}
4.3. Step 3: Receiving Messages (Server to Client)
The client listens for the WebSocket 'message' event and parses the JSON response. Server messages may include usageMetadata and will have exactly one of the following top-level fields: setupComplete, serverContent, toolCall, toolCallCancellation, goAway, sessionResumptionUpdate.

4.3.1. BidiGenerateContentServerContent (Core Output for Voice Chat)
This is the primary message type for receiving the model's generated content, including text, audio, and transcriptions. Content is generated as quickly as possible.

Key Fields for Voice Chat:

modelTurnContent: The actual content generated by the model. For voice chat, this will contain Content objects with parts that are either text (for the textual response) or audio (for the synthesized speech).
generationComplete: true when the model is done generating the current turn's content.
turnComplete: true when the model has completed its entire turn. Generation will only resume with additional client messages.
interrupted: true if a client message (e.g., BidiGenerateContentClientContent or user activityStart if START_OF_ACTIVITY_INTERRUPTS is enabled) has interrupted the model's current generation. This is your signal to stop playing the current output.
inputTranscription: Transcription of the client's audio input.
outputTranscription: Transcription of the model's audio output.
JSON Structure (simplified for common voice chat use):

{
  "serverContent": {
    "modelTurnContent": {
      "parts": [
        {
          "text": "Hello! How can I help you today?" // Textual part
        },
        {
          "audio": {
            "data": "base64_encoded_audio_bytes" // Base64 encoded synthesized speech audio
          }
        }
      ]
    },
    "generationComplete": false, // Incremental until true
    "turnComplete": false,       // Incremental until true
    "interrupted": false,
    "inputTranscription": {
      "text": "Hi there" // What Gemini transcribed from user's speech
    },
    "outputTranscription": {
      "text": "Hello how can I help you today" // What Gemini synthesized and transcribed
    }
    // ... other fields like groundingMetadata, urlContextMetadata
  }
}
Example Code (Receiving and Processing Messages):

import base64
import json
import asyncio

async def receive_messages(websocket):
    try:
        async for message_json in websocket:
            message = json.loads(message_json)
            # print(f"Received message: {message}") # For debugging

            if "serverContent" in message:
                server_content = message["serverContent"]
                if "modelTurnContent" in server_content:
                    for part in server_content["modelTurnContent"]["parts"]:
                        if "text" in part:
                            print(f"Model Text Output: {part['text']}")
                            # You can display this text in Telegram chat or console
                        if "audio" in part:
                            audio_data = base64.b64decode(part["audio"]["data"])
                            # Here, you would send `audio_data` to Telegram for playback
                            # Example: Save to file or push to audio playback queue
                            # with open("output.wav", "ab") as f: # Append to file
                            #     f.write(audio_data)
                            print(f"Received model audio chunk ({len(audio_data)} bytes).")
                
                if "inputTranscription" in server_content:
                    print(f"User Input Transcription: {server_content['inputTranscription']['text']}")
                
                if "outputTranscription" in server_content:
                    print(f"Model Output Transcription: {server_content['outputTranscription']['text']}")

                if server_content.get("interrupted"):
                    print("Model generation interrupted by client.")
                    # Stop current audio playback
                
                if server_content.get("generationComplete"):
                    print("Model generation completed for this turn.")
                
                if server_content.get("turnComplete"):
                    print("Model turn completed.")
                    # Prepare for next user input
            
            elif "setupComplete" in message:
                print("Setup confirmed by server.")
            
            elif "toolCall" in message:
                print(f"Tool call requested: {message['toolCall']['functionCalls']}")
                # Implement tool execution and send BidiGenerateContentToolResponse
            
            elif "goAway" in message:
                print(f"Server is disconnecting in {message['goAway']['timeLeft']} seconds.")
                break # Exit loop, connection will close
            
            elif "sessionResumptionUpdate" in message:
                print(f"Session Resumption Update: {message['sessionResumptionUpdate']}")
            
            else:
                print(f"Unknown message type received: {message}")

    except websockets.exceptions.ConnectionClosedOK:
        print("WebSocket connection closed cleanly.")
    except websockets.exceptions.ConnectionClosedError as e:
        print(f"WebSocket connection closed with error: {e}")
    except Exception as e:
        print(f"An error occurred during message reception: {e}")
4.3.2. Other Server Messages
BidiGenerateContentSetupComplete: A confirmation that the BidiGenerateContentSetup message was processed successfully.
BidiGenerateContentToolCall: Request for the client to execute specific functionCalls.
BidiGenerateContentToolCallCancellation: Notification to cancel a previously issued tool call.
GoAway: A notice that the server will soon disconnect, including timeLeft.
SessionResumptionUpdate: Provides an updated session handle for potential resumption if configured.
5. Advanced Configuration for Voice Chats
These settings, primarily part of BidiGenerateContentSetup.realtimeInputConfig, are crucial for tailoring the voice chat experience.

5.1. Automatic Activity Detection
automaticActivityDetection.disabled (bool):
false (default): Gemini automatically detects voice/text activity. This is recommended for hands-free or natural conversational flows.
true: You must manually send activityStart and activityEnd messages within BidiGenerateContentRealtimeInput to signal user activity.
startOfSpeechSensitivity / endOfSpeechSensitivity (Enums):
_HIGH: Detects speech starts/ends more often (more sensitive).
_LOW: Detects speech starts/ends less often (less sensitive, more tolerant to pauses).
prefixPaddingMs (int32): Duration of detected speech required before start-of-speech is committed. Lower value = more sensitive to short speech, but higher false positives.
silenceDurationMs (int32): Duration of non-speech (silence) required before end-of-speech is committed. Larger value = longer speech gaps tolerated, but increased latency for turn completion.
5.2. Activity Handling (Barge-in)
activityHandling (Enum):
START_OF_ACTIVITY_INTERRUPTS (default): If the user starts speaking while the model is responding, the model's current response is cut off. This is essential for "barge-in" functionality.
NO_INTERRUPTION: The model's response will not be interrupted by new user activity.
5.3. Turn Coverage
turnCoverage (Enum):
TURN_INCLUDES_ONLY_ACTIVITY (default): The user's turn only includes actual activity (speech/text), excluding periods of inactivity (silence).
TURN_INCLUDES_ALL_INPUT: The user's turn includes all real-time input since the last turn, including inactivity (silence).
5.4. Audio Transcription
inputAudioTranscription (object): Include an empty object {} in BidiGenerateContentSetup to enable transcription of user audio input. You'll receive inputTranscription in BidiGenerateContentServerContent.
outputAudioTranscription (object): Include an empty object {} to enable transcription of the model's audio output. You'll receive outputTranscription in BidiGenerateContentServerContent.
5.5. Proactivity
proactivity.proactiveAudio (bool): If enabled, the model can reject responding to the last prompt, e.g., ignoring out-of-context speech or staying silent if no clear request was made. Useful for more natural conversational boundaries.
6. Workflow for Telegram Voice Chat Integration
Here's a high-level conceptual workflow for integrating Gemini Live API into a Telegram voice chat bot:

User Initiates Voice Chat:

Telegram user starts a voice message or joins a voice chat.
Your Telegram bot backend captures the incoming audio stream.
Establish WebSocket Connection:

On the backend, create a new WebSocket connection to the Gemini Live API endpoint.
Include the ephemeral authentication token.
Send Session Configuration (BidiGenerateContentSetup):

Immediately after connection, send the BidiGenerateContentSetup message.
Configure model, generationConfig, realtimeInputConfig (especially automaticActivityDetection and activityHandling for barge-in), and enable inputAudioTranscription/outputAudioTranscription.
Wait for BidiGenerateContentSetupComplete.
Stream User Audio Input (BidiGenerateContentRealtimeInput):

As you receive audio chunks from Telegram (e.g., Opus, which you'll need to decode to raw PCM first if Gemini requires it), encode them (e.g., Base64) and send them as audio parts within BidiGenerateContentRealtimeInput messages.
Ensure proper chunking and timing to maintain a real-time flow.
If the user stops speaking, or if Telegram signals end of a voice message, send audioStreamEnd: true in a BidiGenerateContentRealtimeInput message.
Receive & Process Gemini Responses (BidiGenerateContentServerContent):

Continuously listen for incoming WebSocket messages.
When BidiGenerateContentServerContent messages arrive:
Extract modelTurnContent.parts with audio.data. Decode the Base64 audio and prepare it for playback.
Crucial: Implement an audio playback queue. As audio chunks arrive, add them to the queue. Start playback as soon as the first chunk is available.
Monitor interrupted field: If true, immediately clear the playback queue and stop current audio to handle barge-in.
Monitor generationComplete and turnComplete to understand the model's progress and manage conversational state.
Display inputTranscription and outputTranscription to the user in the Telegram chat (optional, but good for accessibility/debugging).
Handle Tool Calls (If Applicable):

If BidiGenerateContentToolCall is received, execute the function on your backend.
Send the result back using BidiGenerateContentToolResponse.
Manage Turns & Session:

After turnComplete, the model is ready for the next user input.
If the user continues speaking after the model has finished its turn, the process repeats from Step 4.
Monitor for GoAway messages to gracefully close connections.
Considerations for Telegram Specifics:
Audio Codec Conversion: Telegram uses Opus for voice messages. You'll likely need to transcode Opus to raw PCM (e.g., 16kHz, 16-bit, mono) for Gemini, and then Gemini's output PCM back to Opus for Telegram. Libraries like ffmpeg or specialized audio processing libraries will be needed.
Real-time Streaming: Telegram's voice chat APIs might provide raw audio streams directly, or you might need to handle file downloads and segment them. The goal is to get continuous audio chunks to Gemini.
Latency: Minimize processing delays on your backend to ensure a fluid conversational experience.
Error Handling: Implement robust error handling for WebSocket connection issues, API errors, and audio processing failures.
Concurrency: Your bot needs to handle multiple concurrent voice chats, meaning multiple WebSocket connections to Gemini.
7. Code Snippet Summary (Putting it all together)
This is a conceptual example combining the send and receive logic. You'd typically abstract this into classes for a full-fledged application.

import asyncio
import websockets
import json
import base64
import os
# from pydub import AudioSegment # Example for audio processing (install: pip install pydub)
# from pydub.playback import play # Example for local playback

# --- Configuration ---
EPHEMERAL_AUTH_TOKEN = os.environ.get("GEMINI_LIVE_API_TOKEN", "YOUR_EPHEMERAL_TOKEN_HERE")
WEBSOCKET_URL = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?access_token={EPHEMERAL_AUTH_TOKEN}"
MODEL_NAME = "models/gemini-1.5-flash-latest"

async def handle_gemini_session(incoming_audio_stream_source, outgoing_audio_playback_sink):
    """
    Manages a single Gemini Live API session for a voice chat.
    :param incoming_audio_stream_source: An async generator or queue that yields raw audio bytes from the user.
    :param outgoing_audio_playback_sink: An async function or queue to consume raw audio bytes for playback to the user.
    """
    try:
        async with websockets.connect(WEBSOCKET_URL) as websocket:
            print("Connected to Gemini Live API.")

            # 1. Send Setup Message
            setup_message = {
                "setup": {
                    "model": MODEL_NAME,
                    "generationConfig": {
                        "temperature": 0.7,
                        "maxOutputTokens": 2048,
                        "responseModalities": ["TEXT", "AUDIO"],
                    },
                    "systemInstruction": "You are a friendly AI assistant.",
                    "realtimeInputConfig": {
                        "automaticActivityDetection": {
                            "disabled": False,
                            "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH",
                            "silenceDurationMs": 700
                        },
                        "activityHandling": "START_OF_ACTIVITY_INTERRUPTS", # Barge-in enabled
                    },
                    "inputAudioTranscription": {},
                    "outputAudioTranscription": {}
                }
            }
            await websocket.send(json.dumps(setup_message))
            print("Sent BidiGenerateContentSetup message.")
            
            setup_response = json.loads(await websocket.recv())
            if "setupComplete" not in setup_response:
                print(f"Error: Did not receive setupComplete. Response: {setup_response}")
                return

            print("Received BidiGenerateContentSetupComplete. Session ready.")

            # Start tasks for sending and receiving messages concurrently
            send_task = asyncio.create_task(
                send_audio_to_gemini(websocket, incoming_audio_stream_source)
            )
            receive_task = asyncio.create_task(
                receive_and_process_gemini_messages(websocket, outgoing_audio_playback_sink)
            )

            await asyncio.gather(send_task, receive_task)

    except websockets.exceptions.ConnectionClosedOK:
        print("WebSocket connection closed cleanly.")
    except websockets.exceptions.ConnectionClosedError as e:
        print(f"WebSocket connection closed with error: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

async def send_audio_to_gemini(websocket, audio_source_generator):
    """Reads audio from a generator and sends it to Gemini."""
    try:
        async for audio_chunk in audio_source_generator:
            if audio_chunk is None: # Signal for end of user's turn
                await websocket.send(json.dumps({"realtimeInput": {"audioStreamEnd": True}}))
                print("Sent audioStreamEnd.")
                break # Or continue waiting for next turn if managing multi-turn from source
            
            base64_audio = base64.b64encode(audio_chunk).decode('utf-8')
            await websocket.send(json.dumps({
                "realtimeInput": {
                    "audio": {
                        "data": base64_audio
                    }
                }
            }))
            # print(f"Sent audio chunk ({len(audio_chunk)} bytes)")
            # You might need to add a small delay here based on audio sample rate and chunk size
            # E.g., for 16kHz, 16-bit mono, 4096 bytes is 128ms of audio.
            # await asyncio.sleep(len(audio_chunk) / (16000 * 2)) # approximate sleep based on audio duration
            
    except Exception as e:
        print(f"Error sending audio to Gemini: {e}")
    finally:
        print("Finished sending audio stream.")

async def receive_and_process_gemini_messages(websocket, playback_sink):
    """Receives messages from Gemini and passes audio to playback sink."""
    try:
        async for message_json in websocket:
            message = json.loads(message_json)
            # print(f"Received: {message}") # Uncomment for full debug

            if "serverContent" in message:
                server_content = message["serverContent"]
                if "modelTurnContent" in server_content:
                    for part in server_content["modelTurnContent"]["parts"]:
                        if "text" in part:
                            print(f"Model Text Output: {part['text']}")
                            # Send text to Telegram chat
                        if "audio" in part:
                            audio_data = base64.b64decode(part["audio"]["data"])
                            await playback_sink(audio_data) # Send audio to Telegram for playback
                            # print(f"Received model audio chunk ({len(audio_data)} bytes) for playback.")
                
                if "inputTranscription" in server_content:
                    print(f"User Input Transcription: {server_content['inputTranscription']['text']}")
                    # Update Telegram UI with transcription
                
                if "outputTranscription" in server_content:
                    print(f"Model Output Transcription: {server_content['outputTranscription']['text']}")
                    # Update Telegram UI with transcription
                
                if server_content.get("interrupted"):
                    print("Model generation interrupted. Clearing playback queue.")
                    # Signal playback sink to clear its queue and stop current audio
                
                if server_content.get("generationComplete"):
                    print("Model generation completed.")
                
                if server_content.get("turnComplete"):
                    print("Model turn completed. Ready for next user input.")
            
            elif "goAway" in message:
                print(f"Server going away: {message.get('goAway', {})}")
                return # End reception

    except Exception as e:
        print(f"Error receiving messages from Gemini: {e}")
    finally:
        print("Finished receiving messages.")

# --- Example Usage (Conceptual) ---
async def main():
    # Simulate an incoming audio stream from a user (e.g., from Telegram's audio input)
    async def simulated_audio_source():
        # This would come from your Telegram bot's audio capture
        yield b"..." # first audio chunk
        await asyncio.sleep(0.1)
        yield b"..." # second audio chunk
        await asyncio.sleep(0.1)
        # ... more chunks
        yield None # Signal end of user's speaking turn

    # Simulate an outgoing audio playback sink (e.g., sending to Telegram for user)
    async def simulated_playback_sink(audio_data):
        # This would send audio_data (after transcoding to Opus if needed) to Telegram
        # print(f"Sending {len(audio_data)} bytes to Telegram for playback.")
        # if 'pydub' in globals(): # For local testing
        #     audio_segment = AudioSegment(audio_data, frame_rate=16000, sample_width=2, channels=1)
        #     play(audio_segment)
        pass # Actual Telegram sending logic here

    await handle_gemini_session(simulated_audio_source(), simulated_playback_sink)

# To run this:
# if __name__ == "__main__":
#     # Make sure you have an ephemeral token in GEMINI_LIVE_API_TOKEN environment variable
#     # Or replace the placeholder at the top.
#     # For local testing, you might need pyaudio or simpleaudio to play audio.
#     # For real Telegram integration, this would be part of your bot's event loop.
#     asyncio.run(main())

