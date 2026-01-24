import { fileManager } from './file_manager.js';

document.addEventListener('DOMContentLoaded', async () => {
  const messageInput = document.getElementById('message');
  const sendButton = document.getElementById('sendButton');
  const aiGenerateButton = document.getElementById('aiGenerateButton');
  const settingsBtn = document.getElementById('settingsBtn');
  
  const apiKeyInput = document.getElementById('apiKey');
  const providerSelect = document.getElementById('providerSelect');
  const modelSelect = document.getElementById('modelSelect');
  const promptInput = document.getElementById('prompt');
  const statusDiv = document.getElementById('status');

  let apiKey = null;
  let selectedProvider = null;
  let selectedModel = null;
  let userPrompt = null;
  let isAutoSyncEnabled = false;

  // 设置按钮
  settingsBtn.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });

  // 填充服务商下拉列表
  config.aiProviders.forEach(provider => {
    const option = document.createElement('option');
    option.value = provider.value;
    option.textContent = provider.name;
    providerSelect.appendChild(option);
  });

  // --- 加载配置 ---
  async function loadConfiguration() {
    try {
      // 检查自动同步状态
      const syncState = await chrome.storage.sync.get('autoSyncEnabled');
      isAutoSyncEnabled = !!syncState.autoSyncEnabled;

      if (isAutoSyncEnabled) {
        const handle = await fileManager.getHandle();
        if (handle) {
          statusDiv.textContent = '正在从本地文件同步配置...';
          statusDiv.style.color = 'blue';
          
          try {
            const fileConfig = await fileManager.readFromFile();
            if (fileConfig) {
              // 更新本地变量
              apiKey = fileConfig.apiKey;
              selectedProvider = fileConfig.selectedProvider;
              selectedModel = fileConfig.selectedModel;
              userPrompt = fileConfig.userPrompt;

              // 同时更新存储以保持同步
              await chrome.storage.sync.set(fileConfig);

              statusDiv.textContent = '外部配置加载成功';
              statusDiv.style.color = 'green';
            }
          } catch (err) {
            if (err.message === 'NEED_PERMISSION') {
              statusDiv.textContent = '需要文件权限。请在设置页重新授权。';
            } else {
              statusDiv.textContent = '同步外部文件失败: ' + err.message;
            }
            statusDiv.style.color = 'red';
          }
        }
      } 
      
      // 从存储加载（可能是刚才从文件同步的，或者是标准存储）
      const result = await chrome.storage.sync.get(['apiKey', 'selectedProvider', 'selectedModel', 'userPrompt']);
      apiKey = result.apiKey;
      selectedProvider = result.selectedProvider;
      selectedModel = result.selectedModel;
      userPrompt = result.userPrompt;


      // 应用到 UI
      apiKeyInput.value = apiKey || '';
      providerSelect.value = selectedProvider || config.aiProviders[0].value;
      promptInput.value = userPrompt || config.prompt;
      
      // 加载模型
      if (apiKey) {
        populateModelsDropdown(providerSelect.value, apiKey, selectedModel);
      } else {
        populateModelsDropdown(providerSelect.value, null, null);
      }

    } catch (e) {
      console.error('加载配置出错:', e);
      statusDiv.textContent = '加载配置出错';
    }
  }

  await loadConfiguration();

  // --- 保存配置 ---
  async function saveConfiguration(updates) {
    // 更新本地变量
    if (updates.apiKey !== undefined) apiKey = updates.apiKey;
    if (updates.selectedProvider !== undefined) selectedProvider = updates.selectedProvider;
    if (updates.selectedModel !== undefined) selectedModel = updates.selectedModel;
    if (updates.userPrompt !== undefined) userPrompt = updates.userPrompt;

    // 首先保存到 Chrome 存储
    await chrome.storage.sync.set(updates);

    // 如果启用了自动同步，同时写入文件
    if (isAutoSyncEnabled) {
       try {
        const dataToSave = {
          apiKey: apiKey,
          selectedProvider: selectedProvider,
          selectedModel: selectedModel,
          userPrompt: userPrompt
        };
        await fileManager.writeToFile(dataToSave);
      } catch (err) {
        console.error('自动同步保存失败:', err);
        statusDiv.textContent = '自动保存到文件失败: ' + err.message;
        statusDiv.style.color = 'orange';
      }
    }
  }

  // --- 输入框事件监听 ---
  
  apiKeyInput.addEventListener('input', () => {
    saveConfiguration({ apiKey: apiKeyInput.value });
    if (apiKeyInput.value) {
      populateModelsDropdown(providerSelect.value, apiKeyInput.value, selectedModel);
    }
  });

  providerSelect.addEventListener('change', () => {
    saveConfiguration({ selectedProvider: providerSelect.value });
    populateModelsDropdown(providerSelect.value, apiKey, selectedModel);
  });
  
  modelSelect.addEventListener('change', () => {
    saveConfiguration({ selectedModel: modelSelect.value });
  });

  promptInput.addEventListener('input', () => {
    saveConfiguration({ userPrompt: promptInput.value });
  });

  // --- 辅助函数 ---

  async function populateModelsDropdown(provider, currentApiKey, currentSelectedModel) {
    if (!currentApiKey) {
      modelSelect.innerHTML = '';
      return;
    }

    statusDiv.textContent = '正在获取AI模型列表...';
    statusDiv.style.color = 'black';
    modelSelect.innerHTML = '';

    try {
      let models = [];
      if (provider === 'gemini' || provider === 'gemini3') {
        models = await aiService.listAvailableModels(provider, currentApiKey);
      }
      
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
          saveConfiguration({ selectedModel: models[0] });
        }
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
    if (!modelSelect.value) {
      statusDiv.textContent = '请选择一个AI模型！';
      statusDiv.style.color = 'red';
      return;
    }
    if (!promptInput.value) {
      statusDiv.textContent = '请输入AI提示词！';
      statusDiv.style.color = 'red';
      return;
    }

    statusDiv.textContent = 'AI正在生成弹幕...';
    statusDiv.style.color = 'black';
    messageInput.value = '';

    try {
      const response = await aiService.generateDanmu(selectedProvider, apiKey, modelSelect.value, promptInput.value);
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