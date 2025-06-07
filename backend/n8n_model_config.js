// N8N Model Configuration Manager for Gemini Voice Interactions
class N8nModelConfig {
    static getVoiceConfig(modelVersion = '2.5', features = {}) {
        const baseConfig = {
            responseModalities: ['AUDIO'],  // We want audio output with text transcriptions
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: features.voice || 'Zephyr'
                    }
                }
            },
            realtimeInputConfig: {
                automaticActivityDetection: {
                    disabled: false,
                    startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
                    endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
                    prefixPaddingMs: 0,
                    silenceDurationMs: 0
                }
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            mediaResolution: "MEDIA_RESOLUTION_MEDIUM"
        };

        // Version-specific configurations
        if (modelVersion === '2.0') {
            return {
                ...baseConfig,
                model: 'gemini-2.0-flash-live-001',
                languageCode: features.languageCode || 'en-US',
                contextWindowCompression: {
                    triggerTokens: 32000,
                    slidingWindow: {
                        targetTokens: 32000
                    }
                },
                tools: this.getTools20(features)
            };
        } else {
            // Gemini 2.5
            return {
                ...baseConfig,
                model: 'gemini-2.5-flash-preview-native-audio-dialog',
                contextWindowCompression: {
                    triggerTokens: 25600,
                    slidingWindow: {
                        targetTokens: 12800
                    }
                },
                ...this.getFeatureConfig25(features)
            };
        }
    }

    static getTools20(features = {}) {
        const tools = [];

        if (features.functionCalling) {
            tools.push({
                functionDeclarations: features.functionDeclarations || [
                    {
                        name: "send_konverter_email",
                        description: "Send Konverter.ai company information email with PDF attachment to the user.",
                        behavior: "NON_BLOCKING",
                        parameters: {
                            type: "object",
                            properties: {
                                recipient_email: {
                                    type: "string",
                                    description: "Email address where to send Konverter.ai information"
                                }
                            },
                            required: ["recipient_email"]
                        }
                    }
                ]
            });
        }

        if (features.groundingWithGoogleSearch) {
            tools.push({ googleSearch: {} });
        }

        return tools;
    }

    static getFeatureConfig25(features = {}) {
        const config = {};

        // Rule 1: affectiveDialog
        if (features.affectiveDialog) {
            config.enableAffectiveDialog = true;
            config.proactivity = { proactiveAudio: false };
        }
        // Rule 2: proactiveAudio
        else if (features.proactiveAudio) {
            config.enableAffectiveDialog = false;
            config.proactivity = { proactiveAudio: true };
        }
        // Rule 3 & 4: functionCalling
        else if (features.functionCalling) {
            config.tools = {
                functionDeclarations: features.functionDeclarations || [
                    {
                        name: "send_konverter_email",
                        description: "Send Konverter.ai company information email with PDF attachment to the user.",
                        behavior: "NON_BLOCKING",
                        parameters: {
                            type: "object",
                            properties: {
                                recipient_email: {
                                    type: "string",
                                    description: "Email address where to send Konverter.ai information"
                                }
                            },
                            required: ["recipient_email"]
                        }
                    }
                ]
            };

            // Add Google Search if enabled and automatic function response is not
            if (features.groundingWithGoogleSearch && !features.automaticFunctionResponse) {
                config.tools.googleSearch = {};
            }
        }
        // Default case: just Google Search if enabled
        else if (features.groundingWithGoogleSearch) {
            config.tools = { googleSearch: {} };
        }

        return config;
    }

    static getWebsocketProxyConfig(sessionId, apiKey) {
        return {
            websocketProxyUrl: `wss://ws.lomeai.com:8003/ws?session=${sessionId}`,
            apiKey: apiKey
        };
    }

    // Example usage in n8n:
    static getN8nSessionConfig(sessionId, apiKey) {
        const modelConfig = this.getVoiceConfig('2.5', {
            affectiveDialog: true,
            groundingWithGoogleSearch: true,
            functionCalling: false,
            voice: 'Zephyr'
        });

        const proxyConfig = this.getWebsocketProxyConfig(sessionId, apiKey);

        return {
            success: true,
            sessionId,
            config: {
                ...proxyConfig,
                model: modelConfig.model,
                config: modelConfig
            }
        };
    }
}

module.exports = N8nModelConfig;
