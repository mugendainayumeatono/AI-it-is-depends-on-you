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

  // Settings Button
  settingsBtn.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });

  // Populate Provider Dropdown
  config.aiProviders.forEach(provider => {
    const option = document.createElement('option');
    option.value = provider.value;
    option.textContent = provider.name;
    providerSelect.appendChild(option);
  });

  // --- Load Configuration ---
  async function loadConfiguration() {
    try {
      // Check Auto-Sync status
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
              // Update local vars
              apiKey = fileConfig.apiKey;
              selectedProvider = fileConfig.selectedProvider;
              selectedModel = fileConfig.selectedModel;
              userPrompt = fileConfig.userPrompt;

              // Also update storage to keep them in sync
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
      
      // Load from Storage (either synced from file just now, or standard storage)
      const result = await chrome.storage.sync.get(['apiKey', 'selectedProvider', 'selectedModel', 'userPrompt']);
      apiKey = result.apiKey;
      selectedProvider = result.selectedProvider;
      selectedModel = result.selectedModel;
      userPrompt = result.userPrompt;


      // Apply to UI
      apiKeyInput.value = apiKey || '';
      providerSelect.value = selectedProvider || config.aiProviders[0].value;
      promptInput.value = userPrompt || config.prompt;
      
      // Load Models
      if (apiKey) {
        populateModelsDropdown(providerSelect.value, apiKey, selectedModel);
      } else {
        populateModelsDropdown(providerSelect.value, null, null);
      }

    } catch (e) {
      console.error('Load config error:', e);
      statusDiv.textContent = '加载配置出错';
    }
  }

  await loadConfiguration();

  // --- Save Configuration ---
  async function saveConfiguration(updates) {
    // Update local variables
    if (updates.apiKey !== undefined) apiKey = updates.apiKey;
    if (updates.selectedProvider !== undefined) selectedProvider = updates.selectedProvider;
    if (updates.selectedModel !== undefined) selectedModel = updates.selectedModel;
    if (updates.userPrompt !== undefined) userPrompt = updates.userPrompt;

    // Save to Chrome Storage first
    await chrome.storage.sync.set(updates);

    // If Auto-Sync is ON, also write to file
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
        console.error('Auto-sync save failed:', err);
        statusDiv.textContent = '自动保存到文件失败: ' + err.message;
        statusDiv.style.color = 'orange';
      }
    }
  }

  // --- Event Listeners for Inputs ---
  
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

  // --- Helper Functions ---

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