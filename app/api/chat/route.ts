import { createCerebras } from "@ai-sdk/cerebras";
import { streamText } from "ai";
import { NextRequest, NextResponse } from "next/server";

// 型定義（lib/db.tsから必要に応じてインポート）
interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}
interface ModelSettings {
  modelName: string;
  temperature: number;
  maxTokens: number;
}
interface AppSettings {
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
async function callLlmApi(apiKey: string, messages: Message[], modelSettings: ModelSettings): Promise<string> {
  const cerebras = createCerebras({ apiKey });
  const { textStream } = await streamText({
    model: cerebras(modelSettings.modelName),
    messages: messages,
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
  historyMessages: Message[], // <-- 引数を追加 (POSTハンドラ内の fullMessages を受け取る)
  responses: ModelResponse[],
  integratorModel: ModelSettings,
): Promise<string> {
  // 元の会話履歴 (historyMessages) は、[system?, ...履歴..., user (最新の質問)] を含んでいる。

  // 最後のユーザーメッセージ（最新の質問）を取得
  const lastUserMessage = historyMessages.at(-1);
  // 最後のユーザーメッセージ *以外* の履歴
  const historyWithoutLast = historyMessages.slice(0, -1);

  // 統合モデルに渡すための新しいメッセージ配列 (Message[]) を構築
  const promptMessages: Message[] = [
    // 1. 最後の質問 *より前* の履歴をすべて含める
    ...historyWithoutLast,

    // 2. 最後のメッセージ (user role) を、統合指示用に再構成する
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

  const { messages, modelSettings, appSettings: rawAppSettings, systemPrompt } = await req.json();
  const appSettings: AppSettings = rawAppSettings ?? {};

  const enabledModels: ModelSettings[] = modelSettings.filter((m: any) => m.enabled);
  if (enabledModels.length === 0) {
    return NextResponse.json({ error: "有効な推論モデルが設定されていません" }, { status: 400 });
  }

  // 1. システムプロンプトをメッセージの先頭に追加
  const fullMessages: Message[] = messages.map((m: any) => ({ role: m.role, content: m.content }));
  if (systemPrompt && systemPrompt.trim() !== "") {
    fullMessages.unshift({ role: "system", content: systemPrompt });
  }

  // 2. APIキーのローテーションとフォールバック
  let lastError: any = null;

  for (const apiKey of shuffledApiKeys) {
    try {
      // 3. 並行推論
      const responses = await Promise.all(
        enabledModels.map(async (model) => {
          const content = await callLlmApi(apiKey, fullMessages, model);
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
          fullMessages, // <-- 履歴を追加
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
      });
    } catch (error: any) {
      lastError = error;
      console.warn(`[API Key Fallback] APIキー (末尾...${apiKey.slice(-4)}) でエラー: ${error.message}`);
      // 401 (認証エラー), 429 (レートリミット) などの場合に次のキーを試す
      // ここでは全てのエラーで次のキーを試行
    }
  }

  // すべてのキーで失敗した場合
  console.error("[API Key Fallback] すべてのAPIキーでエラーが発生しました。", lastError);
  return NextResponse.json(
    { error: `すべてのAPIキーで試行しましたが失敗しました: ${lastError?.message || "不明なエラー"}` },
    { status: 500 },
  );
}
