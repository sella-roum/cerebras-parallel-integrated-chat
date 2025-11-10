import { createCerebras } from "@ai-sdk/cerebras";
import { streamText } from "ai";
import { NextRequest, NextResponse } from "next/server";

// 型定義を lib/db.ts と一致させる
interface Message {
  id: string; // db.ts に合わせて id を追加
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number; // db.ts に合わせて timestamp を追加
  conversationId: string; // db.ts に合わせて conversationId を追加
  modelResponses?: ModelResponse[]; // db.ts に合わせて modelResponses を追加
}
// (LlmApi に渡す用の最小限の型)
interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ModelSettings {
  modelName: string;
  temperature: number;
  maxTokens: number;
}
interface AppSettings {
  summarizerModel?: ModelSettings;
  integratorModel?: ModelSettings;
}
interface ModelResponse {
  model: string;
  provider: string;
  content: string;
}

/**
 * 環境変数からAPIキーのリストを取得
 */
function getApiKeys(): string[] {
  const keysEnv = process.env.CEREBRAS_API_KEYS || "";
  return keysEnv.split(",").filter((key) => key.trim() !== "");
}

/**
 * 単一のLLM呼び出し（ストリームをテキストに集約）
 * この関数が失敗すると、フォールバックがトリガーされます。
 */
async function callLlmApi(apiKey: string, messages: LlmMessage[], modelSettings: ModelSettings): Promise<string> {
  const cerebras = createCerebras({ apiKey });
  const { textStream } = await streamText({
    model: cerebras(modelSettings.modelName),
    messages: messages, // LlmMessage[] を受け取る
    temperature: modelSettings.temperature,
    maxTokens: modelSettings.maxTokens,
  });

  let fullText = "";
  for await (const textPart of textStream) {
    fullText += textPart;
  }
  return fullText;
}

/**
 * 統合モデルの呼び出し
 * (会話履歴もコンテキストとして含める)
 */
async function callIntegrator(
  apiKey: string,
  historyMessages: LlmMessage[], // LlmMessage[] を受け取る
  responses: ModelResponse[],
  integratorModel: ModelSettings,
): Promise<string> {
  // 最後のユーザーメッセージ（最新の質問）を取得
  const lastUserMessage = historyMessages.at(-1);
  // 最後のユーザーメッセージ *以外* の履歴
  const historyWithoutLast = historyMessages.slice(0, -1);

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

/**
 * Fisher-Yates (aka Knuth) Shuffle
 * 配列をランダムにシャッフルする（インプレースではありません）
 */
function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array]; // 配列をコピー
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]]; // 要素を交換
  }
  return newArray;
}

/**
 * メインのPOSTリクエストハンドラ
 */
export async function POST(req: NextRequest) {
  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) {
    return NextResponse.json({ error: "APIキーがサーバーに設定されていません" }, { status: 500 });
  }

  const shuffledApiKeys = shuffleArray(apiKeys);

  // totalContentLength を受け取り、messages の型を Message[] に
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

  const CONVERSATION_THRESHOLD = 10;
  const CONTENT_LENGTH_THRESHOLD = 8000;

  let processedMessages: Message[] = [...messages];
  let didSummarize = false;
  let newHistoryContext: Message[] | null = null;

  const isTooLongByCount = processedMessages.length > CONVERSATION_THRESHOLD;
  const isTooLongByLength = totalContentLength > CONTENT_LENGTH_THRESHOLD;

  if (appSettings.summarizerModel && (isTooLongByCount || isTooLongByLength)) {
    console.log(
      `[Summarizer] 履歴が閾値を超えたため要約を実行します。(件数: ${processedMessages.length}, 文字数: ${totalContentLength})`,
    );

    const lastUserMessage = processedMessages.at(-1)!;
    const messagesToSummarize = processedMessages.slice(0, -1);

    let summaryContent: string | null = null;
    let lastError: any = null;

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

        if (summaryContent) break;
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

      processedMessages = [summaryMessage, lastUserMessage];
      newHistoryContext = [summaryMessage];
    } else {
      console.error("[Summarizer] すべてのAPIキーで要約に失敗しました。", lastError);
    }
  }

  // 1. システムプロンプトをメッセージの先頭に追加
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

  // 2. APIキーのローテーションとフォールバック
  let lastError: any = null;

  // callLlmApi に渡すために、最小限の型にマッピング
  const messagesForLlm: LlmMessage[] = fullMessages.map((m) => ({ role: m.role, content: m.content }));

  for (const apiKey of shuffledApiKeys) {
    try {
      // 3. 並行推論
      const responses = await Promise.all(
        enabledModels.map(async (model) => {
          const content = await callLlmApi(apiKey, messagesForLlm, model); // messagesForLlm を使用
          return { model: model.modelName, provider: "cerebras", content };
        }),
      );

      const validResponses = responses.filter((r) => r.content);
      if (validResponses.length === 0) {
        throw new Error("全ての推論モデルが応答に失敗しました。");
      }

      // 4. 統合
      let finalContent: string;
      if (validResponses.length > 1 && appSettings.integratorModel) {
        finalContent = await callIntegrator(
          apiKey,
          messagesForLlm, // messagesForLlm を使用
          validResponses,
          appSettings.integratorModel,
        );
      } else {
        finalContent = validResponses[0].content;
      }

      // 成功したら結果を返して終了
      return NextResponse.json({
        content: finalContent,
        modelResponses: validResponses,
        summaryExecuted: didSummarize, // ▼ 変更点： 要約フラグを返す
        newHistoryContext: newHistoryContext, // ▼ 変更点： 要約コンテキストを返す
      });
    } catch (error: any) {
      lastError = error;
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
