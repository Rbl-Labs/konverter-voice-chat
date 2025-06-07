# Konverter.ai Voice & Text Telegram Mini-App

## Overview
This project is a Telegram Mini-App designed to provide users with both voice and text-based AI chat interfaces. Users can choose to interact with an AI assistant via real-time voice conversation (powered by Google Gemini Live API) or through a standard text chat interface (powered by Google Dialogflow Messenger).

## Current Status
As of May 29, 2025:
The project has undergone a significant refactoring (Phases 1 & 2) to improve audio handling for real-time voice conversations with the Google Gemini Live API.

*   **Chooser Page**: `index.html` allows users to select voice or text chat.
*   **Voice Chat (`voice_chat.html`)**:
    *   **Continuous Conversation**: Multi-turn voice conversations are functional.
    *   **User Audio Input**: Utilizes `AdvancedAudioRecorder.js` and `audio_processor_worklet.js`, leveraging the Web Audio API and AudioWorklets. This system captures raw PCM audio from the user's microphone at 16kHz and streams it to the backend.
    *   **AI Audio Output**: Employs `PCMStreamPlayer.js`, which receives streamed PCM audio chunks (24kHz) from the backend. It uses the Web Audio API for low-latency playback, including client-side linear resampling to match the browser's `AudioContext` sample rate.
    *   **Achievements**:
        *   Significantly reduced AI audio playback latency compared to previous WAV-based approach.
        *   Improved overall audio quality and smoothness ("stitching" issues largely resolved, though minor artifacts can occasionally occur).
        *   Better audio volume control on mobile devices.
*   **Text Chat (`text_chat.html`)**: Integrated using Google Dialogflow Messenger, remains functional.
*   **Backend (`gemini_websocket_proxy.js`)**:
    *   Handles raw PCM audio input from the client (16kHz).
    *   Streams raw PCM audio output from Gemini (24kHz) directly to the client.
    *   Manages the Gemini Live API session.
    *   Session configuration (including VAD parameters like `silenceDurationMs`) is primarily controlled via an N8N workflow.

## Project Structure

### `/front_end/`
Contains all client-side files for the Telegram Mini-App.
*   `index.html`: Main landing/chooser page.
*   `text_chat.html`: HTML for Dialogflow Messenger text chat.
*   `voice_chat.html`: HTML for the Gemini voice chat interface.
*   `styles.css`: Main CSS for `voice_chat.html`.
*   `gemini_telegram_client.js`: (v3.3.0) Core JavaScript client for voice chat. Orchestrates WebSocket communication, session management, user audio capture via `AdvancedAudioRecorder`, and AI audio playback via `PCMStreamPlayer`.
*   `advanced_audio_recorder.js`: Captures microphone audio as PCM chunks using Web Audio API and `AudioWorkletNode`.
*   `audio_processor_worklet.js`: The `AudioWorkletProcessor` used by `AdvancedAudioRecorder` to get raw audio data.
*   `pcm_stream_player.js`: Plays incoming PCM audio chunks from the backend with low latency, including resampling, using Web Audio API.
*   `ui_controller.js`: Manages dynamic UI elements for `voice_chat.html`.
*   `telegram_audio_bridge.js`: Largely deprecated for core voice chat audio; `AdvancedAudioRecorder` and `PCMStreamPlayer` handle primary audio tasks. May still be used for simple UI sounds if any.
*   `deploy_to_github.sh`: Script for deploying frontend files to GitHub Pages.

### `/backend/`
Contains the server-side Node.js application.
*   `gemini_websocket_proxy.js`: WebSocket proxy server.
    *   Manages client WebSocket connections.
    *   Interfaces with N8N for session configuration.
    *   Streams user's 16kHz PCM audio to the Google Gemini Live API.
    *   Streams Gemini's 24kHz PCM audio response back to the client.
    *   No longer performs audio transcoding (e.g., WebM to PCM or PCM to WAV for the main voice stream).
*   `deploy_to_aws_v2.sh`: Script for deploying the backend.
*   `package.json`, `package-lock.json`: Node.js project files.
*   `.env`: For environment variables.

### `/n8n/`
N8N workflow JSON files.
*   `Voice_Session_API.json`: Manages voice chat session initialization and configuration, including Gemini API settings like VAD parameters.
*   `Telegram_Voice_Bot_Handler.json`: Handles Telegram bot interactions.

### `/documentation/`
Project documentation. (Needs review for outdated information).
*   `live_api.md`
*   `gemini_liveapi_websocket.md`
*   `deployment_guide.md`

## Key Technologies
*   **Frontend**: HTML5, CSS3, JavaScript (ES6 Modules), Telegram WebApp SDK, **Web Audio API (including AudioWorklets)**, Dialogflow Messenger.
*   **Backend**: Node.js, Express.js, `ws` (WebSocket library), Google Gemini Live API.
*   **Orchestration & Session Management**: N8N.
*   **Deployment**: GitHub Pages (frontend), AWS EC2 (backend).

## Known Issues & Next Steps

### Known Issues
*   **Session Interruption**: Conversations occasionally stop after 3-4 turns; the user's voice is no longer captured, and subsequent attempts to speak might initiate a new Gemini session. This is currently under investigation and may be related to VAD settings (e.g., `silenceDurationMs` in N8N) or Gemini API session behavior.
*   **Minor Audio Artifacts**: Occasional "stitching" issues or slight speed variations in AI speech, though significantly improved. This could be due to the simplicity of the current linear resampling or stream buffering in `PCMStreamPlayer`.
*   **Sample Rate Warning (Client Console)**: If the browser doesn't honor the requested 24kHz `AudioContext` sample rate for `PCMStreamPlayer` (defaulting to e.g., 48kHz), a warning is logged. The client-side resampling mitigates the audible impact, but this indicates the context isn't running at the ideal matched rate.
*   `favicon.ico` 404 errors in console (benign).

### Next Steps
1.  **Resolve Session Interruption Issue**:
    *   Experiment with `silenceDurationMs` and other VAD parameters in the N8N workflow.
    *   Conduct detailed logging on both client and backend around the point of failure to identify the root cause.
2.  **Further Audio Quality Tuning**:
    *   Fine-tune `PCMStreamPlayer` buffering (`minBufferDurationMs`, `chunkProcessSizeMs`) for even smoother playback.
    *   If linear resampling proves insufficient, consider implementing a more advanced client-side resampling algorithm (e.g., using a library or a more complex sinc interpolation).
3.  **AudioContext Management**: Investigate options for potentially sharing a single `AudioContext` between `AdvancedAudioRecorder` and `PCMStreamPlayer` for resource optimization, ensuring consistent sample rates if possible.
4.  **Documentation Review**: Update all files in `/documentation/` to reflect the new architecture.
5.  **Code Cleanup**: Remove any truly deprecated code paths (e.g., old WebM handling if fully replaced by PCM input).
6.  **Comprehensive Cross-Device Testing**: Continue testing on various iOS and Android devices.


## Explanation of Web Audio API and Gain Node

1. Web Audio API

What it is: The Web Audio API is a powerful JavaScript API built into modern web browsers for processing and synthesizing audio directly in web applications. It's much more advanced than the basic HTML5 <audio> element.
How it works: It operates on an "audio graph" concept. You create an AudioContext, which is like a central hub. Then, you create various "audio nodes" and connect them together to form a processing chain.
Source Nodes: These produce audio (e.g., from a microphone, an oscillator, or an existing audio file/buffer).
Processing Nodes: These modify audio (e.g., change volume, apply filters like equalization, add effects like reverb, analyze audio).
Destination Node: This is usually your speakers (audioContext.destination), where the final processed audio goes.
Key Capabilities:
Precise Timing: It allows for sample-accurate scheduling of audio events, which is crucial for gapless playback of audio chunks, sequencing sounds, and creating complex rhythms.
Low Latency: Designed for high-performance audio applications, aiming for minimal delay between an audio event and when it's heard.
Direct Audio Manipulation: You can access and manipulate raw audio data (PCM samples) directly, for example, to synthesize sounds, apply custom effects, or analyze audio content (like creating visualizations).
Modular Routing: You can create complex audio processing chains by connecting various nodes.
Why it's relevant to us:
For Playback Latency: For playing back the AI's voice, instead of loading a full WAV file into an <audio> tag, we can receive raw PCM audio chunks from the backend. The Web Audio API can then take these chunks, put them into AudioBuffers, and schedule them to play one after another with very precise timing, creating a smooth, continuous stream with much lower perceived latency. This is what the example demo's AudioStreamer does.
For Recording (AudioWorklets): For microphone input, AudioWorklets (part of Web Audio API) allow you to run custom JavaScript code in a separate, high-priority audio thread. This is great for processing raw microphone audio (like converting format, doing VAD, or sending chunks) without blocking the main browser thread, leading to more responsive input handling. The example demo's AudioRecorder uses this.
2. GainNode for Volume Control

What it is: A GainNode is a specific type of Web Audio API processing node that controls the volume (amplitude) of an audio signal passing through it.
How it works:
You create a GainNode using audioContext.createGain().
You connect an audio source (like an AudioBufferSourceNode playing a sound, or a microphone input) to the GainNode.
You then connect the GainNode to another node or to the audioContext.destination (speakers).
The GainNode has a gain property, which is an AudioParam. You can change the value of this gain.value to control the volume.
gain.value = 1 (default): No change in volume.
gain.value = 0.5: Reduces volume by half (-6dB).
gain.value = 2: Doubles the volume (+6dB).
gain.value = 0: Mutes the sound.
Key Capabilities:
Dynamic Volume Control: You can change the volume smoothly over time using methods like setValueAtTime, linearRampToValueAtTime, or exponentialRampToValueAtTime. This is great for fades or dynamic adjustments.
Per-Source Volume: If you have multiple audio sources, you can have a separate GainNode for each, allowing independent volume control before mixing them.
Why it's relevant to us (especially for the mobile volume issue):
If we switch to using Web Audio API for playing back the AI's voice (as proposed in Phase 2 of the redesign), we would create an AudioContext, then for each audio chunk from the AI, create an AudioBufferSourceNode, connect it to a GainNode, and then connect the GainNode to the speakers.
This GainNode would give us explicit programmatic control over the playback volume of the AI's voice. If the low volume on mobile is due to some default handling of <audio> elements by the Telegram WebApp browser or OS, using a GainNode might allow us to boost the volume or set it to a consistent level more reliably. We could even add a user-facing volume slider that controls this GainNode's value.
