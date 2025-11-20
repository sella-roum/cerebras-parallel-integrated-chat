import { executeParallel } from "../../llm-core/parallel-executor";
import type { ExecutionStepFunction } from "../types";
import type { CoreMessage } from "ai";

/**
 * [ステップ] 批評モード用の「批評役」を実行
 * `context.parallelResponses` (草稿) を読み取り、
 * 有効な全モデルに対して批評を行わせます。
 * (旧ロジック: role="critique" のみ抽出 → 新ロジック: 全モデル使用)
 *
 * @param {AgentContext} context - 現在の実行コンテキスト
 * @returns {Promise<AgentContext>} critiques が追加されたコンテキスト
 * @throws {Error} 批評対象の草稿が見つからない場合
 */
export const executeCritics: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels, parallelResponses } = context;

  if (enabledModels.length === 0) {
    throw new Error("有効な推論モデルがありません。");
  }
  if (!parallelResponses || parallelResponses.length === 0) {
    throw new Error("批評対象の草稿（parallelResponses）がありません。");
  }

  // 1. 批評役として全モデルを使用
  const criticModels = enabledModels;

  // 2. 批評対象の草稿をテキストにまとめる
  const drafts = parallelResponses.map((r, i) => `[草稿 ${i + 1}: ${r.model}]\n${r.content}`).join("\n\n");
  const lastUserMessage = llmMessages.at(-1)?.content || "";

  // 3. 批評役モデルに渡す共通プロンプト
  const criticPrompt: CoreMessage[] = [
    // 批評ステップでは、完全な履歴は不要（草稿がメイン）だが、文脈理解のために最後の質問を含める
    { role: "user", content: `元の質問：「${lastUserMessage}」` },
    {
      role: "system",
      content: `（システム）以下は、あなたのチームが作成した回答の草稿です。\n\n---草稿---\n${drafts}`,
    },
    {
      role: "user",
      content:
        "（指示）あなたは優秀な編集者かつ批評家です。上記草稿の論理的な誤り、不十分な点、改善点を客観的に指摘し、より良い回答にするための具体的な改善案を提示してください。",
    },
  ];

  // 4. 全モデルで批評を実行（並列）
  const critiques = await executeParallel(apiKeyManager, criticModels, criticPrompt);

  // 結果を critiques スロットに格納
  context.critiques = critiques;
  return context;
};
