import { executeParallel } from "../../llm-core/parallel-executor";
import { executeIntegration } from "../../llm-core/integrator-executor";
import type { ExecutionStepFunction } from "../types";
import type { CoreMessage } from "ai";
import type { ModelSettings } from "../../db";

/**
 * [ステップ] 標準的な並列実行
 * コンテキスト内の全有効化モデルに対し、共通の履歴を渡して並列実行します。
 */
export const executeStandard: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels } = context;

  const responses = await executeParallel(apiKeyManager, enabledModels, llmMessages);

  context.parallelResponses = responses;
  return context;
};

/**
 * [ステップ] 役割ベース（エキスパート）の並列実行
 * `role` が設定されたモデルのみを抽出し、モデルごとに異なる（役割を注入した）プロンプトで並列実行します。
 */
export const executeExpertTeam: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels } = context;

  const expertModels = enabledModels.filter((m) => m.role && m.role.trim() !== "");
  if (expertModels.length === 0) {
    throw new Error("「エキスパート・チーム」モードが選択されましたが、役割(role)が設定されたモデルがありません。");
  }

  // ★ モデルIDごとに異なるプロンプト（役割）を準備
  const expertMessagesMap = new Map<string, CoreMessage[]>();
  for (const model of expertModels) {
    // 履歴の先頭に役割プロンプトを挿入
    const rolePrompt: CoreMessage = { role: "system", content: model.role! };
    expertMessagesMap.set(model.id, [rolePrompt, ...llmMessages]);
  }

  const responses = await executeParallel(
    apiKeyManager,
    expertModels, // 役割が設定されたモデルのみ実行
    expertMessagesMap,
  );

  context.parallelResponses = responses;
  return context;
};

/**
 * [ステップ] 深層思考（CoT）の並列実行
 * 全モデルに「思考」と「最終回答」を要求するプロンプトを付与して並列実行し、結果をパースします。
 */
export const executeDeepThought: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels } = context;

  const cotPrompt: CoreMessage = {
    role: "system",
    content:
      "あなたは論理的なAIです。以下の形式で厳密に回答してください。\n[思考]\n（まず、質問を分析し、回答へのステップを詳細に記述してください）\n[/思考]\n\n[最終回答]\n（思考に基づいた最終的な回答を記述してください）",
  };
  const cotMessages = [...llmMessages, cotPrompt];

  // CoTはプロンプトが共通なので、Mapではなく共通メッセージとして渡す
  const rawResponses = await executeParallel(apiKeyManager, enabledModels, cotMessages);

  // パースして [思考] と [最終回答] を分離
  context.parallelResponses = rawResponses.map((res) => {
    const thoughtMatch = res.content.match(/\[思考\]([\s\S]*?)\[\/思考\]/);
    const answerMatch = res.content.match(/\[最終回答\]([\s\S]*)/);

    const thought = thoughtMatch ? thoughtMatch[1].trim() : "（思考の抽出に失敗）";
    // 思考が抽出できても回答が抽出できない場合、全体を回答とする（フォールバック）
    const answer = answerMatch ? answerMatch[1].trim() : thoughtMatch ? res.content : res.content;

    return {
      ...res,
      content: answer, // content を「最終回答」部分のみにする
      thought: thought, // ★カスタムプロパティとして思考を添付
    };
  });

  return context;
};

/**
 * [ステップ] 批評モード用の「生成役」を実行
 * "generate" ロールを持つモデル（または全モデル）で草稿を作成します。
 */
export const executeGenerators: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels } = context;

  // "generate" ロールが設定されているモデルを探す
  let generatorModels = enabledModels.filter((m) => m.role?.toLowerCase() === "generate");

  // 1つもなければ、全有効化モデルを Generator として扱う
  if (generatorModels.length === 0) {
    console.warn("[Agent Step: executeGenerators] 'generate' ロールのモデルがないため、全有効モデルを実行します。");
    generatorModels = enabledModels;
  }

  const responses = await executeParallel(apiKeyManager, generatorModels, llmMessages);
  context.parallelResponses = responses; // これが「草稿」
  return context;
};

/**
 * [ステップ] 動的ルーターが最適なモデル（役割）を選定する
 * 統合モデルをプランナーとして使い、実行対象のモデルを絞り込みます。
 */
export const executeRouter: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels, appSettings } = context;

  if (!appSettings.integratorModel) {
    throw new Error("ルーターモードには統合モデル（ルーター役）の設定が必要です。");
  }

  const availableRoles = [...new Set(enabledModels.map((m) => m.role).filter(Boolean) as string[])];

  if (availableRoles.length === 0) {
    throw new Error("ルーターモードが選択されましたが、役割(role)が設定されたモデルがありません。");
  }

  const roleList = availableRoles.join(", ");
  const lastUserMessage = llmMessages.at(-1)?.content || "";

  const routerPrompt: CoreMessage[] = [
    // 履歴は含めず、最新の質問のみで高速に判断
    {
      role: "user",
      content: `タスク：「${lastUserMessage}」\n\n（指示）上記のタスクを解決するのに最も適した専門家（の役割）を、以下のリストからカンマ区切りで選んでください。リストにない役割は選ばないでください。\n\n利用可能な専門家リスト: [${roleList}]\n\n最適な専門家:`,
    },
  ];

  // executeIntegration を非ストリーミングで呼び出す
  // 型不整合を解消
  const routerResponse = await executeIntegration(apiKeyManager, routerPrompt, {
    ...appSettings.integratorModel,
    id: "router",
    enabled: true,
  } as ModelSettings);

  const selectedRoles = routerResponse.split(",").map((r) => r.trim());

  // ★重要： コンテキストの enabledModels を、ルーターが選んだ役割を持つモデルのみに上書き
  context.enabledModels = enabledModels.filter((m) => m.role && selectedRoles.includes(m.role));

  if (context.enabledModels.length === 0) {
    console.warn(
      `[Agent Step: Router] ルーターが役割 [${selectedRoles}] を選びましたが、該当モデルがありません。全モデルでフォールバックします。`,
    );
    context.enabledModels = enabledModels; // フォールバック
  }

  console.log(`[Agent Step: Router] 実行チームを選定: ${context.enabledModels.map((m) => m.role).join(", ")}`);
  return context;
};

/**
 * [ステップ] サブタスク（または仮説）を並列実行
 * `context.subTasks` の内容を、利用可能なモデルに割り当てて実行します。
 */
export const executeSubtasks: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels, subTasks } = context;

  if (!subTasks || subTasks.length === 0) {
    throw new Error("実行すべきサブタスク（または仮説）がありません。");
  }
  if (enabledModels.length === 0) {
    throw new Error("サブタスクを実行するための有効なモデルがありません。");
  }

  const models = enabledModels;
  const messagesMap = new Map<string, CoreMessage[]>();
  const modelsToRun: ModelSettings[] = [];

  // 各サブタスク（または仮説）を、利用可能なモデルにラウンドロビンで割り当てる
  subTasks.forEach((task, index) => {
    const model = models[index % models.length]; // ラウンドロビン
    modelsToRun.push(model);

    // このモデルID（一意）にタスクを割り当て
    messagesMap.set(model.id, [
      ...llmMessages, // 完全な履歴
      {
        role: "system",
        content: `（指示）以下のサブタスク（または仮説）について、詳細な回答を生成してください：\n「${task}」`,
      },
    ]);
  });

  const responses = await executeParallel(
    apiKeyManager,
    modelsToRun, // 実際に割り当てたモデル
    messagesMap, // モデルID -> タスクプロンプト のMap
  );

  context.parallelResponses = responses;
  return context;
};
