/**
 * User Form Component for Voice Chat
 * Collects user information before starting the conversation
 */

class UserForm {
    constructor() {
        this.formData = {
            name: localStorage.getItem('user_name') || '',
            email: localStorage.getItem('user_email') || ''
        };
        this.onSubmitCallback = null;
        this.formElement = null;
        this.overlayElement = null;
    }

    /**
     * Initialize the form and add it to the DOM
     */
    initialize() {
        // Create overlay
        this.overlayElement = document.createElement('div');
        this.overlayElement.className = 'form-overlay';
        this.overlayElement.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        `;

        // Create form container
        this.formElement = document.createElement('div');
        this.formElement.className = 'user-form';
        this.formElement.style.cssText = `
            background-color: #1a1a2e;
            border-radius: 12px;
            padding: 24px;
            width: 90%;
            max-width: 500px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            color: white;
            font-family: Arial, sans-serif;
        `;

        // Create form content
        this.formElement.innerHTML = `
            <h2 style="margin-top: 0; color: #7b68ee; text-align: center; font-size: 24px;">Welcome to Voice Chat</h2>
            <p style="margin-bottom: 20px; text-align: center;">Please provide your information to get started</p>
            
            <form id="userInfoForm">
                <div style="margin-bottom: 16px;">
                    <label for="userName" style="display: block; margin-bottom: 8px; font-weight: bold;">Your Name</label>
                    <input 
                        type="text" 
                        id="userName" 
                        value="${this.formData.name}"
                        placeholder="What should we call you?" 
                        style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #444; background: #2a2a40; color: white; font-size: 16px;"
                    >
                </div>
                
                <div style="margin-bottom: 24px;">
                    <label for="userEmail" style="display: block; margin-bottom: 8px; font-weight: bold;">Your Email Address</label>
                    <input 
                        type="email" 
                        id="userEmail" 
                        value="${this.formData.email}"
                        placeholder="Where can we reach you?" 
                        style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #444; background: #2a2a40; color: white; font-size: 16px;"
                    >
                </div>
                
                <button 
                    type="submit" 
                    style="width: 100%; padding: 12px; background: #7b68ee; color: white; border: none; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; transition: background 0.3s;"
                    onmouseover="this.style.background='#9280ff'"
                    onmouseout="this.style.background='#7b68ee'"
                >
                    Start Conversation
                </button>
            </form>
        `;

        // Add form to overlay
        this.overlayElement.appendChild(this.formElement);

        // Add event listeners
        const form = this.formElement.querySelector('#userInfoForm');
        form.addEventListener('submit', (e) => this.handleSubmit(e));

        // Add to DOM
        document.body.appendChild(this.overlayElement);
    }

    /**
     * Handle form submission
     */
    handleSubmit(event) {
        event.preventDefault();
        
        // Get form values
        const nameInput = this.formElement.querySelector('#userName');
        const emailInput = this.formElement.querySelector('#userEmail');
        
        this.formData.name = nameInput.value.trim();
        this.formData.email = emailInput.value.trim();
        
        // Save to localStorage
        localStorage.setItem('user_name', this.formData.name);
        localStorage.setItem('user_email', this.formData.email);
        
        // Hide form
        this.hide();
        
        // Call callback if exists
        if (this.onSubmitCallback) {
            this.onSubmitCallback(this.formData);
        }
    }

    /**
     * Set callback for form submission
     */
    onSubmit(callback) {
        this.onSubmitCallback = callback;
    }

    /**
     * Show the form
     */
    show() {
        this.initialize();
    }

    /**
     * Hide the form
     */
    hide() {
        if (this.overlayElement && this.overlayElement.parentNode) {
            this.overlayElement.parentNode.removeChild(this.overlayElement);
        }
    }

    /**
     * Get the current form data
     */
    getData() {
        return this.formData;
    }
}

// Export as global
window.UserForm = UserForm;
