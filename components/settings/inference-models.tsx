"use client";

import { useState, useEffect } from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion"; // プリミティブをインポート
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  // AccordionTrigger, // <-- カスタムするため、ここでは使わない
} from "@/components/ui/accordion";
import { Plus, Trash2, ChevronDownIcon } from "lucide-react"; // ChevronDownIcon をインポート
import { Slider } from "@/components/ui/slider";
import { db, type ModelSettings } from "@/lib/db";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils"; // cn をインポート

export function InferenceModels() {
  const [models, setModels] = useState<ModelSettings[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      const settings = await db.getModelSettings();
      setModels(settings);
      console.log("[v0] Loaded model settings:", settings.length);
    } catch (error) {
      console.error("[v0] Failed to load model settings:", error);
    }
  };

  const addModel = () => {
    const newModel: ModelSettings = {
      id: `model_${Date.now()}`,
      provider: "cerebras",
      modelName: "zai-glm-4.6",
      temperature: 0.6,
      maxTokens: 40960,
      enabled: true,
    };
    setModels([...models, newModel]);
  };

  const deleteModel = async (id: string) => {
    try {
      await db.deleteModelSettings(id);
      setModels(models.filter((m) => m.id !== id));
      toast({
        title: "モデルを削除しました",
      });
    } catch (error) {
      console.error("[v0] Failed to delete model:", error);
      toast({
        title: "削除に失敗しました",
        variant: "destructive",
      });
    }
  };

  const updateModel = async (id: string, field: keyof ModelSettings, value: string | boolean | number) => {
    const updatedModels = models.map((m) => (m.id === id ? { ...m, [field]: value } : m));
    setModels(updatedModels);

    const model = updatedModels.find((m) => m.id === id);
    if (model) {
      try {
        await db.saveModelSettings(model);
        console.log("[v0] Model settings saved:", id);
      } catch (error) {
        console.error("[v0] Failed to save model settings:", error);
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>推論モデル設定</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Accordion type="single" collapsible className="w-full">
          {models.map((model) => (
            <AccordionItem key={model.id} value={model.id}>
              {/* AccordionTrigger (button) の中に Switch (button) が
                ネストしないよう、プリミティブを使ってレイアウトを分離します。
              */}
              <AccordionPrimitive.Header className="flex items-center justify-between w-full py-4 pr-4">
                {/* 1. アコーディオンを開閉するトリガー（ボタン） */}
                <AccordionPrimitive.Trigger
                  className={cn(
                    "focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-start gap-4 rounded-md py-0 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180",
                    "hover:no-underline", // 元のスタイルを維持
                  )}
                >
                  <span className="text-sm font-medium">{model.modelName || "新規モデル"}</span>
                  <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200" />
                </AccordionPrimitive.Trigger>

                {/* 2. トグルスイッチ（ボタン） - Triggerの「兄弟」要素として配置 */}
                <Switch
                  checked={model.enabled}
                  onCheckedChange={(checked) => updateModel(model.id, "enabled", checked)}
                  // onClick={(e) => e.stopPropagation()} <-- 兄弟要素になったため不要
                />
              </AccordionPrimitive.Header>

              <AccordionContent>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor={`model-name-${model.id}`}>モデル名</Label>
                    <Input
                      id={`model-name-${model.id}`}
                      value={model.modelName}
                      onChange={(e) => updateModel(model.id, "modelName", e.target.value)}
                      placeholder="zai-glm-4.6"
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      利用可能: zai-glm-4.6, llama3.1-8b, llama-3.3-70b など
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`temperature-${model.id}`}>Temperature: {model.temperature}</Label>
                    <Slider
                      id={`temperature-${model.id}`}
                      min={0}
                      max={2}
                      step={0.1}
                      value={[model.temperature]}
                      onValueChange={([value]) => updateModel(model.id, "temperature", value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`max-tokens-${model.id}`}>最大トークン数</Label>
                    <Input
                      id={`max-tokens-${model.id}`}
                      type="number"
                      value={model.maxTokens}
                      onChange={(e) => updateModel(model.id, "maxTokens", Number.parseInt(e.target.value) || 0)}
                      placeholder="40960"
                    />
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => deleteModel(model.id)} className="w-full">
                    <Trash2 className="h-4 w-4 mr-2" />
                    削除
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <Button onClick={addModel} variant="outline" className="w-full bg-transparent">
          <Plus className="h-4 w-4 mr-2" />
          モデルを追加
        </Button>
      </CardContent>
    </Card>
  );
}
