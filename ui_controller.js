/**
 * Enhanced UI Controller for Gemini Voice Chat
 * Version 2.0.0 - Support for Gemini 2.5 and complete text responses
 */

class UIController {
    constructor() {
        this.elements = {};
        this.state = {
            connectionState: 'disconnected',
            isUserSpeaking: false,
            isAISpeaking: false,
            isChatOpen: false,
            unreadMessages: 0,
            modelType: null,
            modelName: null,
            useNativeAudio: false,
            chatModeEnabled: false
        };
        
        this.messageHistory = [];
        this.maxMessages = 100;
        
        this.initialize();
    }
    
    initialize() {
        this.cacheElements();
        this.setupEventListeners();
        this.log('UIController initialized');
    }
    
    cacheElements() {
        // Status and header elements
        this.elements.statusBanner = document.getElementById('status');
        this.elements.debugBtn = document.getElementById('debugBtn');
        
        // Interaction elements
        this.elements.userCircle = document.getElementById('userInteractionCircle');
        this.elements.aiCircle = document.getElementById('aiCircle');
        this.elements.interactionIcon = document.getElementById('interactionIcon');
        
        // Chat elements
        this.elements.chatWidget = document.getElementById('chatWidget');
        this.elements.chatPreview = document.getElementById('chatPreview');
        this.elements.transcriptionPanel = document.getElementById('transcriptionPanel');
        this.elements.conversationLog = document.getElementById('conversationLog');
        this.elements.chatTextInput = document.getElementById('chatTextInput');
        this.elements.sendTextButton = document.getElementById('sendTextButton');
        this.elements.unreadIndicator = document.getElementById('unreadIndicator');
        this.elements.closeTranscriptionBtn = document.getElementById('closeTranscriptionPanelBtn');
        
        // Transcription elements
        this.elements.inputTranscription = document.getElementById('inputTranscription');
        this.elements.outputTranscription = document.getElementById('outputTranscription');
        
        // Bottom bar
        this.elements.connectButton = document.getElementById('connectButton');
        
        // Model info elements (create if they don't exist)
        if (!document.getElementById('modelInfo')) {
            const modelInfo = document.createElement('div');
            modelInfo.id = 'modelInfo';
            modelInfo.className = 'model-info';
            modelInfo.style.cssText = 'position: absolute; top: 70px; right: 10px; font-size: 12px; opacity: 0.7;';
            document.querySelector('.app-container').appendChild(modelInfo);
            this.elements.modelInfo = modelInfo;
        } else {
            this.elements.modelInfo = document.getElementById('modelInfo');
        }
    }
    
    setupEventListeners() {
        // Debug button
        if (this.elements.debugBtn) {
            this.elements.debugBtn.addEventListener('click', () => {
                if (typeof window.showDebugInfo === 'function') {
                    window.showDebugInfo();
                }
            });
        }
        
        // Connect button
        if (this.elements.connectButton) {
            this.elements.connectButton.addEventListener('click', () => this.handleConnectButton());
        }
        
        // User interaction circle
        if (this.elements.userCircle) {
            this.elements.userCircle.addEventListener('click', () => this.handleInteractionButton());
        }
        
        // Chat widget
        if (this.elements.chatPreview) {
            this.elements.chatPreview.addEventListener('click', () => this.toggleChat());
        }
        
        if (this.elements.closeTranscriptionBtn) {
            this.elements.closeTranscriptionBtn.addEventListener('click', () => this.toggleChat(false));
        }
        
        // Chat input
        if (this.elements.chatTextInput) {
            this.elements.chatTextInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendChatMessage();
                }
            });
        }
        
        if (this.elements.sendTextButton) {
            this.elements.sendTextButton.addEventListener('click', () => this.sendChatMessage());
        }
    }
    
    log(message, isError = false) {
        if (typeof window.debugLog === 'function') {
            window.debugLog(`[UIController] ${message}`, isError);
        } else {
            console[isError ? 'error' : 'log'](`[UIController] ${message}`);
        }
    }
    
    updateStatusBanner(message, type = '') {
        if (this.elements.statusBanner) {
            this.elements.statusBanner.textContent = message;
            this.elements.statusBanner.className = 'status-banner ' + type;
        }
    }
    
    updateModelInfo(modelType, modelName) {
        if (this.elements.modelInfo) {
            this.state.modelType = modelType;
            this.state.modelName = modelName;
            this.elements.modelInfo.textContent = `Model: ${modelName || modelType || 'Unknown'}`;
        }
    }
    
    setConnectionState(state) {
        this.state.connectionState = state;
        this.log(`Connection state changed to: ${state}`);
        
        switch(state) {
            case 'disconnected':
                this.updateStatusBanner('Disconnected', 'error');
                this.updateConnectButton('Connect', false);
                this.updateInteractionButton('disconnected');
                break;
            case 'connecting':
                this.updateStatusBanner('Connecting...', 'warning');
                this.updateConnectButton('Connecting...', true);
                this.updateInteractionButton('connecting');
                break;
            case 'connected':
                this.updateStatusBanner('Connected to Gemini', 'success');
                this.updateConnectButton('Disconnect', false);
                this.updateInteractionButton('ready_to_play');
                break;
            case 'error':
                this.updateStatusBanner('Connection Error', 'error');
                this.updateConnectButton('Retry', false);
                this.updateInteractionButton('error');
                break;
        }
    }
    
    updateConnectButton(text, disabled = false) {
        if (this.elements.connectButton) {
            this.elements.connectButton.textContent = text;
            this.elements.connectButton.disabled = disabled;
        }
    }
    
    updateInteractionButton(state, enabled = true) {
        if (!this.elements.userCircle || !this.elements.interactionIcon) return;
        
        // Remove all state classes
        this.elements.userCircle.classList.remove('connecting', 'ready', 'listening', 'processing', 'error', 'disabled');
        
        // Update based on state
        switch(state) {
            case 'disconnected':
                this.elements.interactionIcon.textContent = '🔌';
                this.elements.userCircle.classList.add('disabled');
                break;
            case 'connecting':
                this.elements.interactionIcon.textContent = '⏳';
                this.elements.userCircle.classList.add('connecting');
                break;
            case 'ready_to_play':
                this.elements.interactionIcon.textContent = '▶️';
                this.elements.userCircle.classList.add('ready');
                break;
            case 'listening':
                this.elements.interactionIcon.textContent = '🎤';
                this.elements.userCircle.classList.add('listening');
                break;
            case 'processing':
                this.elements.interactionIcon.textContent = '⏸️';
                this.elements.userCircle.classList.add('processing');
                break;
            case 'error':
                this.elements.interactionIcon.textContent = '❌';
                this.elements.userCircle.classList.add('error');
                break;
        }
        
        this.elements.userCircle.style.pointerEvents = enabled ? 'auto' : 'none';
    }
    
    handleConnectButton() {
        if (!window.geminiClient) {
            this.log('GeminiClient not initialized', true);
            return;
        }
        
        if (this.state.connectionState === 'disconnected' || this.state.connectionState === 'error') {
            window.geminiClient.connect();
        } else if (this.state.connectionState === 'connected') {
            window.geminiClient.disconnect();
        }
    }
    
    handleInteractionButton() {
        if (!window.geminiClient) {
            this.log('GeminiClient not initialized', true);
            return;
        }
        
        if (this.state.connectionState !== 'connected') {
            this.log('Not connected, cannot start interaction');
            return;
        }
        
        // Toggle between play and pause
        if (this.state.isUserSpeaking) {
            window.geminiClient.pauseConversation();
        } else {
            window.geminiClient.startConversation();
        }
    }
    
    setUserSpeaking(isSpeaking) {
        this.state.isUserSpeaking = isSpeaking;
        if (this.elements.userCircle) {
            if (isSpeaking) {
                this.elements.userCircle.classList.add('speaking');
            } else {
                this.elements.userCircle.classList.remove('speaking');
            }
        }
    }
    
    setAISpeaking(isSpeaking) {
        this.state.isAISpeaking = isSpeaking;
        if (this.elements.aiCircle) {
            if (isSpeaking) {
                this.elements.aiCircle.classList.add('speaking');
            } else {
                this.elements.aiCircle.classList.remove('speaking');
            }
        }
    }
    
    updateInputTranscription(text) {
        if (this.elements.inputTranscription) {
            this.elements.inputTranscription.textContent = text;
            if (text) {
                this.elements.inputTranscription.classList.add('active');
            } else {
                this.elements.inputTranscription.classList.remove('active');
            }
        }
    }
    
    updateOutputTranscription(text) {
        if (this.elements.outputTranscription) {
            this.elements.outputTranscription.textContent = text;
            if (text) {
                this.elements.outputTranscription.classList.add('active');
            } else {
                this.elements.outputTranscription.classList.remove('active');
            }
        }
    }
    
    clearTranscriptions() {
        this.updateInputTranscription('');
        this.updateOutputTranscription('');
    }
    
    toggleChat(open = null) {
        if (open === null) {
            open = !this.state.isChatOpen;
        }
        
        this.state.isChatOpen = open;
        
        if (this.elements.chatWidget) {
            if (open) {
                this.elements.chatWidget.classList.add('open');
                this.elements.chatPreview.style.display = 'none';
                this.elements.transcriptionPanel.style.display = 'flex';
                this.state.unreadMessages = 0;
                this.updateUnreadIndicator();
                
                // Focus on input
                if (this.elements.chatTextInput) {
                    this.elements.chatTextInput.focus();
                }
                
                // Scroll to bottom
                this.scrollChatToBottom();
            } else {
                this.elements.chatWidget.classList.remove('open');
                this.elements.chatPreview.style.display = 'flex';
                this.elements.transcriptionPanel.style.display = 'none';
            }
        }
    }
    
    addMessage(content, type = 'user', isHTML = false) {
        const message = {
            content,
            type,
            timestamp: new Date(),
            isHTML
        };
        
        this.messageHistory.push(message);
        if (this.messageHistory.length > this.maxMessages) {
            this.messageHistory.shift();
        }
        
        this.renderMessage(message);
        
        // Update unread count if chat is closed
        if (!this.state.isChatOpen && type !== 'user') {
            this.state.unreadMessages++;
            this.updateUnreadIndicator();
        }
    }
    
    renderMessage(message) {
        if (!this.elements.conversationLog) return;
        
        const messageEl = document.createElement('div');
        messageEl.className = `message message-${message.type}`;
        
        const timeEl = document.createElement('span');
        timeEl.className = 'message-time';
        timeEl.textContent = message.timestamp.toLocaleTimeString();
        
        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        
        if (message.isHTML) {
            contentEl.innerHTML = message.content;
        } else {
            contentEl.textContent = message.content;
        }
        
        messageEl.appendChild(timeEl);
        messageEl.appendChild(contentEl);
        
        this.elements.conversationLog.appendChild(messageEl);
        this.scrollChatToBottom();
    }
    
    scrollChatToBottom() {
        if (this.elements.conversationLog) {
            this.elements.conversationLog.scrollTop = this.elements.conversationLog.scrollHeight;
        }
    }
    
    updateUnreadIndicator() {
        if (this.elements.unreadIndicator) {
            if (this.state.unreadMessages > 0) {
                this.elements.unreadIndicator.textContent = this.state.unreadMessages;
                this.elements.unreadIndicator.style.display = 'inline-block';
            } else {
                this.elements.unreadIndicator.style.display = 'none';
            }
        }
    }
    
    sendChatMessage() {
        if (!this.elements.chatTextInput || !window.geminiClient) return;
        
        const text = this.elements.chatTextInput.value.trim();
        if (!text) return;
        
        // Add message to UI
        this.addMessage(text, 'user');
        
        // Send to Gemini
        window.geminiClient.sendTextMessage(text);
        
        // Clear input
        this.elements.chatTextInput.value = '';
    }
    
    // Function execution UI updates
    showFunctionExecution(functionName) {
        this.addMessage(`⚡ Executing function: ${functionName}`, 'system');
    }
    
    showFunctionResult(functionName, success, message) {
        const icon = success ? '✅' : '❌';
        this.addMessage(`${icon} ${functionName}: ${message}`, 'system');
    }
    
    // Model switching UI
    showModelSwitchUI() {
        const modelSwitchHTML = `
            <div class="model-switch-ui">
                <h4>Switch Model</h4>
                <button onclick="window.uiController.switchToModel('2.0')">Gemini 2.0</button>
                <button onclick="window.uiController.switchToModel('2.5')">Gemini 2.5 (Native Audio)</button>
            </div>
        `;
        this.addMessage(modelSwitchHTML, 'system', true);
    }
    
    switchToModel(modelType) {
        if (window.geminiClient) {
            window.geminiClient.switchModel(modelType);
        }
    }
    
    // Enable/disable chat mode
    toggleChatMode() {
        this.state.chatModeEnabled = !this.state.chatModeEnabled;
        if (window.geminiClient) {
            window.geminiClient.enableChatMode(this.state.chatModeEnabled);
        }
        this.addMessage(`Chat mode ${this.state.chatModeEnabled ? 'enabled' : 'disabled'}`, 'system');
    }
}

// Initialize UI Controller when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.uiController = new UIController();
    });
} else {
    window.uiController = new UIController();
}
