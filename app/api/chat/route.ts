import { createCerebras } from "@ai-sdk/cerebras";
import { streamText } from "ai";
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
 * Vercel AI SDK (streamText) に渡すための最小限のメッセージ型
 */
interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * 単一のモデル設定
 */
interface ModelSettings {
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
// #endregion

// #region APIキー管理

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
 * Fisher-Yates (aka Knuth) Shuffle
 * 配列をランダムにシャッフルします（非破壊的）。
 * これにより、APIキーの使用順序が分散され、レートリミットを回避しやすくなります。
 * @param {T[]} array シャッフルする配列
 * @returns {T[]} シャッフルされた新しい配列
 */
function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array]; // 元の配列をコピー
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}
// #endregion

// #region LLM呼び出しラッパー

/**
 * 単一のLLM呼び出し（ストリームをテキストに集約）
 * この関数が失敗すると、フォールバックがトリガーされます。
 * @param {string} apiKey - 使用するCerebras APIキー
 * @param {LlmMessage[]} messages - LLMに渡すメッセージ履歴
 * @param {ModelSettings} modelSettings - 使用するモデルの設定
 * @returns {Promise<string>} LLMからのテキスト応答
 * @throws API呼び出しが失敗した場合にエラーをスローします
 */
async function callLlmApi(apiKey: string, messages: LlmMessage[], modelSettings: ModelSettings): Promise<string> {
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
}

/**
 * 統合モデルを呼び出すための専用ラッパー
 * @param {string} apiKey - 使用するCerebras APIキー
 * @param {LlmMessage[]} historyMessages - 完全な会話履歴（要約済みの場合あり）
 * @param {ModelResponse[]} responses - 並行推論モデルからの応答配列
 * @param {ModelSettings} integratorModel - 統合モデルの設定
 * @returns {Promise<string>} 統合モデルによる最終回答
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

  return callLlmApi(apiKey, promptMessages, integratorModel);
}
// #endregion

// #region POSTハンドラ (メインロジック)

/**
 * メインのチャットAPIエンドポイント
 */
export async function POST(req: NextRequest) {
  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) {
    return NextResponse.json({ error: "APIキーがサーバーに設定されていません" }, { status: 500 });
  }

  // APIキーをシャッフルし、レートリミットに備える
  const shuffledApiKeys = shuffleArray(apiKeys);

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

  const enabledModels: ModelSettings[] = modelSettings.filter((m: any) => m.enabled);
  if (enabledModels.length === 0) {
    return NextResponse.json({ error: "有効な推論モデルが設定されていません" }, { status: 400 });
  }

  let processedMessages: Message[] = [...messages];
  let didSummarize = false;
  let newHistoryContext: Message[] | null = null;

  const isTooLongByCount = processedMessages.length > CONVERSATION_THRESHOLD;
  const isTooLongByLength = totalContentLength > CONTENT_LENGTH_THRESHOLD;

  // --- 1. 要約ステップ ---
  if (appSettings.summarizerModel && (isTooLongByCount || isTooLongByLength)) {
    console.log(
      `[Summarizer] 履歴が閾値を超えたため要約を実行します。(件数: ${processedMessages.length}, 文字数: ${totalContentLength})`,
    );

    const lastUserMessage = processedMessages.at(-1)!;
    const messagesToSummarize = processedMessages.slice(0, -1);

    let summaryContent: string | null = null;
    let lastError: any = null;

    // 要約ステップでもAPIキーフォールバックを実行
    for (const apiKey of shuffledApiKeys) {
      try {
        const summaryPromptMessages: LlmMessage[] = [
          ...messagesToSummarize.map((m) => ({ role: m.role, content: m.content })),
          {
            role: "user",
            content: `（指示）上記の会話履歴全体を、重要な文脈を失わないように、第三者視点で詳細な要約に圧縮してください。システムプロンプト（「${
              systemPrompt || "なし"
            }」）の指示も考慮に入れてください。`,
          },
        ];

        summaryContent = await callLlmApi(apiKey, summaryPromptMessages, appSettings.summarizerModel);
        if (summaryContent) break; // 成功したらループを抜ける
      } catch (error: any) {
        lastError = error;
        console.warn(`[API Key Fallback] APIキー (末尾...${apiKey.slice(-4)}) で要約エラー: ${error.message}`);
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
      console.error("[Summarizer] すべてのAPIキーで要約に失敗しました。", lastError);
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

  // --- 3. 推論 & 統合ステップ (APIキーフォールバックループ) ---
  let lastError: any = null;

  for (const apiKey of shuffledApiKeys) {
    try {
      // 3a. 並行推論
      const responses = await Promise.all(
        enabledModels.map(async (model) => {
          const content = await callLlmApi(apiKey, messagesForLlm, model);
          return { model: model.modelName, provider: "cerebras", content };
        }),
      );

      const validResponses = responses.filter((r) => r.content);
      if (validResponses.length === 0) {
        throw new Error("全ての推論モデルが応答に失敗しました。");
      }

      // 3b. 統合
      let finalContent: string;
      if (validResponses.length > 1 && appSettings.integratorModel) {
        // 応答が複数あり、統合モデルが設定されていれば統合を実行
        finalContent = await callIntegrator(apiKey, messagesForLlm, validResponses, appSettings.integratorModel);
      } else {
        // 応答が1つだけ、または統合モデルがない場合は、最初のモデルの応答をそのまま使用
        finalContent = validResponses[0].content;
      }

      // 成功したら結果を返して終了
      return NextResponse.json({
        content: finalContent,
        modelResponses: validResponses,
        summaryExecuted: didSummarize,
        newHistoryContext: newHistoryContext,
      });
    } catch (error: any) {
      lastError = error;
      // このキーでは失敗したため、次のキーで再試行
      console.warn(`[API Key Fallback] APIキー (末尾...${apiKey.slice(-4)}) でエラー: ${error.message}`);
    }
  }

  // すべてのキーで失敗した場合
  console.error("[API Key Fallback] すべてのAPIキーでエラーが発生しました。", lastError);
  return NextResponse.json(
    { error: `すべてのAPIキーで試行しましたが失敗しました: ${lastError?.message || "不明なエラー"}` },
    { status: 500 },
  );
}
