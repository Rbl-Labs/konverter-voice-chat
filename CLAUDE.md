# Konverter Voice Chat - Project Documentation

## Project Overview

This is a professional voice chat Telegram mini app that leverages Google's Gemini Live API to provide real-time voice conversations with an AI assistant named Chloe. The system integrates Telegram Bot API, n8n automation workflows, and a WebSocket-based architecture for seamless voice communication.

## Core Architecture

### Technology Stack
- **Frontend**: Vanilla JavaScript, HTML5, CSS3, Web Audio API
- **Backend**: Node.js WebSocket proxy server
- **Automation**: n8n workflows for Telegram bot handling
- **AI**: Google Gemini 2.0/2.5 Live API
- **Deployment**: AWS (backend), GitHub Pages (frontend)
- **Process Management**: PM2

### Data Flow
1. User interacts with Telegram Mini App
2. Frontend captures voice/text input
3. WebSocket proxy forwards to Gemini Live API
4. n8n workflows handle session management and Telegram integration
5. AI responses streamed back through the same path

## Project Structure

### Active Development Directories

#### `/backend/` - Core Backend Server
- `gemini_websocket_proxy.js` - Main WebSocket server connecting frontend to Gemini Live API
- `deploy_to_aws.sh` - AWS deployment script
- `ecosystem.config.js` - PM2 process configuration
- `package.json` - Node.js dependencies

#### `/front_end/` - Main Frontend Application
- `voice_chat.html` - Primary voice chat interface
- `index.html` - Entry point and landing page
- `gemini_telegram_client.js` - Core Gemini API client
- `gemini_telegram_client_enhancement.js` - Extended client functionality
- `ui_controller.js` - UI state management and user interactions
- `advanced_audio_recorder.js` - Audio capture and processing
- `pcm_stream_player.js` - Audio playback for AI responses
- `telegram_audio_bridge.js` - Telegram integration bridge
- `audio_processor_worklet.js` - Web Audio API worklet for real-time processing
- `styles.css` - Main stylesheet

#### `/n8n/` - Automation Workflows
- `Telegram_Voice_Bot_Handler_Konverter.json` - Main Telegram bot workflow
- `Voice_Session_API.json` - Session management workflow
- `Gemini_TTS_Send_Email.json` - TTS and email functionality

#### `/documentation/` - Technical Documentation
- `GEMINI_LIVE_API_HANDBOOK.md` - Comprehensive Gemini Live API guide
- `AUDIO_IMPLEMENTATION_DEEP_DIVE.md` - Audio system architecture
- `live_api.md` - API integration details

### Legacy/Reference Directories
- `/aws_deployment_old/` - Previous deployment configurations
- `/dialogue-flow-agent/` - DialogFlow alternative implementation
- `/google_original_demo/` - Google's reference implementation
- `/previous_state/` - Backup of previous versions
- `/chatterbots/` - Alternative React-based implementation
- `/ui_revamp/` - UI improvement experiments

## Key Features

### Voice Processing
- Real-time audio capture using Web Audio API
- PCM 16-bit, 16kHz audio format for Gemini compatibility
- Audio worklet for low-latency processing
- Voice activity detection
- Echo cancellation and noise reduction

### Session Management
- Secure session tokens via n8n workflows
- User authentication through Telegram
- Session persistence and recovery
- Rate limiting and usage tracking

### UI/UX
- Responsive design for mobile and desktop
- Visual audio indicators and waveforms
- Text chat fallback
- Telegram Mini App integration
- Custom branding with Konverter assets

## Development Workflow

### Frontend Development
```bash
# Test locally
cd front_end
python3 -m http.server 8000

# Deploy to GitHub Pages
./deploy_to_github.sh
```

### Backend Development
```bash
# Local testing
cd backend
npm start

# Deploy to AWS
./deploy_to_aws.sh
```

### n8n Workflows
- Import JSON files into n8n instance
- Configure webhooks and API credentials
- Test workflows with Telegram bot commands

## Common Issues and Solutions

### Audio Problems
1. **No audio capture**: Check browser permissions and HTTPS requirements
2. **Audio quality issues**: Verify 16kHz PCM format in `advanced_audio_recorder.js`
3. **Playback delays**: Check WebSocket connection stability

### WebSocket Issues
1. **Connection failures**: Verify backend server status with PM2
2. **Authentication errors**: Check session tokens in n8n workflows
3. **Data corruption**: Inspect audio chunk encoding/decoding

### Deployment Issues
1. **AWS deployment**: Check EC2 instance status and security groups
2. **GitHub Pages**: Verify repository settings and branch configuration
3. **CORS errors**: Review backend CORS configuration

## Environment Variables

### Backend
- `GEMINI_API_KEY` - Google Gemini API key
- `PORT` - WebSocket server port (default: 8080)
- `NODE_ENV` - Environment (development/production)

### n8n Workflows
- `TELEGRAM_BOT_TOKEN` - Telegram bot authentication
- `N8N_WEBHOOK_URL` - n8n webhook endpoints
- `GEMINI_PROJECT_ID` - Google Cloud project ID

## Security Considerations

### API Security
- Secure API key management
- Rate limiting on endpoints
- Input validation and sanitization
- CORS policy enforcement

### User Privacy
- No persistent audio storage
- Session-based authentication
- Encrypted WebSocket communication
- GDPR compliance considerations

## Performance Optimization

### Frontend
- Audio worklet for real-time processing
- Efficient DOM manipulation
- Lazy loading of non-critical resources
- Service worker for caching (future enhancement)

### Backend
- WebSocket connection pooling
- Memory management for audio streams
- Efficient error handling and recovery
- PM2 cluster mode for scaling

## Testing Strategy

### Manual Testing
- Cross-browser compatibility (Chrome, Safari, Firefox)
- Mobile device testing (iOS, Android)
- Network condition testing (3G, WiFi, poor connectivity)
- Audio quality testing with different microphones

### Automated Testing (Future)
- Unit tests for core functions
- Integration tests for API endpoints
- End-to-end tests for user workflows
- Performance benchmarking

## Monitoring and Logging

### Current Logging
- PM2 process logs for backend
- Browser console logs for frontend
- n8n workflow execution logs

### Future Enhancements
- Structured logging with timestamps
- Error aggregation and alerting
- Performance metrics collection
- User analytics (privacy-compliant)

## Deployment Architecture

### Production Environment
- **Frontend**: GitHub Pages (HTTPS enabled)
- **Backend**: AWS EC2 with PM2 process management
- **Database**: n8n internal storage for workflows
- **Monitoring**: PM2 monitoring dashboard

### Development Environment
- Local HTTP server for frontend testing
- Local Node.js server for backend
- ngrok for webhook testing with n8n

## Contributing Guidelines

### Code Standards
- Use consistent indentation (2 spaces)
- Meaningful variable and function names
- Comprehensive error handling
- Documentation for complex functions

### Git Workflow (To Be Implemented)
- Feature branches from main
- Pull request reviews required
- Automated testing before merge
- Semantic versioning for releases

## Roadmap

### Short-term (Next 2 weeks)
- Fix frontend code overlaps and race conditions
- Implement proper CI/CD pipeline
- Improve error handling and user feedback

### Medium-term (1-2 months)
- Add text-to-speech for AI responses
- Implement conversation history
- Add user preferences and settings
- Performance optimization

### Long-term (3-6 months)
- Multi-language support
- Advanced AI conversation features
- Mobile app development
- Analytics and insights dashboard

## Contact and Support

For technical issues or questions:
- Review this documentation first
- Check GitHub issues for known problems
- Test with the latest version before reporting bugs
- Provide detailed reproduction steps and logs

## License and Usage

This project is proprietary to Konverter/Rbl-Labs. All rights reserved.