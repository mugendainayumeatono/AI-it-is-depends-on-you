document.addEventListener('DOMContentLoaded', async () => {
  const messageInput = document.getElementById('message');
  const sendButton = document.getElementById('sendButton');
  const aiGenerateButton = document.getElementById('aiGenerateButton');
  const apiKeyInput = document.getElementById('apiKey');
  const providerSelect = document.getElementById('providerSelect');
  const modelSelect = document.getElementById('modelSelect');
  const promptInput = document.getElementById('prompt');
  const statusDiv = document.getElementById('status');

  let apiKey = null;
  let selectedProvider = null;
  let selectedModel = null;
  let userPrompt = null;

  // 从配置填充接口下拉菜单
  config.aiProviders.forEach(provider => {
    const option = document.createElement('option');
    option.value = provider.value;
    option.textContent = provider.name;
    providerSelect.appendChild(option);
  });

  // 从存储加载已保存的设置
  const result = await chrome.storage.sync.get(['apiKey', 'selectedProvider', 'selectedModel', 'userPrompt']);
  apiKey = result.apiKey;
  apiKeyInput.value = apiKey || '';
  selectedProvider = result.selectedProvider || config.aiProviders[0].value;
  providerSelect.value = selectedProvider;
  selectedModel = result.selectedModel;
  userPrompt = result.userPrompt || config.prompt;
  promptInput.value = userPrompt;


  // 当设置更改时保存到存储
  apiKeyInput.addEventListener('input', () => {
    apiKey = apiKeyInput.value;
    chrome.storage.sync.set({ apiKey: apiKey });
    // 如果API密钥更改，则重新加载模型
    if (apiKey) {
      populateModelsDropdown(selectedProvider, apiKey, selectedModel);
    }
  });

  providerSelect.addEventListener('change', () => {
    selectedProvider = providerSelect.value;
    chrome.storage.sync.set({ selectedProvider: selectedProvider });
    // 当接口更改时重新加载模型
    populateModelsDropdown(selectedProvider, apiKey, selectedModel);
  });
  
  modelSelect.addEventListener('change', () => {
    selectedModel = modelSelect.value;
    chrome.storage.sync.set({ selectedModel: selectedModel });
  });

  promptInput.addEventListener('input', () => {
    userPrompt = promptInput.value;
    chrome.storage.sync.set({ userPrompt: userPrompt });
  });

  // 填充模型下拉菜单的函数
  async function populateModelsDropdown(provider, apiKey, currentSelectedModel) {
    if (!apiKey) {
      statusDiv.textContent = '请输入API密钥以获取模型列表。';
      statusDiv.style.color = 'red';
      modelSelect.innerHTML = '';
      return;
    }

    statusDiv.textContent = '正在获取AI模型列表...';
    statusDiv.style.color = 'black';
    modelSelect.innerHTML = '';

    try {
      let models = [];
      if (provider === 'gemini' || provider === 'gemini3') {
        models = await aiService.listAvailableModels(provider, apiKey);
      } // 未来在此处添加其他接口
      
      if (models.length > 0) {
        models.forEach(model => {
          const option = document.createElement('option');
          option.value = model;
          option.textContent = model;
          modelSelect.appendChild(option);
        });

        if (currentSelectedModel && models.includes(currentSelectedModel)) {
          modelSelect.value = currentSelectedModel;
        } else {
          modelSelect.value = models[0];
          chrome.storage.sync.set({ selectedModel: models[0] });
        }
        selectedModel = modelSelect.value;

        statusDiv.textContent = '模型列表加载成功。';
        statusDiv.style.color = 'green';
      } else {
        statusDiv.textContent = '沒有可用的AI模型，请检查API密钥或权限。';
        statusDiv.style.color = 'red';
      }
    } catch (error) {
      console.error('获取AI模型列表失败:', error);
      statusDiv.textContent = `获取AI模型列表失败: ${error.message}`;
      statusDiv.style.color = 'red';
    }
  }

  // 初始化填充模型下拉菜单
  populateModelsDropdown(selectedProvider, apiKey, selectedModel);

  sendButton.addEventListener('click', () => {
    const message = messageInput.value;
    if (message) {
      console.log('即将发送弹幕:', message);
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'sendMessage',
          message: message
        }, (response) => {
          if (response && response.status === "success") {
            statusDiv.textContent = '弹幕发送成功！';
            statusDiv.style.color = 'green';
          } else {
            statusDiv.textContent = `弹幕发送失败: ${response.message || '未知错误'}`;
            statusDiv.style.color = 'red';
          }
        });
      });
    }
  });

  aiGenerateButton.addEventListener('click', async () => {
    if (!apiKey) {
      statusDiv.textContent = '请输入API密钥！';
      statusDiv.style.color = 'red';
      return;
    }
    if (!selectedProvider) {
      statusDiv.textContent = '请选择一个AI接口！';
      statusDiv.style.color = 'red';
      return;
    }
    if (!selectedModel) {
      statusDiv.textContent = '请选择一个AI模型！';
      statusDiv.style.color = 'red';
      return;
    }
    if (!userPrompt) {
      statusDiv.textContent = '请输入AI提示词！';
      statusDiv.style.color = 'red';
      return;
    }

    statusDiv.textContent = 'AI正在生成弹幕...';
    statusDiv.style.color = 'black';
    messageInput.value = '';

    try {
      const response = await aiService.generateDanmu(selectedProvider, apiKey, selectedModel, userPrompt);
      messageInput.value = response;
      statusDiv.textContent = '弹幕生成成功！';
      statusDiv.style.color = 'green';
    } catch (error) {
      console.error('AI生成弹幕失败:', error);
      statusDiv.textContent = `AI生成弹幕失败: ${error.message}`;
      statusDiv.style.color = 'red';
    }
  });
});