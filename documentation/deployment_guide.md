# Deployment Guide for Voice Chat System

## Overview of Fixes

We've addressed two critical issues in the voice chat system:

1. **Client-Side Race Condition**: Fixed the client code to wait for session initialization before trying to connect to Gemini.
2. **Server-Side API Configuration**: Fixed the WebSocket proxy server to properly handle the v1alpha API version required for advanced features like affective dialog and proactive audio.

## 1. Client-Side Race Condition Fix

The client was trying to connect to Gemini immediately after the WebSocket connection was established, but the server needs time to initialize the session first. We fixed this by:

1. Adding a `sessionInitialized` flag to track initialization state
2. Updating the WebSocket onopen handler to not send connect_gemini immediately
3. Updating the handleWebSocketMessage method to send connect_gemini only after receiving session_initialized

```javascript
// Before:
this.ws.onopen = () => {
    console.log('WebSocket connected');
    
    // PROBLEM: Immediately sending connect_gemini without waiting for session initialization
    this.ws.send(JSON.stringify({
        type: 'connect_gemini'
    }));
};

// After:
this.ws.onopen = () => {
    console.log('WebSocket connected');
    this.updateStatus('WebSocket connected, waiting for session initialization...', '');
    
    // Don't send connect_gemini here - wait for session_initialized message
};

// And in the message handler:
case 'session_initialized':
    console.log('Session initialized successfully');
    this.sessionInitialized = true;
    this.updateStatus('Session ready - Connecting to Gemini...', '');
    
    // Now it's safe to connect to Gemini
    this.ws.send(JSON.stringify({
        type: 'connect_gemini'
    }));
    break;
```

## 2. Server-Side API Configuration Fix

The WebSocket proxy server was not correctly handling the API version for advanced features. We fixed this by:

1. Adding support for the v1alpha API version in the server
2. Updating the n8n session logic to use camelCase for configuration parameters
3. Adding proper initialization tracking to prevent premature Gemini connections

```javascript
// In n8n_session_logic_fixed.js:
config: {
    // WebSocket proxy URL
    websocketProxyUrl: `wss://ws.lomeai.com:8002/ws?session=${sessionId}`,
    
    // Gemini API key
    apiKey: "AIzaSyDDBFBPhEpbA0pujdCgmZG4KUYmrhQDY14", 
    
    // API version (required for affective dialog and proactivity)
    apiVersion: "v1alpha",
    
    // Configuration in camelCase as required by the Gemini API
    config: {
        responseModalities: ['AUDIO'],
        enableAffectiveDialog: true,
        proactivity: {
            proactiveAudio: true
        },
        // ... other parameters in camelCase
    }
}

// In gemini_websocket_proxy_fixed.js:
// Check if we need to use v1alpha API version
const apiOptions = {};
if (this.sessionConfig && this.sessionConfig.apiVersion === 'v1alpha') {
    apiOptions.httpOptions = { apiVersion: 'v1alpha' };
    console.log('📋 Using v1alpha API version for advanced features');
}

// Initialize the Gemini client with API key and options
this.geminiClient = new GoogleGenAI({ 
    apiKey: GEMINI_API_KEY,
    ...apiOptions
});
```

## Deployment Steps

### 1. Update the n8n Session Logic

1. Log in to your n8n instance at https://n8n.lomeai.com
2. Navigate to the Voice Session workflow
3. Edit the "Handle Session Logic" node
4. Replace the code with the contents of `n8n_session_logic_fixed.js`
5. Save the workflow

### 2. Deploy the Fixed WebSocket Proxy Server

```bash
# SSH into the EC2 instance
ssh -i /path/to/gemini-websocket-proxy.pem ubuntu@51.21.55.104

# Backup the current file
cd /home/ubuntu/gemini-websocket-proxy
cp gemini_websocket_proxy.js gemini_websocket_proxy.js.backup

# Create the new file
nano gemini_websocket_proxy.js
# Paste the contents of gemini_websocket_proxy_fixed.js and save

# Restart the service
sudo systemctl restart gemini-websocket-proxy

# Check the logs to ensure it's working
sudo journalctl -u gemini-websocket-proxy -f
```

### 3. Deploy the Fixed Client Code

1. Update the client code on your web server with the changes from `modern_voice_chat.html`
2. Alternatively, you can use the complete fixed version in `fixed_voice_chat.html`

## Verification

After deploying the fixes, verify that:

1. The client connects to the WebSocket server successfully
2. The client waits for session initialization before trying to connect to Gemini
3. The server correctly initializes the Gemini client with the v1alpha API version
4. The Gemini connection is established successfully
5. Audio input and output work correctly

## Troubleshooting

If you encounter issues:

1. Check the server logs: `sudo journalctl -u gemini-websocket-proxy -f`
2. Check the browser console for client-side errors
3. Verify that the n8n workflow is correctly configured
4. Ensure that the Gemini API key is valid and has access to the v1alpha API

## Additional Notes

- The v1alpha API version is required for advanced features like affective dialog and proactive audio
- The camelCase naming convention is required for the Gemini API configuration
- The session initialization process must complete before trying to connect to Gemini
