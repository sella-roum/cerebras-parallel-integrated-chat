import type { ExecutionStepFunction } from "../types";
import { StreamProtocol } from "../types";
import { executeDeepThought } from "./02-execute"; // CoT
import { executeCritics } from "./03-critique"; // 批評
import { integrateWithCritiques } from "./04-integrate"; // 批評統合

/**
 * [ステップ] 自己反省ループ（CoT -> 批評 -> 統合）
 * このステップは、それ自体が複数のサブステップを実行するオーケストレーターです。
 * 最終的なストリーミングまで内部で完結させます。
 *
 * @param {AgentContext} context - 現在の実行コンテキスト
 * @returns {Promise<AgentContext>} 最終的なコンテキスト
 */
export const reflectionLoop: ExecutionStepFunction = async (context) => {
  const { streamController } = context;

  // 1. 草稿 (CoT実行ステップ)
  streamController.enqueue(StreamProtocol.STATUS("REFLECTION_DRAFT"));
  // executeDeepThought は context.parallelResponses に CoT の結果を格納する
  const step1Context = await executeDeepThought(context);

  // 2. 批評 (批評実行ステップ)
  streamController.enqueue(StreamProtocol.STATUS("REFLECTION_CRITIQUE"));
  // executeCritics は step1Context.parallelResponses を読み、
  // context.critiques に批評結果を格納する
  const step2Context = await executeCritics(step1Context);

  // 3. 最終統合 (批評統合ステップ)
  streamController.enqueue(StreamProtocol.STATUS("REFLECTION_INTEGRATE"));
  // integrateWithCritiques は parallelResponses(草稿) と critiques(批評) を読み、
  // 最終回答をストリーミング（DATA:）で送信する
  const finalContext = await integrateWithCritiques(step2Context);

  // この関数がすべてのサブステップと最終ストリーミングを実行したので、
  // 最終的なコンテキストをそのまま返す
  return finalContext;
};
