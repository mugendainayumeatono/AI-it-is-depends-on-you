// ai_service.js

const aiService = {
  async generateDanmu(provider, apiKey, model, prompt) {
    if (provider === 'gemini') {
      return this.callGeminiAPI(apiKey, model, prompt);
    } else if (provider === 'gemini3') {
      return this.callGemini3API(apiKey, model, prompt);
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
    return this._fetchGemini(API_ENDPOINT, requestBody);
  },

  async callGemini3API(apiKey, model, prompt) {
    const API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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
    return this._fetchGemini(API_ENDPOINT, requestBody);
  },

  async _fetchGemini(endpoint, body) {
    const MAX_RETRIES = 3;
    const INITIAL_DELAY = 1000;

    let attempt = 0;
    while (attempt <= MAX_RETRIES) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (response.ok) {
          const data = await response.json();
          if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.length > 0) {
            return data.candidates[0].content.parts[0].text;
          } else {
            throw new Error('未能从 Gemini API 获取有效内容');
          }
        }

        // 处理错误
        if (response.status === 429 || response.status === 503) {
          // 模型超载或请求过多，需要重试
          attempt++;
          if (attempt > MAX_RETRIES) {
             const errorData = await response.json();
             throw new Error(errorData.error.message || `API 请求失败 (Status: ${response.status})`);
          }
          
          const delay = INITIAL_DELAY * Math.pow(2, attempt - 1); // 指数退避
          console.warn(`请求失败 (${response.status})，正在进行第 ${attempt} 次重试，等待 ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        } else {
          // 其他错误直接抛出
          const errorData = await response.json();
          throw new Error(errorData.error.message || 'API 请求失败');
        }

      } catch (error) {
        // 网络错误等也可能触发重试，或者直接抛出
        // 这里如果是 fetch 本身的异常（如断网），也可以选择重试，视情况而定
        // 为简单起见，如果是在重试循环内抛出的 Error (上面的 throw)，直接向外抛
        // 如果是 fetch 抛出的 TypeError (网络问题)，也可以尝试重试
        if (attempt < MAX_RETRIES && (error.name === 'TypeError' || error.message === 'Failed to fetch')) {
             attempt++;
             const delay = INITIAL_DELAY * Math.pow(2, attempt - 1);
             console.warn(`网络请求异常，正在进行第 ${attempt} 次重试，等待 ${delay}ms...`, error);
             await new Promise(resolve => setTimeout(resolve, delay));
             continue;
        }
        throw error;
      }
    }
  },

  async listAvailableModels(provider, apiKey) {
    if (provider === 'gemini') {
      return this.listGeminiModels(apiKey);
    } else if (provider === 'gemini3') {
      return this.listGemini3Models(apiKey);
    } else {
      throw new Error(`不支持的模型列表获取: ${provider}`);
    }
  },

  async listGeminiModels(apiKey) {
    const API_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
    return this._fetchModelList(API_ENDPOINT);
  },

  async listGemini3Models(apiKey) {
    const API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    return this._fetchModelList(API_ENDPOINT);
  },

  async _fetchModelList(endpoint) {
    const response = await fetch(endpoint);

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
      throw new Error('未找到可用的 API 模型');
    }
  }
};
