import { createCerebras } from "@ai-sdk/cerebras";
import { streamText, type CoreMessage } from "ai";
import { NextRequest, NextResponse } from "next/server";

// #region 型定義
// 型定義は lib/db.ts と一致させています

/**
 * DBとクライアント間で受け渡される完全なメッセージオブジェクト
 */
interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  conversationId: string;
  modelResponses?: ModelResponse[];
}

/**
 * Vercel AI SDK (streamText) に渡すためのコアメッセージ型
 */
type LlmMessage = CoreMessage;

/**
 * 単一のモデル設定
 * (推論モデルはDB由来のidを持つ)
 */
interface ModelSettings {
  id?: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
}

/**
 * アプリケーション全体のAI設定（要約・統合モデル）
 */
interface AppSettings {
  summarizerModel?: ModelSettings;
  integratorModel?: ModelSettings;
}

/**
 * AIによる個別応答
 */
interface ModelResponse {
  model: string;
  provider: string;
  content: string;
}
// #endregion

// #region 定数
/**
 * 履歴の自動要約がトリガーされるメッセージ件数の閾値
 */
const CONVERSATION_THRESHOLD = 10;
/**
 * 履歴の自動要約がトリガーされる総文字数の閾値
 */
const CONTENT_LENGTH_THRESHOLD = 30000;
/**
 * APIキーの数に関わらず、一時的エラー時に最低限保証するリトライ回数
 */
const MIN_RETRY_ATTEMPTS = 3;
// #endregion

// #region APIキー管理とカスタムエラー

/**
 * HTTPエラーなど、API呼び出しに関する情報を保持するカスタムエラー
 */
class LlmApiError extends Error {
  public status: number;
  public modelName?: string;
  public apiKeyUsed: string;

  /**
   * LlmApiErrorのコンストラクタ
   * @param {string} message - エラーメッセージ
   * @param {number} status - HTTPステータスコード
   * @param {string} apiKeyUsed - 使用されたAPIキー
   * @param {string} [modelName] - (オプション) 使用されたモデル名
   */
  constructor(message: string, status: number, apiKeyUsed: string, modelName?: string) {
    super(message);
    this.name = "LlmApiError";
    this.status = status;
    this.modelName = modelName;
    this.apiKeyUsed = apiKeyUsed;
  }
}

/**
 * リクエストごとにAPIキーのプールを管理し、循環させるクラス
 */
class ApiKeyManager {
  private availableKeys: string[];
  private currentIndex: number = 0;

  /**
   * ApiKeyManagerのコンストラクタ
   * @param {string[]} keys - 使用するAPIキーの配列。内部でシャッフルされます。
   * @throws {Error} キー配列が空の場合
   */
  constructor(keys: string[]) {
    if (keys.length === 0) {
      throw new Error("APIキーがありません。");
    }
    // Fisher-Yates (aka Knuth) Shuffle でシャッフルしてコピー
    const shuffledKeys = [...keys];
    for (let i = shuffledKeys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledKeys[i], shuffledKeys[j]] = [shuffledKeys[j], shuffledKeys[i]];
    }
    this.availableKeys = shuffledKeys;
  }

  /**
   * 現在利用可能なAPIキーの数を取得します。
   * @returns {number} 利用可能なキーの数
   */
  public get keyCount(): number {
    return this.availableKeys.length;
  }

  /**
   * 次に使用するAPIキーを取得します（循環キュー）。
   * 利用可能なキーがない場合は null を返します。
   * @returns {string | null} APIキーまたはnull
   */
  public getNextKey(): string | null {
    if (this.availableKeys.length === 0) {
      return null;
    }
    const key = this.availableKeys[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.availableKeys.length;
    return key;
  }

  /**
   * 永続的なエラー（401など）が発生したキーをプールから削除します。
   * @param {string} keyToRemove - 削除するAPIキー
   */
  public removeKey(keyToRemove: string) {
    const originalLength = this.availableKeys.length;
    this.availableKeys = this.availableKeys.filter((key) => key !== keyToRemove);

    if (this.availableKeys.length < originalLength) {
      console.warn(
        `[ApiKeyManager] APIキー (末尾...${keyToRemove.slice(-4)}) をプールから削除しました (永続的エラー)。`,
      );
      // インデックスが範囲外にならないように調整
      this.currentIndex = this.currentIndex % (this.availableKeys.length || 1);
    }
  }
}

/**
 * 環境変数 `CEREBRAS_API_KEYS` からAPIキーの配列を取得します。
 * カンマ区切りで複数のキーを登録可能です。
 * @returns {string[]} APIキーの配列
 */
function getApiKeys(): string[] {
  const keysEnv = process.env.CEREBRAS_API_KEYS || "";
  return keysEnv.split(",").filter((key) => key.trim() !== "");
}

/**
 * 発生したLlmApiErrorを分類し、リトライ戦略を決定します。
 * @param {LlmApiError} error - 分類対象のエラー
 * @returns {{ isPermanent: boolean, removeKey: boolean, removeModel: boolean }}
 * - `isPermanent`: リトライしても無駄な永続的エラーか
 * - `removeKey`: このAPIキーをプールから削除すべきか (401, 403)
 * - `removeModel`: このモデルをリトライ対象から除外すべきか (404, 400)
 */
function classifyError(error: LlmApiError): { isPermanent: boolean; removeKey: boolean; removeModel: boolean } {
  const status = error.status;

  if (status === 401 || status === 403) {
    // 認証・権限エラー (キーが悪い)
    return { isPermanent: true, removeKey: true, removeModel: false };
  }
  if (status === 404) {
    // Not Found (モデル名が悪い)
    return { isPermanent: true, removeKey: false, removeModel: true };
  }
  if (status >= 400 && status < 500 && status !== 429) {
    // その他のクライアントエラー (リクエストが悪いなど。リトライしても無駄)
    return { isPermanent: true, removeKey: false, removeModel: true };
  }
  // 一時的エラー (429 レートリミット, 5xx サーバーエラー) はリトライ対象
  return { isPermanent: false, removeKey: false, removeModel: false };
}
// #endregion

// #region LLM呼び出しラッパー

/**
 * 単一のLLM呼び出し（ストリームをテキストに集約）
 * API SDKのエラーを捕捉し、HTTPステータスコードを含むカスタムエラーをスローします。
 * @param {string} apiKey - 使用するCerebras APIキー
 * @param {LlmMessage[]} messages - LLMに渡すメッセージ履歴
 * @param {ModelSettings} modelSettings - 使用するモデルの設定
 * @returns {Promise<string>} LLMからのテキスト応答
 * @throws {LlmApiError} API呼び出しが失敗した場合
 */
async function callLlmApi(apiKey: string, messages: LlmMessage[], modelSettings: ModelSettings): Promise<string> {
  try {
    const cerebras = createCerebras({ apiKey });
    const { textStream } = await streamText({
      model: cerebras(modelSettings.modelName),
      messages: messages,
      temperature: modelSettings.temperature,
      maxOutputTokens: modelSettings.maxTokens,
    });

    let fullText = "";
    for await (const textPart of textStream) {
      fullText += textPart;
    }
    return fullText;
  } catch (error: any) {
    // Vercel AI SDK (ai) は 'cause' プロパティに元のフェッチ応答を含むことが多い
    const response: Response | undefined = error.cause;
    const status = response?.status || 500; // 不明なエラーは500とする

    // 401:認証, 403:権限, 404:モデル不明, 429:レートリミット
    throw new LlmApiError(error.message || "LLM API呼び出しで不明なエラー", status, apiKey, modelSettings.modelName);
  }
}

/**
 * 統合モデルを呼び出すための専用ラッパー
 * @param {string} apiKey - 使用するCerebras APIキー
 * @param {LlmMessage[]} historyMessages - 完全な会話履歴（要約済みの場合あり）
 * @param {ModelResponse[]} responses - 並行推論モデルからの応答配列
 * @param {ModelSettings} integratorModel - 統合モデルの設定
 * @returns {Promise<string>} 統合モデルによる最終回答
 * @throws {LlmApiError} API呼び出しが失敗した場合
 */
async function callIntegrator(
  apiKey: string,
  historyMessages: LlmMessage[],
  responses: ModelResponse[],
  integratorModel: ModelSettings,
): Promise<string> {
  // 最新のユーザーメッセージ（質問）とそれ以前の履歴を分離
  const lastUserMessage = historyMessages.at(-1);
  const historyWithoutLast = historyMessages.slice(0, -1);

  // 統合モデルに渡すための特別なプロンプトを構築
  const promptMessages: LlmMessage[] = [
    ...historyWithoutLast,
    {
      role: "user",
      content: `（会話履歴はここまで）\n\n上記の会話の最後の質問（"${
        lastUserMessage?.content.slice(0, 50) || ""
      }..."）に対して、複数のAIモデルが以下のように応答しました。\n\n${responses
        .map((r, i) => `[モデル${i + 1}: ${r.model}]\n${r.content}`)
        .join(
          "\n\n",
        )}\n\n--- 統合指示 ---\nこれらの応答をすべてレビューし、会話履歴の文脈を踏まえた上で、最も適切で包括的な「最終回答」を単一の回答として生成してください。レビューはあなた自身の思考として内部処理し、最終的な回答をあなた自身の言葉として出力してください。`,
    },
  ];

  // callLlmApiは LlmApiError をスローする可能性がある
  return callLlmApi(apiKey, promptMessages, integratorModel);
}
// #endregion

// #region POSTハンドラ (メインロジック)

/**
 * メインのチャットAPIエンドポイント
 */
export async function POST(req: NextRequest) {
  let apiKeyManager: ApiKeyManager;
  try {
    apiKeyManager = new ApiKeyManager(getApiKeys());
  } catch (error: any) {
    // getApiKeys() が空配列を返し、ApiKeyManager のコンストラクタがエラーを投げた場合
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const {
    messages,
    modelSettings,
    appSettings: rawAppSettings,
    systemPrompt,
    totalContentLength,
  } = (await req.json()) as {
    messages: Message[];
    modelSettings: (ModelSettings & { enabled: boolean })[];
    appSettings: AppSettings | null;
    systemPrompt?: string;
    totalContentLength: number;
  };
  const appSettings: AppSettings = rawAppSettings ?? {};

  const enabledModels: (ModelSettings & { enabled: boolean })[] = modelSettings.filter((m: any) => m.enabled);
  if (enabledModels.length === 0) {
    return NextResponse.json({ error: "有効な推論モデルが設定されていません" }, { status: 400 });
  }

  let processedMessages: Message[] = [...messages];
  let didSummarize = false;
  let newHistoryContext: Message[] | null = null;
  let lastApiError: LlmApiError | null = null;

  // --- 1. 要約ステップ (リトライロジック付き) ---
  const isTooLongByCount = processedMessages.length > CONVERSATION_THRESHOLD;
  const isTooLongByLength = totalContentLength > CONTENT_LENGTH_THRESHOLD;

  if (appSettings.summarizerModel && (isTooLongByCount || isTooLongByLength)) {
    console.log(`[Summarizer] 履歴が閾値を超えたため要約を実行します。`);

    const lastUserMessage = processedMessages.at(-1)!;
    const messagesToSummarize = processedMessages.slice(0, -1);

    const summaryPromptMessages: LlmMessage[] = [
      ...messagesToSummarize.map((m) => ({ role: m.role, content: m.content })),
      {
        role: "user",
        content: `（指示）上記の会話履歴全体を、重要な文脈を失わないように、第三者視点で詳細な要約に圧縮してください。システムプロンプト（「${
          systemPrompt || "なし"
        }」）の指示も考慮に入れてください。`,
      },
    ];

    let summaryContent: string | null = null;
    let summaryAttempts = 0;
    let maxSummaryAttempts = Math.max(apiKeyManager.keyCount, MIN_RETRY_ATTEMPTS);

    while (summaryAttempts < maxSummaryAttempts && summaryContent === null) {
      if (apiKeyManager.keyCount === 0) {
        console.error("[Summarizer] すべてのAPIキーが利用不可になりました。");
        break; // すべてのキーが認証エラーで除外された
      }

      summaryAttempts++;
      const apiKey = apiKeyManager.getNextKey()!;

      try {
        summaryContent = await callLlmApi(apiKey, summaryPromptMessages, appSettings.summarizerModel);
      } catch (error: any) {
        if (error instanceof LlmApiError) {
          lastApiError = error;
          console.warn(
            `[Summarizer] ${summaryAttempts}回目 失敗 (Key: ...${apiKey.slice(-4)}, Status: ${error.status})`,
            error.message,
          );
          const { isPermanent, removeKey } = classifyError(error);

          if (isPermanent && removeKey) {
            apiKeyManager.removeKey(apiKey);
            const remainingKeys = apiKeyManager.keyCount;
            maxSummaryAttempts = Math.max(maxSummaryAttempts, summaryAttempts + remainingKeys);
          }
        } else {
          // 予期せぬエラー
          console.error("[Summarizer] 予期せぬエラー", error);
          lastApiError = new LlmApiError(error.message, 500, apiKey);
        }
      }
    }

    if (summaryContent) {
      didSummarize = true;
      const summaryMessage: Message = {
        id: `msg_summary_${Date.now()}`,
        role: "system",
        content: `[以前の会話の要約]\n${summaryContent}`,
        timestamp: Date.now(),
        conversationId: lastUserMessage.conversationId,
      };
      // 以降の処理で使用するメッセージ履歴を「要約＋最新の質問」に置き換える
      processedMessages = [summaryMessage, lastUserMessage];
      // クライアントDB同期用に、要約メッセージ本体を格納
      newHistoryContext = [summaryMessage];
    } else {
      console.error("[Summarizer] 要約に失敗しました。圧縮されていない履歴で続行します。", lastApiError);
      // 注: 要約に失敗しても、エラーにはせず、圧縮されていない履歴で処理を続行する
    }
  }

  // --- 2. メッセージ履歴の準備 ---
  // (要約済み、または元の) 履歴の先頭にシステムプロンプトを挿入
  const fullMessages: Message[] = [...processedMessages];
  if (systemPrompt && systemPrompt.trim() !== "") {
    fullMessages.unshift({
      id: "system_prompt",
      role: "system",
      content: systemPrompt,
      timestamp: Date.now(),
      conversationId: messages[0]?.conversationId || "unknown",
    });
  }

  // LLM APIに渡すために、最小限の型 (LlmMessage) にマッピング
  const messagesForLlm: LlmMessage[] = fullMessages.map((m) => ({ role: m.role, content: m.content }));

  // --- 3a. 並行推論 (個別リトライロジック付き) ---

  // 各モデルの実行タスクを定義
  let modelTasks = enabledModels.map((model) => ({
    modelSettings: model,
    status: "pending" as "pending" | "fulfilled" | "failed",
    result: null as ModelResponse | null,
    attempts: 0,
    maxAttempts: Math.max(apiKeyManager.keyCount, MIN_RETRY_ATTEMPTS),
  }));

  let pendingTasks = modelTasks.filter((t) => t.status === "pending");

  while (pendingTasks.length > 0) {
    if (apiKeyManager.keyCount === 0) {
      console.error("[Inference] すべてのAPIキーが利用不可になりました。");
      break; // 全キーが認証エラーなどで除外された
    }

    const results = await Promise.allSettled(
      pendingTasks.map(async (task) => {
        task.attempts++;
        const apiKey = apiKeyManager.getNextKey()!;
        try {
          const content = await callLlmApi(apiKey, messagesForLlm, task.modelSettings);
          // 成功オブジェクトにapiKeyUsedを含めない（セキュリティのため）
          return { model: task.modelSettings.modelName, provider: "cerebras", content };
        } catch (error: any) {
          // エラーオブジェクトは LlmApiError として再スロー
          if (error instanceof LlmApiError) {
            throw error;
          }
          throw new LlmApiError(error.message, 500, apiKey, task.modelSettings.modelName);
        }
      }),
    );

    // 実行結果を精査
    const nextPendingTasks: typeof pendingTasks = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const task = pendingTasks[i];

      if (result.status === "fulfilled" && result.value.content) {
        // 成功
        task.status = "fulfilled";
        task.result = result.value;
      } else {
        // 失敗
        const error: LlmApiError = (result as PromiseRejectedResult).reason;
        lastApiError = error;
        console.warn(
          `[Inference] ${task.modelSettings.modelName} が ${task.attempts}回目 失敗 (Key: ...${error.apiKeyUsed.slice(-4)}, Status: ${error.status})`,
        );

        const { isPermanent, removeKey, removeModel } = classifyError(error);

        if (removeKey) {
          apiKeyManager.removeKey(error.apiKeyUsed);
          const remainingKeys = apiKeyManager.keyCount;
          modelTasks.forEach((t) => {
            t.maxAttempts = Math.max(t.maxAttempts, t.attempts + remainingKeys);
          });
        }

        if (isPermanent && removeModel) {
          // 404などモデル固有の問題。このタスクは諦める
          task.status = "failed";
          console.error(
            `[Inference] ${task.modelSettings.modelName} は永続的エラー (${error.status}) のため除外されます。`,
          );
        } else if (task.attempts < task.maxAttempts) {
          // 一時的エラー。リトライリストに追加
          nextPendingTasks.push(task);
        } else {
          // リトライ上限に達した
          task.status = "failed";
          console.error(
            `[Inference] ${task.modelSettings.modelName} は全 ${task.maxAttempts} 回の試行に失敗しました。`,
          );
        }
      }
    }
    pendingTasks = nextPendingTasks; // 次のループで実行するタスクを更新
  }

  // 成功した結果のみを収集
  const validResponses = modelTasks.filter((t) => t.status === "fulfilled" && t.result).map((t) => t.result!);

  if (validResponses.length === 0) {
    return NextResponse.json(
      { error: `全ての推論モデルが応答に失敗しました: ${lastApiError?.message || "不明なエラー"}` },
      { status: 500 },
    );
  }

  // --- 3b. 統合 (リトライロジック付き) ---
  let finalContent: string;

  if (validResponses.length > 1 && appSettings.integratorModel) {
    // 応答が複数あり、統合モデルが設定されていれば統合を実行
    let integrationSuccess = false;
    let integrationAttempts = 0;
    let maxIntegrationAttempts = Math.max(apiKeyManager.keyCount, MIN_RETRY_ATTEMPTS);

    while (integrationAttempts < maxIntegrationAttempts && !integrationSuccess) {
      if (apiKeyManager.keyCount === 0) {
        console.error("[Integrator] すべてのAPIキーが利用不可になりました。");
        break; // 全キーが除外された
      }

      integrationAttempts++;
      const apiKey = apiKeyManager.getNextKey()!;
      try {
        finalContent = await callIntegrator(apiKey, messagesForLlm, validResponses, appSettings.integratorModel);
        integrationSuccess = true; // 成功
      } catch (error: any) {
        if (error instanceof LlmApiError) {
          lastApiError = error;
          console.warn(
            `[Integrator] ${integrationAttempts}回目 失敗 (Key: ...${apiKey.slice(-4)}, Status: ${error.status})`,
          );
          const { isPermanent, removeKey } = classifyError(error);

          if (isPermanent && removeKey) {
            apiKeyManager.removeKey(apiKey);
            const remainingKeys = apiKeyManager.keyCount;
            maxIntegrationAttempts = Math.max(maxIntegrationAttempts, integrationAttempts + remainingKeys);
          }
        } else {
          lastApiError = new LlmApiError(error.message, 500, apiKey);
        }
      }
    }

    if (!integrationSuccess) {
      console.error("[Integrator] すべてのAPIキーで統合に失敗しました。", lastApiError);
      return NextResponse.json(
        { error: `統合モデルの呼び出しに失敗しました: ${lastApiError?.message || "不明なエラー"}` },
        { status: 500 },
      );
    }
  } else {
    // 応答が1つだけ、または統合モデルがない場合は、最初のモデルの応答をそのまま使用
    finalContent = validResponses[0].content;
  }

  // --- 4. 成功応答 ---
  return NextResponse.json({
    content: finalContent!,
    modelResponses: validResponses,
    summaryExecuted: didSummarize,
    newHistoryContext: newHistoryContext,
  });
}
// #endregion
