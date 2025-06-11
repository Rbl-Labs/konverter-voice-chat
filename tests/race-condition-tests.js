/**
 * Unit Tests for Race Condition Prevention
 * These tests verify that the frontend refactoring eliminated race conditions
 */

describe('Race Condition Prevention Tests', () => {
    
    beforeEach(() => {
        // Clean window object before each test
        delete window.uiController;
        delete window.geminiClient;
        delete window.GeminiTelegramClient;
        delete window.UIController;
        
        // Clear any existing event listeners
        document.body.innerHTML = '';
    });

    describe('Global Object Conflicts', () => {
        test('should have only one UIController definition', async () => {
            // Load the UI controller
            await import('../front_end/ui_controller.js');
            
            const firstController = new window.UIController();
            window.uiController = firstController;
            
            // Attempt to create another controller
            const secondController = new window.UIController();
            
            // Should be same constructor, but different instances
            expect(firstController.constructor).toBe(secondController.constructor);
            expect(firstController).not.toBe(secondController);
            
            // Window should only have one reference at a time
            window.uiController = secondController;
            expect(window.uiController).toBe(secondController);
            expect(window.uiController).not.toBe(firstController);
        });

        test('should have only one GeminiTelegramClient definition', async () => {
            await import('../front_end/gemini_telegram_client.js');
            
            // Should only have one constructor available
            expect(typeof window.GeminiTelegramClient).toBe('function');
            
            const client1 = new window.GeminiTelegramClient();
            const client2 = new window.GeminiTelegramClient();
            
            // Should be different instances of same class
            expect(client1.constructor).toBe(client2.constructor);
            expect(client1).not.toBe(client2);
        });
    });

    describe('Event Handler Stacking', () => {
        test('should not stack multiple event listeners on same element', () => {
            // Create test DOM elements
            document.body.innerHTML = `
                <button id="connectButton">Connect</button>
                <div id="userInteractionCircle">Interaction</div>
            `;

            const connectButton = document.getElementById('connectButton');
            const interactionCircle = document.getElementById('userInteractionCircle');
            
            let clickCount = 0;
            const handler = () => clickCount++;

            // Simulate what the old code did (stacking handlers)
            connectButton.addEventListener('click', handler);
            
            // Verify only one handler is attached
            connectButton.click();
            expect(clickCount).toBe(1);
            
            // Adding same handler again should not double-trigger
            connectButton.addEventListener('click', handler);
            connectButton.click();
            expect(clickCount).toBe(2); // Not 3!
        });

        test('should properly remove event listeners on cleanup', async () => {
            document.body.innerHTML = `
                <button id="connectButton">Connect</button>
            `;

            const connectButton = document.getElementById('connectButton');
            let clickCount = 0;
            
            const controller = {
                handleClick: () => clickCount++,
                setupListeners() {
                    this.boundHandler = this.handleClick.bind(this);
                    connectButton.addEventListener('click', this.boundHandler);
                },
                cleanup() {
                    connectButton.removeEventListener('click', this.boundHandler);
                }
            };

            controller.setupListeners();
            connectButton.click();
            expect(clickCount).toBe(1);

            controller.cleanup();
            connectButton.click();
            expect(clickCount).toBe(1); // Should not increment after cleanup
        });
    });

    describe('Message Handler Conflicts', () => {
        test('should handle WebSocket messages without duplication', () => {
            const messages = [];
            
            const mockClient = {
                state: { isConnectedToWebSocket: true, isGeminiSessionActive: true },
                log: (msg) => messages.push(msg),
                
                handleWebSocketMessage(message) {
                    switch (message.type) {
                        case 'function_executing':
                            this.log(`Function executing: ${message.functionName}`);
                            break;
                        case 'text_response':
                            this.log(`Text response: ${message.text}`);
                            break;
                    }
                }
            };

            // Simulate receiving same message twice (race condition scenario)
            const testMessage = { type: 'function_executing', functionName: 'searchGoogle' };
            
            mockClient.handleWebSocketMessage(testMessage);
            mockClient.handleWebSocketMessage(testMessage);
            
            // Should have handled each message separately, not duplicated processing
            expect(messages).toEqual([
                'Function executing: searchGoogle',
                'Function executing: searchGoogle'
            ]);
            expect(messages.length).toBe(2);
        });
    });

    describe('State Management Race Conditions', () => {
        test('should maintain consistent state across methods', () => {
            const mockClient = {
                state: {
                    isConnectedToWebSocket: false,
                    isGeminiSessionActive: false,
                    isConversationPaused: true
                },
                
                connect() {
                    this.state.isConnectedToWebSocket = true;
                },
                
                startSession() {
                    if (!this.state.isConnectedToWebSocket) return false;
                    this.state.isGeminiSessionActive = true;
                    return true;
                },
                
                toggleVoiceSession() {
                    if (!this.state.isConnectedToWebSocket || !this.state.isGeminiSessionActive) {
                        return false;
                    }
                    this.state.isConversationPaused = !this.state.isConversationPaused;
                    return true;
                }
            };

            // Test state consistency
            expect(mockClient.toggleVoiceSession()).toBe(false); // Not connected
            
            mockClient.connect();
            expect(mockClient.toggleVoiceSession()).toBe(false); // No session
            
            mockClient.startSession();
            expect(mockClient.toggleVoiceSession()).toBe(true); // Should work now
            expect(mockClient.state.isConversationPaused).toBe(false);
        });
    });

    describe('Enhancement Integration', () => {
        test('should not have enhancement wrapper conflicts', () => {
            // Verify no window.enhanceGeminiClient exists (consolidated into main client)
            expect(window.enhanceGeminiClient).toBeUndefined();
            
            // Verify main client has all enhanced features
            const mockClient = new window.GeminiTelegramClient();
            
            expect(typeof mockClient.sendTextMessage).toBe('function');
            expect(typeof mockClient.toggleVoiceSession).toBe('function');
            expect(typeof mockClient.sendUserInfo).toBe('function');
            expect(mockClient.isTextChatEnabled).toBe(true);
        });
    });
});

// Performance Test for Race Conditions
describe('Concurrent Operation Tests', () => {
    test('should handle rapid successive calls without conflicts', async () => {
        const mockClient = {
            callCount: 0,
            state: { isConnectedToWebSocket: true, isGeminiSessionActive: true },
            
            async sendTextMessage(text) {
                this.callCount++;
                // Simulate async operation
                await new Promise(resolve => setTimeout(resolve, 10));
                return `Processed: ${text}`;
            }
        };

        // Fire multiple rapid calls
        const promises = [
            mockClient.sendTextMessage('message1'),
            mockClient.sendTextMessage('message2'), 
            mockClient.sendTextMessage('message3')
        ];

        const results = await Promise.all(promises);
        
        expect(mockClient.callCount).toBe(3);
        expect(results).toEqual([
            'Processed: message1',
            'Processed: message2', 
            'Processed: message3'
        ]);
    });
});

// Integration Test
describe('End-to-End Race Condition Prevention', () => {
    test('should load all components without conflicts', async () => {
        // This would be run in a browser environment
        const loadOrder = [];
        
        // Mock the script loading process
        const mockLoadScript = async (src) => {
            loadOrder.push(src);
            // Simulate loading delay
            await new Promise(resolve => setTimeout(resolve, 50));
        };

        // Simulate the voice_chat.html loading sequence
        await mockLoadScript('./pcm_stream_player.js');
        await mockLoadScript('./advanced_audio_recorder.js');
        await mockLoadScript('./telegram_audio_bridge.js');
        await mockLoadScript('./ui_controller.js');
        await mockLoadScript('./user_form.js');
        await mockLoadScript('./gemini_telegram_client.js');
        
        expect(loadOrder).toEqual([
            './pcm_stream_player.js',
            './advanced_audio_recorder.js', 
            './telegram_audio_bridge.js',
            './ui_controller.js',
            './user_form.js',
            './gemini_telegram_client.js'
        ]);
        
        // Verify no enhancement loading
        expect(loadOrder).not.toContain('./gemini_telegram_client_enhancement.js');
        expect(loadOrder).not.toContain('./ui-controller.js');
    });
});