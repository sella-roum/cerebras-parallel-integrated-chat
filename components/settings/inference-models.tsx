"use client";

import { useState, useEffect } from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion"; // プリミティブをインポート
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem } from "@/components/ui/accordion";
import {
  Plus,
  Trash2,
  ChevronDownIcon, // <button> ネスト修正用
  Check, // ComboBox用
  ChevronsUpDown, // ComboBox用
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { db, type ModelSettings } from "@/lib/db";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ComboBox (Popover + Command) に必要なコンポーネント
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { DEFAULT_CEREBRAS_MODELS } from "@/lib/constants";

export function InferenceModels() {
  const [models, setModels] = useState<ModelSettings[]>([]);
  // ComboBoxの開閉状態をモデルごとに管理
  const [popoverOpen, setPopoverOpen] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      const settings = await db.getModelSettings();
      // もし0件ならデフォルトを1件追加する
      if (settings.length === 0) {
        const newModel: ModelSettings = {
          id: `model_${Date.now()}`,
          provider: "cerebras",
          modelName: "zai-glm-4.6",
          temperature: 0.6,
          maxTokens: 30000,
          enabled: true,
        };
        await db.saveModelSettings(newModel);
        setModels([newModel]);
      } else {
        setModels(settings);
      }
      console.log("Loaded model settings:", settings.length);
    } catch (error) {
      console.error("Failed to load model settings:", error);
    }
  };

  const addModel = () => {
    const newModel: ModelSettings = {
      id: `model_${Date.now()}`,
      provider: "cerebras",
      modelName: "zai-glm-4.6",
      temperature: 0.6,
      maxTokens: 30000,
      enabled: true,
    };
    // DBにも保存
    db.saveModelSettings(newModel);
    setModels([...models, newModel]);
  };

  const deleteModel = async (id: string) => {
    // 既にUIで無効化されているはずだが、念のためロジック側でもチェック
    if (models.length <= 1) {
      toast({
        title: "削除できません",
        description: "最低1つの推論モデルが必要です。",
        variant: "destructive",
      });
      return;
    }

    try {
      await db.deleteModelSettings(id);
      setModels(models.filter((m) => m.id !== id));
      // toast({
      //   title: "モデルを削除しました",
      // })
    } catch (error) {
      console.error("Failed to delete model:", error);
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
        console.log("Model settings saved:", id);
      } catch (error) {
        console.error("Failed to save model settings:", error);
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
              <AccordionPrimitive.Header className="flex items-center justify-between w-full py-4 pr-4">
                <AccordionPrimitive.Trigger
                  className={cn(
                    "focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-start gap-4 rounded-md py-0 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180",
                    "hover:no-underline",
                  )}
                >
                  <span className="text-sm font-medium">{model.modelName || ""}</span>
                  <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200" />
                </AccordionPrimitive.Trigger>

                <Switch
                  checked={model.enabled}
                  onCheckedChange={(checked) => updateModel(model.id, "enabled", checked)}
                />
              </AccordionPrimitive.Header>

              <AccordionContent>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor={`model-name-${model.id}`}>モデル名</Label>
                    <Popover
                      open={popoverOpen[model.id] || false}
                      onOpenChange={(open) => setPopoverOpen({ ...popoverOpen, [model.id]: open })}
                    >
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" className="w-full justify-between font-mono">
                          {model.modelName || "モデルを選択..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                        <Command>
                          <CommandInput
                            placeholder="モデル名を検索または入力..."
                            value={model.modelName}
                            onValueChange={(search) => {
                              updateModel(model.id, "modelName", search);
                            }}
                          />
                          <CommandList>
                            <CommandEmpty>モデルが見つかりません。</CommandEmpty>
                            <CommandGroup>
                              {DEFAULT_CEREBRAS_MODELS.map((defaultModel) => (
                                <CommandItem
                                  key={defaultModel}
                                  value={defaultModel}
                                  onSelect={(currentValue) => {
                                    updateModel(model.id, "modelName", currentValue);
                                    setPopoverOpen({
                                      ...popoverOpen,
                                      [model.id]: false,
                                    });
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      model.modelName === defaultModel ? "opacity-100" : "opacity-0",
                                    )}
                                  />
                                  {defaultModel}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <p className="text-xs text-muted-foreground">
                      リストから選択するか、カスタムモデル名を入力してください。
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
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteModel(model.id)}
                    className="w-full"
                    // models.length が 1以下 の場合に disabled (無効化)
                    disabled={models.length <= 1}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {/* disabled状態の時はテキストも変更する */}
                    {models.length <= 1 ? "最低1つのモデルが必要です" : "削除"}
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
