import type { GraphJSON } from '../types/index.js';

const DB_NAME = 'thinkcraft-lite';
const DB_VERSION = 1;
const STORE_NAME = 'graph-v1';
const STORAGE_KEY = 'graph-v1';

class PersistenceManager {
  private db: IDBDatabase | null = null;
  private saveTimeout: number | null = null;

  async initialize(): Promise<void> {
    try {
      this.db = await this.openIndexedDB();
    } catch (error) {
      console.warn('IndexedDB not available, falling back to localStorage:', error);
    }
  }

  private openIndexedDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }

  async saveGraph(graphJSON: GraphJSON): Promise<void> {
    // Debounce saves to avoid excessive writes
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = window.setTimeout(async () => {
      try {
        if (this.db) {
          await this.saveToIndexedDB(graphJSON);
        } else {
          this.saveToLocalStorage(graphJSON);
        }
      } catch (error) {
        console.error('Failed to save graph:', error);
        // Fallback to localStorage if IndexedDB fails
        this.saveToLocalStorage(graphJSON);
      }
    }, 800);
  }

  private async saveToIndexedDB(graphJSON: GraphJSON): Promise<void> {
    if (!this.db) throw new Error('IndexedDB not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const request = store.put({
        id: 'main',
        data: graphJSON,
        timestamp: Date.now(),
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private saveToLocalStorage(graphJSON: GraphJSON): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(graphJSON));
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
    }
  }

  async loadGraph(): Promise<GraphJSON | null> {
    try {
      if (this.db) {
        const result = await this.loadFromIndexedDB();
        if (result) return result;
      }
    } catch (error) {
      console.warn('Failed to load from IndexedDB, trying localStorage:', error);
    }

    return this.loadFromLocalStorage();
  }

  private async loadFromIndexedDB(): Promise<GraphJSON | null> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get('main');

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.data : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private loadFromLocalStorage(): GraphJSON | null {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Failed to load from localStorage:', error);
      return null;
    }
  }

  async clearStorage(): Promise<void> {
    try {
      if (this.db) {
        await this.clearIndexedDB();
      }
    } catch (error) {
      console.warn('Failed to clear IndexedDB:', error);
    }

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear localStorage:', error);
    }
  }

  private async clearIndexedDB(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Force immediate save (bypass debouncing)
  async forceSave(graphJSON: GraphJSON): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    try {
      if (this.db) {
        await this.saveToIndexedDB(graphJSON);
      } else {
        this.saveToLocalStorage(graphJSON);
      }
    } catch (error) {
      console.error('Failed to force save graph:', error);
      this.saveToLocalStorage(graphJSON);
    }
  }
}

// Export singleton instance
export const persistenceManager = new PersistenceManager();

// Export convenience functions
export const saveGraph = (graphJSON: GraphJSON) => persistenceManager.saveGraph(graphJSON);
export const loadGraph = () => persistenceManager.loadGraph();
export const clearStorage = () => persistenceManager.clearStorage();
export const forceSave = (graphJSON: GraphJSON) => persistenceManager.forceSave(graphJSON);
