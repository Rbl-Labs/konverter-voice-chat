/**
 * Enhanced Gemini Telegram Client with Voice+Text Support
 * Version: 5.0.1 - Fixed recursion issues
 * 
 * NOW: Compatible with backend turn-based message system
 * FIXES: Infinite recursion in handleCriticalError and setupHealthMonitoring
 */

// Enhancement wrapper that preserves ALL original functionality
window.enhanceGeminiClient = function(originalClient) {
    console.log('[ENHANCE] Starting client enhancement v5.0 - Turn-based compatible...');
    
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
    const originalHandleCriticalError = originalClient.handleCriticalError; // FIXED: Store original
    const originalSetupHealthMonitoring = originalClient.setupHealthMonitoring; // FIXED: Store original
    
    // Add enhancement properties (REMOVED problematic message buffering)
    originalClient.isTextChatEnabled = true; // Always allow text during sessions
    originalClient.messageHistory = []; // Store for recent messages
    originalClient.maxDisplayMessages = 3;
    
    console.log('[ENHANCE] Enhancement properties added');
    
    // FIXED: Enhanced message handling - compatible with turn-based system
    originalClient.handleWebSocketMessage = function(message) {
        console.log('[ENHANCE] Processing message:', message.type);
        
        // CRITICAL: Handle enhancement-specific features without interfering with turn system
        switch (message.type) {
            case 'conversation_turn_complete':
                // IMPORTANT: Let original client handle this completely
                console.log('[ENHANCE] Turn complete - delegating to original client');
                // Don't interfere with turn-based message ordering
                break;
                
            case 'text_response':
                // IMPORTANT: Only handle live transcription, don't add to conversation log
                if (window.uiController) {
                    window.uiController.updateOutputTranscription(message.text, true, true);
                }
                // Let original client handle this too (but it should just update transcription)
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
                console.log('[ENHANCE] Health check received');
                break;
                
            case 'gemini_raw_output':
                console.log('[ENHANCE] Raw output received for debugging');
                break;
                
            case 'turn_complete':
                // Handle UI updates for turn completion
                if (window.uiController) {
                    window.uiController.setAISpeaking(false);
                    // Don't change user speaking state - let original client handle voice logic
                }
                break;
                
            case 'interrupted':
                // Handle UI updates for interruption
                if (window.uiController) {
                    window.uiController.setAISpeaking(false);
                }
                break;
        }
        
        // CRITICAL: Always call original handler for ALL message types
        if (originalHandleWebSocketMessage) {
            originalHandleWebSocketMessage.call(this, message);
        }
    };
    
    // FIXED: Text message sending - compatible with turn-based system
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
            const messageObj = { 
                type: 'text_input', 
                text: text.trim(), 
                timestamp: Date.now() 
            };
            
            console.log('[ENHANCE] WebSocket message being sent:', messageObj);
            
            // Send the message
            this.state.ws.send(JSON.stringify(messageObj));
            
            // FIXED: Don't add to conversation log immediately
            // The backend will send conversation_turn_complete with proper ordering
            
            console.log('[ENHANCE] Text message sent successfully');
            return true;
        } else {
            console.log('[ENHANCE] WebSocket not ready');
            return false;
        }
    };
    
    // Voice session toggle while keeping text active
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
    
    // Enhanced user info handling
    originalClient.sendUserInfo = function() {
        if (!this.userData) {
            console.log('[ENHANCE] No user data to send');
            return false;
        }
        
        if (!this.state.isConnectedToWebSocket) {
            console.log('[ENHANCE] Cannot send user info: not connected to WebSocket');
            return false;
        }
        
        console.log(`[ENHANCE] Sending user info to backend:`, this.userData);
        
        // Send user info to backend
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            try {
                const message = { 
                    type: 'user_info_update', 
                    userData: this.userData, 
                    timestamp: Date.now() 
                };
                
                console.log('[ENHANCE] Sending WebSocket message:', message);
                
                this.state.ws.send(JSON.stringify(message));
                
                console.log('[ENHANCE] User info sent to backend');
                
                // Add to UI
                if (window.uiController) {
                    window.uiController.updateStatusBanner(`Connected as ${this.userData.name}`, 'connected');
                }
                
                return true;
            } catch (error) {
                console.error('[ENHANCE] Error sending user info:', error);
                return false;
            }
        } else {
            console.log('[ENHANCE] WebSocket not ready for sending user info');
            return false;
        }
    };

    // Enhanced connection methods with user form
    originalClient.connect = function() {
        console.log('[ENHANCE] Connect method called');
        
        if (window.uiController) {
            window.uiController.setConnectionState('connecting');
        }
        
        // Check if we have user data
        const userName = localStorage.getItem('user_name');
        const userEmail = localStorage.getItem('user_email');
        
        // If we don't have user data, show the form
        if (!userName || !userEmail) {
            console.log('[ENHANCE] No user data found, showing form');
            
            // Create and show user form
            if (window.UserForm) {
                const userForm = new window.UserForm();
                userForm.onSubmit((formData) => {
                    console.log('[ENHANCE] User form submitted:', formData);
                    
                    // Store user data for system prompt
                    this.userData = formData;
                    
                    // Store in localStorage for future sessions
                    localStorage.setItem('user_name', formData.name);
                    localStorage.setItem('user_email', formData.email);
                    
                    // Call original connect method
                    if (originalConnect) {
                        originalConnect.call(this);
                    }
                });
                userForm.show();
                return;
            }
        } else {
            // We already have user data
            this.userData = {
                name: userName,
                email: userEmail
            };
            console.log('[ENHANCE] Using existing user data:', this.userData);
        }
        
        // Call original connect method
        if (originalConnect) {
            return originalConnect.call(this);
        }
    };
    
    originalClient.disconnect = function(reason = 'User disconnected') {
        console.log(`[ENHANCE] Disconnect method called: ${reason}`);
        
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
            window.uiController.updateInteractionButton('listening');
            window.uiController.setUserSpeaking(true);
            window.uiController.updateStatusBanner('Listening... Voice + text both active', 'connected');
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
        if (window.uiController && window.uiController.clearRecentMessages) {
            window.uiController.clearRecentMessages();
        }
    };
    
    // Enhanced error handling - FIXED: Avoid infinite recursion
    originalClient.handleCriticalError = function(context, error) {
        console.error(`[ENHANCE] Critical error in ${context}:`, error);
        
        if (window.uiController) {
            window.uiController.updateStatusBanner(`Error: ${error.message}`, 'error');
        }
        
        // Call original error handler if it exists
        if (originalHandleCriticalError) {
            return originalHandleCriticalError.call(this, context, error);
        }
    };
    
    // Enhanced permission handling
    originalClient.handlePermissionChange = function(state) {
        console.log(`[ENHANCE] Permission state changed to: ${state}`);
        
        if (window.uiController) {
            const message = state === 'granted' ? 'Microphone access granted' : 
                           state === 'denied' ? 'Microphone access denied' : 
                           'Requesting microphone access...';
            
            const statusType = state === 'granted' ? 'success' : 
                              state === 'denied' ? 'error' : 'warning';
            
            window.uiController.updateStatusBanner(message, statusType);
        }
        
        // Call original permission handler if it exists
        if (originalClient.handlePermissionChange) {
            return originalClient.handlePermissionChange.call(this, state);
        }
    };
    
    // Enhanced logging
    originalClient.log = function(message, isError = false, data = null) {
        const prefix = '[ENHANCED_CLIENT]';
        
        if (this.config && this.config.debug || isError) {
            const logMethod = isError ? console.error : console.log;
            if (data !== null && data !== undefined) {
                logMethod(prefix, message, data);
            } else {
                logMethod(prefix, message);
            }
        }
        
        // Call original log method if it exists
        if (originalClient.log && originalClient.log !== this.log) {
            return originalClient.log.call(this, message, isError, data);
        }
    };
    
    // Health monitoring enhancement - FIXED: Avoid infinite recursion
    originalClient.setupHealthMonitoring = function() {
        console.log('[ENHANCE] Setting up enhanced health monitoring');
        
        // Call original health monitoring setup
        if (originalSetupHealthMonitoring) {
            originalSetupHealthMonitoring.call(this);
        }
        
        // Add enhanced health check UI updates
        const healthCheckInterval = setInterval(() => {
            if (this.state && this.state.isConnectedToWebSocket && 
                this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
                
                // Visual indication of healthy connection
                if (window.uiController) {
                    // Could add subtle health indicators here if needed
                }
            }
        }, 30000); // Check every 30 seconds
        
        // Store interval for cleanup
        if (!this.enhancementIntervals) {
            this.enhancementIntervals = [];
        }
        this.enhancementIntervals.push(healthCheckInterval);
    };
    
    // Enhanced disposal
    originalClient.dispose = function() {
        console.log('[ENHANCE] Disposing enhanced client...');
        
        // Clean up enhancement intervals
        if (this.enhancementIntervals) {
            this.enhancementIntervals.forEach(interval => {
                clearInterval(interval);
            });
            this.enhancementIntervals = [];
        }
        
        // Clear enhancement data
        this.messageHistory = [];
        
        // Call original dispose method
        if (originalClient.dispose) {
            return originalClient.dispose.call(this);
        }
    };
    
    // Add helper methods for external access
    originalClient.getEnhancementVersion = function() {
        return '5.0.0-turn-based-compatible';
    };
    
    originalClient.getCapabilities = function() {
        return {
            voiceChat: this.isConnected(),
            textChat: this.isTextEnabled(),
            voiceActive: this.isVoiceActive(),
            userFormIntegration: true,
            turnBasedMessaging: true,
            functionCalling: true
        };
    };
    
    console.log('[ENHANCE] Client enhancement v5.0.1 complete - Fixed recursion issues');
    console.log('[ENHANCE] Available methods:', Object.getOwnPropertyNames(originalClient).filter(name => 
        typeof originalClient[name] === 'function' && name.startsWith('is') || name.includes('toggle') || name.includes('get')
    ));
};
