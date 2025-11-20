import { executeParallel } from "../../llm-core/parallel-executor";
import type { ExecutionStepFunction } from "../types";
import type { CoreMessage } from "ai";

/**
 * [ステップ] 感情・トーン分析と標準実行を並列に行う (メタ分析)
 * 特定の役割設定に関わらず、
 * 1. モデルリストの先頭のモデルを「分析役」として実行
 * 2. 全モデルを「回答役」として標準実行
 * これらを並列処理します。
 *
 * @param {AgentContext} context - 現在の実行コンテキスト
 * @returns {Promise<AgentContext>} parallelResponses と critiques (分析結果) が追加されたコンテキスト
 * @throws {Error} 有効なモデルがない場合
 */
export const executeEmotionAnalysis: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels } = context;

  if (enabledModels.length === 0) {
    throw new Error("有効な推論モデルがありません。");
  }

  // 1. 動的に役割を割り当て
  // 先頭のモデルを「分析役」に指名（ランダムでも良いが、決定論的な方がデバッグしやすい）
  const analyzerModel = enabledModels[0];

  // 2. 感情分析プロンプトの準備
  const analysisPrompt: CoreMessage[] = [
    ...llmMessages, // 文脈理解のために全履歴を渡す
    {
      role: "system",
      content:
        '（分析タスク）ユーザーの最新のメッセージと会話履歴に基づき、ユーザーの現在の感情（例：怒り、喜び、焦り、好奇心）と、望ましい回答のトーン（例：簡潔、共感的、技術的、丁寧）を分析してください。\n出力は JSON形式 `{"emotion": "...", "tone": "..."}` のみとしてください。',
    },
  ];

  // 3. 並列実行の開始

  // Task A: 分析の実行 (1つのモデル)
  const analysisPromise = executeParallel(apiKeyManager, [analyzerModel], analysisPrompt);

  // Task B: 通常の回答生成 (全モデル)
  // ※ 分析結果を待たずに、まずは標準的な回答を生成させておく（時間短縮）
  const standardPromise = executeParallel(apiKeyManager, enabledModels, llmMessages);

  // 両方の完了を待機
  const [analysisResponses, standardResponses] = await Promise.all([analysisPromise, standardPromise]);

  // 4. 結果の格納
  // critiques スロットを流用してメタ情報（分析結果）を格納
  context.critiques = analysisResponses;

  // 通常の並列実行の結果を格納
  context.parallelResponses = standardResponses;

  // 万が一標準実行が失敗した場合のフォールバック
  if (context.parallelResponses.length === 0 && analysisResponses.length > 0) {
    context.parallelResponses = analysisResponses.map((r) => ({
      ...r,
      content: `分析結果（回答の生成に失敗）： ${r.content}`,
    }));
  }

  return context;
};
