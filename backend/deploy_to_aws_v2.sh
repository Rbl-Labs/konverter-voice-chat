#!/bin/bash
# Enhanced deployment script with cache clearing and PM2 integration

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SSH_KEY="/Users/mikrbl/Downloads/gemini-websocket-proxy.pem"
SERVER_USER="ubuntu"
SERVER_IP="51.21.55.104"
REMOTE_DIR="/home/ubuntu/gemini-websocket-proxy"
LOCAL_BACKEND_FILE="gemini_websocket_proxy.js"
REMOTE_BACKEND_FILE="gemini_websocket_proxy.js"
SERVICE_NAME="gemini-websocket-proxy"

# Function to check if a command succeeded
check_status() {
    if [ $? -ne 0 ]; then
        echo -e "${RED}Error: $1${NC}"
        exit 1
    fi
}

# Function to print section header
print_header() {
    echo -e "\n${BLUE}=== $1 ===${NC}"
}

print_header "Deployment Preparation"

# Check if running from the correct directory
if [[ ! -f "$LOCAL_BACKEND_FILE" ]]; then
    echo -e "${RED}Error: Local backend file not found at $LOCAL_BACKEND_FILE${NC}"
    echo -e "${YELLOW}Make sure you're running this script from the backend directory${NC}"
    exit 1
fi

# Check if SSH key exists
if [ ! -f "$SSH_KEY" ]; then
    echo -e "${RED}Error: SSH key not found at $SSH_KEY${NC}"
    exit 1
fi

# Ask for confirmation
echo -e "${YELLOW}Enhanced deployment with cache clearing and PM2 to:${NC}"
echo -e "  Server: ${GREEN}$SERVER_USER@$SERVER_IP${NC}"
echo -e "  Service: ${GREEN}$SERVICE_NAME${NC}"
echo -e "${YELLOW}Do you want to continue? (y/n)${NC}"
read -r response
if [[ ! "$response" =~ ^[Yy]$ ]]; then
    echo -e "${RED}Deployment cancelled${NC}"
    exit 0
fi

print_header "Setting up deployment"

# Create remote deployment script
echo -e "${YELLOW}Creating remote deployment script...${NC}"
cat << 'EOF' > /tmp/remote_deploy.sh
#!/bin/bash

# Clear Node.js module cache
echo "Clearing Node.js module cache..."
find /home/ubuntu/gemini-websocket-proxy -name "*.node" -type f -delete
rm -rf /home/ubuntu/gemini-websocket-proxy/node_modules/.cache

# Verify PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

# Stop existing PM2 process
echo "Stopping existing PM2 process..."
pm2 stop gemini-websocket-proxy || true
pm2 delete gemini-websocket-proxy || true

# Install dependencies
echo "Installing dependencies..."
cd /home/ubuntu/gemini-websocket-proxy
npm install --production

# Start with PM2
echo "Starting with PM2..."
pm2 start ecosystem.config.js
pm2 save

# Verify service is running
sleep 5
if pm2 list | grep -q "gemini-websocket-proxy.*online"; then
    echo "Service started successfully"
else
    echo "Error: Service failed to start"
    exit 1
fi
EOF

# Copy deployment script to server
scp -i "$SSH_KEY" /tmp/remote_deploy.sh "$SERVER_USER@$SERVER_IP:/tmp/remote_deploy.sh"
check_status "Failed to copy deployment script"

# Make script executable
ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" "chmod +x /tmp/remote_deploy.sh"
check_status "Failed to make deployment script executable"

print_header "Deploying Files"

# Create backup of current version
echo -e "${YELLOW}Creating backup of current version...${NC}"
ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" "cp $REMOTE_DIR/$REMOTE_BACKEND_FILE $REMOTE_DIR/${REMOTE_BACKEND_FILE}.backup" || true

# Copy the backend file to the server
echo -e "${YELLOW}Copying backend file to server...${NC}"
scp -i "$SSH_KEY" "$LOCAL_BACKEND_FILE" "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/$REMOTE_BACKEND_FILE"
check_status "Failed to copy backend file"

# Copy ecosystem.config.js if not exists
scp -i "$SSH_KEY" "ecosystem.config.js" "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/ecosystem.config.js"

print_header "Executing Deployment"

# Run the remote deployment script
echo -e "${YELLOW}Executing remote deployment script...${NC}"
ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" "cd $REMOTE_DIR && /tmp/remote_deploy.sh"
check_status "Deployment script failed"

print_header "Verifying Deployment"

# Check service status
echo -e "${YELLOW}Checking service status...${NC}"
ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" "pm2 list | grep gemini-websocket-proxy"
check_status "Failed to get service status"

# Test health endpoint
echo -e "${YELLOW}Testing health endpoint...${NC}"
sleep 5
curl -s "https://gemini-proxy.lomeai.com/health" | grep -q "healthy"
if [ $? -eq 0 ]; then
    echo -e "${GREEN}Health check passed${NC}"
else
    echo -e "${RED}Warning: Health check failed${NC}"
fi

print_header "Deployment Complete"
echo -e "${GREEN}✓ Backup created${NC}"
echo -e "${GREEN}✓ Files deployed${NC}"
echo -e "${GREEN}✓ Cache cleared${NC}"
echo -e "${GREEN}✓ Service restarted with PM2${NC}"

echo -e "\n${YELLOW}Useful Commands:${NC}"
echo -e "${BLUE}Check PM2 status:${NC}"
echo -e "  ssh -i $SSH_KEY $SERVER_USER@$SERVER_IP \"pm2 list\""
echo -e "${BLUE}View logs:${NC}"
echo -e "  ssh -i $SSH_KEY $SERVER_USER@$SERVER_IP \"pm2 logs gemini-websocket-proxy\""
echo -e "${BLUE}Monitor:${NC}"
echo -e "  ssh -i $SSH_KEY $SERVER_USER@$SERVER_IP \"pm2 monit\""

# Cleanup
rm -f /tmp/remote_deploy.sh
ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" "rm -f /tmp/remote_deploy.sh"

exit 0
