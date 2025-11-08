"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Menu, Settings, Send, Bot, Copy, RefreshCw, Loader2, ChevronDown } from "lucide-react"
import { useMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { db, type Message } from "@/lib/db"
import { llmService } from "@/lib/llm-service"
import { useToast } from "@/hooks/use-toast"
import { MarkdownRenderer } from "./markdown-renderer"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

interface ChatViewProps {
  selectedConversation: string | null
  onOpenSidebar: () => void
  onOpenSettings: () => void
  onUpdateConversationTitle: (id: string, title: string) => void
  onNewConversation: () => void
}

export function ChatView({
  selectedConversation,
  onOpenSidebar,
  onOpenSettings,
  onUpdateConversationTitle,
  onNewConversation,
}: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isMobile = useMobile()
  const { toast } = useToast()

  useEffect(() => {
    if (selectedConversation) {
      loadMessages()
    } else {
      setMessages([])
    }
  }, [selectedConversation])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const loadMessages = async () => {
    if (!selectedConversation) return
    try {
      const loadedMessages = await db.getMessages(selectedConversation)
      setMessages(loadedMessages)
      console.log("[v0] Loaded messages:", loadedMessages.length)
    } catch (error) {
      console.error("[v0] Failed to load messages:", error)
      toast({
        title: "メッセージの読み込みに失敗しました",
        variant: "destructive",
      })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const conversationId = selectedConversation
    if (!conversationId) {
      await onNewConversation()
      return
    }

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: input,
      timestamp: Date.now(),
      conversationId,
    }

    try {
      await db.addMessage(userMessage)
      setMessages([...messages, userMessage])
      setInput("")
      setIsLoading(true)

      if (messages.length === 0) {
        const title = input.slice(0, 30) + (input.length > 30 ? "..." : "")
        onUpdateConversationTitle(conversationId, title)
      }

      const modelSettings = await db.getModelSettings()
      const appSettings = await db.getAppSettings()

      console.log("[v0] Calling LLM service with settings:", { modelSettings, appSettings })

      const { content, modelResponses } = await llmService.generateResponseWithDetails(
        [...messages, userMessage],
        modelSettings,
        appSettings || {},
      )

      const assistantMessage: Message = {
        id: `msg_${Date.now() + 1}`,
        role: "assistant",
        content,
        timestamp: Date.now(),
        conversationId,
        modelResponses,
      }

      await db.addMessage(assistantMessage)
      setMessages((prev) => [...prev, assistantMessage])
      console.log("[v0] Response saved successfully")
    } catch (error) {
      console.error("[v0] Failed to generate response:", error)
      toast({
        title: "応答の生成に失敗しました",
        description: error instanceof Error ? error.message : "エラーが発生しました",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content)
    toast({
      title: "コピーしました",
      duration: 2000,
    })
  }

  const handleRegenerate = async (messageId: string) => {
    console.log("Regenerate:", messageId)
  }

  const toggleExpanded = (messageId: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) {
        next.delete(messageId)
      } else {
        next.add(messageId)
      }
      return next
    })
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* ヘッダー */}
      <header className="h-14 border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {isMobile && (
            <Button variant="ghost" size="icon" onClick={onOpenSidebar} aria-label="サイドバーを開く">
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <h1 className="text-base font-semibold">{selectedConversation ? "チャット" : "新規チャット"}</h1>
        </div>
        <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="設定を開く">
          <Settings className="h-5 w-5" />
        </Button>
      </header>

      {/* メッセージ表示エリア */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.length === 0 && !selectedConversation && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm text-center">
            メッセージを送信して会話を開始しましょう
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}
            onMouseEnter={() => setHoveredMessageId(message.id)}
            onMouseLeave={() => setHoveredMessageId(null)}
          >
            {message.role === "assistant" && (
              <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
                <Bot className="w-5 h-5 text-primary-foreground" />
              </div>
            )}

            <div className="relative max-w-[70%] group">
              <div
                className={cn(
                  "px-4 py-3 rounded-lg",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-card-foreground border border-border",
                )}
              >
                {message.role === "assistant" ? (
                  <MarkdownRenderer content={message.content} className="text-sm" />
                ) : (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                )}

                {message.role === "assistant" && message.modelResponses && message.modelResponses.length > 1 && (
                  <Collapsible
                    open={expandedMessages.has(message.id)}
                    onOpenChange={() => toggleExpanded(message.id)}
                    className="mt-4"
                  >
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full justify-between bg-transparent">
                        <span className="text-xs">個別モデルの応答を表示 ({message.modelResponses.length})</span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform",
                            expandedMessages.has(message.id) && "rotate-180",
                          )}
                        />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-3 space-y-3">
                      {message.modelResponses.map((response, index) => (
                        <div key={index} className="border border-border rounded-md p-3 bg-muted/30">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-muted-foreground">{response.model}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleCopy(response.content)}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          <MarkdownRenderer content={response.content} className="text-xs" />
                        </div>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>

              {message.role === "assistant" && hoveredMessageId === message.id && (
                <div className="absolute -bottom-8 left-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCopy(message.content)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRegenerate(message.id)}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 入力フォーム */}
      <div className="p-4 border-t border-border">
        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="メッセージを送信..."
            className="min-h-[44px] max-h-[200px] resize-none"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e)
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isLoading}
            aria-label="送信"
            className="flex-shrink-0"
          >
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </Button>
        </form>
      </div>
    </div>
  )
}
