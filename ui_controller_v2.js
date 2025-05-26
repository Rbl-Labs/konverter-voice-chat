/**
 * Modern Voice Chat UI Controller
 * Version: 3.0.0
 */

class UIController {
    constructor() {
        this.elements = {
            userCircle: document.getElementById('userCircle'),
            aiCircle: document.getElementById('aiCircle'),
            micButton: document.getElementById('micButton'),
            transcriptionPanel: document.getElementById('transcriptionPanel'),
            transcriptionToggle: document.getElementById('transcriptionToggle'),
            inputTranscription: document.getElementById('inputTranscription'),
            outputTranscription: document.getElementById('outputTranscription'),
            conversationLog: document.getElementById('conversationLog'),
            status: document.getElementById('status')
        };
        
        this.state = {
            isTranscriptionVisible: false,
            isUserSpeaking: false,
            isAISpeaking: false
        };
        
        this.initialize();
    }
    
    initialize() {
        // Set up event listeners
        document.addEventListener('DOMContentLoaded', () => {
            this.setupEventListeners();
        });
        
        if (document.readyState !== 'loading') {
            this.setupEventListeners();
        }
    }
    
    setupEventListeners() {
        // Transcription panel toggle
        if (this.elements.transcriptionToggle) {
            this.elements.transcriptionToggle.addEventListener('click', () => {
                this.toggleTranscriptionPanel();
            });
        }
        
        // Close button in transcription panel
        const closeBtn = document.querySelector('.transcription-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.toggleTranscriptionPanel(false);
            });
        }
    }
    
    /**
     * Toggle the transcription panel visibility
     * @param {boolean} [force] - Force a specific state (true = show, false = hide)
     */
    toggleTranscriptionPanel(force) {
        const panel = this.elements.transcriptionPanel;
        if (!panel) return;
        
        const newState = force !== undefined ? force : !this.state.isTranscriptionVisible;
        
        if (newState) {
            panel.classList.add('visible');
        } else {
            panel.classList.remove('visible');
        }
        
        this.state.isTranscriptionVisible = newState;
    }
    
    /**
     * Set the user speaking state and animate the circle
     * @param {boolean} isSpeaking - Whether the user is speaking
     */
    setUserSpeaking(isSpeaking) {
        if (this.state.isUserSpeaking === isSpeaking) return;
        
        this.state.isUserSpeaking = isSpeaking;
        
        if (isSpeaking) {
            this.elements.userCircle.classList.add('user-active');
        } else {
            this.elements.userCircle.classList.remove('user-active');
        }
    }
    
    /**
     * Set the AI speaking state and animate the circle
     * @param {boolean} isSpeaking - Whether the AI is speaking
     */
    setAISpeaking(isSpeaking) {
        if (this.state.isAISpeaking === isSpeaking) return;
        
        this.state.isAISpeaking = isSpeaking;
        
        if (isSpeaking) {
            this.elements.aiCircle.classList.add('ai-active');
        } else {
            this.elements.aiCircle.classList.remove('ai-active');
        }
    }
    
    /**
     * Update the input transcription (user speech)
     * @param {string} text - The transcription text
     * @param {boolean} [show=true] - Whether to show the transcription
     */
    updateInputTranscription(text, show = true) {
        if (!this.elements.inputTranscription) return;
        
        this.elements.inputTranscription.textContent = text;
        
        if (show && text) {
            this.elements.inputTranscription.style.display = 'block';
        } else {
            this.elements.inputTranscription.style.display = 'none';
        }
    }
    
    /**
     * Update the output transcription (AI speech)
     * @param {string} text - The transcription text
     * @param {boolean} [show=true] - Whether to show the transcription
     */
    updateOutputTranscription(text, show = true) {
        if (!this.elements.outputTranscription) return;
        
        this.elements.outputTranscription.textContent = text;
        
        if (show && text) {
            this.elements.outputTranscription.style.display = 'block';
        } else {
            this.elements.outputTranscription.style.display = 'none';
        }
    }
    
    /**
     * Add a message to the conversation log
     * @param {string} text - The message text
     * @param {string} sender - The sender type ('user', 'ai', or 'system')
     */
    addMessage(text, sender) {
        if (!this.elements.conversationLog) return;
        
        const messageEl = document.createElement('div');
        messageEl.className = `message ${sender}`;
        messageEl.textContent = text;
        
        const avatarEl = document.createElement('div');
        avatarEl.className = 'message-avatar';
        
        if (sender === 'ai') {
            avatarEl.textContent = 'K';
        } else if (sender === 'user') {
            avatarEl.textContent = 'U';
        } else {
            avatarEl.textContent = 'i';
        }
        
        messageEl.appendChild(avatarEl);
        
        this.elements.conversationLog.appendChild(messageEl);
        this.elements.conversationLog.scrollTop = this.elements.conversationLog.scrollHeight;
    }
    
    /**
     * Update the status message
     * @param {string} message - The status message
     * @param {string} [type=''] - The status type ('', 'connected', 'error', 'recording', etc.)
     */
    updateStatus(message, type = '') {
        if (!this.elements.status) return;
        
        this.elements.status.textContent = message;
        this.elements.status.className = 'status ' + type;
    }
    
    /**
     * Update the mic button state
     * @param {boolean} isRecording - Whether recording is active
     * @param {boolean} isEnabled - Whether the button should be enabled
     */
    updateMicButton(isRecording, isEnabled = true) {
        if (!this.elements.micButton) return;
        
        this.elements.micButton.disabled = !isEnabled;
        
        if (isRecording) {
            this.elements.micButton.classList.add('recording');
            this.elements.micButton.innerHTML = '⏹️';
        } else {
            this.elements.micButton.classList.remove('recording');
            this.elements.micButton.innerHTML = '🎤';
        }
    }
    
    /**
     * Clear all transcriptions
     */
    clearTranscriptions() {
        this.updateInputTranscription('', false);
        this.updateOutputTranscription('', false);
    }
}

// Global function to toggle transcription panel
function toggleTranscriptionPanel(force) {
    if (window.uiController) {
        window.uiController.toggleTranscriptionPanel(force);
    }
}

// Create the UI controller instance when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    window.uiController = new UIController();
});

// If the document is already loaded, create the controller immediately
if (document.readyState !== 'loading') {
    window.uiController = new UIController();
}
