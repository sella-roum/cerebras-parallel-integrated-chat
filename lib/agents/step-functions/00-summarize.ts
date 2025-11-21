import type { AgentContext } from "../types";
import type { Message, ModelSettings } from "../../db";
import type { CoreMessage } from "ai";
import { executeIntegration } from "../../llm-core/integrator-executor";

/**
 * 要約がトリガーされるメッセージ件数の閾値
 */
const CONVERSATION_THRESHOLD = 10;
/**
 * 要約がトリガーされる総文字数の閾値
 */
const CONTENT_LENGTH_THRESHOLD = 30000; // 元の 8000 から 30000 に増加 (README と合わせる)

/**
 * [ステップ] 会話履歴が閾値を超えた場合、要約を実行する
 * これはエージェント・ループの前に実行される共通ステップです。
 *
 * @param {AgentContext} context - 現在の実行コンテキスト
 * @returns {Promise<AgentContext>} 更新されたコンテキスト
 */
export async function summarizeHistory(context: AgentContext): Promise<AgentContext> {
  const { appSettings, llmMessages, apiKeyManager, totalContentLength } = context;
  const isTooLongByCount = llmMessages.length > CONVERSATION_THRESHOLD;
  const isTooLongByLength = totalContentLength && totalContentLength > CONTENT_LENGTH_THRESHOLD;

  // 要約モデルがないか、閾値に達していない場合はそのまま返す
  if (!appSettings?.summarizerModel || (!isTooLongByCount && !isTooLongByLength)) {
    return { ...context, summaryExecuted: false, newHistoryContext: null };
  }

  console.log(`[Agent Step: Summarize] 履歴が閾値を超えたため要約を実行します。`);

  const lastUserMessage = llmMessages.at(-1)!;
  const messagesToSummarize = llmMessages.slice(0, -1);

  const summaryPromptMessages: CoreMessage[] = [
    ...messagesToSummarize,
    {
      role: "user",
      content: `（指示）上記の会話履歴全体を、重要な文脈を失わないように、第三者視点で詳細な要約に圧縮してください。`,
    },
  ];

  try {
    // 統合実行エンジンを非ストリーミングで呼び出す
    const summaryContent = await executeIntegration(
      apiKeyManager,
      summaryPromptMessages,
      {
        ...appSettings.summarizerModel,
        id: "summarizer", // ダミーID
        enabled: true, // ダミーフラグ
      } as ModelSettings,
      // streamController を渡さないことで非ストリーミング実行になる
    );

    // DB保存用の Message 型
    const summaryMessage: Message = {
      id: `msg_summary_${Date.now()}`,
      role: "system",
      content: `[以前の会話の要約]\n${summaryContent}`,
      timestamp: Date.now(),
      conversationId: "temp", // このコンテキストでは不明
    };

    // API内部処理用の CoreMessage 型
    const summaryCoreMessage: CoreMessage = { role: "system", content: summaryMessage.content };

    // コンテキストを更新して返す
    context.llmMessages = [summaryCoreMessage, lastUserMessage]; // 要約＋最新の質問
    context.summaryExecuted = true;
    context.newHistoryContext = [summaryMessage];
    return context;
  } catch (error) {
    console.error("[Summarizer] 要約に失敗しました。圧縮されていない履歴で続行します。", error);
    // 要約に失敗してもエラーとはせず、元の履歴で続行する
    return { ...context, summaryExecuted: false, newHistoryContext: null };
  }
}
