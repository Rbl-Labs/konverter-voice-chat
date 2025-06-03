/**
 * Enhanced Gemini Telegram Client with Voice+Text Support
 * Version: 4.1.0 - Implements proper message aggregation and chat during voice
 * 
 * PRESERVES all existing functionality while adding:
 * 1. Chat working during voice sessions (like Google AI Studio)
 * 2. Message aggregation with proper sentence completion
 * 3. Recent messages display (max 3 AI messages full-screen)
 */

// Enhancement wrapper that preserves ALL original functionality
window.enhanceGeminiClient = function(originalClient) {
    console.log('[ENHANCE] Starting client enhancement...');
    
    if (!originalClient) {
        console.error('[ENHANCE] No original client provided');
        return;
    }
    
    // Store original methods (PRESERVE ALL EXISTING)
    const originalHandleWebSocketMessage = originalClient.handleWebSocketMessage;
    const originalSendTextMessage = originalClient.sendTextMessage;
    const originalConnect = originalClient.connect;
    const originalDisconnect = originalClient.disconnect;
    const originalStartConversation = originalClient.startConversation;
    const originalPauseConversation = originalClient.pauseConversation;
    
    // Add enhancement properties
    originalClient.messageBuffer = '';
    originalClient.messageTimeout = null;
    originalClient.messageAggregationDelay = 3000; // 3 seconds for complete sentences
    originalClient.sentenceEndRegex = /[.!?]\s*$/; // Better sentence detection
    originalClient.isTextChatEnabled = true; // Always allow text during sessions
    originalClient.messageHistory = []; // Store for recent messages
    originalClient.maxDisplayMessages = 3;
    
    console.log('[ENHANCE] Enhancement properties added');
    
    // Enhanced message handling (PRESERVE ALL EXISTING TYPES)
    originalClient.handleWebSocketMessage = function(message) {
        console.log('[ENHANCE] Processing message:', message.type);
        
        // Handle new aggregated text responses
        if (message.type === 'text_response') {
            this.aggregateMessage(message.text);
            return; // Don't send to original handler for text_response
        }
        
        // CRITICAL: Handle ALL existing backend message types
        switch (message.type) {
            case 'ai_audio_chunk_pcm':
                // Don't handle audio chunks here, let the original handler do it
                // This ensures proper audio processing by the original client
                break;
                
            case 'function_executing':
                console.log(`[ENHANCE] Function executing: ${message.functionName}`);
                if (window.uiController) {
                    window.uiController.updateStatusBanner(`Executing: ${message.functionName}`, 'processing');
                }
                break;
                
            case 'function_completed':
                console.log(`[ENHANCE] Function completed: ${message.functionName}, success: ${message.success}`);
                if (window.uiController) {
                    const status = message.success ? '✅' : '❌';
                    window.uiController.updateStatusBanner(`${status} ${message.functionName}`, 'info');
                }
                break;
                
            case 'health_check':
                // PRESERVE: Backend health monitoring
                console.log('[ENHANCE] Health check received');
                break;
                
            case 'gemini_raw_output':
                // PRESERVE: Debug information
                console.log('[ENHANCE] Raw output received for debugging');
                break;
                
            case 'turn_complete':
                // CRITICAL: Flush any remaining messages
                this.flushMessageBuffer();
                if (window.uiController) {
                    window.uiController.setAISpeaking(false);
                    window.uiController.setUserSpeaking(false);
                }
                break;
                
            case 'interrupted':
                // CRITICAL: Clear message buffer on interruption
                this.flushMessageBuffer();
                if (this.pcmPlayer && this.pcmPlayer.isPlaying) {
                    this.pcmPlayer.stopPlayback();
                }
                break;
        }
        
        // CRITICAL: Always call original handler for ALL other message types
        if (originalHandleWebSocketMessage) {
            originalHandleWebSocketMessage.call(this, message);
        }
    };
    
    // NEW: Message aggregation with proper sentence detection
    originalClient.aggregateMessage = function(text) {
        if (!text || text.trim().length === 0) return;
        
        // Add to buffer
        this.messageBuffer += text;
        
        // Clear existing timeout
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
        }
        
        // Set timeout to flush buffer after delay
        this.messageTimeout = setTimeout(() => {
            this.flushMessageBuffer();
        }, this.messageAggregationDelay);
        
        // Check for sentence endings to flush immediately
        if (this.sentenceEndRegex.test(text.trim())) {
            clearTimeout(this.messageTimeout);
            setTimeout(() => this.flushMessageBuffer(), 500); // Small delay for natural flow
        }
    };
    
    // NEW: Flush complete messages to UI
    originalClient.flushMessageBuffer = function() {
        if (this.messageBuffer.trim()) {
            const completeMessage = this.messageBuffer.trim();
            
            // Add to message history for recent display
            this.messageHistory.push({
                text: completeMessage,
                timestamp: Date.now(),
                sender: 'ai'
            });
            
            // Keep only last 3 messages
            if (this.messageHistory.length > this.maxDisplayMessages) {
                this.messageHistory = this.messageHistory.slice(-this.maxDisplayMessages);
            }
            
            // Send to UI controller
            if (window.uiController) {
                window.uiController.addMessage(completeMessage, 'ai');
            }
            
            console.log(`[ENHANCE] Flushed complete message: "${completeMessage.substring(0, 100)}..."`);
            
            // Clear buffer
            this.messageBuffer = '';
        }
        
        // Clear timeout
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }
    };
    
    // Enhanced text message sending (PRESERVE existing WebSocket logic)
    originalClient.sendTextMessage = function(text) {
        // CRITICAL: Use existing connection validation logic
        if (!this.state.isConnectedToWebSocket || !this.state.isGeminiSessionActive) {
            console.log('[ENHANCE] Cannot send text: not connected');
            if (window.uiController) {
                window.uiController.updateStatusBanner('Not connected', 'error');
            }
            return false;
        }
        
        if (!text || text.trim().length === 0) {
            console.log('[ENHANCE] Cannot send empty text');
            return false;
        }
        
        console.log(`[ENHANCE] Sending text message: "${text}"`);
        
        // CRITICAL: Use existing WebSocket sending logic
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify({ 
                type: 'text_input', 
                text: text.trim(), 
                timestamp: Date.now() 
            }));
            
            // Add to UI immediately for user
            if (window.uiController) {
                window.uiController.addMessage(text, 'user');
            }
            
            console.log('[ENHANCE] Text message sent successfully');
            return true;
        } else {
            console.log('[ENHANCE] WebSocket not ready');
            return false;
        }
    };
    
    // NEW: Voice session toggle while keeping text active
    originalClient.toggleVoiceSession = function() {
        if (!this.state.isConnectedToWebSocket || !this.state.isGeminiSessionActive) {
            console.log('[ENHANCE] Cannot toggle voice: not connected');
            return false;
        }
        
        if (this.state.isConversationPaused) {
            // Start voice (PRESERVE existing logic)
            console.log('[ENHANCE] Starting voice session (text remains active)');
            if (originalStartConversation) {
                originalStartConversation.call(this);
            }
            if (window.uiController) {
                window.uiController.updateStatusBanner('Voice active • Text also available', 'connected');
            }
            return true;
        } else {
            // Pause voice (PRESERVE existing logic)
            console.log('[ENHANCE] Pausing voice session (text remains active)');
            if (originalPauseConversation) {
                originalPauseConversation.call(this);
            }
            if (window.uiController) {
                window.uiController.updateStatusBanner('Voice paused • Text still active', 'connected');
            }
            return false;
        }
    };
    
    // Enhanced connection methods
    originalClient.connect = function() {
        console.log('[ENHANCE] Connect method called');
        
        if (window.uiController) {
            window.uiController.setConnectionState('connecting');
        }
        
        // Call original connect method
        if (originalConnect) {
            return originalConnect.call(this);
        }
    };
    
    originalClient.disconnect = function(reason = 'User disconnected') {
        console.log(`[ENHANCE] Disconnect method called: ${reason}`);
        
        // Flush any remaining messages
        this.flushMessageBuffer();
        
        if (window.uiController) {
            window.uiController.setConnectionState('disconnected');
        }
        
        // Call original disconnect method
        if (originalDisconnect) {
            return originalDisconnect.call(this, reason);
        }
    };
    
    // Enhanced conversation methods
    originalClient.startConversation = function() {
        console.log('[ENHANCE] Starting voice conversation (text remains available)');
        
        if (window.uiController) {
            window.uiController.updateInteractionButton('recording');
            window.uiController.setUserSpeaking(true);
            window.uiController.updateStatusBanner('Listening... Voice + text both active', 'recording');
        }
        
        // Call original method
        if (originalStartConversation) {
            return originalStartConversation.call(this);
        }
    };
    
    originalClient.pauseConversation = function() {
        console.log('[ENHANCE] Pausing voice conversation (text remains available)');
        
        if (window.uiController) {
            window.uiController.updateInteractionButton('ready_to_play');
            window.uiController.setUserSpeaking(false);
            window.uiController.setAISpeaking(false);
            window.uiController.updateStatusBanner('Voice paused • Text chat still active', 'connected');
        }
        
        // Call original method
        if (originalPauseConversation) {
            return originalPauseConversation.call(this);
        }
    };
    
    // Connection state methods
    originalClient.isConnected = function() {
        return this.state.isConnectedToWebSocket && this.state.isGeminiSessionActive;
    };
    
    originalClient.isVoiceActive = function() {
        return !this.state.isConversationPaused;
    };
    
    originalClient.isTextEnabled = function() {
        // CRITICAL: Text is ALWAYS enabled when connected (like Google AI Studio)
        return this.isConnected();
    };
    
    // Get recent messages for UI display
    originalClient.getRecentMessages = function() {
        return this.messageHistory.slice(-this.maxDisplayMessages);
    };
    
    // Clear recent messages
    originalClient.clearRecentMessages = function() {
        this.messageHistory = [];
        if (window.uiController) {
            window.uiController.clearRecentMessages();
        }
    };
    
    console.log('[ENHANCE] Client enhancement complete');
};
