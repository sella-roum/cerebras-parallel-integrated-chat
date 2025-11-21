import type { CoreMessage } from "ai";
import type { ApiKeyManager } from "../llm-core/api-key-manager";
import type { AppSettings, ModelSettings, ModelResponse, Message } from "../db";

/**
 * APIとクライアント間で通信するための厳格なストリーミング・プロトコル
 * @since AgentUpdate
 */
export const StreamProtocol = {
  /** 思考ステップの開始を通知 */
  STATUS: (stepName: string) => `STATUS:STEP:${stepName}\n`,
  /** AIの回答テキストのチャンク（断片） */
  DATA: (chunk: string) => `DATA:${chunk}\n`,
  /** 最終的な個別モデルの応答（JSON） */
  RESPONSES: (responses: ModelResponse[]) => `MODEL_RESPONSES:${JSON.stringify(responses)}\n`,
  /** エラー発生を通知 */
  ERROR: (message: string) => `ERROR:${message}\n`,
  /** 要約が実行されたことを通知（新しい履歴コンテキストを送信） */
  SUMMARY: (context: Message[]) => `SUMMARY_EXECUTED:${JSON.stringify(context)}\n`,
};

/**
 * エージェントの実行ステップで共有されるコンテキスト（状態）。
 * 各ステップはこのコンテキストを読み取り、変更を加えて次のステップに渡します。
 */
export interface AgentContext {
  // --- 入力（不変） ---
  apiKeyManager: ApiKeyManager;
  llmMessages: CoreMessage[]; // 現在の会話履歴（要約済みの場合あり）
  enabledModels: ModelSettings[]; // 利用可能な全推論モデル
  appSettings: AppSettings; // 統合・要約モデル設定
  streamController: ReadableStreamDefaultController; // ストリーミング用コントローラー

  // --- 要約ステップ用 ---
  totalContentLength?: number;
  summaryExecuted?: boolean;
  newHistoryContext?: Message[] | null;

  // --- 中間データ（可変） ---
  plan?: string; // (アイディア5) 計画
  subTasks?: string[]; // (アイディア5) サブタスク
  parallelResponses: ModelResponse[]; // 並列実行の結果（必須）
  critiques?: ModelResponse[]; // 批評の結果

  /**
   * 仮説モードであるかどうかのフラグ
   */
  isHypothesis?: boolean;

  // --- 最終出力（可変） ---
  finalContent: string; // 最終的な回答

  /** * 最終的に採用されたモデル応答のリスト
   * (parallelResponses や critiques を統合した結果)
   * ★ このプロパティを追加してエラーを解消
   */
  modelResponses?: ModelResponse[];

  /** ストリームで送信されたか（二重送信防止） */
  finalContentStreamed?: boolean;
}

/**
 * 実行計画の各ステップの処理内容を定義する型。
 */
export type ExecutionStepFunction = (context: AgentContext) => Promise<AgentContext>;

/**
 * 実行計画のステップ定義。
 */
export interface ExecutionStep {
  name: string; // "PLAN", "EXECUTE_PARALLEL", "INTEGRATE" など
  execute: ExecutionStepFunction;
}

/**
 * 思考モード（エージェント）の完全な定義。
 */
export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** このモードが実行するステップのリスト（実行計画） */
  steps: ExecutionStep[];
}
