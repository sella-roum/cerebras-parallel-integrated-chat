// IndexedDBを使った永続化ストレージ

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: number
  conversationId: string
  modelResponses?: ModelResponse[]
}

export interface ModelResponse {
  model: string
  provider: string
  content: string
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface ApiKey {
  id: string
  provider: string
  key: string
}

export interface ModelSettings {
  id: string
  provider: string
  modelName: string
  temperature: number
  maxTokens: number
  enabled: boolean
}

export interface AppSettings {
  summarizerModel?: {
    provider: string
    modelName: string
    temperature: number
    maxTokens: number
  }
  integratorModel?: {
    provider: string
    modelName: string
    temperature: number
    maxTokens: number
  }
}

const DB_NAME = "multi-llm-chat"
const DB_VERSION = 1

class Database {
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Conversations store
        if (!db.objectStoreNames.contains("conversations")) {
          db.createObjectStore("conversations", { keyPath: "id" })
        }

        // Messages store
        if (!db.objectStoreNames.contains("messages")) {
          const messagesStore = db.createObjectStore("messages", { keyPath: "id" })
          messagesStore.createIndex("conversationId", "conversationId", { unique: false })
        }

        // API Keys store
        if (!db.objectStoreNames.contains("apiKeys")) {
          db.createObjectStore("apiKeys", { keyPath: "id" })
        }

        // Model Settings store
        if (!db.objectStoreNames.contains("modelSettings")) {
          db.createObjectStore("modelSettings", { keyPath: "id" })
        }

        // App Settings store
        if (!db.objectStoreNames.contains("appSettings")) {
          db.createObjectStore("appSettings", { keyPath: "id" })
        }
      }
    })
  }

  // Conversations
  async getConversations(): Promise<Conversation[]> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["conversations"], "readonly")
      const store = transaction.objectStore("conversations")
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  async createConversation(conversation: Conversation): Promise<void> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["conversations"], "readwrite")
      const store = transaction.objectStore("conversations")
      const request = store.add(conversation)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async updateConversation(conversation: Conversation): Promise<void> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["conversations"], "readwrite")
      const store = transaction.objectStore("conversations")
      const request = store.put(conversation)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async deleteConversation(id: string): Promise<void> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["conversations", "messages"], "readwrite")
      const conversationsStore = transaction.objectStore("conversations")
      const messagesStore = transaction.objectStore("messages")
      const index = messagesStore.index("conversationId")

      // Delete conversation
      conversationsStore.delete(id)

      // Delete all messages
      const request = index.openCursor(IDBKeyRange.only(id))
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          messagesStore.delete(cursor.primaryKey)
          cursor.continue()
        }
      }

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  // Messages
  async getMessages(conversationId: string): Promise<Message[]> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["messages"], "readonly")
      const store = transaction.objectStore("messages")
      const index = store.index("conversationId")
      const request = index.getAll(conversationId)

      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  async addMessage(message: Message): Promise<void> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["messages"], "readwrite")
      const store = transaction.objectStore("messages")
      const request = store.add(message)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // API Keys
  async getApiKeys(): Promise<ApiKey[]> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["apiKeys"], "readonly")
      const store = transaction.objectStore("apiKeys")
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  async saveApiKey(apiKey: ApiKey): Promise<void> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["apiKeys"], "readwrite")
      const store = transaction.objectStore("apiKeys")
      const request = store.put(apiKey)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async deleteApiKey(id: string): Promise<void> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["apiKeys"], "readwrite")
      const store = transaction.objectStore("apiKeys")
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Model Settings
  async getModelSettings(): Promise<ModelSettings[]> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["modelSettings"], "readonly")
      const store = transaction.objectStore("modelSettings")
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  async saveModelSettings(settings: ModelSettings): Promise<void> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["modelSettings"], "readwrite")
      const store = transaction.objectStore("modelSettings")
      const request = store.put(settings)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async deleteModelSettings(id: string): Promise<void> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["modelSettings"], "readwrite")
      const store = transaction.objectStore("modelSettings")
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // App Settings
  async getAppSettings(): Promise<AppSettings | null> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["appSettings"], "readonly")
      const store = transaction.objectStore("appSettings")
      const request = store.get("main")

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async saveAppSettings(settings: AppSettings): Promise<void> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["appSettings"], "readwrite")
      const store = transaction.objectStore("appSettings")
      const request = store.put({ id: "main", ...settings })

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

export const db = new Database()
