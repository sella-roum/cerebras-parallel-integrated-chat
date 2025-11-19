import { executeParallel } from "../../llm-core/parallel-executor";
import type { ExecutionStepFunction } from "../types";
import type { CoreMessage } from "ai";

/**
 * [ステップ] 感情・トーン分析と標準実行を同時に行う (メタ分析)
 * "analyzer" ロールを持つモデル（またはフォールバック）がメタ分析を行い、
 * 他のモデルが標準的な回答生成を並列で行います。
 *
 * @param {AgentContext} context - 現在の実行コンテキスト
 * @returns {Promise<AgentContext>} parallelResponses と critiques (分析結果) が追加されたコンテキスト
 * @throws {Error} 分析用モデルが見つからない場合
 */
export const executeEmotionAnalysis: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels } = context;

  // "analyzer" ロールを持つモデルを探す
  let analyzerModel = enabledModels.find((m) => m.role?.toLowerCase() === "analyzer");

  if (!analyzerModel) {
    // フォールバック: 最初の有効なモデルを分析役にする
    analyzerModel = enabledModels[0];
    console.warn(
      `[Agent Step: Meta] 'analyzer' ロールのモデルがないため、${analyzerModel?.modelName || "N/A"} を分析役として使用します。`,
    );
  }
  if (!analyzerModel) {
    throw new Error("感情分析モードが選択されましたが、有効なモデルがありません。");
  }

  // 分析役以外のモデルで標準実行を行う
  const standardModels = enabledModels.filter((m) => m.id !== analyzerModel!.id);

  // 1. 感情分析プロンプトの準備
  const analysisPrompt: CoreMessage[] = [
    llmMessages.at(-1)!, // 最新の質問のみ
    {
      role: "system",
      content:
        'ユーザーの最新のメッセージと会話履歴に基づき、ユーザーの現在の感情（例：怒り、喜び、急いでいる、好奇心旺盛）と、望ましい回答のトーン（例：フォーマル、共感的、技術的）を分析し、JSON（例: {"emotion": "急いでいる", "tone": "フォーマル"}）の形式で、JSONオブジェクトのみを厳密に出力してください。',
    },
  ];

  // 1a. 感情分析の実行タスク
  const analysisPromise = executeParallel(apiKeyManager, [analyzerModel], analysisPrompt);

  // 1b. 通常の並列実行タスク
  const standardPromise = (async () => {
    if (standardModels.length > 0) {
      // executeStandard はコンテキストを返すため、ここでは直接 executeParallel を呼ぶ
      return await executeParallel(apiKeyManager, standardModels, llmMessages);
    }
    return []; // 分析役しかいない場合は空
  })();

  // 2. 両方を並列で待機
  const [analysisResponses, standardResponses] = await Promise.all([analysisPromise, standardPromise]);

  // ★ critiques スロットを流用してメタ情報（分析結果）を格納
  context.critiques = analysisResponses;
  // ★ 通常の並列実行の結果を格納
  context.parallelResponses = standardResponses;

  // もし標準実行が失敗（例：分析役しかいなかった）場合、分析結果を回答として使う（フォールバック）
  if (context.parallelResponses.length === 0) {
    context.parallelResponses = analysisResponses.map((r) => ({
      ...r,
      content: `分析結果（回答の生成に失敗）： ${r.content}`,
    }));
  }

  return context;
};
