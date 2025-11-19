import { createCerebras } from "@ai-sdk/cerebras";
import { streamText, type CoreMessage } from "ai";
import { LlmApiError } from "./api-key-manager";
import type { ModelSettings } from "../db";
import { StreamProtocol } from "../agents/types";

/**
 * 単一のLLM呼び出し（非ストリーミング、テキスト集約）
 * 主に要約や計画ステップで使用されます。
 * @param {string} apiKey - 使用するCerebras APIキー
 * @param {CoreMessage[]} messages - LLMに渡すメッセージ履歴
 * @param {ModelSettings} modelSettings - 使用するモデルの設定
 * @returns {Promise<string>} LLMからのテキスト応答
 * @throws {LlmApiError} API呼び出しが失敗した場合
 */
export async function callLlmApi(
  apiKey: string,
  messages: CoreMessage[],
  modelSettings: ModelSettings,
): Promise<string> {
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
  } catch (error: unknown) {
    // Vercel AI SDK (ai) は 'cause' プロパティに元のフェッチ応答を含む場合があります
    let status = 500;
    let message = "LLM API呼び出しエラー";

    if (error instanceof Error) {
      message = error.message;
      // エラーオブジェクトに cause があり、それが Response オブジェクトか確認
      // anyキャストを回避するため、一時的な型アサーションを使用
      const cause = (error as { cause?: unknown }).cause;

      if (cause && typeof cause === "object" && "status" in cause) {
        // Responseオブジェクト、またはそれに準ずるオブジェクトとして扱う
        status = (cause as { status: number }).status;
      }
    } else {
      message = String(error);
    }

    throw new LlmApiError(message, status, apiKey, modelSettings.modelName);
  }
}

/**
 * 単一のLLM呼び出し（ストリーミング）
 * Vercel AI SDK の `streamText` を直接ラップし、`streamController` に
 * 厳格な `DATA:` プロトコルで書き込みます。
 * 主に最終回答の生成（統合ステップ）で使用されます。
 *
 * @param {string} apiKey - 使用するCerebras APIキー
 * @param {CoreMessage[]} messages - LLMに渡すメッセージ履歴
 * @param {ModelSettings} modelSettings - 使用するモデルの設定
 * @param {ReadableStreamDefaultController} streamController - 書き込み先のストリームコントローラー
 * @returns {Promise<string>} LLMからの完全なテキスト応答（ストリーム終了後に解決）
 * @throws {LlmApiError} API呼び出しが失敗した場合
 */
export async function callLlmApiStreaming(
  apiKey: string,
  messages: CoreMessage[],
  modelSettings: ModelSettings,
  streamController: ReadableStreamDefaultController,
): Promise<string> {
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
      // ★ 厳格なプロトコル `DATA:` でチャンクを送信
      streamController.enqueue(StreamProtocol.DATA(textPart));
    }
    return fullText;
  } catch (error: unknown) {
    let status = 500;
    let message = "LLM APIストリーミングエラー";

    if (error instanceof Error) {
      message = error.message;
      // エラーオブジェクトに cause があり、それが Response オブジェクトか確認
      const cause = (error as { cause?: unknown }).cause;

      if (cause && typeof cause === "object" && "status" in cause) {
        // Responseオブジェクト、またはそれに準ずるオブジェクトとして扱う
        status = (cause as { status: number }).status;
      }
    } else {
      message = String(error);
    }
    throw new LlmApiError(message, status, apiKey, modelSettings.modelName);
  }
}
