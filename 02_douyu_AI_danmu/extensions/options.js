import { fileManager } from './file_manager.js';

document.addEventListener('DOMContentLoaded', async () => {
  const selectFileBtn = document.getElementById('selectFileBtn');
  const saveToFileBtn = document.getElementById('saveToFileBtn');
  const readFromFileBtn = document.getElementById('readFromFileBtn');
  const autoSyncCheckbox = document.getElementById('autoSyncCheckbox');
  const fileNameSpan = document.getElementById('fileName');
  const statusDiv = document.getElementById('status');

  let currentHandle = null;

  // 初始化
  await checkStoredHandle();
  await loadSyncState();

  // 1. 选择文件按钮
  selectFileBtn.addEventListener('click', async () => {
    try {
      statusDiv.textContent = '正在选择文件...';
      statusDiv.style.color = 'blue';

      // 使用 showOpenFilePicker 以避免“是否覆盖？”提示和“保存”标题。
      // 这仅用于选择 现有 文件。
      const handles = await window.showOpenFilePicker({
        types: [{
          description: 'JSON Configuration File',
          accept: { 'application/json': ['.json'] },
        }],
        multiple: false
      });
      
      const handle = handles[0];
      await setFileHandle(handle);
      
      statusDiv.textContent = '文件已选择: ' + handle.name + '。请点击“从文件读取”或“保存到文件”进行操作。';
      statusDiv.style.color = 'green';

    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('文件选择失败:', err);
        statusDiv.textContent = '文件选择失败: ' + err.message;
        statusDiv.style.color = 'red';
      } else {
        statusDiv.textContent = '操作已取消';
        statusDiv.style.color = 'gray';
      }
    }
  });

  // 2. 保存按钮（导出到文件）
  saveToFileBtn.addEventListener('click', async () => {
    try {
      // 如果未选择文件，则此操作相当于“另存为” / “新建”
      if (!currentHandle) {
         try {
            const handle = await window.showSaveFilePicker({
                suggestedName: 'douyu_danmu_config.json',
                types: [{
                  description: 'JSON Configuration File',
                  accept: { 'application/json': ['.json'] },
                }],
            });
            await setFileHandle(handle);
         } catch (e) {
             if (e.name === 'AbortError') return; // 用户取消了创建
             throw e;
         }
      }
      
      await saveToFile();
    } catch (err) {
      handleError(err, '保存失败');
    }
  });

  // 3. 读取按钮（从文件导入）
  readFromFileBtn.addEventListener('click', async () => {
    try {
      await readFromFile();
    } catch (err) {
      handleError(err, '读取失败');
    }
  });

  // 4. 自动同步复选框
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
        // 尝试立即读取以同步状态
        try {
           await readFromFile();
        } catch (e) {
           console.warn('自动同步初始读取失败:', e);
           // 不禁用，仅警告
        }
      }
    } else {
      statusDiv.textContent = '自动同步已禁用。';
      statusDiv.style.color = 'black';
    }
  });


  // --- 辅助函数 ---

  async function checkStoredHandle() {
    try {
      const handle = await fileManager.getHandle();
      if (handle) {
        currentHandle = handle;
        fileNameSpan.textContent = handle.name;
        saveToFileBtn.disabled = false;
        readFromFileBtn.disabled = false;
        
        // 如果启用了自动同步，尝试自动读取
        const syncState = await chrome.storage.sync.get('autoSyncEnabled');
        if (syncState.autoSyncEnabled) {
             try {
                 await readFromFile(true); // 静默模式
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
      console.error('检查句柄出错:', err);
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
    if (!currentHandle) throw new Error('未选择文件'); // 虽然调用者已处理，但为了安全起见保留
    
    statusDiv.textContent = '正在保存...';
    
    // 从存储获取当前配置
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
      // 更新 Chrome 存储
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