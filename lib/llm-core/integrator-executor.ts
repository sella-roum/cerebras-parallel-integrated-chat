import type { CoreMessage } from "ai";
import type { ModelSettings } from "../db";
import { ApiKeyManager, classifyError, LlmApiError } from "./api-key-manager";
import { callLlmApi, callLlmApiStreaming } from "./llm-api-wrapper";

/**
 * 統合タスクにおける、最低限保証されるリトライ回数。
 */
const MIN_RETRY_ATTEMPTS = 3;

/**
 * 単一のLLM呼び出し（通常は統合モデル）を、リトライ機構付きで実行します。
 * ストリーミングコントローラーが渡された場合、ストリーミングで応答します。
 *
 * @param {ApiKeyManager} apiKeyManager - APIキーマネージャー
 * @param {CoreMessage[]} messages - LLMに渡すメッセージ（統合プロンプトなど）
 * @param {ModelSettings} modelSettings - 統合モデルの設定
 * @param {ReadableStreamDefaultController} [streamController] - (オプション) 提供された場合、ストリーミングで書き出す
 * @returns {Promise<string>} 最終的なテキスト応答
 * @throws {Error} リトライしても失敗した場合
 */
export async function executeIntegration(
  apiKeyManager: ApiKeyManager,
  messages: CoreMessage[],
  modelSettings: ModelSettings,
  streamController?: ReadableStreamDefaultController,
): Promise<string> {
  let attempts = 0;
  let maxAttempts = Math.max(apiKeyManager.keyCount, MIN_RETRY_ATTEMPTS);
  let lastApiError: LlmApiError | null = null;

  while (attempts < maxAttempts) {
    if (apiKeyManager.keyCount === 0) {
      console.error("[Integrator] すべてのAPIキーが利用不可になりました。");
      break;
    }

    attempts++;
    const apiKey = apiKeyManager.getNextKey()!;

    try {
      if (streamController) {
        // ストリーミングモード
        return await callLlmApiStreaming(apiKey, messages, modelSettings, streamController);
      } else {
        // 非ストリーミングモード（要約や計画用）
        return await callLlmApi(apiKey, messages, modelSettings);
      }
    } catch (error: unknown) {
      if (error instanceof LlmApiError) {
        lastApiError = error;
        console.warn(`[Integrator] ${attempts}回目 失敗 (Key: ...${apiKey.slice(-4)}, Status: ${error.status})`);
        const { isPermanent, removeKey } = classifyError(error);

        if (isPermanent && removeKey) {
          apiKeyManager.removeKey(apiKey);
          // キーが減ったので、最大リトライ回数を再計算
          const remainingKeys = apiKeyManager.keyCount;
          maxAttempts = Math.max(maxAttempts, attempts + remainingKeys);
        }
        // 404（モデルエラー）や 500（一時的エラー）でもリトライする
      } else {
        // 予期せぬエラー
        const errorMessage = error instanceof Error ? error.message : String(error);
        lastApiError = new LlmApiError(errorMessage, 500, apiKey);
      }
    }
  }

  throw new Error(`統合モデルの呼び出しに失敗しました: ${lastApiError?.message || "不明なエラー"}`);
}
