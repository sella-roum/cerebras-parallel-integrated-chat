// IndexedDBを使った永続化ストレージ

export interface Message {
  id: string;
  // ▼ 変更点： "system" を追加
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  conversationId: string;
  modelResponses?: ModelResponse[];
}

export interface ModelResponse {
  model: string;
  provider: string;
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  systemPrompt?: string;
}

// ApiKey インターフェースは削除

export interface ModelSettings {
  id: string;
  provider: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
}

export interface AppSettings {
  summarizerModel?: {
    provider: string;
    modelName: string;
    temperature: number;
    maxTokens: number;
  };
  integratorModel?: {
    provider: string;
    modelName: string;
    temperature: number;
    maxTokens: number;
  };
}

const DB_NAME = "multi-llm-chat";
const DB_VERSION = 1; // 既存のDBにカラムを追加する場合、バージョンを上げる必要があります

class Database {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Conversations store
        if (!db.objectStoreNames.contains("conversations")) {
          db.createObjectStore("conversations", { keyPath: "id" });
        }

        // Messages store
        if (!db.objectStoreNames.contains("messages")) {
          const messagesStore = db.createObjectStore("messages", { keyPath: "id" });
          messagesStore.createIndex("conversationId", "conversationId", { unique: false });
        }

        // API Keys store (削除)
        // if (db.objectStoreNames.contains("apiKeys")) {
        //   db.deleteObjectStore("apiKeys");
        // }

        // Model Settings store
        if (!db.objectStoreNames.contains("modelSettings")) {
          db.createObjectStore("modelSettings", { keyPath: "id" });
        }

        // App Settings store
        if (!db.objectStoreNames.contains("appSettings")) {
          db.createObjectStore("appSettings", { keyPath: "id" });
        }
      };
    });
  }

  // Conversations
  async getConversations(): Promise<Conversation[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["conversations"], "readonly");
      const store = transaction.objectStore("conversations");
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async createConversation(conversation: Conversation): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["conversations"], "readwrite");
      const store = transaction.objectStore("conversations");
      const request = store.add(conversation);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async updateConversation(conversation: Conversation): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["conversations"], "readwrite");
      const store = transaction.objectStore("conversations");
      const request = store.put(conversation);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async deleteConversation(id: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["conversations", "messages"], "readwrite");
      const conversationsStore = transaction.objectStore("conversations");
      const messagesStore = transaction.objectStore("messages");
      const index = messagesStore.index("conversationId");

      // Delete conversation
      conversationsStore.delete(id);

      // Delete all messages
      const request = index.openCursor(IDBKeyRange.only(id));
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          messagesStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Messages
  async getMessages(conversationId: string): Promise<Message[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["messages"], "readonly");
      const store = transaction.objectStore("messages");
      const index = store.index("conversationId");
      const request = index.getAll(conversationId);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async addMessage(message: Message): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["messages"], "readwrite");
      const store = transaction.objectStore("messages");
      const request = store.add(message);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // API Keys (関連メソッドをすべて削除)

  // Model Settings
  async getModelSettings(): Promise<ModelSettings[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["modelSettings"], "readonly");
      const store = transaction.objectStore("modelSettings");
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async saveModelSettings(settings: ModelSettings): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["modelSettings"], "readwrite");
      const store = transaction.objectStore("modelSettings");
      const request = store.put(settings);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async deleteModelSettings(id: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["modelSettings"], "readwrite");
      const store = transaction.objectStore("modelSettings");
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // App Settings
  async getAppSettings(): Promise<AppSettings | null> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["appSettings"], "readonly");
      const store = transaction.objectStore("appSettings");
      const request = store.get("main");

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async saveAppSettings(settings: AppSettings): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["appSettings"], "readwrite");
      const store = transaction.objectStore("appSettings");
      const request = store.put({ id: "main", ...settings });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 特定のメッセージID以降のメッセージ（そのIDを含む）を
   * 同じ会話IDからすべて削除します。
   */
  async deleteMessagesAfter(messageId: string, conversationId: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["messages"], "readwrite");
      const store = transaction.objectStore("messages");
      const index = store.index("conversationId");

      let foundStart = false;
      // 会話IDでカーソルを開く
      const request = index.openCursor(IDBKeyRange.only(conversationId));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          // メッセージIDが一致したら、それ以降の削除フラグを立てる
          // (messageIdは 'msg_${Date.now()}' で時系列ソート可能)
          if (cursor.primaryKey === messageId) {
            foundStart = true;
          }

          if (foundStart) {
            store.delete(cursor.primaryKey);
          }
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * 特定の会話IDのメッセージをすべて削除し、新しいメッセージ配列で置き換えます。
   */
  async replaceHistory(conversationId: string, newMessages: Message[]): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["messages"], "readwrite");
      const store = transaction.objectStore("messages");
      const index = store.index("conversationId");

      let addMessagesPromise: Promise<void> | null = null;

      // 1. 古いメッセージを全削除
      const request = index.openCursor(IDBKeyRange.only(conversationId));
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          // 2. 削除完了後、新しいメッセージを追加
          try {
            for (const msg of newMessages) {
              // 新しいメッセージの会話IDを強制
              store.add({ ...msg, conversationId });
            }
            addMessagesPromise = Promise.resolve();
          } catch (e) {
            addMessagesPromise = Promise.reject(e);
          }
        }
      };

      transaction.oncomplete = () => {
        if (addMessagesPromise) {
          addMessagesPromise.then(resolve).catch(reject);
        } else {
          // メッセージが0件だった場合など
          resolve();
        }
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

export const db = new Database();
