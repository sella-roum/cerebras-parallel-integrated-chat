"use client";
import { InferenceModels } from "@/components/settings/inference-models";
import { SummarizerModel } from "@/components/settings/summarizer-model";
import { IntegratorModel } from "@/components/settings/integrator-model";

export function ModelSettingsTab() {
  return (
    <div className="space-y-6">
      <InferenceModels />
      <SummarizerModel />
      <IntegratorModel />
    </div>
  );
}
