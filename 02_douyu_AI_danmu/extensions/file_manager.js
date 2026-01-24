const DB_NAME = 'DouyuDanmuDB';
const STORE_NAME = 'fileHandles';
const HANDLE_KEY = 'configFileHandle';

export const fileManager = {
  // 初始化数据库
  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    });
  },

  // 将句柄保存到 IndexedDB
  async saveHandle(handle) {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(handle, HANDLE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  // 从 IndexedDB 获取句柄
  async getHandle() {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(HANDLE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  // 从 IndexedDB 移除句柄
  async clearHandle() {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(HANDLE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  // 将内容写入文件句柄
  async writeToFile(content) {
    const handle = await this.getHandle();
    if (!handle) throw new Error('未找到文件句柄');
    
    // 验证权限
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) !== 'granted') {
      if ((await handle.requestPermission(opts)) !== 'granted') {
        throw new Error('权限被拒绝');
      }
    }

    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(content, null, 2));
    await writable.close();
  },

  // 从文件句柄读取内容
  async readFromFile() {
    const handle = await this.getHandle();
    if (!handle) return null;

    // 验证权限
    const opts = { mode: 'read' };
    // 注意：请求权限需要用户手势。
    // 如果在没有用户手势的情况下在初始化期间调用，可能会失败或需要特殊处理。
    if ((await handle.queryPermission(opts)) !== 'granted') {
       // 我们无法在加载时自动请求权限。
       // 调用者必须处理“提示”状态或 UI。
       throw new Error('NEED_PERMISSION'); 
    }

    const file = await handle.getFile();
    const text = await file.text();
    if (!text.trim()) return null;
    
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error('解析配置文件失败:', e);
      return null;
    }
  }
};
