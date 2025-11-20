import { NextRequest } from "next/server";
import { ApiKeyManager, getApiKeys } from "@/lib/llm-core/api-key-manager";
import { getAgentById } from "@/lib/agents";
import { StreamProtocol, type AgentContext } from "@/lib/agents/types";
import type { ModelSettings, AppSettings } from "@/lib/db";
import { summarizeHistory } from "@/lib/agents/step-functions/00-summarize";

/**
 * メインのチャットAPIエンドポイント（ストリーミング対応）
 *
 * @param {NextRequest} req - Next.js のリクエストオブジェクト
 * @returns {Promise<Response>} ストリーミングレスポンスまたはエラーJSONレスポンス
 */
export async function POST(req: NextRequest) {
  let apiKeyManager: ApiKeyManager;
  try {
    // 1. APIキーマネージャーの初期化
    apiKeyManager = new ApiKeyManager(getApiKeys());
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown API Key Error";
    // APIキーがないなど、起動時の致命的エラー
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. リクエストボディのパース (Vercel AI SDK 形式)
  const { messages, data } = await req.json();

  // ★ 修正: メッセージ形式のバリデーションを追加
  // messages が配列でない場合、ランタイムエラーを防ぐために早期リターン
  if (!Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: "Invalid request: messages must be an array" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { modelSettings, appSettings, systemPrompt, totalContentLength, agentMode } = (data || {}) as {
    modelSettings: (ModelSettings & { enabled: boolean })[];
    appSettings: AppSettings;
    systemPrompt?: string;
    totalContentLength: number;
    agentMode: string;
  };

  /**
   * 3. レスポンスストリームの生成と開始
   * この中でエージェント・オーケストレーションを実行します。
   */
  const stream = new ReadableStream({
    async start(controller) {
      // 3a. 実行コンテキストの初期化
      let context: AgentContext = {
        apiKeyManager: apiKeyManager,
        llmMessages: messages, // Vercel AI SDK からの CoreMessage[]
        enabledModels: modelSettings ? modelSettings.filter((m) => m.enabled) : [],
        appSettings: appSettings || {},
        streamController: controller,
        totalContentLength: totalContentLength || 0,
        parallelResponses: [],
        finalContent: "",
        summaryExecuted: false,
        newHistoryContext: null,
        finalContentStreamed: false, // まだストリーミングされていない
      };

      try {
        // --- 3b. 要約ステップ (全モード共通で最初に実行) ---
        // `summarizeHistory` は `context.llmMessages` などを更新して返す
        context = await summarizeHistory(context);

        if (context.summaryExecuted) {
          // 要約が実行されたことをクライアントに通知
          controller.enqueue(StreamProtocol.SUMMARY(context.newHistoryContext!));
        }

        // --- 3c. 履歴とエージェントの準備 ---
        if (systemPrompt && systemPrompt.trim() !== "") {
          // 要約済みの履歴の先頭にシステムプロンプトを挿入
          context.llmMessages.unshift({ role: "system", content: systemPrompt });
        }

        const agent = getAgentById(agentMode);
        console.log(`[API Route] 実行計画: ${agent.name} (${agent.steps.map((s) => s.name).join(" -> ")})`);

        // --- 3d. 実行計画（ステップ）の順次実行 ---
        // 要約は既に実行済みのため、実行計画からは除外
        const executionSteps = agent.steps.filter((step) => step.name !== "SUMMARIZE");

        for (const step of executionSteps) {
          controller.enqueue(StreamProtocol.STATUS(step.name)); // ★途中経過を送信
          context = await step.execute(context);
        }

        // --- 3e. 最終結果の送信 ---
        // 最後の統合ステップがストリーミング（DATA:）で送信したはず

        // もし何らかの理由でストリーミングされなかった場合、ここで送信する
        if (!context.finalContentStreamed && context.finalContent) {
          controller.enqueue(StreamProtocol.DATA(context.finalContent));
        }

        // ★カスタムプロトコルで個別応答を送信
        // context.modelResponses があればそれを優先（批評モード等で統合されている場合があるため）
        const responsesToSend = context.modelResponses || context.parallelResponses;
        controller.enqueue(StreamProtocol.RESPONSES(responsesToSend));

        controller.close(); // ストリーム正常終了
      } catch (error: unknown) {
        console.error(`[API Route] エラー (Mode: ${agentMode}):`, error);
        const errorMessage = error instanceof Error ? error.message : "不明なエラー";
        // ★カスタムプロトコルでエラーを送信
        controller.enqueue(StreamProtocol.ERROR(errorMessage));
        controller.close();
      }
    },
  });

  // StreamingTextResponse は Vercel AI SDK v5 で削除されたため、
  // 標準の Response オブジェクトを使用します。
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
