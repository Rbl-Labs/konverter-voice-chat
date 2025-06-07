# Deployment Configuration

## Required GitHub Secrets

To enable automated deployment, add the following secrets in your GitHub repository settings (Settings > Secrets and variables > Actions):

### AWS Deployment Secrets

1. **AWS_PRIVATE_KEY**: The contents of your AWS EC2 private key file
   - Copy the entire contents of `/Users/mikrbl/Downloads/gemini-websocket-proxy.pem`
   - This should start with `-----BEGIN PRIVATE KEY-----` and end with `-----END PRIVATE KEY-----`

2. **AWS_HOST**: The IP address of your AWS EC2 instance
   - Value: `51.21.55.104`

3. **AWS_USER**: The username for SSH connection to AWS EC2
   - Value: `ubuntu`

## GitHub Pages Configuration

The frontend will be automatically deployed to GitHub Pages using the `gh-pages` branch. Ensure that:

1. GitHub Pages is enabled in repository settings
2. Source is set to "Deploy from a branch"
3. Branch is set to `gh-pages`

## Backend Deployment Details

The workflow will:
1. Create a backup of the current deployment
2. Upload and extract the new backend code
3. Install production dependencies
4. Start/restart the service using PM2
5. Verify the deployment was successful

## Local Testing Commands

Before pushing to main, you can test locally:

```bash
# Test backend locally
cd backend
npm install
npm start

# Test frontend locally
cd front_end
python3 -m http.server 8000
```

## Manual Deployment (Fallback)

If automated deployment fails, you can deploy manually:

### Frontend
```bash
cd front_end
./deploy_to_github.sh
```

### Backend
```bash
cd backend
./deploy_to_aws.sh
```

## Monitoring and Logs

After deployment, check logs:
```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "pm2 logs gemini-websocket-proxy --lines 100"
```

## Rollback Procedure

If deployment fails and you need to rollback:

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 << 'EOF'
# List available backups
ls -la /opt/backups/

# Restore from backup (replace with actual backup name)
sudo rm -rf /opt/konverter-voice-chat
sudo cp -r /opt/backups/konverter-voice-chat-YYYYMMDD-HHMMSS /opt/konverter-voice-chat
sudo chown -R ubuntu:ubuntu /opt/konverter-voice-chat

# Restart service
cd /opt/konverter-voice-chat
pm2 restart gemini-websocket-proxy
EOF
```