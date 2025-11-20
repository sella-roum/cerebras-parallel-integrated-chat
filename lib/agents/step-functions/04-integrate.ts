import { executeIntegration } from "../../llm-core/integrator-executor";
import type { ExecutionStepFunction } from "../types";
import type { CoreMessage } from "ai";
import { StreamProtocol } from "../types";
import type { ModelSettings } from "../../db";

/**
 * [ステップ] 標準的な統合
 * 最後の回答をストリーミングで実行します。
 */
export const integrateStandard: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, appSettings, streamController, parallelResponses } = context;

  if (!appSettings.integratorModel) {
    throw new Error("統合モデルが設定されていません。");
  }
  if (parallelResponses.length === 0) {
    throw new Error("統合対象の並列応答がありません。");
  }

  // 応答が1つだけの場合、その内容をそのままストリーミング
  if (parallelResponses.length === 1) {
    const singleResponse = parallelResponses[0];

    // ストリームコントローラーが存在する場合のみエンキューする
    if (streamController) {
      streamController.enqueue(StreamProtocol.DATA(singleResponse.content));
      context.finalContentStreamed = true; // 手動でストリーミングした
    }

    context.finalContent = singleResponse.content;
    context.modelResponses = parallelResponses;
    return context;
  }

  // 複数の応答がある場合、統合プロンプトを作成
  const integrationPrompt: CoreMessage[] = [
    ...llmMessages.slice(0, -1), // 最後の質問を除く履歴
    {
      role: "user",
      content: `（会話履歴はここまで）\n\n上記の会話の最後の質問（"${
        llmMessages.at(-1)?.content.slice(0, 50) || ""
      }..."）に対して、複数のAIモデルが以下のように応答しました。\n\n${parallelResponses
        .map((r, i) => `[モデル${i + 1}: ${r.model}]\n${r.content}`)
        .join(
          "\n\n",
        )}\n\n--- 統合指示 ---\nこれらの応答をすべてレビューし、会話履歴の文脈を踏まえた上で、最も適切で包括的な「最終回答」を単一の回答として生成してください。レビューはあなた自身の思考として内部処理し、最終的な回答をあなた自身の言葉として出力してください。`,
    },
  ];

  // リトライ付き統合実行（ストリーミング）を呼び出す
  const finalContent = await executeIntegration(
    apiKeyManager,
    integrationPrompt,
    {
      ...appSettings.integratorModel,
      id: "integrator",
      enabled: true,
    } as ModelSettings,
    streamController, // ストリームコントローラーを渡す
  );

  context.finalContent = finalContent; // 最終的な完全なテキスト
  context.modelResponses = parallelResponses; // UI表示用にセット
  context.finalContentStreamed = true; // executeIntegration がストリーミングを担当した
  return context;
};

/**
 * [ステップ] 深層思考（CoT）の統合
 */
export const integrateDeepThought: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, appSettings, streamController, parallelResponses } = context;

  if (!appSettings.integratorModel) throw new Error("統合モデルが設定されていません。");
  if (!parallelResponses || parallelResponses.length === 0) throw new Error("統合対象の応答がありません。");

  // CoT専用の統合プロンプト
  const integrationPrompt: CoreMessage[] = [
    ...llmMessages.slice(0, -1),
    {
      role: "user",
      content: `（履歴ここまで）\n質問：「${llmMessages.at(-1)?.content}」\n\n各モデルの「思考プロセス」と「最終回答」は以下です。\n\n${parallelResponses
        .map((r, i) => `[モデル${i + 1}: ${r.model}]\n[思考]\n${r.thought || "N/A"}\n[最終回答]\n${r.content}`)
        .join(
          "\n\n",
        )}\n\n--- 統合指示 ---\n最も論理的な思考プロセスを参考に、あなた自身の思考を再構築し、最高の最終回答を生成してください。思考プロセスは出力せず、最終回答のみを出力してください。`,
    },
  ];

  const finalContent = await executeIntegration(
    apiKeyManager,
    integrationPrompt,
    {
      ...appSettings.integratorModel,
      id: "integrator",
      enabled: true,
    } as ModelSettings,
    streamController,
  );

  context.finalContent = finalContent;
  context.modelResponses = parallelResponses;
  context.finalContentStreamed = true;
  return context;
};

/**
 * [ステップ] 批評モードの最終統合
 */
export const integrateWithCritiques: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, appSettings, streamController, parallelResponses, critiques } = context;

  if (!appSettings.integratorModel) throw new Error("統合モデルが設定されていません。");
  // ガード処理を追加
  if (!parallelResponses || parallelResponses.length === 0) throw new Error("統合対象の草稿がありません。");
  if (!critiques || critiques.length === 0) throw new Error("統合対象の批評がありません。");

  const drafts = parallelResponses.map((r, i) => `[草稿 ${i + 1}]\n${r.content}`).join("\n\n");
  const critiqueText = critiques.map((c, i) => `[批評 ${i + 1}: ${c.model}]\n${c.content}`).join("\n\n");

  const integrationPrompt: CoreMessage[] = [
    ...llmMessages, // 完全な履歴を渡す
    {
      role: "system",
      content: `（システム）以下は、元の草稿と、それに対する批評です。\n\n---元の草稿---\n${drafts}\n\n---批評---\n${critiqueText}`,
    },
    {
      role: "user",
      content:
        "（指示）あなたは最終編集者です。上記の「批評」をすべて考慮し、「元の草稿」を全面的に修正・改善した、完璧な最終回答を生成してください。元の質問の意図にも沿うように注意してください。",
    },
  ];

  const finalContent = await executeIntegration(
    apiKeyManager,
    integrationPrompt,
    {
      ...appSettings.integratorModel,
      id: "integrator",
      enabled: true,
    } as ModelSettings,
    streamController,
  );

  context.finalContent = finalContent;
  // UIで草稿と批評の両方を見れるように結合
  const allResponses = [...parallelResponses, ...critiques];
  context.parallelResponses = allResponses;
  context.modelResponses = allResponses;

  context.finalContentStreamed = true;
  return context;
};

/**
 * [ステップ] マネージャー/仮説モードの最終レポート統合
 */
export const integrateReport: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, appSettings, streamController, parallelResponses, subTasks } = context;

  if (!appSettings.integratorModel) throw new Error("統合モデルが設定されていません。");
  if (!parallelResponses || parallelResponses.length === 0) throw new Error("統合対象の応答がありません。");

  // subTasks が仮説かタスクかによってプロンプトを少し変える
  const taskType = context.isHypothesis ? "仮説" : "サブタスク";

  const results = parallelResponses
    .map((r, i) => `[${taskType}「${(subTasks && subTasks[i]) || "N/A"}」の結果 (by ${r.model})]\n${r.content}`)
    .join("\n\n");

  const prompt: CoreMessage[] = [
    ...llmMessages,
    { role: "system", content: `（システム）以下の${taskType}の実行結果が報告されました。\n\n${results}` },
    {
      role: "user",
      content: `（指示）あなたはプロジェクトマネージャーです。すべての実行結果をレビュー・統合し、元のユーザー要求に対する単一の、完全で包括的な最終回答（報告書）を作成してください。`,
    },
  ];

  const finalContent = await executeIntegration(
    apiKeyManager,
    prompt,
    {
      ...appSettings.integratorModel,
      id: "integrator",
      enabled: true,
    } as ModelSettings,
    streamController,
  );

  context.finalContent = finalContent;
  context.modelResponses = parallelResponses;
  context.finalContentStreamed = true;
  return context;
};

/**
 * [ステップ] 感情分析を考慮した統合
 */
export const integrateWithEmotion: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, appSettings, streamController, parallelResponses, critiques } = context;

  if (!appSettings.integratorModel) throw new Error("統合モデルが設定されていません。");
  // ガード処理を追加
  if (!parallelResponses || parallelResponses.length === 0) throw new Error("統合対象の応答がありません。");

  // critiques スロットに感情分析の結果が格納されていると仮定
  const analysis = critiques && critiques.length > 0 ? critiques[0].content : '{"emotion": "不明", "tone": "標準"}';
  const drafts = parallelResponses.map((r, i) => `[回答案 ${i + 1}]\n${r.content}`).join("\n---\n");

  const prompt: CoreMessage[] = [
    ...llmMessages,
    { role: "system", content: `（システム）ユーザーの分析結果： ${analysis}\n\n回答の草稿：\n${drafts}` },
    {
      role: "user",
      content:
        "（指示）あなたは共感力のあるアシスタントです。上記の「分析結果」に基づき、「回答の草稿」をユーザーにとって最適なトーン（例：急いでいるなら簡潔に、共感的になど）に書き直して、最終回答を生成してください。",
    },
  ];

  const finalContent = await executeIntegration(
    apiKeyManager,
    prompt,
    {
      ...appSettings.integratorModel,
      id: "integrator",
      enabled: true,
    } as ModelSettings,
    streamController,
  );

  context.finalContent = finalContent;
  context.modelResponses = parallelResponses; // 感情分析の結果はUIに出さない
  context.finalContentStreamed = true;
  return context;
};
