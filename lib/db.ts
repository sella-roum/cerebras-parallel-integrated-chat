// IndexedDBを使ったクライアントサイドの永続化ストレージ

// #region 型定義

/**
 * チャットメッセージの構造
 */
export interface Message {
  id: string;
  /** メッセージの送信者 (systemは要約などに使用) */
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  conversationId: string;
  /** アシスタントの場合、各モデルの個別応答を保持 */
  modelResponses?: ModelResponse[];
}

/**
 * アシスタントメッセージに紐づく、各推論モデルの個別応答
 */
export interface ModelResponse {
  model: string;
  provider: string;
  content: string;
}

/**
 * 会話セッションのメタデータ
 */
export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** この会話に固有のシステムプロンプト */
  systemPrompt?: string;
}

/**
 * 並行推論モデルの設定
 */
export interface ModelSettings {
  id: string;
  provider: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  /** このモデルを並行推論で使用するか否か */
  enabled: boolean;
}

/**
 * アプリケーション全体の設定（要約・統合）
 */
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
// #endregion

const DB_NAME = "multi-llm-chat";
const DB_VERSION = 1;

/**
 * IndexedDBを非同期で操作するためのラッパークラス
 */
class Database {
  private db: IDBDatabase | null = null;

  /**
   * データベース接続を初期化（または既存の接続を取得）します。
   * @returns {Promise<void>} 接続が完了すると解決するPromise
   */
  async init(): Promise<void> {
    // 既に接続済みの場合は何もしない
    if (this.db) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      // DBバージョンが古い場合、または新規作成時に実行
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 会話ストア
        if (!db.objectStoreNames.contains("conversations")) {
          db.createObjectStore("conversations", { keyPath: "id" });
        }

        // メッセージストア
        if (!db.objectStoreNames.contains("messages")) {
          const messagesStore = db.createObjectStore("messages", { keyPath: "id" });
          // 会話IDでの検索を高速化するためのインデックス
          messagesStore.createIndex("conversationId", "conversationId", { unique: false });
        }

        // (旧バージョンの "apiKeys" ストアは削除されました)

        // 推論モデル設定ストア
        if (!db.objectStoreNames.contains("modelSettings")) {
          db.createObjectStore("modelSettings", { keyPath: "id" });
        }

        // アプリ設定ストア
        if (!db.objectStoreNames.contains("appSettings")) {
          db.createObjectStore("appSettings", { keyPath: "id" });
        }
      };
    });
  }

  // #region Conversations API
  /**
   * すべての会話メタデータを取得します。
   * 取得時に `createdAt` (作成日時) の降順でソートされます。
   * @returns {Promise<Conversation[]>} 会話の配列
   */
  async getConversations(): Promise<Conversation[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["conversations"], "readonly");
      const store = transaction.objectStore("conversations");
      const request = store.getAll();

      request.onsuccess = () => {
        // 取得結果をクライアント側でソート
        const sortedConversations = (request.result || []).sort(
          (a: Conversation, b: Conversation) => b.createdAt - a.createdAt,
        );
        resolve(sortedConversations);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 新しい会話メタデータをDBに追加します。
   * @param {Conversation} conversation - 追加する会話オブジェクト
   * @returns {Promise<void>}
   */
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

  /**
   * 既存の会話メタデータ（タイトルやシステムプロンプト）を更新します。
   * @param {Conversation} conversation - 更新する会話オブジェクト (IDで検索)
   * @returns {Promise<void>}
   */
  async updateConversation(conversation: Conversation): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["conversations"], "readwrite");
      const store = transaction.objectStore("conversations");
      const request = store.put(conversation); // putはIDが存在すれば更新、なければ追加

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 指定されたIDの会話と、それに紐づく全てのメッセージを削除します。
   * @param {string} id - 削除する会話のID
   * @returns {Promise<void>}
   */
  async deleteConversation(id: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["conversations", "messages"], "readwrite");
      const conversationsStore = transaction.objectStore("conversations");
      const messagesStore = transaction.objectStore("messages");
      const index = messagesStore.index("conversationId");

      // 1. 会話メタデータを削除
      conversationsStore.delete(id);

      // 2. 関連する全メッセージをインデックス経由で削除
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

  /**
   * 既存の会話（メタデータと全メッセージ）を複製して新しい会話を作成します。
   * @param {string} originalId - 複製元の会話ID
   * @returns {Promise<Conversation>} 新しく作成された会話オブジェクト
   * @throws {Error} 複製元の会話が見つからない場合
   */
  async duplicateConversation(originalId: string): Promise<Conversation> {
    if (!this.db) await this.init();

    // 1. 複製元の会話メタデータを取得
    const originalConv = await new Promise<Conversation>((resolve, reject) => {
      const tx = this.db!.transaction(["conversations"], "readonly");
      tx.objectStore("conversations").get(originalId).onsuccess = (e) => resolve((e.target as IDBRequest).result);
      tx.onerror = () => reject(tx.error);
    });

    if (!originalConv) {
      throw new Error("Conversation not found");
    }

    // 2. 複製元の全メッセージを取得
    const originalMessages = await this.getMessages(originalId);

    // 3. 新しいConversationオブジェクトを作成
    const newConversation: Conversation = {
      ...originalConv,
      id: `conv_${Date.now()}`, // 新しいID
      title: `${originalConv.title} (コピー)`, // タイトルを変更
      createdAt: Date.now(), // 現在時刻
      updatedAt: Date.now(),
    };

    // 4. メッセージを新しいIDで複製
    const newMessages: Message[] = originalMessages.map((msg, index) => ({
      ...msg,
      id: `msg_${Date.now() + index + 1}`, // 新しいユニークID
      conversationId: newConversation.id, // 新しい会話IDに紐付け
    }));

    // 5. 新しい会話とメッセージをDBに一括書き込み
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(["conversations", "messages"], "readwrite");
      tx.objectStore("conversations").add(newConversation);
      const messagesStore = tx.objectStore("messages");
      for (const msg of newMessages) {
        messagesStore.add(msg);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    return newConversation;
  }
  // #endregion

  // #region Messages API
  /**
   * 指定された会話IDに紐づく全てのメッセージを取得します。
   * (注: この層ではソートされません。必要に応じて呼び出し側で行います)
   * @param {string} conversationId - メッセージを取得する会話のID
   * @returns {Promise<Message[]>} メッセージの配列
   */
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

  /**
   * 新しいメッセージをDBに追加します。
   * @param {Message} message - 追加するメッセージオブジェクト
   * @returns {Promise<void>}
   */
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

  /**
   * 既存のメッセージの内容（content）を更新します。
   * (ユーザーメッセージの編集・やり直し機能で使用)
   * @param {string} messageId - 更新するメッセージのID
   * @param {string} newContent - 新しいメッセージ内容
   * @returns {Promise<void>}
   */
  async updateMessageContent(messageId: string, newContent: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["messages"], "readwrite");
      const store = transaction.objectStore("messages");
      // 1. まずメッセージを取得
      const request = store.get(messageId);

      request.onsuccess = () => {
        const message = request.result;
        if (message) {
          // 2. 内容を更新して書き戻す
          message.content = newContent;
          store.put(message).onsuccess = () => resolve();
        } else {
          reject(new Error("Message not found"));
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 特定のメッセージID以降のメッセージ（そのIDを含む）を
   * 同じ会話IDからすべて削除します。
   * (メッセージの再生成や編集・やり直し機能で使用)
   * @param {string} messageId - 削除を開始するメッセージのID
   * @param {string} conversationId - 対象の会話ID
   * @returns {Promise<void>}
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
          // messageIdは 'msg_${Date.now()}' 形式のため、時系列ソートが可能
          // 削除開始IDと一致したら、それ以降（含む）を削除
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
   * (サーバー側での履歴要約（圧縮）の同期で使用)
   * @param {string} conversationId - 対象の会話ID
   * @param {Message[]} newMessages - 新しく置き換えるメッセージの配列
   * @returns {Promise<void>}
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
              store.add({ ...msg, conversationId }); // 会話IDを強制
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
          resolve(); // メッセージが0件だった場合など
        }
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }
  // #endregion

  // #region Settings API (Model & App)
  /**
   * 保存されている全ての「推論モデル設定」を取得します。
   * @returns {Promise<ModelSettings[]>}
   */
  async getModelSettings(): Promise<ModelSettings[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["modelSettings"], "readonly");
      const store = transaction.objectStore("modelSettings");
      const request = store.getAll();

      request.onsuccess = () => {
        const stored = (request.result || []) as ModelSettings[];
        const normalized = stored.map((setting) => ({
          ...setting,
          enabled: setting.enabled ?? true,
        }));
        resolve(normalized);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 「推論モデル設定」を保存（追加または更新）します。
   * @param {ModelSettings} settings - 保存する設定オブジェクト (IDで識別)
   * @returns {Promise<void>}
   */
  async saveModelSettings(settings: ModelSettings): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["modelSettings"], "readwrite");
      const store = transaction.objectStore("modelSettings");
      const request = store.put(settings); // putはIDが存在すれば更新、なければ追加

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 指定されたIDの「推論モデル設定」を削除します。
   * @param {string} id - 削除する設定のID
   * @returns {Promise<void>}
   */
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

  /**
   * 「アプリ設定」（要約・統合モデル）を取得します。
   * @returns {Promise<AppSettings | null>}
   */
  async getAppSettings(): Promise<AppSettings | null> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["appSettings"], "readonly");
      const store = transaction.objectStore("appSettings");
      // アプリ設定は常に "main" という単一のIDで保存
      const request = store.get("main");

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 「アプリ設定」（要約・統合モデル）を保存します。
   * @param {AppSettings} settings - 保存する設定オブジェクト
   * @returns {Promise<void>}
   */
  async saveAppSettings(settings: AppSettings): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(["appSettings"], "readwrite");
      const store = transaction.objectStore("appSettings");
      // 常に "main" というIDで上書き保存
      const request = store.put({ id: "main", ...settings });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  // #endregion
}

/**
 * データベースクラスのシングルトンインスタンス
 */
export const db = new Database();
