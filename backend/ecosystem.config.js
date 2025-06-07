module.exports = {
  apps: [{
    name: 'gemini-websocket-proxy',
    script: './gemini_websocket_proxy.js',
    instances: 1, // Single instance for WebSocket consistency
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 8003,
      HOST: '0.0.0.0'
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 8003,
      HOST: '0.0.0.0'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 4000
  }]
};
