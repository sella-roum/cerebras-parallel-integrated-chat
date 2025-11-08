"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { db } from "@/lib/db"

export function IntegratorModel() {
  const [modelName, setModelName] = useState("zai-glm-4.6")
  const [temperature, setTemperature] = useState(0.5)
  const [maxTokens, setMaxTokens] = useState(2000)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const settings = await db.getAppSettings()
      if (settings?.integratorModel) {
        setModelName(settings.integratorModel.modelName)
        setTemperature(settings.integratorModel.temperature)
        setMaxTokens(settings.integratorModel.maxTokens)
      }
    } catch (error) {
      console.error("[v0] Failed to load integrator settings:", error)
    }
  }

  useEffect(() => {
    if (modelName) {
      saveSettings()
    }
  }, [modelName, temperature, maxTokens])

  const saveSettings = async () => {
    try {
      const currentSettings = await db.getAppSettings()
      await db.saveAppSettings({
        ...currentSettings,
        integratorModel: {
          provider: "cerebras",
          modelName,
          temperature,
          maxTokens,
        },
      })
      console.log("[v0] Integrator settings saved")
    } catch (error) {
      console.error("[v0] Failed to save integrator settings:", error)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>統合モデル</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="integrator-model">モデル名</Label>
          <Input
            id="integrator-model"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="zai-glm-4.6"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">複数のモデルからの応答を統合する際に使用します</p>
        </div>
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
        <div className="space-y-2">
          <Label htmlFor="integrator-tokens">最大トークン数</Label>
          <Input
            id="integrator-tokens"
            type="number"
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number.parseInt(e.target.value) || 0)}
            placeholder="2000"
          />
        </div>
      </CardContent>
    </Card>
  )
}
