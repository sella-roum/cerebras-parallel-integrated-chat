"use client";

import { InferenceModels } from "@/components/settings/inference-models";
import { SummarizerModel } from "@/components/settings/summarizer-model";
import { IntegratorModel } from "@/components/settings/integrator-model";

/**
 * 設定ダイアログ内の「モデル設定」タブ
 * 3つの主要なAIモデル（推論、要約、統合）の設定コンポーネントを
 * まとめて表示します。
 */
export function ModelSettingsTab() {
  return (
    <div className="space-y-6">
      {/* 1. 並行推論モデル（複数設定可能） */}
      <InferenceModels />

      {/* 2. 要約モデル（単一設定） */}
      <SummarizerModel />

      {/* 3. 統合モデル（単一設定） */}
      <IntegratorModel />
    </div>
  );
}
