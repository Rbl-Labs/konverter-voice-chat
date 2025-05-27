/**
 * Konverter.ai Custom Chat Interface
 * Bridges between custom UI and Dialogflow df-messenger
 */

class KonverterChat {
    constructor() {
        this.hiddenMessenger = null;
        this.chatContainer = null;
        this.messagesContainer = null;
        this.messageInput = null;
        this.sendButton = null;
        this.typingIndicator = null;
        this.isTyping = false;
        this.sessionId = this.generateSessionId();
        
        this.init();
    }
    
    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }
    
    setup() {
        try {
            this.setupElements();
            this.setupEventListeners();
            this.setupDialogflow();
            this.showWelcomeMessage();
            console.log('KonverterChat initialized successfully');
        } catch (error) {
            console.error('KonverterChat setup failed:', error);
        }
    }
    
    setupElements() {
        this.chatContainer = document.getElementById('chatInterface');
        this.messagesContainer = document.getElementById('messagesContainer');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.typingIndicator = document.getElementById('typingIndicator');
        
        if (!this.chatContainer) {
            throw new Error('Chat container not found');
        }
    }
    
    setupEventListeners() {
        // Send button click
        if (this.sendButton) {
            this.sendButton.addEventListener('click', () => this.sendMessage());
        }
        
        // Enter key to send
        if (this.messageInput) {
            this.messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
            
            // Auto-resize textarea
            this.messageInput.addEventListener('input', () => {
                this.autoResizeInput();
            });
        }
        
        // Quick action buttons
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('konverter-quick-action')) {
                const message = e.target.textContent;
                this.sendMessage(message);
            }
        });
        
        // Voice interface toggle
        const voiceToggle = document.getElementById('voiceToggle');
        if (voiceToggle) {
            voiceToggle.addEventListener('click', () => this.toggleVoiceInterface());
        }
    }
    
    setupDialogflow() {
        // Wait for df-messenger to be ready with more robust checking
        const checkMessenger = (attempts = 0) => {
            this.hiddenMessenger = document.getElementById('hiddenMessenger');
            
            if (this.hiddenMessenger && typeof this.hiddenMessenger.addEventListener === 'function') {
                // Listen for Dialogflow responses with multiple event types
                this.hiddenMessenger.addEventListener('df-response-received', (event) => {
                    console.log('Dialogflow response received:', event.detail);
                    this.handleDialogflowResponse(event.detail);
                });
                
                this.hiddenMessenger.addEventListener('df-messenger-loaded', () => {
                    console.log('Dialogflow messenger loaded and ready');
                });
                
                // Listen for user input events as well
                this.hiddenMessenger.addEventListener('df-user-input-entered', (event) => {
                    console.log('User input entered:', event.detail);
                });
                
                // Check if messenger is actually ready by testing its properties
                setTimeout(() => {
                    console.log('Dialogflow messenger properties:', {
                        hasRenderCustomText: typeof this.hiddenMessenger.renderCustomText === 'function',
                        projectId: this.hiddenMessenger.getAttribute('project-id'),
                        agentId: this.hiddenMessenger.getAttribute('agent-id'),
                        element: this.hiddenMessenger.tagName
                    });
                }, 1000);
                
                console.log('Dialogflow integration setup complete');
            } else if (attempts < 50) {
                // Retry for up to 5 seconds
                setTimeout(() => checkMessenger(attempts + 1), 100);
            } else {
                console.error('Failed to initialize Dialogflow messenger after 5 seconds');
                this.addErrorMessage('Chat system initialization failed. Please refresh the page.');
            }
        };
        
        checkMessenger();
    }
    
    showWelcomeMessage() {
        const welcomeMessage = {
            text: "👋 Welcome to Konverter.ai! I'm your AI assistant ready to help with our agent marketplace, funding opportunities, or product demos. How can I assist you today?",
            isBot: true,
            timestamp: new Date()
        };
        
        this.addMessage(welcomeMessage);
    }
    
    sendMessage(messageText = null) {
        const text = messageText || this.messageInput?.value.trim();
        
        if (!text) return;
        
        // Add user message to UI
        const userMessage = {
            text: text,
            isBot: false,
            timestamp: new Date()
        };
        
        this.addMessage(userMessage);
        
        // Clear input
        if (this.messageInput && !messageText) {
            this.messageInput.value = '';
            this.autoResizeInput();
        }
        
        // Show typing indicator
        this.showTyping();
        
        // Send to Dialogflow via hidden messenger
        this.sendToDialogflow(text);
    }
    
    sendToDialogflow(text) {
        try {
            if (this.hiddenMessenger) {
                // Create a proper message event for Dialogflow
                const messageEvent = new CustomEvent('df-user-input-entered', {
                    detail: {
                        input: text,
                        session: this.sessionId
                    }
                });
                
                // Dispatch the event to trigger Dialogflow
                this.hiddenMessenger.dispatchEvent(messageEvent);
                
                // Alternative method - directly set the input
                setTimeout(() => {
                    try {
                        // Try to access the internal input method
                        if (this.hiddenMessenger.querySelector) {
                            const input = this.hiddenMessenger.querySelector('input');
                            if (input) {
                                input.value = text;
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                
                                // Trigger send
                                const sendBtn = this.hiddenMessenger.querySelector('[data-testid="send-button"]') || 
                                               this.hiddenMessenger.querySelector('button[type="submit"]');
                                if (sendBtn) {
                                    sendBtn.click();
                                }
                            }
                        }
                        
                        // Fallback: Use the renderCustomText method more carefully
                        if (typeof this.hiddenMessenger.renderCustomText === 'function') {
                            this.hiddenMessenger.renderCustomText({
                                text: String(text).trim(),
                                sessionId: this.sessionId
                            });
                        }
                    } catch (fallbackError) {
                        console.warn('Fallback Dialogflow methods failed:', fallbackError);
                        // Last resort - simulate a timeout and show error
                        setTimeout(() => {
                            this.hideTyping();
                            this.addErrorMessage('Connection issue. Please refresh the page and try again.');
                        }, 3000);
                    }
                }, 100);
                
            } else {
                console.error('Dialogflow messenger not available');
                this.hideTyping();
                this.addErrorMessage('Connection error. Please refresh the page.');
            }
        } catch (error) {
            console.error('Error sending to Dialogflow:', error);
            this.hideTyping();
            this.addErrorMessage('Failed to send message. Please try again.');
        }
    }
    
    handleDialogflowResponse(response) {
        this.hideTyping();
        
        try {
            // Extract response text
            let responseText = '';
            
            if (response.response && response.response.queryResult) {
                const queryResult = response.response.queryResult;
                
                if (queryResult.fulfillmentText) {
                    responseText = queryResult.fulfillmentText;
                } else if (queryResult.fulfillmentMessages && queryResult.fulfillmentMessages.length > 0) {
                    const message = queryResult.fulfillmentMessages[0];
                    if (message.text && message.text.text && message.text.text.length > 0) {
                        responseText = message.text.text[0];
                    }
                }
            } else if (typeof response === 'string') {
                responseText = response;
            } else if (response.text) {
                responseText = response.text;
            }
            
            if (responseText) {
                const botMessage = {
                    text: responseText,
                    isBot: true,
                    timestamp: new Date()
                };
                
                this.addMessage(botMessage);
            } else {
                console.warn('No response text found:', response);
                this.addErrorMessage('I received your message but couldn\'t generate a response. Please try again.');
            }
        } catch (error) {
            console.error('Error handling Dialogflow response:', error);
            this.addErrorMessage('Sorry, I encountered an error processing your message.');
        }
    }
    
    addMessage(message) {
        if (!this.messagesContainer) return;
        
        // Hide welcome screen if it exists
        const welcomeScreen = document.querySelector('.konverter-welcome-message');
        if (welcomeScreen) {
            welcomeScreen.style.display = 'none';
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `konverter-message ${message.isBot ? 'ai' : 'user'}`;
        
        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'konverter-message-bubble';
        bubbleDiv.textContent = message.text;
        
        const timeDiv = document.createElement('div');
        timeDiv.className = 'konverter-message-time';
        timeDiv.textContent = this.formatTime(message.timestamp);
        
        messageDiv.appendChild(bubbleDiv);
        messageDiv.appendChild(timeDiv);
        
        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
        
        // Add animation
        messageDiv.classList.add('konverter-fade-in');
    }
    
    addErrorMessage(text) {
        const errorMessage = {
            text: `⚠️ ${text}`,
            isBot: true,
            timestamp: new Date()
        };
        this.addMessage(errorMessage);
    }
    
    showTyping() {
        if (this.typingIndicator && !this.isTyping) {
            this.isTyping = true;
            this.typingIndicator.classList.remove('konverter-hidden');
            this.scrollToBottom();
        }
    }
    
    hideTyping() {
        if (this.typingIndicator && this.isTyping) {
            this.isTyping = false;
            this.typingIndicator.classList.add('konverter-hidden');
        }
    }
    
    autoResizeInput() {
        if (this.messageInput) {
            this.messageInput.style.height = 'auto';
            this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 120) + 'px';
        }
    }
    
    scrollToBottom() {
        if (this.messagesContainer) {
            setTimeout(() => {
                this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
            }, 100);
        }
    }
    
    formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    generateSessionId() {
        return 'konverter-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
    }
    
    toggleVoiceInterface() {
        const voiceInterface = document.getElementById('voiceInterface');
        const chatInterface = document.getElementById('chatInterface');
        
        if (voiceInterface && chatInterface) {
            if (voiceInterface.style.display === 'none') {
                // Show voice, hide chat
                voiceInterface.style.display = 'block';
                chatInterface.style.display = 'none';
                
                // Update status if voice initialization exists
                if (typeof updateStatus === 'function') {
                    updateStatus('Voice mode active');
                }
            } else {
                // Show chat, hide voice
                voiceInterface.style.display = 'none';
                chatInterface.style.display = 'flex';
            }
        }
    }
    
    // Public methods for external access
    sendCustomMessage(text) {
        this.sendMessage(text);
    }
    
    clearChat() {
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = '';
            this.showWelcomeMessage();
        }
    }
}

// Global functions for external access
window.KonverterChat = KonverterChat;

// Auto-initialize when script loads
let konverterChatInstance = null;

// Initialize after DOM is ready
const initializeKonverterChat = () => {
    if (!konverterChatInstance) {
        konverterChatInstance = new KonverterChat();
        window.konverterChat = konverterChatInstance;
    }
};

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeKonverterChat);
} else {
    initializeKonverterChat();
}

// Export for external use
window.initializeKonverterChat = initializeKonverterChat;
