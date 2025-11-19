import { executeParallel } from "../../llm-core/parallel-executor";
import type { ExecutionStepFunction } from "../types";
import type { CoreMessage } from "ai";

/**
 * [ステップ] 批評モード用の「批評役」を実行
 * `context.parallelResponses` (草稿) を読み取り、
 * "critique" ロールを持つモデルに批評させます。
 * 結果は `context.critiques` に格納されます。
 *
 * @param {AgentContext} context - 現在の実行コンテキスト
 * @returns {Promise<AgentContext>} critiques が追加されたコンテキスト
 * @throws {Error} 批評役のモデルや、批評対象の草稿が見つからない場合
 */
export const executeCritics: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels, parallelResponses } = context;

  // "critique" ロールが設定されたモデルを抽出
  const criticModels = enabledModels.filter((m) => m.role?.toLowerCase() === "critique");
  if (criticModels.length === 0) {
    throw new Error("批評モードには 'critique' ロールが設定されたモデルが最低1つ必要です。");
  }

  if (!parallelResponses || parallelResponses.length === 0) {
    throw new Error("批評対象の草稿（parallelResponses）がありません。");
  }

  // 批評対象の草稿をテキストにまとめる
  const drafts = parallelResponses.map((r, i) => `[草稿 ${i + 1}: ${r.model}]\n${r.content}`).join("\n\n");
  const lastUserMessage = llmMessages.at(-1)?.content || "";

  // 批評役モデルに渡す共通プロンプト
  const criticPrompt: CoreMessage[] = [
    // 批評ステップでは、完全な履歴は不要（草稿がメイン）
    { role: "user", content: `元の質問：「${lastUserMessage}」` },
    {
      role: "system",
      content: `（システム）以下は、あなたのチームが作成した回答の草稿です。\n\n---草稿---\n${drafts}`,
    },
    {
      role: "user",
      content:
        "（指示）あなたは批評家です。上記草稿の論理的な誤り、不十分な点、改善点を厳しく指摘し、具体的な改善案を提示してください。",
    },
  ];

  // すべての批評役モデルで、同じ草稿を批評（並列実行）
  const critiques = await executeParallel(apiKeyManager, criticModels, criticPrompt);

  // 結果を critiques スロットに格納
  context.critiques = critiques;
  return context;
};
