const DB_NAME = 'DouyuDanmuDB';
const STORE_NAME = 'fileHandles';
const HANDLE_KEY = 'configFileHandle';

export const fileManager = {
  // Initialize DB
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

  // Save handle to IndexedDB
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

  // Get handle from IndexedDB
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

  // Remove handle from IndexedDB
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

  // Write content to the file handle
  async writeToFile(content) {
    const handle = await this.getHandle();
    if (!handle) throw new Error('No file handle found');
    
    // Verify permission
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) !== 'granted') {
      if ((await handle.requestPermission(opts)) !== 'granted') {
        throw new Error('Permission denied');
      }
    }

    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(content, null, 2));
    await writable.close();
  },

  // Read content from the file handle
  async readFromFile() {
    const handle = await this.getHandle();
    if (!handle) return null;

    // Verify permission
    const opts = { mode: 'read' };
    // Note: Requesting permission requires a user gesture. 
    // If called during initialization without gesture, this might fail or require handling.
    if ((await handle.queryPermission(opts)) !== 'granted') {
       // We cannot request permission automatically on load. 
       // The caller must handle the 'prompt' state or UI.
       throw new Error('NEED_PERMISSION'); 
    }

    const file = await handle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  }
};
