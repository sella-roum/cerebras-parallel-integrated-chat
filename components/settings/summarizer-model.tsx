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

export function SummarizerModel() {
  const [modelName, setModelName] = useState("zai-glm-4.6");
  const [temperature, setTemperature] = useState(0.3);
  const [maxTokens, setMaxTokens] = useState(30000);
  const [popoverOpen, setPopoverOpen] = useState(false); // Popoverの開閉state

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await db.getAppSettings();
      if (settings?.summarizerModel) {
        setModelName(settings.summarizerModel.modelName);
        setTemperature(settings.summarizerModel.temperature);
        setMaxTokens(settings.summarizerModel.maxTokens);
      }
    } catch (error) {
      console.error("Failed to load summarizer settings:", error);
    }
  };

  useEffect(() => {
    if (modelName) {
      saveSettings();
    }
  }, [modelName, temperature, maxTokens]);

  const saveSettings = async () => {
    try {
      const currentSettings = await db.getAppSettings();
      await db.saveAppSettings({
        ...currentSettings,
        summarizerModel: {
          provider: "cerebras",
          modelName,
          temperature,
          maxTokens,
        },
      });
      console.log("Summarizer settings saved");
    } catch (error) {
      console.error("Failed to save summarizer settings:", error);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>要約モデル</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="summarizer-model">モデル名</Label>

          {/* ▼ InputをComboBoxに置き換え ▼ */}
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="w-full justify-between font-mono">
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

          <p className="text-xs text-muted-foreground">Cerebrasモデルを使用して会話のタイトルを生成します</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="summarizer-temperature">Temperature: {temperature}</Label>
          <Slider
            id="summarizer-temperature"
            min={0}
            max={2}
            step={0.1}
            value={[temperature]}
            onValueChange={([value]) => setTemperature(value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="summarizer-tokens">最大トークン数</Label>
          <Input
            id="summarizer-tokens"
            type="number"
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number.parseInt(e.target.value) || 0)}
            placeholder="500"
          />
        </div>
      </CardContent>
    </Card>
  );
}
