"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { db } from "@/lib/db";

export function SummarizerModel() {
  const [modelName, setModelName] = useState("zai-glm-4.6");
  const [temperature, setTemperature] = useState(0.3);
  const [maxTokens, setMaxTokens] = useState(500);

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
      console.error("[v0] Failed to load summarizer settings:", error);
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
      console.log("[v0] Summarizer settings saved");
    } catch (error) {
      console.error("[v0] Failed to save summarizer settings:", error);
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
          <Input
            id="summarizer-model"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="zai-glm-4.6"
            className="font-mono"
          />
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
