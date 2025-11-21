import type { Message, ModelSettings, AppSettings, ModelResponse } from "./db";

/**
 * ストリーミングAPI呼び出しのコールバック
 * chat-view.tsx がこれらの関数を実装して、UI更新とDB同期を行います。
 */
export interface StreamCallbacks {
  /** 思考ステップなどの途中経過が届いた時 */
  onStatus: (step: string) => void;
  /** AIの回答テキストのチャンク（断片）が届いた時 */
  onData: (chunk: string) => void;
  /** 最終的な個別モデルの応答（JSON）が届いた時 */
  onResponses: (data: ModelResponse[]) => void;
  /** 要約実行時の新しい履歴コンテキスト（JSON）が届いた時 */
  onSummary: (context: Message[]) => void;
  /** エラー発生時 */
  onError: (message: string) => void;
  /** ストリームが正常に完了した時（最終的な完全な回答テキストを渡す） */
  onFinish: (finalContent: string) => void;
}

/**
 * サーバーサイドのLLM API（/api/chat）と通信するためのサービスクラス
 * Vercel AI SDK の `useChat` を使わずに手動でストリーミングを処理します。
 */
export class LLMService {
  /**
   * サーバーサイドの /api/chat エンドポイントを（ストリーミングで）呼び出します。
   *
   * @param {Message[]} messages - DBから取得した現在のメッセージ履歴
   * @param {ModelSettings[]} modelSettings - DBから取得したモデル設定
   * @param {AppSettings} appSettings - DBから取得したアプリ設定
   * @param {string | undefined} systemPrompt - 現在の会話のシステムプロンプト
   * @param {number} totalContentLength - 履歴の総文字数（要約トリガー用）
   * @param {string} agentMode - 選択されたエージェントモードID
   * @param {StreamCallbacks} callbacks - ストリーミングイベントを処理するコールバック関数群
   */
  async generateResponseStreaming(
    messages: Message[], // DBの Message 型
    modelSettings: ModelSettings[],
    appSettings: AppSettings,
    systemPrompt: string | undefined,
    totalContentLength: number,
    agentMode: string,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    // Vercel AI SDK (useChat) の body 形式に準拠
    // 'messages' には CoreMessage 形式を、
    // 'data' にはそれ以外のカスタムデータを格納します。
    const body = {
      // APIに渡すのは CoreMessage の形式 (idやtimestampは不要)
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      data: {
        // 追加データは 'data' オブジェクトに格納
        agentMode,
        systemPrompt,
        modelSettings,
        appSettings,
        totalContentLength,
      },
    };

    let response: Response;
    try {
      response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e: unknown) {
      // any -> unknown
      const msg = e instanceof Error ? e.message : String(e);
      // ネットワーク接続エラーなど、fetch自体が失敗した場合
      callbacks.onError(`APIへの接続に失敗しました: ${msg}`);
      callbacks.onFinish(""); // 空のコンテンツで終了
      return;
    }

    // 4xx, 5xx などのAPIエラー
    if (!response.ok) {
      try {
        const errorData = await response.json();
        callbacks.onError(errorData.error || `APIエラー (HTTP ${response.status})`);
      } catch {
        callbacks.onError(`APIエラー (HTTP ${response.status})。応答の解析に失敗しました。`);
      }
      callbacks.onFinish("");
      return;
    }

    if (!response.body) {
      callbacks.onError("APIからストリームが返されませんでした");
      callbacks.onFinish("");
      return;
    }

    // --- ストリームの手動パース処理 ---
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = ""; // チャンクの切れ端を保持するバッファ
    let finalContent = ""; // 最終的な完全な回答テキスト

    // バッファ内の行を処理するヘルパー関数
    const processLines = (lines: string[]) => {
      for (const line of lines) {
        if (line.startsWith("DATA:")) {
          // ★ 厳格なプロトコル `DATA:` のみ content として扱う
          const chunk = line.substring(5); // "DATA:" の5文字を削除
          callbacks.onData(chunk);
          finalContent += chunk;
        } else if (line.startsWith("STATUS:STEP:")) {
          callbacks.onStatus(line.replace("STATUS:STEP:", "").trim());
        } else if (line.startsWith("MODEL_RESPONSES:")) {
          callbacks.onResponses(JSON.parse(line.replace("MODEL_RESPONSES:", "").trim()));
        } else if (line.startsWith("SUMMARY_EXECUTED:")) {
          callbacks.onSummary(JSON.parse(line.replace("SUMMARY_EXECUTED:", "").trim()));
        } else if (line.startsWith("ERROR:")) {
          callbacks.onError(line.replace("ERROR:", "").trim());
        }
        // プロトコルに合致しない行（空行など）は無視
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          // ストリームが正常に終了
          break;
        }

        buffer += value;
        const lines = buffer.split("\n");

        // 最後の行は不完全かもしれないのでバッファに戻す
        // (例: "DATA: こんにちは\nSTATUS:ST" の "STATUS:ST" の部分)
        buffer = lines.pop() || "";

        processLines(lines);
      }

      // ★ 修正: ストリーム終了後にバッファに残った行を処理
      // 最後の行が改行で終わっていない場合でも処理する
      if (buffer.length > 0) {
        const remainingLines = buffer.split("\n");
        processLines(remainingLines);
      }
    } catch (e: unknown) {
      // any -> unknown
      const msg = e instanceof Error ? e.message : String(e);
      callbacks.onError(`ストリームの読み取りに失敗しました: ${msg}`);
    } finally {
      // ストリームが正常終了(done)またはエラー(catch)した場合に必ず呼び出す
      callbacks.onFinish(finalContent);
    }
  }

  /**
   * @deprecated この関数は古いシグネチャです。`generateResponseStreaming` を使用してください。
   * (注: `totalContentLength` が 0 固定のため、要約機能が正しく動作しません)
   *
   * ★ 修正: 空文字を返すのではなく、Promiseでラップして最終結果を返すように修正し、
   * 既存の呼び出し元が壊れないようにしました。
   */
  async generateResponse(
    messages: Message[],
    modelSettings: ModelSettings[],
    appSettings: AppSettings,
    systemPrompt?: string,
  ): Promise<string> {
    let finalContent = "";

    await this.generateResponseStreaming(
      messages,
      modelSettings,
      appSettings,
      systemPrompt,
      0, // totalContentLength が 0 固定
      "standard", // 古い呼び出しは standard モード固定
      {
        onStatus: () => {},
        onData: () => {},
        onResponses: () => {},
        onSummary: () => {},
        onError: () => {},
        onFinish: (content) => {
          finalContent = content;
        },
      },
    );

    return finalContent;
  }
}

/**
 * LLMServiceクラスのシングルトンインスタンス
 */
export const llmService = new LLMService();
