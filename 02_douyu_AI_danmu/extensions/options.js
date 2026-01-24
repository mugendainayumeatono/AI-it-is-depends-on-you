import { fileManager } from './file_manager.js';

document.addEventListener('DOMContentLoaded', async () => {
  const selectFileBtn = document.getElementById('selectFileBtn');
  const saveToFileBtn = document.getElementById('saveToFileBtn');
  const readFromFileBtn = document.getElementById('readFromFileBtn');
  const autoSyncCheckbox = document.getElementById('autoSyncCheckbox');
  const fileNameSpan = document.getElementById('fileName');
  const statusDiv = document.getElementById('status');

  let currentHandle = null;

  // Initialize
  await checkStoredHandle();
  await loadSyncState();

  // 1. Select File Button
  selectFileBtn.addEventListener('click', async () => {
    try {
      statusDiv.textContent = '正在选择文件...';
      statusDiv.style.color = 'blue';

      // Use showSaveFilePicker to allow creating new or picking existing
      const handle = await window.showSaveFilePicker({
        suggestedName: 'douyu_danmu_config.json',
        types: [{
          description: 'JSON Configuration File',
          accept: { 'application/json': ['.json'] },
        }],
      });

      await setFileHandle(handle);
      statusDiv.textContent = '文件已选择: ' + handle.name;
      statusDiv.style.color = 'green';
      
      // If auto-sync is on, try to read immediately (or write if empty?)
      // Let's just try to read.
      if (autoSyncCheckbox.checked) {
        await readFromFile();
      }

    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('File selection failed:', err);
        statusDiv.textContent = '文件选择失败: ' + err.message;
        statusDiv.style.color = 'red';
      } else {
        statusDiv.textContent = '操作已取消';
        statusDiv.style.color = 'gray';
      }
    }
  });

  // 2. Save Button (Export to File)
  saveToFileBtn.addEventListener('click', async () => {
    try {
      await saveToFile();
    } catch (err) {
      handleError(err, '保存失败');
    }
  });

  // 3. Read Button (Import from File)
  readFromFileBtn.addEventListener('click', async () => {
    try {
      await readFromFile();
    } catch (err) {
      handleError(err, '读取失败');
    }
  });

  // 4. Auto-Sync Checkbox
  autoSyncCheckbox.addEventListener('change', async () => {
    const isEnabled = autoSyncCheckbox.checked;
    await chrome.storage.sync.set({ 'autoSyncEnabled': isEnabled });
    
    if (isEnabled) {
      if (!currentHandle) {
        statusDiv.textContent = '请先选择一个文件！';
        statusDiv.style.color = 'red';
        autoSyncCheckbox.checked = false;
        await chrome.storage.sync.set({ 'autoSyncEnabled': false });
      } else {
        statusDiv.textContent = '自动同步已启用。';
        statusDiv.style.color = 'green';
        // Try to read immediately to sync state
        try {
           await readFromFile();
        } catch (e) {
           console.warn('Auto-sync initial read failed:', e);
           // Don't disable, just warn
        }
      }
    } else {
      statusDiv.textContent = '自动同步已禁用。';
      statusDiv.style.color = 'black';
    }
  });


  // --- Helper Functions ---

  async function checkStoredHandle() {
    try {
      const handle = await fileManager.getHandle();
      if (handle) {
        currentHandle = handle;
        fileNameSpan.textContent = handle.name;
        saveToFileBtn.disabled = false;
        readFromFileBtn.disabled = false;
        
        // Attempt auto-read if enabled
        const syncState = await chrome.storage.sync.get('autoSyncEnabled');
        if (syncState.autoSyncEnabled) {
             try {
                 await readFromFile(true); // silent mode
                 statusDiv.textContent = '已自动读取文件配置';
                 statusDiv.style.color = 'green';
             } catch (e) {
                 if (e.message === 'NEED_PERMISSION') {
                      statusDiv.textContent = '自动同步需要权限，请点击“从文件读取”或“保存到文件”来重新授权。';
                      statusDiv.style.color = 'orange';
                 }
             }
        }
      }
    } catch (err) {
      console.error('Error checking handle:', err);
    }
  }

  async function setFileHandle(handle) {
    currentHandle = handle;
    await fileManager.saveHandle(handle);
    fileNameSpan.textContent = handle.name;
    saveToFileBtn.disabled = false;
    readFromFileBtn.disabled = false;
  }

  async function loadSyncState() {
    const result = await chrome.storage.sync.get('autoSyncEnabled');
    autoSyncCheckbox.checked = !!result.autoSyncEnabled;
  }

  async function saveToFile() {
    if (!currentHandle) throw new Error('未选择文件');
    
    statusDiv.textContent = '正在保存...';
    
    // Get current config from storage
    const data = await chrome.storage.sync.get(['apiKey', 'userPrompt', 'selectedProvider', 'selectedModel']);
    const configToSave = {
      apiKey: data.apiKey || '',
      userPrompt: data.userPrompt || '',
      selectedProvider: data.selectedProvider || 'gemini',
      selectedModel: data.selectedModel || ''
    };

    await fileManager.writeToFile(configToSave);
    
    statusDiv.textContent = '保存成功！';
    statusDiv.style.color = 'green';
  }

  async function readFromFile(silent = false) {
    if (!currentHandle) throw new Error('未选择文件');

    if (!silent) statusDiv.textContent = '正在读取...';

    const config = await fileManager.readFromFile();
    if (config) {
      // Update Chrome Storage
      await chrome.storage.sync.set({
        apiKey: config.apiKey,
        userPrompt: config.userPrompt,
        selectedProvider: config.selectedProvider,
        selectedModel: config.selectedModel
      });
      
      if (!silent) {
        statusDiv.textContent = '读取成功！配置已更新。';
        statusDiv.style.color = 'green';
      }
    }
  }

  function handleError(err, prefix) {
    console.error(prefix, err);
    if (err.message === 'NEED_PERMISSION') {
      statusDiv.textContent = `${prefix}: 需要权限。请再次点击按钮并授予权限。`;
    } else {
      statusDiv.textContent = `${prefix}: ${err.message}`;
    }
    statusDiv.style.color = 'red';
  }
});