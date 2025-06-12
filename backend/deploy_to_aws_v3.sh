#!/bin/bash

# ASCII Art Banner
echo "_____      _                                  _    _      _     _____            _          _____"
echo " |_   _|    | |                                | |  | |    | |   / ____|          | |        |  __ \\"
echo "   | |  ____| | ___  __ _ _ __ __ _ _ __ ___   | |  | | ___| |__| (___   ___   ___| | _____  | |__) | __ _____  ___   _"
echo "   | | / _ \\ |/ _ \\/ _\` | '__/ _\` | '_ \` _ \\  | |  | |/ _ \\ '_ \\___ \\ / _ \\ / __| |/ / _ \\ |  ___/ '__/ _ \\ \\/ / | | |"
echo "  _| ||  __/ |  __/ (_| | | | (_| | | | | | | | |__| |  __/ |_) |___) | (_) | (__|   <  __/ | |   | | | (_) >  <| |_| |"
echo " |_____\\___|_|\\___|\\__, |_|  \\__,_|_| |_| |_|  \\____/ \\___|_.__/_____/ \\___/ \\___|_|\\_\\___| |_|   |_|  \\___/_/\\_\\__, |"
echo "                     __/ |                                                                                         __/ |"
echo "                    |___/                                                                                         |___/"
echo ""
echo ""

# Configuration
SERVER="ubuntu@51.21.55.104"
PEM_FILE="/Users/mikrbl/Documents/voice-chat-lomeai/notforgithub/gemini-websocket-proxy.pem"
REMOTE_DIR="/home/ubuntu/gemini-websocket-proxy"
SERVICE_NAME="gemini-websocket-proxy"
LOCAL_JS_FILE="gemini_websocket_proxy.js"
LOCAL_ENV_FILE=".env"
REMOTE_JS_FILE="${REMOTE_DIR}/gemini_websocket_proxy.js"
REMOTE_ENV_FILE="${REMOTE_DIR}/.env"

# Deployment Preparation
echo "=== Deployment Preparation ==="
echo "You are about to deploy to:"
echo "  Server: ${SERVER}"
echo "  Service: ${SERVICE_NAME}"
echo "  Local files: ${LOCAL_JS_FILE} and ${LOCAL_ENV_FILE}"
echo "  Remote files: ${REMOTE_JS_FILE} and ${REMOTE_ENV_FILE}"
read -p "Do you want to continue? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 1
fi

# Upload files
echo "=== Uploading Files ==="
echo "Uploading ${LOCAL_JS_FILE}..."
scp -i "${PEM_FILE}" "${LOCAL_JS_FILE}" "${SERVER}:${REMOTE_JS_FILE}"
if [ $? -ne 0 ]; then
    echo "Error uploading ${LOCAL_JS_FILE}. Deployment failed."
    exit 1
fi
echo "${LOCAL_JS_FILE} uploaded successfully."

echo "Uploading ${LOCAL_ENV_FILE}..."
scp -i "${PEM_FILE}" "${LOCAL_ENV_FILE}" "${SERVER}:${REMOTE_ENV_FILE}"
if [ $? -ne 0 ]; then
    echo "Error uploading ${LOCAL_ENV_FILE}. Deployment failed."
    exit 1
fi
echo "${LOCAL_ENV_FILE} uploaded successfully."

# Restart service
echo "=== Restarting Service ==="
ssh -i "${PEM_FILE}" "${SERVER}" "cd ${REMOTE_DIR} && \
    echo 'Stopping service...' && \
    pm2 stop ${SERVICE_NAME} && \
    echo 'Service stopped' && \
    echo 'Starting service...' && \
    pm2 start ${SERVICE_NAME} && \
    echo 'Service started' && \
    echo 'Checking health status...' && \
    sleep 2 && \
    curl http://localhost:8003/health"

if [ $? -ne 0 ]; then
    echo "Error restarting service. Please check the server logs."
    exit 1
fi

echo ""
echo "=== Deployment Complete ==="
echo "The ${SERVICE_NAME} service has been updated and restarted."
echo "You can check the logs with: ssh -i ${PEM_FILE} ${SERVER} 'pm2 logs ${SERVICE_NAME}'"
