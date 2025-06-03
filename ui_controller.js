/**
 * Modern Voice Chat UI Controller
 * Version: 3.1.0 (Redesigned UI)
 */

class UIController {
    constructor() {
        this.elements = {
            // Header & Status
            headerLogo: document.querySelector('.header-logo'), // Assuming one logo
            statusBanner: document.getElementById('status'),
            navButtonHome: document.querySelector('.header-nav .nav-button[href="index.html"]'), // More specific selector

            // Central Interaction
            userInteractionCircle: document.getElementById('userInteractionCircle'),
            interactionIcon: document.getElementById('interactionIcon'),
            aiCircle: document.getElementById('aiCircle'),
            
            // Live Transcriptions
            liveTranscriptionDisplay: document.getElementById('liveTranscriptionContainer'), // Container for both
            inputTranscription: document.getElementById('inputTranscription'),
            outputTranscription: document.getElementById('outputTranscription'),

            // Chat Widget
            chatWidget: document.getElementById('chatWidget'),
            chatPreview: document.getElementById('chatPreview'),
            transcriptionPanel: document.getElementById('transcriptionPanel'), // Expanded view
            closeTranscriptionPanelBtn: document.getElementById('closeTranscriptionPanelBtn'),
            conversationLog: document.getElementById('conversationLog'),
            chatTextInput: document.getElementById('chatTextInput'),
            sendTextButton: document.getElementById('sendTextButton'),
            unreadIndicator: document.getElementById('unreadIndicator'),

            // Bottom Bar
            connectButton: document.getElementById('connectButton'),

            // Overlays & Spinners
            loadingSpinner: document.getElementById('loadingSpinner'),
            permissionGuidance: document.getElementById('permissionGuidance'),
            debugOverlay: document.getElementById('debugOverlay'),
            debugBtn: document.getElementById('debugBtn') // Existing debug button
        };
        
        this.state = {
            isChatWidgetExpanded: false,
            isUserSpeaking: false, // For user wave animation
            isAISpeaking: false,   // For AI wave animation
            isConnected: false,
            isConnecting: false,
            isConversationActive: false, // Play/Stop state for the central button
            hasUnreadMessages: false
        };
        
        // Initial UI setup based on default states
        this.initializeUI();
        this.setupEventListeners();
        
        // Expose globally for other scripts if not already done by HTML
        window.uiController = this; 
        debugLog('[UIController] Initialized v3.1.0');
    }
    
    initializeUI() {
        this.updateConnectButton('disconnected'); // Initial state
        this.updateInteractionButton('disconnected'); // Disabled until connected
        this.toggleChatWidget(false); // Start minimized
        this.updateStatusBanner('Ready. Tap Connect.', 'info');
    }

    setupEventListeners() {
        if (this.elements.connectButton) {
            this.elements.connectButton.addEventListener('click', () => this.handleConnectToggle());
        }
        if (this.elements.userInteractionCircle) {
            this.elements.userInteractionCircle.addEventListener('click', () => this.handleInteractionToggle());
        }
        if (this.elements.chatPreview) {
            this.elements.chatPreview.addEventListener('click', () => this.toggleChatWidget(true));
        }
        if (this.elements.closeTranscriptionPanelBtn) {
            this.elements.closeTranscriptionPanelBtn.addEventListener('click', () => this.toggleChatWidget(false));
        }
        if (this.elements.sendTextButton) {
            this.elements.sendTextButton.addEventListener('click', () => this.handleSendTextMessage());
        }
        if (this.elements.chatTextInput) {
            this.elements.chatTextInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.handleSendTextMessage();
                }
            });
        }
    }
    
    // --- Connection Button Logic ---
    handleConnectToggle() {
        if (this.state.isConnecting) return;

        if (this.state.isConnected) {
            debugLog('[UIController] Disconnect button clicked');
            if (window.geminiClient) window.geminiClient.disconnect();
            // geminiClient should call uiController.setConnectionState('disconnected')
        } else {
            debugLog('[UIController] Connect button clicked');
            if (window.geminiClient) window.geminiClient.connect();
            // geminiClient should call uiController.setConnectionState('connecting'/'connected'/'error')
        }
    }

    setConnectionState(state) { // Called by gemini_telegram_client.js
        switch(state) {
            case 'connecting':
                this.state.isConnecting = true;
                this.state.isConnected = false;
                this.updateConnectButton('connecting');
                this.updateInteractionButton('disconnected'); // Keep disabled while connecting
                this.updateStatusBanner('Connecting...', 'info');
                break;
            case 'connected':
                this.state.isConnecting = false;
                this.state.isConnected = true;
                this.updateConnectButton('connected'); // Shows "Disconnect"
                this.updateInteractionButton('ready_to_play'); // Enable central button to "Play"
                this.updateStatusBanner('Connected. Tap ▶️ to start.', 'connected');
                break;
            case 'disconnected':
                this.state.isConnecting = false;
                this.state.isConnected = false;
                this.state.isConversationActive = false; // Reset conversation state
                this.updateConnectButton('disconnected'); // Shows "Connect"
                this.updateInteractionButton('disconnected'); // Disable central button
                this.updateStatusBanner('Disconnected. Tap Connect.', 'info');
                this.setAISpeaking(false); // Turn off AI waves
                this.setUserSpeaking(false); // Turn off User waves
                break;
            case 'error':
                this.state.isConnecting = false;
                this.state.isConnected = false;
                this.updateConnectButton('disconnected'); // Revert to "Connect"
                this.updateInteractionButton('disconnected');
                // Status banner updated by debugLog/showCriticalError
                break;
        }
        debugLog(`[UIController] Connection state set to: ${state}`);
    }

    updateConnectButton(state) { // 'disconnected', 'connecting', 'connected'
        if (!this.elements.connectButton) return;
        const btn = this.elements.connectButton;
        btn.classList.remove('disconnected', 'connecting', 'connected');
        btn.classList.add(state);
        if (state === 'disconnected') btn.textContent = 'Connect';
        else if (state === 'connecting') btn.textContent = 'Connecting...';
        else if (state === 'connected') btn.textContent = 'Disconnect';
    }

    // --- Central Interaction Button Logic ---
    handleInteractionToggle() {
        if (!this.state.isConnected || this.state.isConnecting) {
            debugLog('[UIController] Interaction button clicked but not connected/ready.');
            return;
        }

        if (this.state.isConversationActive) { // Currently active, so stop/pause
            debugLog('[UIController] Stop/Pause button clicked');
            if (window.geminiClient) window.geminiClient.pauseConversation(); // Tell client to stop sending audio etc.
            this.state.isConversationActive = false;
            this.updateInteractionButton('ready_to_play'); // Show Play icon
            this.setUserSpeaking(false); // Stop user wave animation
        } else { // Currently paused/idle, so start/play
            debugLog('[UIController] Play/Start button clicked');
            if (window.geminiClient) window.geminiClient.startConversation(); // Tell client to start mic, send audio
            this.state.isConversationActive = true;
            this.updateInteractionButton('listening'); // Show Stop or Listening icon
        }
    }
    
    updateInteractionButton(state, isEnabledOverride) { // States: 'disconnected', 'ready_to_play', 'listening', 'user_speaking', 'processing', 'ai_speaking'
        if (!this.elements.userInteractionCircle || !this.elements.interactionIcon) return;
        
        const circle = this.elements.userInteractionCircle;
        const iconEl = this.elements.interactionIcon;
        let icon = '❓';
        let enabled = false;

        if (isEnabledOverride !== undefined) {
            enabled = isEnabledOverride;
        } else {
            enabled = this.state.isConnected && !this.state.isConnecting;
        }

        circle.classList.toggle('disabled', !enabled);

        if (!enabled || state === 'disconnected') {
            icon = '🔌'; // Or some other "connect first" icon
            this.state.isConversationActive = false; // Ensure this is reset
        } else if (state === 'ready_to_play') { // Connected, but paused
            icon = '▶️'; // Play
            this.state.isConversationActive = false;
        } else if (state === 'listening') { // Conversation active, waiting for user
            icon = '🎤'; // Microphone, ready to listen (or could be Stop ⏹️)
            // Let's use Stop as it's a toggle for active conversation
            icon = '⏹️'; 
        } else if (state === 'user_speaking') { // User is actively speaking
            icon = '⏹️'; // Still Stop, but waves are active
        } else if (state === 'processing') { // User finished, AI processing
            icon = '🔄'; // Loading/spinner
        } else if (state === 'ai_speaking') { // AI is speaking
             icon = '⏹️'; // Still Stop, as conversation is active
        }
        
        iconEl.textContent = icon;
        debugLog(`[UIController] Interaction button state: ${state}, icon: ${icon}, enabled: ${enabled}`);
    }

    // --- Chat Widget & Messages ---
    toggleChatWidget(forceShow) {
        if (!this.elements.chatWidget || !this.elements.transcriptionPanel || !this.elements.chatPreview) return;
        
        const newState = forceShow !== undefined ? forceShow : !this.state.isChatWidgetExpanded;
        
        if (newState) {
            this.elements.transcriptionPanel.style.display = 'flex';
            this.elements.chatPreview.style.display = 'none';
            this.state.isChatWidgetExpanded = true;
            if (this.elements.unreadIndicator) this.elements.unreadIndicator.style.display = 'none';
            this.state.hasUnreadMessages = false;
            // Scroll to bottom of log when opening
            if(this.elements.conversationLog) this.elements.conversationLog.scrollTop = this.elements.conversationLog.scrollHeight;

        } else {
            this.elements.transcriptionPanel.style.display = 'none';
            this.elements.chatPreview.style.display = 'flex';
            this.state.isChatWidgetExpanded = false;
        }
        debugLog(`[UIController] Chat widget toggled to: ${newState ? 'expanded' : 'minimized'}`);
    }

    handleSendTextMessage() {
        if (!this.elements.chatTextInput || !window.geminiClient) return;
        const text = this.elements.chatTextInput.value.trim();
        if (text) {
            debugLog(`[UIController] Sending text message: "${text}"`);
            window.geminiClient.sendTextMessage(text); // Needs to be implemented in gemini_telegram_client.js
            this.addMessage(text, 'user'); // Display user's own message
            this.elements.chatTextInput.value = '';
        }
    }
    
    addMessage(text, sender, isHTML = false) {
        if (!this.elements.conversationLog) return;
        
        const messageEl = document.createElement('div');
        messageEl.className = `message ${sender}`;
        
        if (isHTML) {
            // Basic sanitization: allow only <a> tags with href, and <b>, <i>, <br>
            // This is a very basic example. For production, use a proper sanitizer library.
            const allowedTags = /^(a|b|i|br)$/i;
            const allowedAttrs = /^(href|target)$/i;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = text;
            
            function sanitizeNode(node) {
                if (node.nodeType === Node.TEXT_NODE) {
                    return document.createTextNode(node.textContent);
                }
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (!allowedTags.test(node.tagName)) {
                        return document.createTextNode(node.textContent || '');
                    }
                    const newNode = document.createElement(node.tagName);
                    for (const attr of node.attributes) {
                        if (allowedAttrs.test(attr.name)) {
                            if (attr.name === 'href' && !attr.value.match(/^(https?:\/\/|mailto:|\/)/i)) {
                                // Skip potentially unsafe hrefs
                                continue;
                            }
                            newNode.setAttribute(attr.name, attr.value);
                        }
                    }
                    if (node.tagName.toLowerCase() === 'a') {
                        newNode.setAttribute('target', '_blank'); // Open links in new tab
                        newNode.setAttribute('rel', 'noopener noreferrer');
                    }
                    for (const child of node.childNodes) {
                        newNode.appendChild(sanitizeNode(child));
                    }
                    return newNode;
                }
                return document.createDocumentFragment(); // Ignore other node types
            }
            
            while (tempDiv.firstChild) {
                messageEl.appendChild(sanitizeNode(tempDiv.firstChild));
            }

        } else {
            // Auto-linkify plain text URLs
            const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])|(\bwww\.[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
            const linkedText = text.replace(urlRegex, function(url) {
                let fullUrl = url;
                if (!url.match(/^https?:\/\//i) && url.match(/^www\./i)) {
                    fullUrl = 'http://' + url;
                }
                return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
            });
            messageEl.innerHTML = linkedText;
        }
        
        // Avatar (simplified, can be enhanced)
        const avatarEl = document.createElement('div');
        avatarEl.className = 'message-avatar';
        avatarEl.textContent = sender === 'ai' ? 'AI' : (sender === 'user' ? 'U' : 'S');
        messageEl.appendChild(avatarEl);
        
        this.elements.conversationLog.appendChild(messageEl);
        this.elements.conversationLog.scrollTop = this.elements.conversationLog.scrollHeight;

        if (!this.state.isChatWidgetExpanded && sender === 'ai') {
            this.state.hasUnreadMessages = true;
            if(this.elements.unreadIndicator) this.elements.unreadIndicator.style.display = 'inline-block';
        }
        debugLog(`[UIController] Added message from ${sender}. HTML: ${isHTML}`);
    }

    // --- Visual Feedback (Waves, Transcriptions) ---
    setUserSpeaking(isSpeaking) { // Controls wave animation for user circle
        if (!this.elements.userInteractionCircle) return;
        this.state.isUserSpeaking = isSpeaking;
        this.elements.userInteractionCircle.classList.toggle('active', isSpeaking);
        if (isSpeaking && this.state.isConnected && this.state.isConversationActive) {
            this.updateInteractionButton('user_speaking');
        } else if (this.state.isConnected && this.state.isConversationActive) {
            this.updateInteractionButton('listening'); // Revert to listening/stop if not speaking
        }
    }
    
    setAISpeaking(isSpeaking) { // Controls wave animation for AI circle
        if (!this.elements.aiCircle) return;
        this.state.isAISpeaking = isSpeaking;
        this.elements.aiCircle.classList.toggle('active', isSpeaking);
         if (isSpeaking && this.state.isConnected && this.state.isConversationActive) {
            this.updateInteractionButton('ai_speaking');
        } else if (this.state.isConnected && this.state.isConversationActive && !this.state.isUserSpeaking) {
            // If AI stops and user isn't speaking, revert to listening/stop
            this.updateInteractionButton('listening');
        }
    }
    
    updateInputTranscription(text, show = true) {
        if (!this.elements.inputTranscription) return;
        this.elements.inputTranscription.textContent = text;
        this.elements.inputTranscription.classList.toggle('visible', show && !!text);
    }
    
    updateOutputTranscription(text, show = true) {
        if (!this.elements.outputTranscription) return;
        this.elements.outputTranscription.textContent = text;
        this.elements.outputTranscription.classList.toggle('visible', show && !!text);
    }

    updateStatusBanner(message, type = '') { // Matches function name in HTML
        if (!this.elements.statusBanner) return;
        this.elements.statusBanner.textContent = message;
        this.elements.statusBanner.className = 'status-banner ' + type;
    }
    
    clearTranscriptions() {
        this.updateInputTranscription('', false);
        this.updateOutputTranscription('', false);
    }
}

// Initialize UIController
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (!window.uiController) window.uiController = new UIController();
    });
} else {
    if (!window.uiController) window.uiController = new UIController();
}

// Expose toggleTranscriptionPanel globally if needed by HTML onclick (though it's better to manage via class methods)
// The HTML already has a global toggleTranscriptionPanel, let's ensure it calls the instance method.
function toggleTranscriptionPanel(force) { // This global function will be overwritten by UIController instance if it's also global
    if (window.uiController) {
        window.uiController.toggleChatWidget(force); // Call the new method
    } else {
        console.warn('[GlobalToggle] uiController not ready');
    }
}
