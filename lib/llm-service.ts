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
      const errorData = await response.json().catch(() => ({ error: "APIから無効な応答が返されました" }));
      throw new Error(errorData.error || `APIエラー (HTTP ${response.status})`);
    }

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
