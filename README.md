# Telegram Mini-App with Gemini Voice Integration

This implementation uses a WebRTC-based approach with native Telegram integration for seamless voice conversations with Google's Gemini AI.

## Architecture Overview

The solution consists of three main components:

1. **TelegramAudioBridge**: A WebRTC-based audio bridge that handles audio capture, processing, and playback optimized for mobile devices.
2. **GeminiTelegramClient**: The main client application that manages the WebSocket connection to the backend and coordinates the UI.
3. **Backend WebSocket Proxy**: Handles communication with the Gemini Live API and audio transcoding.

## Features

- Native Telegram WebApp integration
- WebRTC audio processing with echo cancellation and noise suppression
- Voice Activity Detection (VAD) for natural conversation flow
- Adaptive audio playback with retry mechanisms
- Haptic feedback for better user experience
- Session management with automatic reconnection
- Particle animation background

## Files

- `telegram_audio_bridge.js`: WebRTC-based audio bridge component
- `gemini_telegram_client.js`: Main client application
- `voice_chat.html`: UI and entry point

## Deployment Instructions

### Frontend Deployment (GitHub Pages)

1. Clone the repository:
   ```bash
   git clone https://github.com/Rbl-Labs/konverter-voice-chat.git
   cd konverter-voice-chat
   ```

2. Copy the updated files to the repository:
   ```bash
   cp front_end/telegram_audio_bridge.js .
   cp front_end/gemini_telegram_client.js .
   cp front_end/voice_chat.html index.html
   ```

3. Commit and push to GitHub:
   ```bash
   git add .
   git commit -m "Implement WebRTC-based Telegram audio integration"
   git push origin main
   ```

4. GitHub Pages will automatically deploy the updated site.

### Backend Deployment (AWS)

1. Deploy the updated backend proxy to AWS:
   ```bash
   scp -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem /Users/mikrbl/Documents/voice_chat/fix/flexible_gemini_backend_v2.js ubuntu@51.21.55.104:/home/ubuntu/gemini-websocket-proxy/gemini_websocket_proxy.js
   ```

2. Restart the service:
   ```bash
   ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "sudo systemctl restart gemini-websocket-proxy"
   ```

3. Check the logs:
   ```bash
   ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "journalctl -u gemini-websocket-proxy --since '10 minutes ago' --no-pager"
   ```

## Troubleshooting

### "Session Loading" Issue

If you encounter the "Session Loading" issue where the user cannot click any buttons:

1. Check the browser console for errors
2. Verify that the WebSocket connection is established
3. Ensure the session token is valid
4. Check the backend logs for any errors

The implementation includes improved error handling and session state management to prevent this issue:

- Session initialization timeout handling
- Clear error messages
- Retry mechanism for failed connections
- Proper state transitions

### Mobile Audio Issues

If audio playback doesn't work on mobile:

1. Ensure the audio is unlocked by user interaction
2. Check that the audio format is compatible with mobile browsers
3. Verify that the TelegramAudioBridge is properly initialized

The TelegramAudioBridge includes multiple methods for unlocking audio on mobile devices and handles various edge cases.

## Testing

1. Open the mini-app in Telegram
2. Click "Connect" to establish the WebSocket connection
3. Once connected, click the microphone button to start speaking
4. The audio will be sent to Gemini and the response will be played back
5. The conversation will be displayed in the conversation log

## Future Improvements

- Add support for more audio formats
- Implement offline mode with local speech recognition
- Add support for file attachments
- Implement message history persistence
