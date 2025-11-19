"use client";

import { useState, useEffect } from "react";
// AccordionTrigger がネストされた <button> を含んでいたため、プリミティブを直接使用して修正
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem } from "@/components/ui/accordion";
import { Plus, Trash2, ChevronDownIcon, Check, ChevronsUpDown } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { db, type ModelSettings } from "@/lib/db";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_CEREBRAS_MODELS } from "@/lib/constants";

/**
 * 並行推論に使用するモデルを設定するコンポーネント
 * 複数のモデルを動的に追加・削除・設定できます。
 */
export function InferenceModels() {
  const [models, setModels] = useState<ModelSettings[]>([]);
  /** 各ComboBox(Popover)の開閉状態をモデルIDごとに管理 */
  const [popoverOpen, setPopoverOpen] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  // マウント時にDBから設定を読み込む
  useEffect(() => {
    loadModels();
  }, []);

  /**
   * IndexedDBから推論モデル設定を読み込みます。
   * 設定が0件の場合は、デフォルトのモデルを1件追加します。
   */
  const loadModels = async () => {
    try {
      const settings = await db.getModelSettings();
      if (settings.length === 0) {
        // 設定が空の場合、デフォルトのモデルを1つ作成
        const newModel: ModelSettings = {
          id: `model_${Date.now()}`,
          provider: "cerebras",
          modelName: "zai-glm-4.6",
          temperature: 0.6,
          maxTokens: 30000,
          enabled: true,
          role: "general", // デフォルトの役割
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

  /**
   * 新しいデフォルトの推論モデルをリストとDBに追加します。
   */
  const addModel = async () => {
    const newModel: ModelSettings = {
      id: `model_${Date.now()}`,
      provider: "cerebras",
      modelName: "zai-glm-4.6",
      temperature: 0.6,
      maxTokens: 30000,
      enabled: true,
      role: "general", // デフォルトの役割
    };

    try {
      await db.saveModelSettings(newModel);
      setModels((prev) => [...prev, newModel]);
    } catch (error) {
      console.error("Failed to save model settings:", error);
      toast({
        title: "保存に失敗しました",
        description: "ストレージ容量を確認してください。",
        variant: "destructive",
      });
    }
  };

  /**
   * 指定されたIDの推論モデルを削除します。
   * @param {string} id - 削除するモデルのID
   */
  const deleteModel = async (id: string) => {
    // 最後の1つは削除できないようにUI側で制御
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
    } catch (error) {
      console.error("Failed to delete model:", error);
      toast({
        title: "削除に失敗しました",
        variant: "destructive",
      });
    }
  };

  /**
   * モデル設定のいずれかのフィールドを更新し、DBに保存します。
   * @param {string} id - 更新するモデルのID
   * @param {keyof ModelSettings} field - 更新するフィールド名
   * @param {string | boolean | number} value - 新しい値
   */
  const updateModel = async (id: string, field: keyof ModelSettings, value: string | boolean | number) => {
    const updatedModels = models.map((m) => (m.id === id ? { ...m, [field]: value } : m));
    setModels(updatedModels);

    const modelToSave = updatedModels.find((m) => m.id === id);
    if (modelToSave) {
      try {
        await db.saveModelSettings(modelToSave);
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
              {/* shadcn/uiのAccordionTriggerは内部で<button>をレンダリングします。
                UIガイドライン上、<button>のネストは非推奨（または不正）となるため、
                右側のSwitchと干渉しないよう、Radix UIのプリミティブを直接使用して
                Trigger領域とHeader領域を分離しています。
              */}
              <AccordionPrimitive.Header className="flex items-center justify-between w-full py-4 pr-4">
                {/* クリック可能なTrigger領域 */}
                <AccordionPrimitive.Trigger
                  className={cn(
                    "focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-start gap-4 rounded-md py-0 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180",
                    "hover:no-underline", // アンダラインが不要な場合はこの行を有効化
                  )}
                >
                  <span className="text-sm font-medium">{model.modelName || ""}</span>
                  <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200" />
                </AccordionPrimitive.Trigger>

                {/* 有効/無効トグルスイッチ */}
                <Switch
                  checked={model.enabled}
                  onCheckedChange={(checked) => updateModel(model.id, "enabled", checked)}
                  aria-label={`${model.modelName} を有効にする`}
                />
              </AccordionPrimitive.Header>

              {/* アコーディオンコンテンツ */}
              <AccordionContent>
                <div className="space-y-4 pt-4">
                  {/* モデル名 (ComboBox) */}
                  <div className="space-y-2">
                    <Label htmlFor={`model-name-${model.id}`}>モデル名</Label>
                    <Popover
                      open={popoverOpen[model.id] || false}
                      onOpenChange={(open) => setPopoverOpen({ ...popoverOpen, [model.id]: open })}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          className="w-full justify-between font-mono"
                          id={`model-name-${model.id}`}
                        >
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
                              // カスタム入力にも対応
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

                  {/* 役割 / 専門分野 */}
                  <div className="space-y-2">
                    <Label htmlFor={`model-role-${model.id}`}>役割 / 専門分野 (オプション)</Label>
                    <Input
                      id={`model-role-${model.id}`}
                      type="text"
                      value={model.role || ""}
                      onChange={(e) => updateModel(model.id, "role", e.target.value)}
                      placeholder="例: プログラマー, 批評家, general"
                    />
                    <p className="text-xs text-muted-foreground">
                      エージェント・モード（役割ベースなど）で使用する専門分野を入力します。
                    </p>
                  </div>

                  {/* Temperature */}
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
                  {/* 最大トークン数 */}
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
                  {/* 削除ボタン */}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteModel(model.id)}
                    className="w-full"
                    disabled={models.length <= 1} // 最後の1つは削除不可
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
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
