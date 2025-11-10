"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_CEREBRAS_MODELS } from "@/lib/constants";

/**
 * 複数の応答をレビューし「最終回答」を生成する
 * 「統合モデル」を設定するためのコンポーネント
 */
export function IntegratorModel() {
  const [modelName, setModelName] = useState("zai-glm-4.6");
  const [temperature, setTemperature] = useState(0.5);
  const [maxTokens, setMaxTokens] = useState(30000);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  // マウント時にDBから設定を読み込む
  useEffect(() => {
    loadSettings();
  }, []);

  /**
   * IndexedDBから統合モデル設定（appSettings.integratorModel）を読み込みます。
   */
  const loadSettings = async () => {
    try {
      const settings = await db.getAppSettings();
      if (settings?.integratorModel) {
        setModelName(settings.integratorModel.modelName);
        setTemperature(settings.integratorModel.temperature);
        setMaxTokens(settings.integratorModel.maxTokens);
      }
    } catch (error) {
      console.error("Failed to load integrator settings:", error);
    } finally {
      setHasLoaded(true);
    }
  };

  // いずれかの設定値が変更されたら、自動でDBに保存
  useEffect(() => {
    if (!hasLoaded || !modelName) {
      return;
    }
    saveSettings();
  }, [hasLoaded, modelName, temperature, maxTokens]);

  /**
   * 現在のstateを `appSettings.integratorModel` としてDBに保存します。
   */
  const saveSettings = async () => {
    try {
      const currentSettings = await db.getAppSettings();
      await db.saveAppSettings({
        ...currentSettings, // 既存の要約モデル設定などを保持
        integratorModel: {
          provider: "cerebras",
          modelName,
          temperature,
          maxTokens,
        },
      });
      console.log("Integrator settings saved");
    } catch (error) {
      console.error("Failed to save integrator settings:", error);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>統合モデル</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* モデル名 (ComboBox) */}
        <div className="space-y-2">
          <Label htmlFor="integrator-model">モデル名</Label>
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className="w-full justify-between font-mono"
                id="integrator-model"
              >
                {modelName || "モデルを選択..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
              <Command>
                <CommandInput
                  placeholder="モデル名を検索または入力..."
                  value={modelName}
                  onValueChange={setModelName} // カスタム入力に対応
                />
                <CommandList>
                  <CommandEmpty>モデルが見つかりません。</CommandEmpty>
                  <CommandGroup>
                    {DEFAULT_CEREBRAS_MODELS.map((defaultModel) => (
                      <CommandItem
                        key={defaultModel}
                        value={defaultModel}
                        onSelect={(currentValue) => {
                          setModelName(currentValue);
                          setPopoverOpen(false); // 選択したら閉じる
                        }}
                      >
                        <Check
                          className={cn("mr-2 h-4 w-4", modelName === defaultModel ? "opacity-100" : "opacity-0")}
                        />
                        {defaultModel}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <p className="text-xs text-muted-foreground">複数のモデルからの応答を統合する際に使用します</p>
        </div>
        {/* Temperature */}
        <div className="space-y-2">
          <Label htmlFor="integrator-temperature">Temperature: {temperature}</Label>
          <Slider
            id="integrator-temperature"
            min={0}
            max={2}
            step={0.1}
            value={[temperature]}
            onValueChange={([value]) => setTemperature(value)}
          />
        </div>
        {/* 最大トークン数 */}
        <div className="space-y-2">
          <Label htmlFor="integrator-tokens">最大トークン数</Label>
          <Input
            id="integrator-tokens"
            type="number"
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number.parseInt(e.target.value) || 0)}
            placeholder="30000"
          />
        </div>
      </CardContent>
    </Card>
  );
}
