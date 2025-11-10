import type { Message, ModelSettings, AppSettings, ModelResponse } from "./db";

export class LLMService {
  /**
   * サーバーサイドの /api/chat エンドポイントを呼び出します。
   * APIキーの管理やLLMの直接呼び出しはサーバー側で行われます。
   */
  async generateResponseWithDetails(
    messages: Message[],
    modelSettings: ModelSettings[],
    appSettings: AppSettings,
    systemPrompt: string | undefined, // ▼ 変更点 (フェーズ1)： undefined を許容
    totalContentLength: number, // ▼ 変更点 (フェーズ1)： 引数を追加
  ): Promise<{
    content: string;
    modelResponses: ModelResponse[];
    summaryExecuted: boolean; // ▼ 変更点 (フェーズ1)： 戻り値の型を追加
    newHistoryContext: Message[] | null; // ▼ 変更点 (フェーズ1)： 戻り値の型を追加
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
        totalContentLength, // ▼ 変更点 (フェーズ1)： リクエストボディに追加
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "APIから無効な応答が返されました" }));
      throw new Error(errorData.error || `APIエラー (HTTP ${response.status})`);
    }

    // ▼ 変更点 (フェーズ1)： APIの新しい応答の型に合わせてキャスト
    return response.json() as Promise<{
      content: string;
      modelResponses: ModelResponse[];
      summaryExecuted: boolean;
      newHistoryContext: Message[] | null;
    }>;
  }

  /**
   * generateResponseWithDetailsのラッパー
   * (注: このラッパーは引数が合わなくなるため、呼び出し側で generateResponseWithDetails を直接使用することを推奨)
   */
  async generateResponse(
    messages: Message[],
    modelSettings: ModelSettings[],
    appSettings: AppSettings,
    systemPrompt?: string,
  ): Promise<string> {
    // ▼ 変更点 (フェーズ1)： totalContentLength にダミーの0を渡す (非推奨)
    const result = await this.generateResponseWithDetails(
      messages,
      modelSettings,
      appSettings,
      systemPrompt,
      0, // このラッパーは使われなくなる想定
    );
    return result.content;
  }
}

export const llmService = new LLMService();
