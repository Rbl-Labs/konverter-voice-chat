// Import the ModelConfigFactory
const ModelConfigFactory = require('./model_config_factory');

// Update the initialize function to use factory
async function initializeGeminiSession(sessionId, config) {
    try {
        const { Modality } = await import('@google/generativeai');
        const modelName = config.model || 'gemini-2.5-flash-preview-native-audio-dialog';
        const isVersion25 = modelName.includes('2.5') || modelName.includes('native-audio-dialog');
        
        // Get default features based on model
        const defaultFeatures = ModelConfigFactory.getDefaultFeatures(modelName);
        
        // Merge with any custom features from config
        const features = {
            ...defaultFeatures,
            ...config.features || {},
            version: isVersion25 ? '2.5' : '2.0'
        };

        // Get model configuration using factory
        const modelConfig = ModelConfigFactory.getConfigByFeatures(
            features,
            Modality,
            config.customConfig || {}
        );

        // Initialize session with configuration
        const session = await genAI.live.connect({
            model: modelName,
            config: modelConfig,
            callbacks: {
                onOpen: () => console.log('Gemini connection opened'),
                onClose: (e) => console.log('Gemini connection closed:', e),
                onError: (e) => console.error('Gemini connection error:', e),
                onMessage: (msg) => handleGeminiMessage(msg, sessionId)
            }
        });

        // Store session for future reference
        activeSessions.set(sessionId, {
            geminiSession: session,
            config: modelConfig,
            features: features
        });

        return { success: true };
    } catch (error) {
        console.error('Failed to initialize Gemini session:', error);
        return { 
            success: false, 
            error: error.message,
            details: error.toString()
        };
    }
}
