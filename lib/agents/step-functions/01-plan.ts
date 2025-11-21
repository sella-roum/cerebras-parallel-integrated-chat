import { executeIntegration } from "../../llm-core/integrator-executor";
import type { ExecutionStepFunction } from "../types";
import type { CoreMessage } from "ai";
import type { ModelSettings } from "../../db";

/**
 * JSON文字列からMarkdownのコードブロック記号を除去するヘルパー関数
 */
function cleanJsonOutput(text: string): string {
  return text
    .replace(/```json\n?/g, "")
    .replace(/```/g, "")
    .trim();
}

/**
 * [ステップ] 計画：マネージャーモード用のサブタスク計画
 * ユーザーの最新の要求を分析し、それを達成するためのサブタスクのリストを生成します。
 * 結果は `context.subTasks` に格納されます。
 *
 * @param {AgentContext} context - 現在の実行コンテキスト
 * @returns {Promise<AgentContext>} subTasks が追加されたコンテキスト
 * @throws {Error} 計画ステップの実行に必要な統合モデルが設定されていない場合
 */
export const planSubtasks: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, appSettings } = context;
  if (!appSettings.integratorModel) {
    throw new Error("計画ステップ(planSubtasks)には統合モデル（プランナー役）が必要です。");
  }

  const plannerPrompt: CoreMessage[] = [
    // 履歴は含めず、最新の質問（タスク）のみで高速に判断
    llmMessages.at(-1)!,
    {
      role: "system",
      content:
        'あなたは優秀なプロジェクトマネージャーです。上記のユーザー要求を達成するために必要な、具体的で実行可能なサブタスクのリストを作成してください。JSON配列（例: ["タスク1", "タスク2"]）の形式で、タスクリストのみを厳密に出力してください。',
    },
  ];

  // 計画ステップはストリーミングしない
  const planRaw = await executeIntegration(apiKeyManager, plannerPrompt, {
    ...appSettings.integratorModel,
    id: "planner",
    enabled: true,
  } as ModelSettings);

  try {
    // Markdownコードブロックを除去
    const planJson = cleanJsonOutput(planRaw);

    const parsed = JSON.parse(planJson);
    if (Array.isArray(parsed)) {
      // 文字列以外が混ざっていても一応 toString でそろえる
      context.subTasks = parsed.map((v) => String(v));
    } else {
      // 想定外の構造はフォールバック
      context.subTasks = [planJson];
    }
    console.log("[Agent Step: Plan]", context.subTasks);
  } catch {
    console.error("[Agent Step: Plan] 計画のJSONパースに失敗しました。応答を単一タスクとして扱います。", planRaw);
    // パース失敗時は、応答テキスト全体を単一のタスクとして扱うフォールバック
    context.subTasks = [planRaw];
  }
  return context;
};

/**
 * [ステップ] 計画：仮説モード用の仮説生成
 * ユーザーの曖昧な質問を分析し、複数の解釈（仮説）を生成します。
 * 結果は `context.subTasks` に（仮説のリストとして）格納されます。
 *
 * @param {AgentContext} context - 現在の実行コンテキスト
 * @returns {Promise<AgentContext>} subTasks (仮説リスト) が追加されたコンテキスト
 * @throws {Error} 仮説ステップの実行に必要な統合モデルが設定されていない場合
 */
export const generateHypotheses: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, appSettings } = context;
  if (!appSettings.integratorModel) {
    throw new Error("仮説ステップ(generateHypotheses)には統合モデルが必要です。");
  }

  const hypoPrompt: CoreMessage[] = [
    llmMessages.at(-1)!, // 最新の質問のみ
    {
      role: "system",
      content:
        'ユーザーのこの曖昧な質問には、複数の解釈が考えられます。考えられる解釈を3つ、JSON配列（例: ["解釈A", "解釈B", "解釈C"]）として、解釈のリストのみを厳密に出力してください。',
    },
  ];

  // 仮説ステップもストリーミングしない
  const hypoRaw = await executeIntegration(apiKeyManager, hypoPrompt, {
    ...appSettings.integratorModel,
    id: "hypothesis",
    enabled: true,
  } as ModelSettings);

  try {
    // Markdownコードブロックを除去
    const hypoJson = cleanJsonOutput(hypoRaw);

    const parsed = JSON.parse(hypoJson);
    if (Array.isArray(parsed)) {
      context.subTasks = parsed.map((v) => String(v));
    } else {
      context.subTasks = [hypoJson];
    }
    console.log("[Agent Step: Hypothesis]", context.subTasks);
    // 仮説モードであることを示すフラグを立てる（統合ステップが参照するため）
    context.isHypothesis = true;
  } catch {
    console.error("[Agent Step: Hypothesis] 仮説のJSONパースに失敗しました。", hypoRaw);
    context.subTasks = [hypoRaw];
    context.isHypothesis = true;
  }
  return context;
};
