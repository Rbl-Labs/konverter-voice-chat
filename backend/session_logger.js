/**
 * Session Logger for Voice Chat Application
 * 
 * A simple logging utility that creates a new log file for each session
 * and persists logs for at least 48 hours.
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class SessionLogger {
    /**
     * Create a new SessionLogger instance
     * 
     * @param {Object} options - Logger configuration options
     * @param {string} options.sessionId - Unique session identifier
     * @param {string} options.userId - User identifier
     * @param {string} options.logDir - Directory to store logs (default: '/logs')
     * @param {boolean} options.consoleOutput - Whether to also log to console (default: true)
     * @param {string} options.logLevel - Minimum log level to record ('debug', 'info', 'warn', 'error')
     */
    constructor(options = {}) {
        this.sessionId = options.sessionId || 'unknown-session';
        this.userId = options.userId || 'unknown-user';
        this.logDir = options.logDir || '/logs';
        this.consoleOutput = options.consoleOutput !== false;
        this.logLevel = options.logLevel || 'info';
        
        // Create a safe filename from sessionId
        const safeSessionId = this.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        this.logFile = path.join(this.logDir, `session_${safeSessionId}_${timestamp}.log`);
        
        // Log levels and their numeric values for comparison
        this.logLevels = {
            'debug': 0,
            'info': 1,
            'warn': 2,
            'error': 3
        };
        
        // Initialize the logger
        this.init();
    }
    
    /**
     * Initialize the logger by creating the log directory if it doesn't exist
     */
    async init() {
        try {
            // Create log directory if it doesn't exist
            await fs.mkdir(this.logDir, { recursive: true });
            
            // Write initial log entry
            await this.info('Session logging initialized', { 
                sessionId: this.sessionId, 
                userId: this.userId,
                logFile: this.logFile,
                timestamp: new Date().toISOString()
            });
            
            return true;
        } catch (error) {
            if (this.consoleOutput) {
                console.error(`Failed to initialize logger: ${error.message}`);
            }
            return false;
        }
    }
    
    /**
     * Check if the given log level should be recorded based on the configured minimum level
     * 
     * @param {string} level - Log level to check
     * @returns {boolean} - Whether the log should be recorded
     */
    shouldLog(level) {
        return this.logLevels[level] >= this.logLevels[this.logLevel];
    }
    
    /**
     * Write a log entry to the log file and optionally to the console
     * 
     * @param {string} level - Log level ('debug', 'info', 'warn', 'error')
     * @param {string} message - Log message
     * @param {Object} data - Additional data to log
     */
    async log(level, message, data = null) {
        if (!this.shouldLog(level)) {
            return;
        }
        
        const timestamp = new Date().toISOString();
        const prefix = this.getPrefix(level);
        
        // Format the log entry
        const logEntry = {
            timestamp,
            level,
            sessionId: this.sessionId,
            userId: this.userId,
            message,
            data
        };
        
        // Write to console if enabled
        if (this.consoleOutput) {
            const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
            console[consoleMethod](`${prefix} [${timestamp}] ${message}`, data || '');
        }
        
        try {
            // Write to log file
            await fs.appendFile(
                this.logFile, 
                JSON.stringify(logEntry) + '\n'
            );
        } catch (error) {
            if (this.consoleOutput) {
                console.error(`Failed to write to log file: ${error.message}`);
            }
            
            // Try to write to a fallback location if the primary location fails
            try {
                const fallbackLogFile = path.join(os.tmpdir(), path.basename(this.logFile));
                await fs.appendFile(
                    fallbackLogFile, 
                    JSON.stringify(logEntry) + '\n'
                );
                
                if (this.consoleOutput) {
                    console.warn(`Log written to fallback location: ${fallbackLogFile}`);
                }
            } catch (fallbackError) {
                if (this.consoleOutput) {
                    console.error(`Failed to write to fallback log file: ${fallbackError.message}`);
                }
            }
        }
    }
    
    /**
     * Get the prefix for console logging based on the log level
     * 
     * @param {string} level - Log level
     * @returns {string} - Prefix for console logging
     */
    getPrefix(level) {
        switch (level) {
            case 'debug': return '🔍';
            case 'info': return '✅';
            case 'warn': return '⚠️';
            case 'error': return '❌';
            default: return '📝';
        }
    }
    
    /**
     * Log a debug message
     * 
     * @param {string} message - Log message
     * @param {Object} data - Additional data to log
     */
    async debug(message, data = null) {
        await this.log('debug', message, data);
    }
    
    /**
     * Log an info message
     * 
     * @param {string} message - Log message
     * @param {Object} data - Additional data to log
     */
    async info(message, data = null) {
        await this.log('info', message, data);
    }
    
    /**
     * Log a warning message
     * 
     * @param {string} message - Log message
     * @param {Object} data - Additional data to log
     */
    async warn(message, data = null) {
        await this.log('warn', message, data);
    }
    
    /**
     * Log an error message
     * 
     * @param {string} message - Log message
     * @param {Object} data - Additional data to log
     * @param {Error} error - Error object
     */
    async error(message, data = null, error = null) {
        const errorData = error ? {
            ...data,
            errorMessage: error.message,
            stack: error.stack,
            name: error.name
        } : data;
        
        await this.log('error', message, errorData);
    }
}

module.exports = SessionLogger;
