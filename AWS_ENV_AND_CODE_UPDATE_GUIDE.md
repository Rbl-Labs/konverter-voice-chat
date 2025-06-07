# AWS Environment and Code Update Guide

## Overview

You've added header authentication to both N8N webhooks:
- Voice Session API webhook: `https://n8n.lomeai.com/webhook/voice-session`
- Conversation Storage webhook: `https://n8n.lomeai.com/webhook/conversation-storage`

Both webhooks use the same authentication credentials:
- Header name: `X-API-Key`
- Header value: `908y345pqi3geroivMMuabdfkvaRLhsp9r8y32r028`

Now we need to:
1. Update the AWS `.env` file
2. Update the code to include this API key in all webhook requests

## 1. Updating the AWS .env File

### Option A: Direct SSH Update

If you have SSH access to your AWS instance:

```bash
# SSH into your AWS instance
ssh -i your-key.pem ec2-user@your-aws-instance-ip

# Navigate to your application directory
cd /path/to/your/app

# Edit the .env file
nano .env

# Add the following line to the .env file:
N8N_API_KEY=908y345pqi3geroivMMuabdfkvaRLhsp9r8y32r028

# Save and exit (Ctrl+X, then Y, then Enter)
```

### Option B: Using the AWS Console

If you're using AWS Systems Manager Parameter Store:

1. Open the AWS Management Console
2. Navigate to Systems Manager > Parameter Store
3. Click "Create parameter"
4. Enter the following:
   - Name: `/your-app/N8N_API_KEY`
   - Type: SecureString
   - Value: `908y345pqi3geroivMMuabdfkvaRLhsp9r8y32r028`
5. Click "Create parameter"

### Option C: Using the AWS CLI

```bash
# Set the parameter in AWS Parameter Store
aws ssm put-parameter \
    --name "/your-app/N8N_API_KEY" \
    --value "908y345pqi3geroivMMuabdfkvaRLhsp9r8y32r028" \
    --type SecureString \
    --overwrite
```

### Option D: Update Local .env and Redeploy

1. Update your local `.env` file:
   ```
   # Add to your backend/.env file
   N8N_API_KEY=908y345pqi3geroivMMuabdfkvaRLhsp9r8y32r028
   ```

2. Use your existing deployment script to redeploy:
   ```bash
   cd backend
   ./deploy_to_aws.sh
   ```

## 2. Updating the Code

We need to modify all functions that make requests to the N8N webhooks. Here are the key functions to update:

### A. Update `storeConversationTurnInN8N` Method

```javascript
async storeConversationTurnInN8N(turnData) {
    try {
        this.log('Storing conversation turn securely via N8N', { turnId: turnData.turnId });
        
        const response = await fetch(`${N8N_BASE_URL}/webhook/conversation-storage`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-API-Key': process.env.N8N_API_KEY  // Add API key authentication
            },
            body: JSON.stringify({
                session_token: this.sessionToken,
                action: 'store_conversation_turn',
                data: {
                    userId: this.userId,
                    sessionId: this.sessionId,
                    turnId: turnData.turnId,
                    userMessage: turnData.userMessage,
                    aiResponse: turnData.aiResponse,
                    userMethod: turnData.userMethod,
                    timestamp: turnData.timestamp,
                    interrupted: turnData.interrupted || false,
                    modelType: this.modelType,
                    userData: this.userData || {}
                }
            })
        });
        
        if (response.ok) {
            this.log('Conversation turn stored securely via N8N', { turnId: turnData.turnId });
        } else {
            this.log('Failed to store conversation turn via N8N', { 
                status: response.status, 
                statusText: response.statusText 
            }, true);
        }
    } catch (error) {
        this.log('Error storing conversation turn via N8N', { error: error.message }, true);
    }
}
```

### B. Update `notifyN8n` Method

```javascript
async notifyN8n(eventType, data = {}) { 
    try { 
        const controller = new AbortController(); 
        const timeoutId = setTimeout(() => controller.abort(), 5000); 
        
        await fetch(`${N8N_BASE_URL}/webhook/voice-session`, { 
            signal: controller.signal, 
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json',
                'X-API-Key': process.env.N8N_API_KEY  // Add API key authentication
            }, 
            body: JSON.stringify({ 
                session_token: this.sessionToken, 
                action: 'log_event', 
                event_type: eventType, 
                data: { 
                    userId: this.userId, 
                    sessionId: this.sessionId, 
                    modelType: this.modelType, 
                    timestamp: new Date().toISOString(), 
                    ...data 
                } 
            }) 
        }); 
        
        clearTimeout(timeoutId); 
    } catch (error) { 
        this.log('Failed to notify N8N', { eventType, error: error.message }, true); 
    } 
}
```

### C. Update `getSessionConfig` Method

```javascript
async getSessionConfig() {
    try {
        this.log(`Fetching session config from N8N`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(`${N8N_BASE_URL}/webhook/voice-session?session=${this.sessionToken}&action=initialize`, { 
            signal: controller.signal, 
            headers: { 
                'User-Agent': 'TelegramVoiceBot/3.0', 
                'Accept': 'application/json',
                'X-API-Key': process.env.N8N_API_KEY  // Add API key authentication
            } 
        });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`N8N API returned ${response.status}: ${response.statusText}`);
        const data = await response.json();
        const sessionData = Array.isArray(data) ? data[0] : data;
        if (!sessionData.success) throw new Error(sessionData.error || 'Invalid session token or unsuccessful n8n response');
        this.userId = sessionData.userId; 
        this.sessionId = sessionData.sessionId; 
        this.sessionConfigFromN8n = sessionData.config;
        this.log('Session configured successfully', { sessionId: this.sessionId, userId: this.userId, model: this.sessionConfigFromN8n?.model || 'not_provided' });
    } catch (error) { 
        if (error.name === 'AbortError') throw new Error('N8N request timed out'); 
        throw new Error(`Failed to get session configuration: ${error.message}`); 
    }
}
```

### D. Update `getSessionConfigWithUserData` Method (if it exists)

```javascript
async getSessionConfigWithUserData() {
    try {
        this.log('Fetching session config with user data from N8N');
        
        // Prepare URL with user data parameters
        const params = new URLSearchParams();
        params.append('session', this.sessionToken);
        params.append('action', 'initialize');
        
        // Add user data if available
        if (this.userData) {
            if (this.userData.name) params.append('user_name', this.userData.name);
            if (this.userData.email) params.append('user_email', this.userData.email);
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        const response = await fetch(`${N8N_BASE_URL}/webhook/voice-session?${params}`, {
            signal: controller.signal,
            headers: { 
                'User-Agent': 'TelegramVoiceBot/3.0', 
                'Accept': 'application/json',
                'X-API-Key': process.env.N8N_API_KEY  // Add API key authentication
            }
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`N8N API returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        const sessionData = Array.isArray(data) ? data[0] : data;
        
        if (!sessionData.success) {
            throw new Error(sessionData.error || 'Failed to get session config with user data');
        }
        
        // Update session config with enhanced prompt from N8N
        this.sessionConfigFromN8n = sessionData.config;
        
        this.log('Session configured with user data via N8N', { 
            sessionId: this.sessionId, 
            userId: this.userId,
            hasUserData: !!this.userData,
            userName: this.userData?.name,
            userEmail: this.userData?.email
        });
        
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('N8N request timed out');
        }
        throw new Error(`Failed to get session configuration with user data: ${error.message}`);
    }
}
```

## 3. Ensuring Environment Variables are Loaded

Make sure your application loads environment variables correctly:

```javascript
// At the top of your main file (e.g., gemini_websocket_proxy.js)
require('dotenv').config();

// Then access the API key
const N8N_API_KEY = process.env.N8N_API_KEY;

// Verify it's loaded
if (!N8N_API_KEY) {
    console.warn('N8N_API_KEY not found in environment variables. N8N webhook authentication will fail.');
}
```

## 4. Deployment Steps

### Step 1: Update Local Code

1. Make all the code changes described above
2. Test locally if possible
3. Commit your changes

### Step 2: Update AWS Environment

Choose one of the methods described in section 1 to update the AWS environment variables.

### Step 3: Deploy Updated Code

Use your existing deployment script:

```bash
cd backend
./deploy_to_aws.sh
```

### Step 4: Verify Deployment

1. Check the logs to ensure the application started correctly:
   ```bash
   ssh -i your-key.pem ec2-user@your-aws-instance-ip
   cd /path/to/your/app
   pm2 logs
   ```

2. Look for any errors related to missing environment variables or failed N8N requests

3. Test the functionality to ensure the webhooks are working with authentication

## 5. Troubleshooting

If you encounter issues after deployment:

### Check Environment Variables

```bash
ssh -i your-key.pem ec2-user@your-aws-instance-ip
cd /path/to/your/app
pm2 env <app-id>  # Replace <app-id> with your PM2 app ID
```

Look for the `N8N_API_KEY` variable in the output.

### Check N8N Webhook Logs

Check the N8N logs for authentication errors:

1. Open your N8N instance
2. Go to the workflow with the webhook
3. Check the execution logs for any 401 Unauthorized errors

### Test the API Key Manually

```bash
# Test the voice-session webhook
curl -X POST https://n8n.lomeai.com/webhook/voice-session \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 908y345pqi3geroivMMuabdfkvaRLhsp9r8y32r028" \
  -d '{"session_token":"test","action":"test"}'

# Test the conversation-storage webhook
curl -X POST https://n8n.lomeai.com/webhook/conversation-storage \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 908y345pqi3geroivMMuabdfkvaRLhsp9r8y32r028" \
  -d '{"session_token":"test","action":"test"}'
```

## 6. Security Best Practices Reminder

1. **Never hardcode the API key** in your source code
2. **Use environment variables** for all sensitive credentials
3. **Rotate the API key periodically** for enhanced security
4. **Monitor for unauthorized access attempts** in your N8N logs
5. **Use HTTPS** for all communication between your backend and N8N
