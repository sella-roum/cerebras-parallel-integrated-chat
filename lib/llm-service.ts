// LLM APIサービス

import type { Message, ModelSettings, AppSettings, ModelResponse } from "./db"
import { createCerebras } from "@ai-sdk/cerebras"
import { streamText } from "ai"

interface LLMResponse {
  content: string
  provider: string
  model: string
}

export class LLMService {
  private apiKey = ""

  setApiKey(key: string) {
    this.apiKey = key
  }

  async generateResponseWithDetails(
    messages: Message[],
    modelSettings: ModelSettings[],
    appSettings: AppSettings,
  ): Promise<{ content: string; modelResponses: ModelResponse[] }> {
    if (!this.apiKey) {
      throw new Error("Cerebras APIキーが設定されていません")
    }

    console.log("[v0] Generating response with multiple models")

    const enabledModels = modelSettings.filter((m) => m.enabled)

    if (enabledModels.length === 0) {
      throw new Error("有効な推論モデルが設定されていません")
    }

    const responses = await Promise.all(
      enabledModels.map((model) =>
        this.callLLM(messages, model).catch((err) => {
          console.error(`[v0] Error from model ${model.modelName}:`, err)
          return { error: err.message }
        }),
      ),
    )

    console.log(
      "[v0] Got responses from models:",
      responses.map((r) => ({
        model: "model" in r ? r.model : "error",
        hasContent: "content" in r ? r.content.length : 0,
        error: "error" in r ? r.error : undefined,
      })),
    )

    const validResponses = responses.filter((r): r is LLMResponse => !("error" in r))

    if (validResponses.length === 0) {
      const errorMessages = responses
        .filter((r): r is { error: string } => "error" in r)
        .map((r) => r.error)
        .join(", ")
      throw new Error(`すべてのモデルからの応答に失敗しました: ${errorMessages}`)
    }

    const modelResponses: ModelResponse[] = validResponses.map((r) => ({
      model: r.model,
      provider: r.provider,
      content: r.content,
    }))

    let finalContent: string

    if (validResponses.length === 1) {
      finalContent = validResponses[0].content
    } else if (appSettings.integratorModel) {
      finalContent = await this.integrateResponses(validResponses, appSettings.integratorModel)
    } else {
      finalContent = validResponses[0].content
    }

    return { content: finalContent, modelResponses }
  }

  async generateResponse(
    messages: Message[],
    modelSettings: ModelSettings[],
    appSettings: AppSettings,
  ): Promise<string> {
    const result = await this.generateResponseWithDetails(messages, modelSettings, appSettings)
    return result.content
  }

  private async callLLM(messages: Message[], modelSettings: ModelSettings): Promise<LLMResponse> {
    return await this.callCerebras(messages, modelSettings)
  }

  private async callCerebras(messages: Message[], modelSettings: ModelSettings): Promise<LLMResponse> {
    console.log(`[v0] Calling Cerebras ${modelSettings.modelName}`)

    const cerebras = createCerebras({
      apiKey: this.apiKey,
    })

    const formattedMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    try {
      const result = await streamText({
        model: cerebras(modelSettings.modelName),
        messages: formattedMessages,
        temperature: modelSettings.temperature,
        maxTokens: modelSettings.maxTokens,
        topP: 0.95,
      })

      let fullText = ""
      for await (const textPart of result.textStream) {
        fullText += textPart
      }

      console.log(`[v0] Received ${fullText.length} chars from ${modelSettings.modelName}`)

      return {
        content: fullText,
        provider: "cerebras",
        model: modelSettings.modelName,
      }
    } catch (error: any) {
      console.error("[v0] Cerebras API error details:", {
        name: error.name,
        message: error.message,
        statusCode: error.statusCode,
        responseHeaders: error.responseHeaders,
        responseBody: error.responseBody,
        url: error.url,
        cause: error.cause,
      })

      let errorMessage = `Cerebras API エラー (${modelSettings.modelName})`

      if (error.statusCode === 401) {
        errorMessage += ": APIキーが無効です"
      } else if (error.statusCode === 404) {
        errorMessage += ": モデルが見つかりません"
      } else if (error.statusCode === 429) {
        errorMessage += ": レート制限に達しました"
      } else if (error.message) {
        errorMessage += `: ${error.message}`
      }

      throw new Error(errorMessage)
    }
  }

  private async integrateResponses(
    responses: LLMResponse[],
    integratorModel: NonNullable<AppSettings["integratorModel"]>,
  ): Promise<string> {
    console.log("[v0] Integrating responses")

    const apiKey = this.apiKey
    if (!apiKey) {
      console.warn("[v0] Integrator API key not found, returning first response")
      return responses[0].content
    }

    const promptMessages = [
      {
        role: "user",
        content: `以下は複数のAIモデルからの応答です。これらを統合して、最も適切で包括的な回答を生成してください:\n\n${responses
          .map((r, i) => `[モデル${i + 1}: ${r.model}]\n${r.content}`)
          .join("\n\n")}`,
      },
    ]

    const modelSettings: ModelSettings = {
      id: "integrator",
      provider: "cerebras",
      modelName: integratorModel.modelName,
      temperature: integratorModel.temperature,
      maxTokens: integratorModel.maxTokens,
      enabled: true,
    }

    try {
      const result = await this.callLLM(
        promptMessages.map((m) => ({
          id: Date.now().toString(),
          role: m.role as "user" | "assistant",
          content: m.content,
          timestamp: Date.now(),
          conversationId: "",
        })),
        modelSettings,
      )
      return result.content
    } catch (error) {
      console.error("[v0] Integration failed:", error)
      return responses[0].content
    }
  }
}

export const llmService = new LLMService()
