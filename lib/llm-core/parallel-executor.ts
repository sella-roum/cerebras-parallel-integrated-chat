import type { CoreMessage } from "ai";
import type { ModelSettings, ModelResponse } from "../db";
import { ApiKeyManager, classifyError, LlmApiError } from "./api-key-manager";
import { callLlmApi } from "./llm-api-wrapper";

/**
 * 並列実行タスクにおける、最低限保証されるリトライ回数。
 * (例: キーが1つしかなくても、5xxエラーなら3回リトライする)
 */
const MIN_RETRY_ATTEMPTS = 3;

/**
 * 並列実行タスクの状態管理用インターフェース
 * status プロパティの書き換えを可能にするために定義
 */
interface ParallelTask {
  modelSettings: ModelSettings;
  messages?: CoreMessage[]; // スキップされる場合は未定義の可能性があるため optional
  status: "pending" | "fulfilled" | "failed";
  result: ModelResponse | null;
  attempts: number;
  maxAttempts: number;
}

/**
 * 複数のモデル設定に対し、リトライ機構付きで並列推論を実行します（非ストリーミング）。
 * 各モデルに異なるメッセージを渡すことも可能です。
 *
 * @param {ApiKeyManager} apiKeyManager - このリクエスト専用のAPIキーマネージャーのインスタンス
 * @param {ModelSettings[]} modelsToRun - 実行対象のモデル設定配列
 * @param {CoreMessage[] | Map<string, CoreMessage[]>} messages - 全モデル共通のメッセージ、またはモデルIDをキーとするメッセージのMap
 * @returns {Promise<ModelResponse[]>} 成功した応答の配列（`ModelResponse` 型）
 * @throws {Error} すべてのモデルが失敗した場合
 */
export async function executeParallel(
  apiKeyManager: ApiKeyManager,
  modelsToRun: ModelSettings[],
  messages: CoreMessage[] | Map<string, CoreMessage[]>,
): Promise<ModelResponse[]> {
  let lastApiError: LlmApiError | null = null;

  // 1. 実行タスクの初期化
  // ParallelTask[] 型を明示することで、statusプロパティに "fulfilled" 等を代入可能にする
  const modelTasks: ParallelTask[] = modelsToRun.map((model) => {
    // モデル固有のメッセージを取得
    const modelMessages = messages instanceof Map ? messages.get(model.id) || [] : messages;

    // メッセージが指定されていないモデルはタスク化しない
    if (modelMessages.length === 0) {
      console.warn(
        `[ParallelExecutor] モデル ${model.modelName} (ID: ${model.id}) はメッセージが空のためスキップされます。`,
      );
      return {
        modelSettings: model,
        status: "failed",
        result: null,
        attempts: 0,
        maxAttempts: 0,
        // messages は省略 (optional)
      };
    }

    return {
      modelSettings: model,
      messages: modelMessages,
      status: "pending",
      result: null,
      attempts: 0,
      maxAttempts: Math.max(apiKeyManager.keyCount, MIN_RETRY_ATTEMPTS),
    };
  });

  // 保留中のタスクを抽出
  let pendingTasks = modelTasks.filter((t) => t.status === "pending");

  // 2. リトライ・ループ
  while (pendingTasks.length > 0) {
    if (apiKeyManager.keyCount === 0) {
      console.error("[ParallelExecutor] すべてのAPIキーが利用不可になりました。ループを中断します。");
      break;
    }

    // 2a. 保留中のタスクをすべて実行
    const results = await Promise.allSettled(
      pendingTasks.map(async (task) => {
        task.attempts++;
        const apiKey = apiKeyManager.getNextKey()!;
        try {
          // ★ 抽象化された非ストリーミングAPIを呼ぶ
          // task.messages は pending 状態なら必ず存在するはずなので ! を使用
          const content = await callLlmApi(apiKey, task.messages!, task.modelSettings);
          // 応答にモデル名と役割（あれば）を含める
          const roleSuffix = task.modelSettings.role ? ` (${task.modelSettings.role})` : "";
          return { model: `${task.modelSettings.modelName}${roleSuffix}`, provider: "cerebras", content };
        } catch (error: unknown) {
          // any -> unknown
          if (error instanceof LlmApiError) throw error; // LlmApiErrorはそのままスロー
          // その他のエラーはLlmApiErrorにラップ
          const message = error instanceof Error ? error.message : "Unknown Error";
          throw new LlmApiError(message, 500, apiKey, task.modelSettings.modelName);
        }
      }),
    );

    // 2b. 結果の分類とリトライ判定
    const nextPendingTasks: ParallelTask[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const task = pendingTasks[i];

      // 成功判定: status が fulfilled であれば、content が空文字列でも成功とみなす
      if (result.status === "fulfilled") {
        // 成功
        task.status = "fulfilled";
        task.result = result.value;
      } else {
        // 失敗
        // rejected の場合のみ reason にアクセスしてキャスト
        const error = (result as PromiseRejectedResult).reason as LlmApiError;
        lastApiError = error;
        console.warn(
          `[ParallelExecutor] ${task.modelSettings.modelName} が ${task.attempts}回目 失敗 (Key: ...${error.apiKeyUsed.slice(-4)}, Status: ${error.status})`,
        );

        const { isPermanent, removeKey, removeModel } = classifyError(error);

        if (removeKey) {
          apiKeyManager.removeKey(error.apiKeyUsed);
          // キーが減ったので、全タスクの最大リトライ回数を再計算
          const remainingKeys = apiKeyManager.keyCount;
          modelTasks.forEach((t) => {
            if (t.status === "pending") {
              t.maxAttempts = Math.max(t.maxAttempts, t.attempts + remainingKeys);
            }
          });
        }

        if (isPermanent && removeModel) {
          task.status = "failed"; // モデル固有のエラー（404など）。リトライしない。
        } else if (task.attempts < task.maxAttempts) {
          nextPendingTasks.push(task); // 一時的エラー（500, 429）。リトライ。
        } else {
          task.status = "failed"; // リトライ上限に達した。
        }
      }
    }
    pendingTasks = nextPendingTasks; // 次のループで実行するタスクを更新
  }

  // 3. 最終結果の集計
  const validResponses = modelTasks.filter((t) => t.status === "fulfilled" && t.result).map((t) => t.result!);

  if (validResponses.length === 0) {
    throw new Error(`全ての並列推論モデルが失敗しました: ${lastApiError?.message || "不明なエラー"}`);
  }

  return validResponses;
}
