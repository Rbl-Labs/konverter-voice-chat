# Konverter Voice Chat - Documentation Index

## Overview

This directory contains comprehensive documentation for the Konverter Voice Chat project, a Telegram Mini App that enables real-time voice conversations with Google's Gemini 2.0 and 2.5 AI models through the Gemini Live API.

## Documentation Structure

### Core Documentation

1. **[GEMINI_LIVE_API_HANDBOOK.md](./GEMINI_LIVE_API_HANDBOOK.md)** - The definitive guide for understanding and implementing Google's Gemini Live API within our application. This handbook consolidates information from multiple sources into a single, structured reference that addresses both high-level concepts and practical implementation details.

2. **[GOOGLE_GENAI_SDK_GUIDE.md](./GOOGLE_GENAI_SDK_GUIDE.md)** - A comprehensive developer guide for working with the Google GenAI SDK for JavaScript, with particular focus on the Live API functionality essential for our Telegram voice chat application.

3. **[AUDIO_IMPLEMENTATION_DEEP_DIVE.md](./AUDIO_IMPLEMENTATION_DEEP_DIVE.md)** - A detailed technical exploration of our audio implementation, covering recording, processing, playback, and cross-platform compatibility challenges and solutions.

4. **[live_api.md](./live_api.md)** - A practical guide focused on implementing the Live API in a Telegram voice application, with code examples for establishing connections, sending and receiving text/audio, and advanced features.

5. **[gemini_liveapi_websocket.md](./gemini_liveapi_websocket.md)** - A detailed guide specifically for Telegram voice chats using WebSockets, with session lifecycle and message exchange, advanced configuration for voice chats, and workflow for Telegram integration.

6. **[reference_liveapi_websocket_genaisdk.md](./reference_liveapi_websocket_genaisdk.md)** - A comprehensive engineering reference that covers Google Live API overview and core concepts, WebSocket protocol details, and JavaScript/TypeScript SDK usage for Live API.

### Examples and Code Samples

1. **[google_example_2.5_function_calling_textvoice.py](./google_example_2.5_function_calling_textvoice.py)** - A Python example that demonstrates setting up a Live API connection, handling audio input/output, video/camera integration, and function calling.

### Project Documentation

1. **[README_CTO.md](../README_CTO.md)** - A comprehensive technical overview of the project, covering system architecture, components, data flow, and technical details.

2. **[TECHNICAL_ARCHITECTURE.md](../TECHNICAL_ARCHITECTURE.md)** - Visual diagrams and detailed explanations of the system architecture, data flow, component interactions, and more.

3. **[voice_chat_data_flow_analysis.md](../voice_chat_data_flow_analysis.md)** - Detailed Mermaid diagrams and analysis of the complete data flow from Telegram user interaction through the entire system, with sequence diagrams for each major step.

4. **[DEVELOPER_ONBOARDING.md](../DEVELOPER_ONBOARDING.md)** - A guide for new developers to understand the project structure, set up their development environment, and start contributing.

5. **[DOCUMENTATION_SUMMARY.md](../DOCUMENTATION_SUMMARY.md)** - A summary of all documentation created for the project, highlighting key insights and areas for improvement.

## How to Use This Documentation

### For New Team Members

1. Start with **DEVELOPER_ONBOARDING.md** to get a high-level overview of the project and set up your development environment.
2. Review **README_CTO.md** and **TECHNICAL_ARCHITECTURE.md** to understand the system architecture and components.
3. Study **voice_chat_data_flow_analysis.md** to understand the complete data flow from Telegram user interaction through the entire system.
4. Dive into **GEMINI_LIVE_API_HANDBOOK.md** to learn about the Gemini Live API and how it's implemented in our project.

### For Developers Working on Specific Components

1. **Frontend Developers**: Focus on the frontend implementation sections in **GEMINI_LIVE_API_HANDBOOK.md** and review the code examples in **live_api.md**.
2. **Backend Developers**: Study the WebSocket proxy implementation in **GEMINI_LIVE_API_HANDBOOK.md** and the WebSocket protocol details in **reference_liveapi_websocket_genaisdk.md**.
3. **n8n Workflow Developers**: Review the function calling examples in **GEMINI_LIVE_API_HANDBOOK.md** and the workflow documentation in **README_CTO.md**.

### For Troubleshooting

1. Check the "Troubleshooting & Best Practices" section in **GEMINI_LIVE_API_HANDBOOK.md**.
2. Review the code examples in **live_api.md** and **gemini_liveapi_websocket.md** for specific implementation details.
3. Consult the official documentation links provided in the "Additional Resources" section of **GEMINI_LIVE_API_HANDBOOK.md**.

## Documentation Maintenance

This documentation is maintained by the CTO and technical leads. If you find any issues or have suggestions for improvements, please contact the CTO or create a pull request with your proposed changes.

As the project evolves, this documentation will be updated to reflect the latest changes and improvements. Always refer to the most recent version of the documentation for the most accurate information.
