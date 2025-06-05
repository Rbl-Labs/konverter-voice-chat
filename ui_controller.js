/**
 * Enhanced UI Controller with Audio Integration
 * Version: 4.1.0 - Implements voice+text chat and message display
 * 
 * PRESERVES all existing functionality while adding:
 * 1. Chat working during voice sessions (like Google AI Studio)
 * 2. Message aggregation with proper sentence completion
 * 3. Recent messages display (max 3 AI messages full-screen)
 */

class UIController {
    constructor() {
        // Element mapping (PRESERVE existing IDs)
        this.elements = {
            // Core elements
            status: document.getElementById('status'),
            connectButton: document.getElementById('connectButton'),
            sessionInfo: document.getElementById('sessionInfo'),
            
            // Voice circles (PRESERVE existing IDs)
            agentCircle: document.getElementById('agentCircle'),
            userInteractionCircle: document.getElementById('userInteractionCircle'),
            interactionIcon: document.getElementById('interactionIcon'),
            
            // NEW: Recent messages (IMPLEMENT AS PER SCREENSHOT)
            recentMessages: document.getElementById('recentMessages'),
            
            // Transcriptions (PRESERVE existing)
            inputTranscription: document.getElementById('inputTranscription'),
            outputTranscription: document.getElementById('outputTranscription'),
            
            // Chat panel (PRESERVE existing IDs)
            transcriptionPanel: document.getElementById('transcriptionPanel'),
            chatToggle: document.getElementById('chatToggle'),
            conversationLog: document.getElementById('conversationLog'),
            closeTranscriptionPanelBtn: document.getElementById('closeTranscriptionPanelBtn'),
            chatTextInput: document.getElementById('chatTextInput'),
            sendTextButton: document.getElementById('sendTextButton'),
            
            // Debug
            debugOverlay: document.getElementById('debugOverlay'),
            debugContent: document.getElementById('debugContent')
        };
        
        // State management
        this.state = {
            isConnected: false,
            isConnecting: false,
            isVoiceActive: false,
            isChatWidgetExpanded: false,
            isUserSpeaking: false,
            isAISpeaking: false,
            recentMessagesCount: 0,
            maxRecentMessages: 3, // EXACTLY 3 as per screenshot
            hasUnreadMessages: false,
            debugMessages: []
        };
        
        this.initializeUI();
        this.setupEventListeners();
        this.setupAudioIntegration(); // NEW: Audio system integration
        
        // Make globally available
        window.uiController = this;
        this.debugLog('[UI Controller] Enhanced version 4.1.0 initialized');
    }
    
    // NEW: Audio system integration
    setupAudioIntegration() {
        // Monitor for PCMStreamPlayer events
        document.addEventListener('audioPlaybackStart', () => {
            this.setAISpeaking(true);
        });
        
        document.addEventListener('audioPlaybackEnd', () => {
            this.setAISpeaking(false);
        });
        
        // Monitor for AdvancedAudioRecorder events
        document.addEventListener('recordingStart', () => {
            this.setUserSpeaking(true);
        });
        
        document.addEventListener('recordingEnd', () => {
            this.setUserSpeaking(false);
        });
    }
    
    initializeUI() {
        this.setConnectionState('disconnected');
        this.updateInteractionButton('disconnected');
        this.updateStatusBanner('Ready to connect', '');
        this.toggleChatWidget(false);
        
        // Ensure recent messages container is visible
        if (this.elements.recentMessages) {
            this.elements.recentMessages.style.display = 'flex';
        }
    }

    setupEventListeners() {
        // Connect button
        if (this.elements.connectButton) {
            this.elements.connectButton.addEventListener('click', () => this.handleConnectToggle());
        }
        
        // Main interaction circle (voice toggle)
        if (this.elements.userInteractionCircle) {
            this.elements.userInteractionCircle.addEventListener('click', () => this.handleInteractionToggle());
        }
        
        // Chat toggle
        if (this.elements.chatToggle) {
            this.elements.chatToggle.addEventListener('click', () => this.toggleChatWidget(true));
        }
        
        // Chat input with proper integration
        if (this.elements.chatTextInput) {
            this.elements.chatTextInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.handleSendTextMessage();
                }
            });
            
            // Enable input when connected
            this.elements.chatTextInput.addEventListener('focus', () => {
                if (!this.state.isConnected) {
                    this.updateStatusBanner('Connect first to use chat', 'error');
                    this.elements.chatTextInput.blur();
                }
            });
        }
        
        // Send button
        if (this.elements.sendTextButton) {
            this.elements.sendTextButton.addEventListener('click', () => this.handleSendTextMessage());
        }
        
        // Chat panel close
        if (this.elements.closeTranscriptionPanelBtn) {
            this.elements.closeTranscriptionPanelBtn.addEventListener('click', () => this.toggleChatWidget(false));
        }
    }

    // Connection handling with proper state management
    handleConnectToggle() {
        if (this.state.isConnecting) return;
        
        if (window.geminiClient) {
            if (this.state.isConnected) {
                this.debugLog('Disconnect button clicked');
                window.geminiClient.disconnect();
            } else {
                this.debugLog('Connect button clicked');
                window.geminiClient.connect();
            }
        } else {
            this.debugLog('No geminiClient available', true);
            this.updateStatusBanner('Error: Client not initialized', 'error');
        }
    }

    // Voice session handling with form data integration
    handleInteractionToggle() {
        if (!window.geminiClient) {
            this.debugLog('No geminiClient available', true);
            this.updateStatusBanner('Client not initialized', 'error');
            return;
        }
        
        // Check if we need to connect to Gemini with user data first
        if (window.geminiClient.state && window.geminiClient.state.isConnectedToWebSocket && 
            !window.geminiClient.state.isGeminiSessionActive) {
            
            this.debugLog('Play button clicked - connecting to Gemini with user data');
            
            // Use the new handlePlayButtonPress method
            if (typeof window.geminiClient.handlePlayButtonPress === 'function') {
                window.geminiClient.handlePlayButtonPress();
                this.updateStatusBanner('Connecting to Gemini...', 'connecting');
            } else {
                this.debugLog('handlePlayButtonPress method not available', true);
            }
            return;
        }
        
        // Normal voice session toggle when already connected to Gemini
        if (this.state.isConnected) {
            if (typeof window.geminiClient.toggleVoiceSession === 'function') {
                const voiceActive = window.geminiClient.toggleVoiceSession();
                this.debugLog(`Voice session toggled: ${voiceActive ? 'active' : 'paused'}`);
            } else if (typeof window.geminiClient.startConversation === 'function') {
                // Fallback to existing method
                if (window.geminiClient.state && window.geminiClient.state.isConversationPaused) {
                    window.geminiClient.startConversation();
                } else {
                    window.geminiClient.pauseConversation();
                }
            }
        } else {
            this.debugLog('Interaction button clicked but not connected');
            this.updateStatusBanner('Connect first to use voice chat', 'error');
        }
    }

    // Text message handling with proper validation
    handleSendTextMessage() {
        if (!this.elements.chatTextInput) return;
        
        const text = this.elements.chatTextInput.value.trim();
        if (!text) return;
        
        if (!this.state.isConnected) {
            this.updateStatusBanner('Connect first to send messages', 'error');
            return;
        }
        
        this.debugLog(`Sending text message: "${text}"`);
        
        // CRITICAL: Send through existing Gemini client
        if (window.geminiClient && typeof window.geminiClient.sendTextMessage === 'function') {
            if (window.geminiClient.sendTextMessage(text)) {
                // Clear input immediately
                this.elements.chatTextInput.value = '';
                this.debugLog('Text message sent successfully');
            } else {
                this.updateStatusBanner('Failed to send message', 'error');
            }
        } else {
            this.updateStatusBanner('Text messaging not available', 'error');
        }
    }

    // Connection state with chat availability
    setConnectionState(state) {
        const prevState = this.state.isConnected;
        
        switch(state) {
            case 'connecting':
                this.state.isConnecting = true;
                this.state.isConnected = false;
                this.updateConnectButton('connecting');
                this.updateInteractionButton('disconnected');
                this.updateStatusBanner('Connecting...', 'connecting');
                
                // Disable chat input when connecting
                if (this.elements.chatTextInput) {
                    this.elements.chatTextInput.disabled = true;
                    this.elements.chatTextInput.placeholder = 'Connecting...';
                }
                if (this.elements.sendTextButton) {
                    this.elements.sendTextButton.disabled = true;
                }
                break;
                
            case 'connected':
                this.state.isConnecting = false;
                this.state.isConnected = true;
                this.updateConnectButton('connected');
                this.updateInteractionButton('ready_to_play');
                
                // CRITICAL: Enable chat input when connected
                if (this.elements.chatTextInput) {
                    this.elements.chatTextInput.disabled = false;
                    this.elements.chatTextInput.placeholder = 'Type a message...';
                }
                if (this.elements.sendTextButton) {
                    this.elements.sendTextButton.disabled = false;
                }
                
                this.updateStatusBanner('Connected! Voice + text both available', 'connected');
                break;
                
            case 'disconnected':
                this.state.isConnecting = false;
                this.state.isConnected = false;
                this.state.isVoiceActive = false;
                this.updateConnectButton('disconnected');
                this.updateInteractionButton('disconnected');
                this.setAISpeaking(false);
                this.setUserSpeaking(false);
                
                // Disable chat when disconnected
                if (this.elements.chatTextInput) {
                    this.elements.chatTextInput.disabled = true;
                    this.elements.chatTextInput.placeholder = 'Connect first to chat...';
                }
                if (this.elements.sendTextButton) {
                    this.elements.sendTextButton.disabled = true;
                }
                
                this.updateStatusBanner('Disconnected. Tap Connect.', '');
                break;
                
            case 'error':
                this.state.isConnecting = false;
                this.state.isConnected = false;
                this.updateConnectButton('disconnected');
                this.updateInteractionButton('disconnected');
                
                // Disable chat on error
                if (this.elements.chatTextInput) {
                    this.elements.chatTextInput.disabled = true;
                }
                if (this.elements.sendTextButton) {
                    this.elements.sendTextButton.disabled = true;
                }
                break;
        }
        
        this.debugLog(`Connection state: ${prevState ? 'connected' : 'disconnected'} → ${state}`);
    }

    updateConnectButton(state) {
        if (!this.elements.connectButton) return;
        
        const btn = this.elements.connectButton;
        btn.classList.remove('disconnected', 'connecting', 'connected');
        btn.classList.add(state);
        
        switch(state) {
            case 'disconnected':
                btn.textContent = 'CONNECT';
                btn.disabled = false;
                break;
            case 'connecting':
                btn.textContent = 'CONNECTING...';
                btn.disabled = true;
                break;
            case 'connected':
                btn.textContent = 'DISCONNECT';
                btn.disabled = false;
                break;
        }
    }

    // Interaction button management with CSS styling instead of emojis
    updateInteractionButton(state, isEnabledOverride) {
        if (!this.elements.userInteractionCircle || !this.elements.interactionIcon) return;
        
        const circle = this.elements.userInteractionCircle;
        const playButton = this.elements.interactionIcon;
        let enabled = false;

        if (isEnabledOverride !== undefined) {
            enabled = isEnabledOverride;
        } else {
            enabled = this.state.isConnected && !this.state.isConnecting;
        }

        circle.classList.toggle('disabled', !enabled);
        
        // Remove all state classes first
        playButton.classList.remove('state-play', 'state-pause', 'state-processing', 'state-disconnected');
        
        // Add appropriate state class based on state
        if (!enabled || state === 'disconnected') {
            playButton.classList.add('state-disconnected');
            this.state.isVoiceActive = false;
        } else if (state === 'ready_to_play') {
            playButton.classList.add('state-play');
            this.state.isVoiceActive = false;
        } else if (state === 'listening' || state === 'recording' || state === 'user_speaking') {
            playButton.classList.add('state-pause');
            this.state.isVoiceActive = true;
        } else if (state === 'processing') {
            playButton.classList.add('state-processing');
        } else if (state === 'ai_speaking') {
            playButton.classList.add('state-pause');
        } else {
            // Default to play button
            playButton.classList.add('state-play');
        }
        
        this.debugLog(`Interaction button: ${state}, enabled: ${enabled}`);
    }

    // Speaking animations
    setUserSpeaking(isSpeaking) {
        if (!this.elements.userInteractionCircle) return;
        
        this.state.isUserSpeaking = isSpeaking;
        this.elements.userInteractionCircle.classList.toggle('active', isSpeaking);
        
        if (isSpeaking && this.state.isConnected && this.state.isVoiceActive) {
            this.updateInteractionButton('user_speaking');
        } else if (this.state.isConnected && this.state.isVoiceActive) {
            this.updateInteractionButton('listening');
        }
    }
    
    setAISpeaking(isSpeaking) {
        if (!this.elements.agentCircle) return;
        
        this.state.isAISpeaking = isSpeaking;
        this.elements.agentCircle.classList.toggle('active', isSpeaking);
        
        if (isSpeaking && this.state.isConnected && this.state.isVoiceActive) {
            this.updateInteractionButton('ai_speaking');
        } else if (this.state.isConnected && this.state.isVoiceActive && !this.state.isUserSpeaking) {
            this.updateInteractionButton('listening');
        }
    }

    // Transcription updates
    updateInputTranscription(text, show = true) {
        if (!this.elements.inputTranscription) return;
        this.elements.inputTranscription.textContent = text;
        this.elements.inputTranscription.classList.toggle('visible', show && !!text);
    }
    
    // IMPROVED: Make agent transcription accumulate like user messages
    updateOutputTranscription(text, show = true, append = false) {
        if (!this.elements.outputTranscription) return;
        
        // If append is true, add to existing text instead of replacing
        if (append && this.elements.outputTranscription.textContent) {
            this.elements.outputTranscription.textContent += text;
        } else {
            this.elements.outputTranscription.textContent = text;
        }
        
        this.elements.outputTranscription.classList.toggle('visible', show && !!text);
    }
    
    // Clear output transcription when a turn is complete
    clearOutputTranscription() {
        if (this.elements.outputTranscription) {
            this.elements.outputTranscription.textContent = '';
            this.elements.outputTranscription.classList.toggle('visible', false);
        }
    }

    // Status banner
    updateStatusBanner(message, type = '') {
        if (!this.elements.status) return;
        this.elements.status.textContent = message;
        this.elements.status.className = `status ${type}`;
        this.debugLog(`Status: ${message} (${type})`);
    }

    // NEW: Recent messages management (KEY FEATURE)
    addToRecentMessages(text) {
        if (!this.elements.recentMessages) return;
        
        // Create message element with exact styling from screenshot
        const messageEl = document.createElement('div');
        messageEl.className = 'message ai-message';
        messageEl.innerHTML = `<span class="agent-name">Chloe:</span> ${this.sanitizeHTML(text)}`;
        
        // Add with smooth animation
        messageEl.style.opacity = '0';
        messageEl.style.transform = 'translateY(20px)';
        
        this.elements.recentMessages.appendChild(messageEl);
        
        // CRITICAL: Keep only 3 messages (exactly as per screenshot)
        while (this.elements.recentMessages.children.length > this.state.maxRecentMessages) {
            const firstChild = this.elements.recentMessages.firstChild;
            if (firstChild) {
                firstChild.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                firstChild.style.opacity = '0';
                firstChild.style.transform = 'translateY(-20px)';
                
                setTimeout(() => {
                    if (firstChild.parentNode) {
                        firstChild.parentNode.removeChild(firstChild);
                    }
                }, 300);
            }
        }
        
        // Animate in new message
        setTimeout(() => {
            messageEl.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            messageEl.style.opacity = '1';
            messageEl.style.transform = 'translateY(0)';
        }, 100);
        
        this.state.recentMessagesCount = this.elements.recentMessages.children.length;
        this.debugLog(`Added to recent messages (${this.state.recentMessagesCount}/3): ${text.substring(0, 50)}...`);
        
        // Ensure the message is visible by scrolling if needed
        if (this.elements.recentMessages.scrollHeight > this.elements.recentMessages.clientHeight) {
            this.elements.recentMessages.scrollTop = this.elements.recentMessages.scrollHeight;
        }
    }

    // Message management with proper chat integration
    addMessage(text, sender, isHTML = false) {
        // Add to conversation log (chat panel)
        if (this.elements.conversationLog) {
            const messageEl = document.createElement('div');
            messageEl.className = `message ${sender}-message`;
            
            if (isHTML) {
                messageEl.innerHTML = this.sanitizeHTML(text);
            } else {
                messageEl.innerHTML = this.linkifyText(this.sanitizeHTML(text));
            }
            
            this.elements.conversationLog.appendChild(messageEl);
            
            // Auto-scroll to bottom
            this.elements.conversationLog.scrollTop = this.elements.conversationLog.scrollHeight;
        }
        
        // Also add to recent messages if it's from AI
        if (sender === 'ai') {
            this.addToRecentMessages(text);
        }
        
        // Show unread indicator if chat is closed and it's an AI message
        if (!this.state.isChatWidgetExpanded && sender === 'ai') {
            this.state.hasUnreadMessages = true;
            this.updateChatToggleIndicator();
        }
        
        this.debugLog(`Added message (${sender}): ${text.substring(0, 50)}...`);
    }

    // Chat widget management with smooth animations
    toggleChatWidget(forceShow) {
        if (!this.elements.transcriptionPanel) return;
        
        const newState = forceShow !== undefined ? forceShow : !this.state.isChatWidgetExpanded;
        
        if (newState) {
            // Show chat panel
            this.elements.transcriptionPanel.style.display = 'flex';
            // Force reflow
            this.elements.transcriptionPanel.offsetHeight;
            this.elements.transcriptionPanel.classList.add('open');
            this.state.isChatWidgetExpanded = true;
            this.state.hasUnreadMessages = false;
            
            // Hide chat toggle button
            if (this.elements.chatToggle) {
                this.elements.chatToggle.style.display = 'none';
            }
            
            // Focus on input after animation and scroll to bottom
            setTimeout(() => {
                if (this.elements.chatTextInput && this.state.isConnected) {
                    this.elements.chatTextInput.focus();
                }
                if (this.elements.conversationLog) {
                    this.elements.conversationLog.scrollTop = this.elements.conversationLog.scrollHeight;
                }
            }, 300);
            
        } else {
            // Hide chat panel
            this.elements.transcriptionPanel.classList.remove('open');
            this.state.isChatWidgetExpanded = false;
            
            // Show chat toggle button after animation completes
            setTimeout(() => {
                if (this.elements.chatToggle) {
                    this.elements.chatToggle.style.display = 'block';
                }
                this.elements.transcriptionPanel.style.display = 'none';
            }, 300);
        }
        
        this.updateChatToggleIndicator();
        this.debugLog(`Chat widget toggled: ${newState ? 'open' : 'closed'}`);
    }

    updateChatToggleIndicator() {
        if (!this.elements.chatToggle) return;
        
        // Update toggle text based on unread messages
        const textContent = this.state.hasUnreadMessages ? 
            '💬 New messages • Tap to open chat' : 
            '💬 Tap to open chat';
        
        this.elements.chatToggle.innerHTML = textContent;
        
        // Add visual indicator for unread messages
        if (this.state.hasUnreadMessages) {
            this.elements.chatToggle.classList.add('has-unread');
        } else {
            this.elements.chatToggle.classList.remove('has-unread');
        }
    }

    // Utility functions
    sanitizeHTML(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    linkifyText(text) {
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])|(\bwww\.[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        
        return text.replace(urlRegex, function(url) {
            let fullUrl = url;
            if (!url.match(/^https?:\/\//i) && url.match(/^www\./i)) {
                fullUrl = 'http://' + url;
            }
            return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });
    }

    // Clear methods
    clearTranscriptions() {
        this.updateInputTranscription('', false);
        this.updateOutputTranscription('', false);
    }

    clearRecentMessages() {
        if (this.elements.recentMessages) {
            this.elements.recentMessages.innerHTML = '';
            this.state.recentMessagesCount = 0;
            this.debugLog('Recent messages cleared');
        }
    }

    clearChatHistory() {
        if (this.elements.conversationLog) {
            this.elements.conversationLog.innerHTML = '';
            this.debugLog('Chat history cleared');
        }
    }

    // Debug functionality
    debugLog(message, isError = false, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = { timestamp, message, isError, data };
        
        this.state.debugMessages.push(logEntry);
        
        // Keep only last 100 messages
        if (this.state.debugMessages.length > 100) {
            this.state.debugMessages = this.state.debugMessages.slice(-100);
        }
        
        console[isError ? 'error' : 'log'](`[${timestamp}] [UIController] ${message}`, data || '');
        
        // Make available globally for debug overlay
        if (window.debugMessages) {
            window.debugMessages.push(logEntry);
        } else {
            window.debugMessages = [logEntry];
        }
    }

    showDebugInfo() {
        if (!this.elements.debugOverlay || !this.elements.debugContent) return;
        
        let html = '<h3>Voice Chat Debug Info</h3>';
        
        html += '<h4>Connection Status</h4>';
        html += `<p><strong>Connected:</strong> ${this.state.isConnected}</p>`;
        html += `<p><strong>Connecting:</strong> ${this.state.isConnecting}</p>`;
        html += `<p><strong>Voice Active:</strong> ${this.state.isVoiceActive}</p>`;
        html += `<p><strong>Text Enabled:</strong> ${this.state.isConnected}</p>`;
        
        html += '<h4>UI State</h4>';
        html += `<p><strong>Chat Open:</strong> ${this.state.isChatWidgetExpanded}</p>`;
        html += `<p><strong>Recent Messages:</strong> ${this.state.recentMessagesCount}/${this.state.maxRecentMessages}</p>`;
        html += `<p><strong>Unread Messages:</strong> ${this.state.hasUnreadMessages}</p>`;
        html += `<p><strong>User Speaking:</strong> ${this.state.isUserSpeaking}</p>`;
        html += `<p><strong>AI Speaking:</strong> ${this.state.isAISpeaking}</p>`;
        
        html += '<h4>Elements Check</h4>';
        html += `<p><strong>Connect Button:</strong> ${!!this.elements.connectButton}</p>`;
        html += `<p><strong>Interaction Circle:</strong> ${!!this.elements.userInteractionCircle}</p>`;
        html += `<p><strong>Chat Panel:</strong> ${!!this.elements.transcriptionPanel}</p>`;
        html += `<p><strong>Recent Messages:</strong> ${!!this.elements.recentMessages}</p>`;
        html += `<p><strong>Conversation Log:</strong> ${!!this.elements.conversationLog}</p>`;
        html += `<p><strong>Chat Input:</strong> ${!!this.elements.chatTextInput} (disabled: ${this.elements.chatTextInput?.disabled})</p>`;
        
        html += '<h4>Recent Debug Messages</h4>';
        html += '<div style="max-height: 200px; overflow-y: auto; font-size: 11px; background: #2a2a2a; padding: 10px; border-radius: 4px;">';
        this.state.debugMessages.slice(-15).forEach(msg => {
            const time = msg.timestamp.split('T')[1].split('.')[0];
            const color = msg.isError ? '#ff6666' : '#66ff66';
            html += `<p style="margin: 2px 0; color: ${color}; font-family: monospace;">[${time}] ${msg.message}</p>`;
        });
        html += '</div>';
        
        this.elements.debugContent.innerHTML = html;
        this.elements.debugOverlay.style.display = 'block';
        
        this.debugLog('Debug overlay opened');
    }

    hideDebugInfo() {
        if (this.elements.debugOverlay) {
            this.elements.debugOverlay.style.display = 'none';
            this.debugLog('Debug overlay closed');
        }
    }

    // Public API methods for external integration
    getState() {
        return { ...this.state };
    }

    isReady() {
        return this.state.isConnected && !this.state.isConnecting;
    }

    canSendText() {
        return this.state.isConnected; // Text always available when connected
    }

    canUseVoice() {
        return this.state.isConnected;
    }

    // Get recent messages for external access
    getRecentMessages() {
        const messages = [];
        if (this.elements.recentMessages) {
            const messageElements = this.elements.recentMessages.querySelectorAll('.message');
            messageElements.forEach(el => {
                const text = el.textContent.replace('Chloe:', '').trim();
                messages.push(text);
            });
        }
        return messages;
    }
}

// Initialize UIController when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (!window.uiController) {
            window.uiController = new UIController();
        }
    });
} else {
    if (!window.uiController) {
        window.uiController = new UIController();
    }
}

// Make class available globally
window.UIController = UIController;
