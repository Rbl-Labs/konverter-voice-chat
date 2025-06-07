#!/bin/bash
# Enhanced deployment script for Telegram-optimized Gemini WebSocket Proxy

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
LOCAL_BACKEND_FILE="gemini_websocket_proxy.js"  # Now in the same directory
REMOTE_BACKEND_FILE="gemini_websocket_proxy.js"
SERVICE_NAME="gemini-websocket-proxy"
NGINX_SERVICE="nginx"

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

# Function to check if service is running
check_service_running() {
    local service=$1
    local status=$(ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" "systemctl is-active $service" 2>/dev/null)
    if [ "$status" = "active" ]; then
        echo -e "${GREEN}✓ $service is running${NC}"
        return 0
    else
        echo -e "${RED}✗ $service is not running${NC}"
        return 1
    fi
}

# Print banner
echo -e "${YELLOW}"
echo "  _____      _                                  _    _      _     _____            _          _____                     "
echo " |_   _|    | |                                | |  | |    | |   / ____|          | |        |  __ \                    "
echo "   | |  ____| | ___  __ _ _ __ __ _ _ __ ___   | |  | | ___| |__| (___   ___   ___| | _____  | |__) | __ _____  ___   _"
echo "   | | / _ \ |/ _ \/ _\` | '__/ _\` | '_ \` _ \  | |  | |/ _ \ '_ \\___ \ / _ \ / __| |/ / _ \ |  ___/ '__/ _ \ \/ / | | |"
echo "  _| ||  __/ |  __/ (_| | | | (_| | | | | | | | |__| |  __/ |_) |___) | (_) | (__|   <  __/ | |   | | | (_) >  <| |_| |"
echo " |_____\___|_|\___|\__, |_|  \__,_|_| |_| |_|  \____/ \___|_.__/_____/ \___/ \___|_|\_\___| |_|   |_|  \___/_/\_\\__, |"
echo "                     __/ |                                                                                         __/ |"
echo "                    |___/                                                                                         |___/ "
echo -e "${NC}"

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
echo -e "${YELLOW}You are about to deploy to:${NC}"
echo -e "  Server: ${GREEN}$SERVER_USER@$SERVER_IP${NC}"
echo -e "  Service: ${GREEN}$SERVICE_NAME${NC}"
echo -e "  Local file: ${GREEN}$LOCAL_BACKEND_FILE${NC}"
echo -e "  Remote file: ${GREEN}$REMOTE_DIR/$REMOTE_BACKEND_FILE${NC}"
echo -e "${YELLOW}Do you want to continue? (y/n)${NC}"
read -r response
if [[ ! "$response" =~ ^[Yy]$ ]]; then
    echo -e "${RED}Deployment cancelled${NC}"
    exit 0
fi

# Check connection to server
print_header "Checking Server Connection"
echo -e "${YELLOW}Testing connection to server...${NC}"
ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" "echo 'Connection successful'" &>/dev/null
check_status "Failed to connect to server. Check your SSH key and server details."
echo -e "${GREEN}Connection successful${NC}"

# Copy the backend file to the server
print_header "Deploying Backend File"
echo -e "${YELLOW}Copying backend file to server...${NC}"
scp -i "$SSH_KEY" "$LOCAL_BACKEND_FILE" "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/$REMOTE_BACKEND_FILE"
check_status "Failed to copy backend file to server"
echo -e "${GREEN}Backend file copied successfully${NC}"

# Restart the WebSocket proxy service
print_header "Restarting WebSocket Proxy Service"
echo -e "${YELLOW}Restarting $SERVICE_NAME service...${NC}"
ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" "sudo systemctl restart $SERVICE_NAME"
check_status "Failed to restart $SERVICE_NAME service"
echo -e "${GREEN}Service restarted successfully${NC}"

# Check if service is running
sleep 2
check_service_running "$SERVICE_NAME"
if [ $? -ne 0 ]; then
    echo -e "${RED}Warning: $SERVICE_NAME service may not have started correctly${NC}"
    echo -e "${YELLOW}Checking service status...${NC}"
    ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" "sudo systemctl status $SERVICE_NAME"
fi

# Restart Nginx proxy
print_header "Restarting Nginx Proxy"
echo -e "${YELLOW}Restarting $NGINX_SERVICE service...${NC}"
ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" "sudo systemctl restart $NGINX_SERVICE"
check_status "Failed to restart $NGINX_SERVICE service"
echo -e "${GREEN}Nginx proxy restarted successfully${NC}"

# Check if Nginx is running
sleep 1
check_service_running "$NGINX_SERVICE"

# Show logs
print_header "Service Logs"
echo -e "${YELLOW}Showing recent logs for $SERVICE_NAME...${NC}"
ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" "journalctl -u $SERVICE_NAME --since '5 minutes ago' --no-pager | tail -n 20"

# Verify external access
print_header "Verifying External Access"
echo -e "${YELLOW}Checking external access to WebSocket proxy...${NC}"
HEALTH_CHECK_URL="https://gemini-proxy.lomeai.com/health"
echo -e "${YELLOW}Sending request to $HEALTH_CHECK_URL...${NC}"
curl -s "$HEALTH_CHECK_URL" | grep -q "healthy"
if [ $? -eq 0 ]; then
    echo -e "${GREEN}External access verified successfully${NC}"
else
    echo -e "${RED}Warning: Could not verify external access${NC}"
    echo -e "${YELLOW}Manual verification recommended${NC}"
fi

print_header "Deployment Summary"
echo -e "${GREEN}✓ Backend file deployed${NC}"
echo -e "${GREEN}✓ WebSocket proxy service restarted${NC}"
echo -e "${GREEN}✓ Nginx proxy restarted${NC}"
echo -e "${GREEN}Deployment completed successfully!${NC}"

echo -e "\n${YELLOW}Useful Commands:${NC}"
echo -e "${BLUE}Check service status:${NC}"
echo -e "  ssh -i $SSH_KEY $SERVER_USER@$SERVER_IP \"sudo systemctl status $SERVICE_NAME\""
echo -e "${BLUE}View logs:${NC}"
echo -e "  ssh -i $SSH_KEY $SERVER_USER@$SERVER_IP \"journalctl -u $SERVICE_NAME --since '10 minutes ago' --no-pager\""
echo -e "${BLUE}Restart service:${NC}"
echo -e "  ssh -i $SSH_KEY $SERVER_USER@$SERVER_IP \"sudo systemctl restart $SERVICE_NAME\""

exit 0
