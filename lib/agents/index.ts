import type { AgentDefinition } from "./types";
import { AGENT_MODES, type AgentModeId } from "../constants"; // ★共有定数をインポート
import { summarizeHistory } from "./step-functions/00-summarize";
import { planSubtasks, generateHypotheses } from "./step-functions/01-plan";
import {
  executeStandard,
  executeExpertTeam,
  executeDeepThought,
  executeGenerators,
  executeRouter,
  executeSubtasks,
} from "./step-functions/02-execute";
import { executeCritics } from "./step-functions/03-critique";
import {
  integrateStandard,
  integrateDeepThought,
  integrateWithCritiques,
  integrateReport,
  integrateWithEmotion,
} from "./step-functions/04-integrate";
import { executeEmotionAnalysis } from "./step-functions/05-meta";
import { reflectionLoop } from "./step-functions/06-loop";

/** * 共通ステップの定義
 * 改善案に基づき、要約は各エージェントの steps 配列に含めます。
 */
const summarizeStep = { name: "SUMMARIZE", execute: summarizeHistory };

/**
 * インデックス依存を避けるためのヘルパーマップ
 * AGENT_MODES[0] などの直値を避け、modeById.standard のように参照できるようにする
 */
const modeById = Object.fromEntries(AGENT_MODES.map((mode) => [mode.id, mode]));

/**
 * 全てのエージェント（思考モード）の実行計画（ステップ）を定義します。
 */
const AGENT_DEFINITIONS: Record<AgentModeId, AgentDefinition> = {
  standard: {
    id: "standard",
    name: modeById.standard?.name || "標準モード",
    description: modeById.standard?.description || "並列推論と標準的な統合を行います。",
    steps: [
      summarizeStep, // ★要約は実行計画の一部
      { name: "EXECUTE_STANDARD", execute: executeStandard },
      { name: "INTEGRATE_STANDARD", execute: integrateStandard },
    ],
  },

  expert_team: {
    id: "expert_team",
    name: modeById.expert_team?.name || "エキスパート・チーム",
    description: modeById.expert_team?.description || "各専門家が回答し、リーダーが統合します。",
    steps: [
      summarizeStep,
      { name: "EXECUTE_EXPERT_TEAM", execute: executeExpertTeam },
      { name: "INTEGRATE_EXPERT_TEAM", execute: integrateStandard }, // 統合は標準を流用
    ],
  },

  deep_thought: {
    id: "deep_thought",
    name: modeById.deep_thought?.name || "深層思考",
    description: modeById.deep_thought?.description || "思考プロセスをレビューし、回答を生成します。",
    steps: [
      summarizeStep,
      { name: "EXECUTE_DEEP_THOUGHT", execute: executeDeepThought },
      { name: "INTEGRATE_DEEP_THOUGHT", execute: integrateDeepThought },
    ],
  },

  critique: {
    id: "critique",
    name: modeById.critique?.name || "生成と批評",
    description: modeById.critique?.description || "AIが草稿を書き、別のAIが批評・改善します。",
    steps: [
      summarizeStep,
      { name: "EXECUTE_GENERATORS", execute: executeGenerators }, // 1. 草稿
      { name: "EXECUTE_CRITICS", execute: executeCritics }, // 2. 批評
      { name: "INTEGRATE_CRITIQUES", execute: integrateWithCritiques }, // 3. 統合
    ],
  },

  dynamic_router: {
    id: "dynamic_router",
    name: modeById.dynamic_router?.name || "動的ルーター",
    description: modeById.dynamic_router?.description || "質問に最適なAIチームを自動で編成します。",
    steps: [
      summarizeStep,
      { name: "EXECUTE_ROUTER", execute: executeRouter }, // 1. ルーターがモデルを絞り込み
      { name: "EXECUTE_ROUTED_TEAM", execute: executeExpertTeam }, // 2. 絞り込んだチームで実行
      { name: "INTEGRATE_ROUTED_TEAM", execute: integrateStandard }, // 3. 標準統合
    ],
  },

  manager: {
    id: "manager",
    name: modeById.manager?.name || "階層型マネージャー",
    description: modeById.manager?.description || "タスクを分解し、並列処理して統合します。",
    steps: [
      summarizeStep,
      { name: "PLAN_SUBTASKS", execute: planSubtasks }, // 1. 計画
      { name: "EXECUTE_SUBTASKS", execute: executeSubtasks }, // 2. 実行
      { name: "INTEGRATE_REPORT", execute: integrateReport }, // 3. 報告
    ],
  },

  reflection_loop: {
    id: "reflection_loop",
    name: modeById.reflection_loop?.name || "自己反省ループ",
    description: modeById.reflection_loop?.description || "AIが内部で回答をレビューし、改訂します。",
    steps: [
      summarizeStep,
      // 1. このステップが内部で (CoT -> 批評 -> 統合) の全プロセスを実行
      { name: "EXECUTE_REFLECTION_LOOP", execute: reflectionLoop },
    ],
  },

  hypothesis: {
    id: "hypothesis",
    name: modeById.hypothesis?.name || "投機的実行",
    description: modeById.hypothesis?.description || "あいまいな質問の解釈を複数検証します。",
    steps: [
      summarizeStep,
      { name: "GENERATE_HYPOTHESES", execute: generateHypotheses }, // 1. 仮説生成
      { name: "EXECUTE_HYPOTHESES", execute: executeSubtasks }, // 2. 仮説を並列実行 (subTasksを流用)
      { name: "INTEGRATE_HYPOTHESES", execute: integrateReport }, // 3. 結果を統合 (managerの統合を流用)
    ],
  },

  emotion_analysis: {
    id: "emotion_analysis",
    name: modeById.emotion_analysis?.name || "感情・トーン分析",
    description: modeById.emotion_analysis?.description || "ユーザーの感情を分析し、伝え方を調整します。",
    steps: [
      summarizeStep,
      // 1. このステップが内部で「分析」と「標準実行」を並列で行う
      { name: "EXECUTE_META_ANALYSIS", execute: executeEmotionAnalysis },
      // 2. 分析結果(critiques)と回答案(parallelResponses)を統合
      { name: "INTEGRATE_META", execute: integrateWithEmotion },
    ],
  },
};

/**
 * モードIDに基づいてエージェントの定義（実行計画）を取得します。
 * @param {string} modeId - "standard", "expert_team" などのモードID
 * @returns {AgentDefinition} 対応するエージェント定義。不明なIDの場合は "standard" にフォールバックします。
 */
export function getAgentById(modeId: string): AgentDefinition {
  const definition = AGENT_DEFINITIONS[modeId as AgentModeId];
  if (!definition) {
    console.warn(`[Agent Index] 不明なモードID "${modeId}" が要求されました。標準モードにフォールバックします。`);
    return AGENT_DEFINITIONS.standard;
  }
  return definition;
}
