import { executeParallel } from "../../llm-core/parallel-executor";
import { executeIntegration } from "../../llm-core/integrator-executor";
import type { ExecutionStepFunction } from "../types";
import type { CoreMessage } from "ai";
import type { ModelSettings } from "../../db";

/**
 * [ステップ] 標準的な並列実行
 * コンテキスト内の全有効化モデルに対し、共通の履歴を渡して並列実行します。
 * @param {AgentContext} context - 現在の実行コンテキスト
 * @returns {Promise<AgentContext>} 並列実行結果が含まれたコンテキスト
 */
export const executeStandard: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels } = context;

  // 有効なモデルがない場合の明示的なエラーチェック
  if (enabledModels.length === 0) {
    throw new Error("有効化された推論モデルがありません。");
  }

  const responses = await executeParallel(apiKeyManager, enabledModels, llmMessages);

  context.parallelResponses = responses;
  return context;
};

/**
 * [ステップ] エキスパート・チームの並列実行
 * 統合モデルを使用してタスクに必要な「専門家の役割」を動的に生成し、
 * それらを全有効モデルにラウンドロビン方式で割り当てて実行します。
 * 設定画面でモデルに役割が入力されている場合、それは「ユーザーの希望」として
 * 役割生成時のヒントに使用されますが、実行自体は全モデルで行われます。
 * @param {AgentContext} context - 現在の実行コンテキスト
 * @returns {Promise<AgentContext>} 役割分担された回答が含まれたコンテキスト
 */
export const executeExpertTeam: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels, appSettings } = context;

  // 1. 前提チェック
  if (enabledModels.length === 0) {
    throw new Error("有効な推論モデルがありません。");
  }
  if (!appSettings.integratorModel) {
    throw new Error("エキスパート・チームモードには統合モデル（キャプテン役）の設定が必要です。");
  }

  const lastUserMessage = llmMessages.at(-1)?.content || "";

  // ユーザーが設定画面で入力した役割があれば収集（ヒントとして使用）
  const userDefinedRoles = enabledModels
    .map((m) => m.role)
    .filter((r) => r && r.trim() !== "")
    .join(", ");

  const hintText = userDefinedRoles
    ? `\nなお、ユーザーからは以下の役割の希望が出ています（参考程度にしてください）: [${userDefinedRoles}]`
    : "";

  // 2. 役割生成プロンプトの作成
  const roleGenPrompt: CoreMessage[] = [
    {
      role: "user",
      content: `タスク：「${lastUserMessage}」\n\n（指示）このタスクを多角的に解決するために必要な「専門家の役割（ペルソナ）」を、現在利用可能なAIチームの人数（${enabledModels.length}人）に合わせて生成してください。${hintText}\n\n出力は JSON配列形式 ["役割A", "役割B", ...] で、役割名のみを厳密に出力してください。役割は重複しても構いません。`,
    },
  ];

  // 3. 統合モデルによる役割リストの生成（非ストリーミング）
  let generatedRoles: string[] = [];
  try {
    const rolesJson = await executeIntegration(apiKeyManager, roleGenPrompt, {
      ...appSettings.integratorModel,
      id: "role_generator",
      enabled: true,
    } as ModelSettings);

    // JSONパースを試みる
    const parsed = JSON.parse(rolesJson);
    if (Array.isArray(parsed)) {
      generatedRoles = parsed.map(String);
    } else {
      console.warn("[Expert Team] 役割生成の応答が配列ではありませんでした。");
      generatedRoles = [`${rolesJson}`]; // 文字列そのものを役割とする
    }
  } catch (e) {
    console.error("[Expert Team] 役割の生成に失敗しました。デフォルトの専門家として実行します。", e);
    generatedRoles = enabledModels.map(() => "専門家");
  }

  console.log(`[Expert Team] 生成された役割: ${generatedRoles.join(", ")}`);

  // 4. 全モデルへの役割の分配（ラウンドロビン）
  const expertMessagesMap = new Map<string, CoreMessage[]>();

  enabledModels.forEach((model, index) => {
    // モデル数より役割が少ない場合はループ、多い場合はモデル数に合わせて割り当て
    const assignedRole = generatedRoles[index % generatedRoles.length] || "専門家";

    // システムプロンプトに動的な役割を注入
    expertMessagesMap.set(model.id, [
      {
        role: "system",
        content: `（役割指示）あなたは「${assignedRole}」として振る舞ってください。専門的かつ詳細に回答してください。`,
      },
      ...llmMessages,
    ]);
  });

  // 5. 並列実行
  const responses = await executeParallel(
    apiKeyManager,
    enabledModels, // 全モデルを使用
    expertMessagesMap, // 個別の役割プロンプトを使用
  );

  context.parallelResponses = responses;
  return context;
};

/**
 * [ステップ] 深層思考（CoT）の並列実行
 * 全モデルに「思考」と「最終回答」を要求するプロンプトを付与して並列実行し、結果をパースします。
 * @param {AgentContext} context - 現在の実行コンテキスト
 * @returns {Promise<AgentContext>} CoT結果が含まれたコンテキスト
 */
export const executeDeepThought: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels } = context;

  if (enabledModels.length === 0) {
    throw new Error("有効な推論モデルがありません。");
  }

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

    // 修正: ロジックを簡素化
    const answer = answerMatch ? answerMatch[1].trim() : res.content;

    return {
      ...res,
      content: answer, // content を「最終回答」部分のみにする
      thought: thought, // カスタムプロパティとして思考を添付
    };
  });

  return context;
};

/**
 * [ステップ] 批評モード用の「生成役」を実行
 * 全モデルを「草稿作成者」として使用します。
 * @param {AgentContext} context - 現在の実行コンテキスト
 * @returns {Promise<AgentContext>} 草稿が含まれたコンテキスト
 */
export const executeGenerators: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels } = context;

  if (enabledModels.length === 0) {
    throw new Error("有効な推論モデルがありません。");
  }

  // 特定のロールを探すのではなく、全モデルで生成を行う
  const responses = await executeParallel(apiKeyManager, enabledModels, llmMessages);

  context.parallelResponses = responses; // これが「草稿」
  return context;
};

/**
 * [ステップ] 動的ルーターによる最適化実行
 * 統合モデルをルーターとして使用し、タスクに最適な「共通の指示（Instruction）」を生成します。
 * 並列実行は行わず、生成した指示をコンテキストに注入して後続ステップに委ねます。
 * @param {AgentContext} context - 現在の実行コンテキスト
 * @returns {Promise<AgentContext>} 最適化された指示が注入されたコンテキスト
 */
export const executeRouter: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels, appSettings } = context;

  if (enabledModels.length === 0) {
    throw new Error("有効な推論モデルがありません。");
  }
  if (!appSettings.integratorModel) {
    throw new Error("ルーターモードには統合モデル（ルーター役）の設定が必要です。");
  }

  // 1. 統合モデル（ルーター役）が「最適な指示」を考える
  const lastUserMessage = llmMessages.at(-1)?.content || "";
  const routerPrompt: CoreMessage[] = [
    {
      role: "user",
      content: `タスク：「${lastUserMessage}」\n\n（指示）このタスクを最も効果的かつ高品質に解決するために、AIモデルに与えるべき「具体的で戦略的なシステム指示（System Instruction）」を1つ作成してください。\nここでの指示は、役割定義や制約事項を含みます。指示の内容のみを出力してください。`,
    },
  ];

  let dynamicInstruction = "";
  try {
    dynamicInstruction = await executeIntegration(apiKeyManager, routerPrompt, {
      ...appSettings.integratorModel,
      id: "router",
      enabled: true,
    } as ModelSettings);
    console.log(`[Router] 生成された指示:\n${dynamicInstruction}`);
  } catch (e) {
    console.error("[Router] 指示生成に失敗しました。", e);
    dynamicInstruction = "タスクに対して、あなたの能力を最大限に発揮して詳細に回答してください。";
  }

  // 2. 生成された指示をコンテキストのメッセージ履歴に注入する
  // これにより、後続のステップ（executeExpertTeamなど）がこの指示を含んだ状態で実行される
  const routedMessages: CoreMessage[] = [
    { role: "system", content: `（動的戦略指示）\n${dynamicInstruction}` },
    ...llmMessages,
  ];

  // コンテキストを更新して返す（並列実行はしない）
  context.llmMessages = routedMessages;
  return context;
};

/**
 * [ステップ] サブタスク（または仮説）を並列実行
 * `context.subTasks` の内容を、全有効モデルにラウンドロビンで割り当てて実行します。
 * @param {AgentContext} context - 現在の実行コンテキスト
 * @returns {Promise<AgentContext>} サブタスク実行結果が含まれたコンテキスト
 */
export const executeSubtasks: ExecutionStepFunction = async (context) => {
  const { apiKeyManager, llmMessages, enabledModels, subTasks } = context;

  if (!subTasks || subTasks.length === 0) {
    throw new Error("実行すべきサブタスク（または仮説）がありません。");
  }
  if (enabledModels.length === 0) {
    throw new Error("サブタスクを実行するための有効なモデルがありません。");
  }

  const modelsToRun: ModelSettings[] = [];
  const messagesMap = new Map<string, CoreMessage[]>();

  // 各サブタスク（または仮説）を、利用可能なモデルにラウンドロビンで割り当てる
  // モデル数がタスク数より少ない場合、同じモデルが異なるID（仮想モデル）として複数回呼ばれる
  subTasks.forEach((task, index) => {
    const baseModel = enabledModels[index % enabledModels.length]; // ラウンドロビン

    // サブタスクごとにユニークな ID を付与した仮想モデルを作成
    const taskModelId = `${baseModel.id}__subtask_${index}`;
    const taskModel: ModelSettings = { ...baseModel, id: taskModelId };
    modelsToRun.push(taskModel);

    messagesMap.set(taskModelId, [
      ...llmMessages,
      {
        role: "system",
        content: `（サブタスク指示）以下の項目についてのみ、集中して詳細な回答を生成してください：\n「${task}」`,
      },
    ]);
  });

  const responses = await executeParallel(
    apiKeyManager,
    modelsToRun, // 仮想モデルリスト
    messagesMap,
  );

  context.parallelResponses = responses;
  return context;
};
