#!/bin/bash
# Deployment script for Telegram Mini-App frontend to GitHub Pages

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
GITHUB_REPO="https://github.com/Rbl-Labs/konverter-voice-chat.git"
TEMP_DIR="/tmp/konverter-deploy-$(date +%s)"
BRANCH="main"

echo -e "${YELLOW}Starting deployment of Telegram Mini-App frontend to GitHub Pages...${NC}"

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo -e "${RED}Error: git is not installed${NC}"
    exit 1
fi

# Create temporary directory
mkdir -p "$TEMP_DIR"
cd "$TEMP_DIR" || exit 1

# Clone the repository
echo -e "${YELLOW}Cloning repository...${NC}"
git clone "$GITHUB_REPO" .

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to clone repository${NC}"
    exit 1
fi

# Copy frontend files
echo -e "${YELLOW}Copying frontend files...${NC}"
# Define the source directory for frontend files
FRONTEND_SOURCE_DIR="/Users/mikrbl/Documents/voice_chat/front_end"

cp -f "${FRONTEND_SOURCE_DIR}/index.html" .
cp -f "${FRONTEND_SOURCE_DIR}/text_chat.html" .
cp -f "${FRONTEND_SOURCE_DIR}/voice_chat.html" .
cp -f "${FRONTEND_SOURCE_DIR}/styles.css" .
cp -f "${FRONTEND_SOURCE_DIR}/gemini_telegram_client.js" .
cp -f "${FRONTEND_SOURCE_DIR}/telegram_audio_bridge.js" .
cp -f "${FRONTEND_SOURCE_DIR}/ui_controller.js" .
cp -f "${FRONTEND_SOURCE_DIR}/advanced_audio_recorder.js" .
cp -f "${FRONTEND_SOURCE_DIR}/audio_processor_worklet.js" .
cp -f "${FRONTEND_SOURCE_DIR}/pcm_stream_player.js" .

# Copy assets directory if it exists
if [ -d "${FRONTEND_SOURCE_DIR}/assets" ]; then
    echo -e "${YELLOW}Copying assets directory...${NC}"
    cp -r "${FRONTEND_SOURCE_DIR}/assets" .
else
    echo -e "${YELLOW}Assets directory not found, skipping.${NC}"
fi

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to copy frontend files${NC}"
    exit 1
fi

# Remove old client file that's no longer needed (if applicable, adjust if this is still relevant)
echo -e "${YELLOW}Checking for old client file (gemini_audio_chat_client.js)...${NC}"
if [ -f "gemini_audio_chat_client.js" ]; then
    echo -e "${YELLOW}Removing old gemini_audio_chat_client.js...${NC}"
    git rm gemini_audio_chat_client.js
    echo -e "${GREEN}Old client file removed from git tracking.${NC}"
else
    echo -e "${YELLOW}Old client file gemini_audio_chat_client.js not found in cloned repo, skipping removal.${NC}"
fi

# Add files to git
echo -e "${YELLOW}Adding files to git...${NC}"
git add index.html text_chat.html voice_chat.html styles.css gemini_telegram_client.js telegram_audio_bridge.js ui_controller.js advanced_audio_recorder.js audio_processor_worklet.js pcm_stream_player.js assets

# Commit changes
echo -e "${YELLOW}Committing changes...${NC}"
# Consider making this commit message more dynamic or generic
git commit -m "Deploy frontend updates"

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to commit changes${NC}"
    exit 1
fi

# Push changes
echo -e "${YELLOW}Pushing changes to GitHub...${NC}"
echo -e "${YELLOW}You may be prompted for your GitHub credentials${NC}"
git push origin "$BRANCH"

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to push changes to GitHub${NC}"
    exit 1
fi

echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${YELLOW}Your changes will be live at: https://rbl-labs.github.io/konverter-voice-chat/${NC}"

# Clean up
cd - > /dev/null
rm -rf "$TEMP_DIR"

exit 0
