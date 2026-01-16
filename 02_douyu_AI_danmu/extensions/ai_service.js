// ai_service.js

const aiService = {
  async generateDanmu(provider, apiKey, model) {
    const prompt = config.prompt; // 从 config.js 使用 prompt
    
    if (provider === 'gemini') {
      return this.callGeminiAPI(apiKey, model, prompt);
    }
    // 未来可以在此添加其他AI接口
    // else if (provider === 'openai') { ... }
    else {
      throw new Error(`不支持的AI接口: ${provider}`);
    }
  },

  async callGeminiAPI(apiKey, model, prompt) {
    const API_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;
    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ]
    };

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error.message || 'API 请求失败');
    }

    const data = await response.json();
    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.length > 0) {
      return data.candidates[0].content.parts[0].text;
    } else {
      throw new Error('未能从 Gemini API 获取有效内容');
    }
  },

  async listAvailableModels(apiKey) {
    const API_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
    const response = await fetch(API_ENDPOINT);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error.message || '获取模型列表失败');
    }

    const data = await response.json();
    if (data.models && data.models.length > 0) {
      // 筛选出支持'generateContent'的Gemini模型
      return data.models
        .filter(model => model.name.startsWith('models/gemini') && model.supportedGenerationMethods.includes('generateContent'))
        .map(model => model.name.replace('models/', ''));
    } else {
      throw new Error('未找到可用的 Gemini API 模型');
    }
  }
};
