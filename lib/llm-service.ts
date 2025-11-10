import type { Message, ModelSettings, AppSettings, ModelResponse } from "./db";

/**
 * サーバーサイドのLLM API（/api/chat）と通信するためのサービスクラス
 */
export class LLMService {
  /**
   * サーバーサイドの /api/chat エンドポイントを呼び出します。
   * APIキーの管理やLLMの直接呼び出しはサーバー側で行われます。
   *
   * @param {Message[]} messages - 現在の会話履歴（要約済みの場合は要約を含む）
   * @param {ModelSettings[]} modelSettings - クライアントで設定された全推論モデルの設定
   * @param {AppSettings} appSettings - アプリ設定（要約・統合モデル）
   * @param {string | undefined} systemPrompt - この会話に固有のシステムプロンプト
   * @param {number} totalContentLength - 現在の履歴の総文字数（要約トリガー判定用）
   * @returns {Promise<{
   * content: string;
   * modelResponses: ModelResponse[];
   * summaryExecuted: boolean;
   * newHistoryContext: Message[] | null;
   * }>} 統合された最終回答と、要約が実行されたかの情報
   * @throws {Error} API呼び出しが失敗した場合
   */
  async generateResponseWithDetails(
    messages: Message[],
    modelSettings: ModelSettings[],
    appSettings: AppSettings,
    systemPrompt: string | undefined,
    totalContentLength: number,
  ): Promise<{
    content: string;
    modelResponses: ModelResponse[];
    summaryExecuted: boolean;
    newHistoryContext: Message[] | null;
  }> {
    console.log("Calling Next.js API route (/api/chat)");

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        modelSettings,
        appSettings,
        systemPrompt,
        totalContentLength,
      }),
    });

    if (!response.ok) {
      // APIがエラーを返した場合、JSONからエラーメッセージを抽出
      const errorData = await response.json().catch(() => ({ error: "APIから無効な応答が返されました" }));
      throw new Error(errorData.error || `APIエラー (HTTP ${response.status})`);
    }

    // APIからの成功応答をそのまま返す
    return response.json() as Promise<{
      content: string;
      modelResponses: ModelResponse[];
      summaryExecuted: boolean;
      newHistoryContext: Message[] | null;
    }>;
  }

  /**
   * @deprecated この関数は古いシグネチャです。`generateResponseWithDetails` を直接使用してください。
   * (注: このラッパーは `totalContentLength` に 0 を渡すため、要約機能が正しく動作しません)
   */
  async generateResponse(
    messages: Message[],
    modelSettings: ModelSettings[],
    appSettings: AppSettings,
    systemPrompt?: string,
  ): Promise<string> {
    const result = await this.generateResponseWithDetails(
      messages,
      modelSettings,
      appSettings,
      systemPrompt,
      0, // totalContentLength が 0 固定のため、文字数ベースの要約が機能しない
    );
    return result.content;
  }
}

/**
 * LLMServiceクラスのシングルトンインスタンス
 */
export const llmService = new LLMService();
