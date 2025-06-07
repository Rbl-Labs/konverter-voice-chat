# Effective Log Commands for Debugging

## Getting Real-Time Logs

To see logs in real-time as they happen (useful for debugging while testing):

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "pm2 logs gemini-websocket-proxy --raw"
```

This will show logs as they happen. Press Ctrl+C to exit when done.

## Getting Recent Logs with Timestamps

To see the most recent logs with proper timestamps (last 200 lines):

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "pm2 logs gemini-websocket-proxy --lines 200 --timestamp"
```

## Getting Logs from a Specific Time Period

To see logs from the last 10 minutes:

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "cd /home/ubuntu/gemini-websocket-proxy && find logs -type f -mmin -10 -exec cat {} \;"
```

## Filtering Logs for Text Messages

To filter logs specifically for text message handling:

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "pm2 logs gemini-websocket-proxy --lines 500 --timestamp | grep -i 'text_input\|text message\|handleTextInput'"
```

## Viewing Error Logs Only

To see only error logs:

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "pm2 logs gemini-websocket-proxy --lines 200 --timestamp | grep -i 'error\|exception\|fail'"
```

## Saving Logs to a Local File for Analysis

To save logs to a local file for easier analysis:

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "pm2 logs gemini-websocket-proxy --lines 500 --timestamp" > ~/Documents/voice_chat/server_logs_$(date +%Y%m%d_%H%M%S).txt
```

## Checking PM2 Process Status

To check if the process is running correctly:

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "pm2 status"
```

## Viewing Log Files Directly

PM2 stores logs in specific files. To view them directly:

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "ls -la /home/ubuntu/.pm2/logs/"
```

And then to view a specific log file:

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "tail -n 200 /home/ubuntu/.pm2/logs/gemini-websocket-proxy-out.log"
```

For error logs:

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "tail -n 200 /home/ubuntu/.pm2/logs/gemini-websocket-proxy-error.log"
```

## Debugging User Messages in Chat

To specifically debug issues with user messages not appearing in chat, try these commands:

1. Check for text input handling in the logs:

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "pm2 logs gemini-websocket-proxy --lines 200 | grep -i 'text_input\|sendTextMessage\|handleTextInput'"
```

2. Check WebSocket connection status:

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "pm2 logs gemini-websocket-proxy --lines 200 | grep -i 'websocket\|connection\|connected'"
```

3. Check for any errors during message processing:

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "pm2 logs gemini-websocket-proxy --lines 200 | grep -i 'error\|cannot send\|failed'"
```

## Quick Temporary Solution for Better Logging

If you want to quickly add better logging for text messages without implementing a full logging system, you can modify the `handleTextInput` method in `gemini_websocket_proxy.js` on the server:

```bash
ssh -i /Users/mikrbl/Downloads/gemini-websocket-proxy.pem ubuntu@51.21.55.104 "sed -i 's/this.log(`\[DEBUG TEXT\] Processing text input: \"\${message.text}\"`);/this.log(`\[DEBUG TEXT\] Processing text input: \"\${message.text}\". isConnected=\${this.isConnected}, hasLiveSession=\${!!this.liveSession}`);/g' /home/ubuntu/gemini-websocket-proxy/gemini_websocket_proxy.js && pm2 restart gemini-websocket-proxy"
```

This command adds more detailed logging for text input processing and restarts the service.
