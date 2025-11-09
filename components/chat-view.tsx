"use client";

import type React from "react";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Menu, Settings, Send, Bot, Copy, RefreshCw, Loader2, ChevronDown } from "lucide-react";
import { useMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { db, type Message, type Conversation } from "@/lib/db"; // Conversation をインポート
import { llmService } from "@/lib/llm-service";
import { useToast } from "@/hooks/use-toast";
import { MarkdownRenderer } from "./markdown-renderer";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface ChatViewProps {
  selectedConversationData: Conversation | null; // <-- IDからオブジェクトに変更
  onOpenSidebar: () => void;
  onOpenSettings: () => void;
  onUpdateConversationTitle: (id: string, title: string) => void;
  onNewConversation: () => void;
  onUpdateConversationSystemPrompt: (id: string, systemPrompt: string) => void; // <-- 追加
}

export function ChatView({
  selectedConversationData,
  onOpenSidebar,
  onOpenSettings,
  onUpdateConversationTitle,
  onNewConversation,
  onUpdateConversationSystemPrompt, // <-- 追加
}: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [currentSystemPrompt, setCurrentSystemPrompt] = useState(""); // <-- システムプロンプト用state
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMobile = useMobile();
  const { toast } = useToast();

  useEffect(() => {
    if (selectedConversationData) {
      loadMessages(selectedConversationData.id);
      // 会話が切り替わったらシステムプロンプトを更新
      setCurrentSystemPrompt(selectedConversationData.systemPrompt || "");
    } else {
      setMessages([]);
      setCurrentSystemPrompt(""); // 新規チャット時はクリア
    }
  }, [selectedConversationData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadMessages = async (conversationId: string) => {
    try {
      const loadedMessages = await db.getMessages(conversationId);
      setMessages(loadedMessages);
      console.log("Loaded messages:", loadedMessages.length);
    } catch (error) {
      console.error("Failed to load messages:", error);
      toast({
        title: "メッセージの読み込みに失敗しました",
        variant: "destructive",
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const conversationId = selectedConversationData?.id;
    if (!conversationId) {
      // IDがない（新規会話）の場合は、先に onNewConversation を呼び出す必要がある
      await onNewConversation();
      return;
    }

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: input,
      timestamp: Date.now(),
      conversationId,
    };

    try {
      await db.addMessage(userMessage);
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      setInput("");
      setIsLoading(true);

      if (nextMessages.length === 1) {
        // ユーザーメッセージが追加された後なので、1
        const title = input.slice(0, 30) + (input.length > 30 ? "..." : "");
        onUpdateConversationTitle(conversationId, title);
      }

      const modelSettings = await db.getModelSettings();
      const appSettings = await db.getAppSettings();

      console.log("Calling LLM service with settings and system prompt.");

      const { content, modelResponses } = await llmService.generateResponseWithDetails(
        nextMessages,
        modelSettings,
        appSettings || {},
        currentSystemPrompt, // <-- システムプロンプトを渡す
      );

      const assistantMessage: Message = {
        id: `msg_${Date.now() + 1}`,
        role: "assistant",
        content,
        timestamp: Date.now(),
        conversationId,
        modelResponses,
      };

      await db.addMessage(assistantMessage);
      setMessages((prev) => [...prev, assistantMessage]);
      console.log("Response saved successfully");
    } catch (error) {
      console.error("Failed to generate response:", error);
      toast({
        title: "応答の生成に失敗しました",
        description: error instanceof Error ? error.message : "エラーが発生しました",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // --- システムプロンプト用ハンドラ ---
  const handleSystemPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentSystemPrompt(e.target.value);
  };

  // フォーカスが外れたときにDBに保存
  const saveSystemPrompt = () => {
    if (selectedConversationData && selectedConversationData.systemPrompt !== currentSystemPrompt) {
      onUpdateConversationSystemPrompt(selectedConversationData.id, currentSystemPrompt);
      toast({ title: "システムプロンプトを保存しました", duration: 2000 });
    }
  };
  // ------------------------------------

  // コピー機能（実装済み）
  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    toast({
      title: "コピーしました",
      duration: 2000,
    });
  };

  // ▼ ----- 再生成機能（実装） ----- ▼
  const handleRegenerate = async (messageId: string) => {
    if (isLoading || !selectedConversationData) return;

    // 1. 再生成するAIメッセージと、その直前のユーザーメッセージを見つける
    const messageIndex = messages.findIndex((m) => m.id === messageId);
    if (messageIndex < 1) {
      // 最初のメッセージか、見つからない場合は何もしない
      return;
    }

    const assistantMessage = messages[messageIndex];
    const userMessage = messages[messageIndex - 1];

    // 直前がユーザーメッセージでない場合は再生成しない
    if (userMessage.role !== "user" || assistantMessage.role !== "assistant") {
      toast({ title: "このメッセージは再生成できません", variant: "destructive" });
      return;
    }

    const conversationId = selectedConversationData.id;

    // 再送する会話履歴（再生成するAIメッセージの *直前* まで）
    const historyToResend = messages.slice(0, messageIndex);

    setIsLoading(true);

    try {
      // 2. DBとStateから、再生成するAI回答 *以降* のメッセージを削除
      await db.deleteMessagesAfter(messageId, conversationId);

      // 3. UI (State) を更新
      setMessages(historyToResend);

      // 4. handleSubmit と同様のロジックでAIサービスを呼び出す
      const modelSettings = await db.getModelSettings();
      const appSettings = await db.getAppSettings();

      const { content, modelResponses } = await llmService.generateResponseWithDetails(
        historyToResend, // <-- AI回答の直前までの履歴
        modelSettings,
        appSettings || {},
        currentSystemPrompt,
      );

      const newAssistantMessage: Message = {
        id: `msg_${Date.now() + 1}`, // 新しいID
        role: "assistant",
        content,
        timestamp: Date.now(),
        conversationId,
        modelResponses,
      };

      // 5. 新しい回答をDBとStateに追加
      await db.addMessage(newAssistantMessage);
      setMessages((prev) => [...prev, newAssistantMessage]);
      console.log("Response regenerated successfully");
    } catch (error) {
      console.error("Failed to regenerate response:", error);
      toast({
        title: "再生成に失敗しました",
        description: error instanceof Error ? error.message : "エラーが発生しました",
        variant: "destructive",
      });
      // エラーが発生した場合、DBとUIを再同期
      await loadMessages(conversationId);
    } finally {
      setIsLoading(false);
    }
  };
  // ▲ ----- 再生成機能（実装） ----- ▲

  const toggleExpanded = (messageId: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  return (
    // min-w-0 修正済み
    <div className="flex-1 flex flex-col min-w-0">
      {/* ヘッダー */}
      <header className="h-14 border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {isMobile && (
            <Button variant="ghost" size="icon" onClick={onOpenSidebar} aria-label="サイドバーを開く">
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <h1 className="text-base font-semibold">
            {selectedConversationData ? selectedConversationData.title : "新規チャット"}
          </h1>
        </div>
        <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="設定を開く">
          <Settings className="h-5 w-5" />
        </Button>
      </header>

      {/* システムプロンプト入力欄 */}
      {selectedConversationData && (
        <div className="p-4 border-b border-border">
          <Textarea
            placeholder="システムプロンプト (この会話にのみ適用されます)"
            className="text-xs max-h-[100px] min-h-[50px] resize-none"
            value={currentSystemPrompt}
            onChange={handleSystemPromptChange}
            onBlur={saveSystemPrompt}
          />
        </div>
      )}

      {/* メッセージ表示エリア */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.length === 0 && !selectedConversationData && (
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

              {/*
                isLoading中はボタンを非表示にするか、
                特定のメッセージがローディング中かなどを管理する必要があるが、
                現状はシンプルに isLoading で制御
              */}
              {message.role === "assistant" && hoveredMessageId === message.id && !isLoading && (
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
                e.preventDefault();
                handleSubmit(e);
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
  );
}
