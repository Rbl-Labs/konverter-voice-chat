/**
 * User Form Component for Voice Chat
 * Collects user information before starting the conversation
 * Styled to match the main UI
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
            background-color: rgba(15, 17, 35, 0.9);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
            backdrop-filter: blur(5px);
        `;

        // Create form container
        this.formElement = document.createElement('div');
        this.formElement.className = 'user-form';
        this.formElement.style.cssText = `
            background-color: #1A1F35;
            border-radius: 12px;
            padding: 28px;
            width: 90%;
            max-width: 500px;
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
            color: white;
            font-family: 'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            border: 1px solid rgba(255, 255, 255, 0.1);
            animation: fadeIn 0.3s ease;
        `;

        // Create form content
        this.formElement.innerHTML = `
            <h2 style="margin-top: 0; color: #8A2BE2; text-align: center; font-size: 24px; font-weight: 600;">Welcome to Voice Chat</h2>
            <p style="margin-bottom: 24px; text-align: center; opacity: 0.9;">Please provide your information to get started</p>
            
            <form id="userInfoForm">
                <div style="margin-bottom: 20px;">
                    <label for="userName" style="display: block; margin-bottom: 10px; font-weight: 500; letter-spacing: 0.01em;">Your Name</label>
                    <input 
                        type="text" 
                        id="userName" 
                        value="${this.formData.name}"
                        placeholder="What should we call you?" 
                        style="width: 100%; padding: 14px 18px; border-radius: 25px; border: 2px solid rgba(255, 255, 255, 0.2); background-color: rgba(255, 255, 255, 0.1); color: white; font-size: 15px; font-family: 'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; transition: border-color 0.3s ease, background-color 0.3s ease;"
                        onfocus="this.style.borderColor='#8A2BE2'; this.style.backgroundColor='rgba(255, 255, 255, 0.15)';"
                        onblur="this.style.borderColor='rgba(255, 255, 255, 0.2)'; this.style.backgroundColor='rgba(255, 255, 255, 0.1)';"
                    >
                </div>
                
                <div style="margin-bottom: 28px;">
                    <label for="userEmail" style="display: block; margin-bottom: 10px; font-weight: 500; letter-spacing: 0.01em;">Your Email Address</label>
                    <input 
                        type="email" 
                        id="userEmail" 
                        value="${this.formData.email}"
                        placeholder="Where can we reach you?" 
                        style="width: 100%; padding: 14px 18px; border-radius: 25px; border: 2px solid rgba(255, 255, 255, 0.2); background-color: rgba(255, 255, 255, 0.1); color: white; font-size: 15px; font-family: 'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; transition: border-color 0.3s ease, background-color 0.3s ease;"
                        onfocus="this.style.borderColor='#8A2BE2'; this.style.backgroundColor='rgba(255, 255, 255, 0.15)';"
                        onblur="this.style.borderColor='rgba(255, 255, 255, 0.2)'; this.style.backgroundColor='rgba(255, 255, 255, 0.1)';"
                    >
                </div>
                
                <button 
                    type="submit" 
                    style="width: 100%; padding: 12px; background-color: #4CAF50; color: white; border: none; border-radius: 6px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; letter-spacing: 0.1em; text-transform: uppercase; font-family: 'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; box-shadow: 0 3px 10px rgba(76, 175, 80, 0.15);"
                    onmouseover="this.style.backgroundColor='#45a049'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(76, 175, 80, 0.3)';"
                    onmouseout="this.style.backgroundColor='#4CAF50'; this.style.transform='translateY(0)'; this.style.boxShadow='0 3px 10px rgba(76, 175, 80, 0.15)';"
                >
                    START CONVERSATION
                </button>
            </form>
            
            <style>
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                /* Import JetBrains Mono font if not already loaded */
                @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap');
            </style>
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
