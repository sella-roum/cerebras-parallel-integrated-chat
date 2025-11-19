/**
 * HTTPエラーなど、API呼び出しに関する情報を保持するカスタムエラー
 */
export class LlmApiError extends Error {
  public status: number;
  public modelName?: string;
  public apiKeyUsed: string;

  /**
   * LlmApiErrorのコンストラクタ
   * @param {string} message - エラーメッセージ
   * @param {number} status - HTTPステータスコード
   * @param {string} apiKeyUsed - 使用されたAPIキー
   * @param {string} [modelName] - (オプション) 使用されたモデル名
   */
  constructor(message: string, status: number, apiKeyUsed: string, modelName?: string) {
    super(message);
    this.name = "LlmApiError";
    this.status = status;
    this.modelName = modelName;
    this.apiKeyUsed = apiKeyUsed;
  }
}

/**
 * リクエストごとにAPIキーのプールを管理し、循環させるクラス
 */
export class ApiKeyManager {
  private availableKeys: string[];
  private currentIndex: number = 0;

  /**
   * ApiKeyManagerのコンストラクタ
   * @param {string[]} keys - 使用するAPIキーの配列。内部でシャッフルされます。
   * @throws {Error} キー配列が空の場合
   */
  constructor(keys: string[]) {
    if (keys.length === 0) {
      throw new Error("APIキーがありません。CEREBRAS_API_KEYS 環境変数を設定してください。");
    }
    // Fisher-Yates (aka Knuth) Shuffle でシャッフルしてコピー
    const shuffledKeys = [...keys];
    for (let i = shuffledKeys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledKeys[i], shuffledKeys[j]] = [shuffledKeys[j], shuffledKeys[i]];
    }
    this.availableKeys = shuffledKeys;
  }

  /**
   * 現在利用可能なAPIキーの数を取得します。
   * @returns {number} 利用可能なキーの数
   */
  public get keyCount(): number {
    return this.availableKeys.length;
  }

  /**
   * 次に使用するAPIキーを取得します（循環キュー）。
   * @returns {string} APIキー
   * @throws {Error} 利用可能なキーがない場合
   */
  public getNextKey(): string {
    if (this.availableKeys.length === 0) {
      throw new Error("利用可能なAPIキーがありません。");
    }
    const key = this.availableKeys[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.availableKeys.length;
    return key;
  }

  /**
   * 永続的なエラー（401など）が発生したキーをプールから削除します。
   * @param {string} keyToRemove - 削除するAPIキー
   */
  public removeKey(keyToRemove: string) {
    const originalLength = this.availableKeys.length;
    this.availableKeys = this.availableKeys.filter((key) => key !== keyToRemove);

    if (this.availableKeys.length < originalLength) {
      console.warn(
        `[ApiKeyManager] APIキー (末尾...${keyToRemove.slice(-4)}) をプールから削除しました (永続的エラー)。`,
      );
      // インデックスが範囲外にならないように調整
      this.currentIndex = this.currentIndex % (this.availableKeys.length || 1);
    }
  }
}

/**
 * 環境変数 `CEREBRAS_API_KEYS` からAPIキーの配列を取得します。
 * カンマ区切りで複数のキーを登録可能です。
 * @returns {string[]} APIキーの配列
 */
export function getApiKeys(): string[] {
  const keysEnv = process.env.CEREBRAS_API_KEYS || "";
  return keysEnv.split(",").filter((key) => key.trim() !== "");
}

/**
 * 発生したLlmApiErrorを分類し、リトライ戦略を決定します。
 * @param {LlmApiError} error - 分類対象のエラー
 * @returns {{ isPermanent: boolean, removeKey: boolean, removeModel: boolean }}
 * - `isPermanent`: リトライしても無駄な永続的エラーか
 * - `removeKey`: このAPIキーをプールから削除すべきか (401, 403)
 * - `removeModel`: このモデルをリトライ対象から除外すべきか (404, 400)
 */
export function classifyError(error: LlmApiError): { isPermanent: boolean; removeKey: boolean; removeModel: boolean } {
  const status = error.status;

  if (status === 401 || status === 403) {
    // 認証・権限エラー (キーが悪い)
    return { isPermanent: true, removeKey: true, removeModel: false };
  }
  if (status === 404) {
    // Not Found (モデル名が悪い)
    return { isPermanent: true, removeKey: false, removeModel: true };
  }
  if (status >= 400 && status < 500 && status !== 429) {
    // その他のクライアントエラー (リクエストが悪いなど。リトライしても無駄)
    return { isPermanent: true, removeKey: false, removeModel: true };
  }
  // 一時的エラー (429 レートリミット, 5xx サーバーエラー) はリトライ対象
  return { isPermanent: false, removeKey: false, removeModel: false };
}
