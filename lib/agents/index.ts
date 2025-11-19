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
 * 全てのエージェント（思考モード）の実行計画（ステップ）を定義します。
 */
const AGENT_DEFINITIONS: Record<AgentModeId, AgentDefinition> = {
  standard: {
    id: "standard",
    name: AGENT_MODES[0].name,
    description: AGENT_MODES[0].description,
    steps: [
      summarizeStep, // ★要約は実行計画の一部
      { name: "EXECUTE_STANDARD", execute: executeStandard },
      { name: "INTEGRATE_STANDARD", execute: integrateStandard },
    ],
  },

  expert_team: {
    id: "expert_team",
    name: AGENT_MODES[1].name,
    description: AGENT_MODES[1].description,
    steps: [
      summarizeStep,
      { name: "EXECUTE_EXPERT_TEAM", execute: executeExpertTeam },
      { name: "INTEGRATE_EXPERT_TEAM", execute: integrateStandard }, // 統合は標準を流用
    ],
  },

  deep_thought: {
    id: "deep_thought",
    name: AGENT_MODES[2].name,
    description: AGENT_MODES[2].description,
    steps: [
      summarizeStep,
      { name: "EXECUTE_DEEP_THOUGHT", execute: executeDeepThought },
      { name: "INTEGRATE_DEEP_THOUGHT", execute: integrateDeepThought },
    ],
  },

  critique: {
    id: "critique",
    name: AGENT_MODES[3].name,
    description: AGENT_MODES[3].description,
    steps: [
      summarizeStep,
      { name: "EXECUTE_GENERATORS", execute: executeGenerators }, // 1. 草稿
      { name: "EXECUTE_CRITICS", execute: executeCritics }, // 2. 批評
      { name: "INTEGRATE_CRITIQUES", execute: integrateWithCritiques }, // 3. 統合
    ],
  },

  dynamic_router: {
    id: "dynamic_router",
    name: AGENT_MODES[4].name,
    description: AGENT_MODES[4].description,
    steps: [
      summarizeStep,
      { name: "EXECUTE_ROUTER", execute: executeRouter }, // 1. ルーターがモデルを絞り込み
      { name: "EXECUTE_ROUTED_TEAM", execute: executeExpertTeam }, // 2. 絞り込んだチームで実行
      { name: "INTEGRATE_ROUTED_TEAM", execute: integrateStandard }, // 3. 標準統合
    ],
  },

  manager: {
    id: "manager",
    name: AGENT_MODES[5].name,
    description: AGENT_MODES[5].description,
    steps: [
      summarizeStep,
      { name: "PLAN_SUBTASKS", execute: planSubtasks }, // 1. 計画
      { name: "EXECUTE_SUBTASKS", execute: executeSubtasks }, // 2. 実行
      { name: "INTEGRATE_REPORT", execute: integrateReport }, // 3. 報告
    ],
  },

  reflection_loop: {
    id: "reflection_loop",
    name: AGENT_MODES[6].name,
    description: AGENT_MODES[6].description,
    steps: [
      summarizeStep,
      // 1. このステップが内部で (CoT -> 批評 -> 統合) の全プロセスを実行
      { name: "EXECUTE_REFLECTION_LOOP", execute: reflectionLoop },
    ],
  },

  hypothesis: {
    id: "hypothesis",
    name: AGENT_MODES[7].name,
    description: AGENT_MODES[7].description,
    steps: [
      summarizeStep,
      { name: "GENERATE_HYPOTHESES", execute: generateHypotheses }, // 1. 仮説生成
      { name: "EXECUTE_HYPOTHESES", execute: executeSubtasks }, // 2. 仮説を並列実行 (subTasksを流用)
      { name: "INTEGRATE_HYPOTHESES", execute: integrateReport }, // 3. 結果を統合 (managerの統合を流用)
    ],
  },

  emotion_analysis: {
    id: "emotion_analysis",
    name: AGENT_MODES[8].name,
    description: AGENT_MODES[8].description,
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
