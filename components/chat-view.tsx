"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Menu, Settings, Send, Bot, Copy, RefreshCw, Loader2, ChevronDown, Pencil, Sparkles } from "lucide-react";
import { useMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { db, type Message, type Conversation, type ModelResponse } from "@/lib/db";
import { llmService } from "@/lib/llm-service";
import { useToast } from "@/hooks/use-toast";
import { MarkdownRenderer } from "./markdown-renderer";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AGENT_MODES, type AgentModeId } from "@/lib/constants";

/**
 * ChatViewコンポーネントのProps
 */
interface ChatViewProps {
  /** 現在選択されている会話オブジェクト (ない場合は null) */
  selectedConversationData: Conversation | null;
  /** サイドバーを開くためのコールバック */
  onOpenSidebar: () => void;
  /** 設定ダイアログを開くためのコールバック */
  onOpenSettings: () => void;
  /** (page.tsxから) 会話タイトルを更新するためのコールバック */
  onUpdateConversationTitle: (id: string, title: string) => void;
  /** (page.tsxから) 会話のシステムプロンプトを更新するためのコールバック */
  onUpdateConversationSystemPrompt: (id: string, systemPrompt: string) => void;
}

/**
 * メインのチャット表示・操作エリア
 */
export function ChatView({
  selectedConversationData,
  onOpenSidebar,
  onOpenSettings,
  onUpdateConversationTitle,
  onUpdateConversationSystemPrompt,
}: ChatViewProps) {
  // --- UI State ---
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());

  // --- DB同期 State ---
  /** 現在表示中のメッセージ（DBと同期） */
  const [messages, setMessages] = useState<Message[]>([]);
  /** 現在の会話のシステムプロンプト */
  const [currentSystemPrompt, setCurrentSystemPrompt] = useState("");

  // --- エージェント State ---
  /** 選択中のエージェントモードID */
  const [agentMode, setAgentMode] = useState<AgentModeId>("standard");
  /** ストリーミング中の「思考ステップ」表示用 */
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);

  // --- 編集 State ---
  /** 編集中のメッセージID（nullの場合は編集モードではない） */
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  /** 編集中のテキストエリアの内容 */
  const [editingContent, setEditingContent] = useState<string>("");

  // --- Refs ---
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** 会話切り替え時の競合回避用Ref */
  const activeConversationIdRef = useRef<string | null>(null);

  const isMobile = useMobile();
  const { toast } = useToast();

  /**
   * IndexedDBから指定された会話のメッセージを読み込みます。
   * @param {string} conversationId - 読み込む会話のID
   */
  const loadMessages = useCallback(
    async (conversationId: string) => {
      try {
        const loadedMessages = await db.getMessages(conversationId);
        setMessages(loadedMessages);
        console.log("Loaded messages:", loadedMessages.length);
      } catch (error) {
        console.error("Failed to load messages:", error);
        toast({ title: "メッセージの読み込みに失敗しました", variant: "destructive" });
      }
    },
    [toast],
  );

  /**
   * 選択中の会話が変更されたら、DBからメッセージを読み込み、
   * 編集モードをキャンセルします。
   */
  useEffect(() => {
    const currentId = selectedConversationData?.id || null;
    const previousId = activeConversationIdRef.current;

    // IDをRefに更新
    activeConversationIdRef.current = currentId;

    if (selectedConversationData) {
      // IDが同じ場合（タイトル更新などのメタデータ変更時）は、メッセージの再読み込みをスキップする
      // これにより、メッセージ送信直後のタイトル更新でUIがリセットされるのを防ぐ
      if (currentId === previousId) {
        // システムプロンプトのみ同期
        if (selectedConversationData.systemPrompt !== currentSystemPrompt) {
          setCurrentSystemPrompt(selectedConversationData.systemPrompt || "");
        }
        return;
      }

      setIsLoading(false); // 会話切り替え時はローディング解除
      setEditingMessageId(null); // 編集モードをキャンセル
      loadMessages(selectedConversationData.id);
      setCurrentSystemPrompt(selectedConversationData.systemPrompt || "");
    } else {
      setMessages([]);
      setCurrentSystemPrompt("");
    }
  }, [selectedConversationData, loadMessages, currentSystemPrompt]);

  /**
   * メッセージリストやストリーミングステータスが更新されたら、
   * スムーズに一番下にスクロールします。
   */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingStatus]);

  /**
   * 共通のストリーミング実行とDB同期ロジック
   * (handleSubmit, handleRegenerate, handleEditAndRetry で共有)
   * @param {string} conversationId - 現在の会話ID
   * @param {Message[]} historyToResend - APIに送信するメッセージ履歴
   * @param {Message} assistantMessageShell - UI表示用のAIメッセージの「ガワ」
   */
  const executeStreamAndSync = async (
    conversationId: string,
    historyToResend: Message[],
    assistantMessageShell: Message,
  ) => {
    setIsLoading(true);

    try {
      // 1. 最新の設定をDBから取得
      const modelSettings = await db.getModelSettings();
      const appSettings = (await db.getAppSettings()) || {};
      const totalContentLength = historyToResend.reduce((acc, msg) => acc + msg.content.length, 0);

      let finalContent = "";
      let finalModelResponses: ModelResponse[] = [];

      // 2. ストリーミングAPIを呼び出し
      await llmService.generateResponseStreaming(
        historyToResend,
        modelSettings,
        appSettings,
        currentSystemPrompt,
        totalContentLength,
        agentMode,
        {
          /** 思考ステップが届くたび */
          onStatus: (step) => {
            if (activeConversationIdRef.current !== conversationId) return;
            setStreamingStatus(`思考中: ${step}...`);
          },
          /** 回答チャンクが届くたび */
          onData: (chunk) => {
            if (activeConversationIdRef.current !== conversationId) return;
            finalContent += chunk;
            // UIのAIメッセージ（ガワ）の content をリアルタイムで更新
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMessageShell.id ? { ...m, content: finalContent } : m)),
            );
          },
          /** 個別応答（JSON）が届いた時 */
          onResponses: (data) => {
            finalModelResponses = data; // データは常にキャプチャ
            // UI更新はアクティブな場合のみ
            if (activeConversationIdRef.current === conversationId) {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMessageShell.id ? { ...m, modelResponses: data } : m)),
              );
            }
          },
          /** 要約が実行された時 */
          onSummary: (newHistoryContext) => {
            // 要約結果は常にDBに保存（裏側で整合性を保つ）
            const fullHistory: Message[] = [...newHistoryContext, ...historyToResend.slice(-1), assistantMessageShell];
            db.replaceHistory(conversationId, fullHistory);
            // UI更新はアクティブな場合のみ
            if (activeConversationIdRef.current === conversationId) {
              setMessages(fullHistory);
            }
          },
          /** エラー発生時 */
          onError: (message) => {
            if (activeConversationIdRef.current !== conversationId) return;
            toast({ title: "エージェントエラー", description: message, variant: "destructive" });
            setMessages((prev) => prev.filter((m) => m.id !== assistantMessageShell.id));
            setIsLoading(false);
            setStreamingStatus(null);
          },
          /** ストリーム完了時 */
          onFinish: async (content) => {
            // DB同期 (ステップ2): 完全なAIメッセージをDBに保存
            const fullAssistantMessage: Message = {
              ...assistantMessageShell,
              content: content,
              timestamp: Date.now(),
              modelResponses: finalModelResponses,
            };
            try {
              await db.addMessage(fullAssistantMessage);
              console.log("DB Sync: 完了");
            } catch (err) {
              console.error("DB Sync Error:", err);
            }

            // UI更新はアクティブな場合のみ
            if (activeConversationIdRef.current === conversationId) {
              setIsLoading(false);
              setStreamingStatus(null);
            }
          },
        },
      );
    } catch (e) {
      console.error("Stream Execution Error:", e);
      if (activeConversationIdRef.current === conversationId) {
        toast({ title: "予期せぬエラーが発生しました", variant: "destructive" });
        setMessages((prev) => prev.filter((m) => m.id !== assistantMessageShell.id));
        setIsLoading(false);
        setStreamingStatus(null);
      }
    }
  };

  /**
   * メッセージ送信フォームのハンドラ
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !selectedConversationData) return;

    const conversationId = selectedConversationData.id;
    const userInput = input;

    setInput("");
    setStreamingStatus("思考中...");

    // --- DB同期 (ステップ1) ---
    // ユーザーメッセージを即座にDBとStateに保存
    const userMessage: Message = {
      id: `msg_user_${Date.now()}`,
      role: "user",
      content: userInput,
      timestamp: Date.now(),
      conversationId,
    };

    try {
      await db.addMessage(userMessage);
    } catch (error) {
      console.error("Failed to save user message:", error);
      toast({ title: "メッセージの保存に失敗しました", variant: "destructive" });
      // 楽観的UI更新をロールバック
      setInput(userInput);
      setStreamingStatus(null);
      return;
    }

    // アシスタントメッセージの「ガワ」を作成
    const assistantMessageId = `msg_asst_${Date.now()}`;
    const assistantMessageShell: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "", // まだ空
      timestamp: Date.now(),
      conversationId,
      modelResponses: [],
    };

    // UI Stateに両方を反映
    const historyToResend = [...messages, userMessage];
    setMessages([...historyToResend, assistantMessageShell]);

    // 会話の最初のメッセージの場合、自動でタイトルを更新
    if (messages.length === 0) {
      const title = userInput.slice(0, 30) + (userInput.length > 30 ? "..." : "");
      onUpdateConversationTitle(conversationId, title);
    }

    // --- ストリーミング実行 ---
    await executeStreamAndSync(conversationId, historyToResend, assistantMessageShell);
  };

  /**
   * AIの応答を再生成します。
   * @param {string} messageId - 再生成するアシスタントメッセージのID
   */
  const handleRegenerate = async (messageId: string) => {
    if (isLoading || !selectedConversationData) return;
    const conversationId = selectedConversationData.id;

    const messageIndex = messages.findIndex((m) => m.id === messageId);
    if (messageIndex < 1) {
      toast({ title: "このメッセージは再生成できません", variant: "destructive" });
      return;
    }
    const assistantMessage = messages[messageIndex];
    const userMessage = messages[messageIndex - 1];
    if (userMessage.role !== "user" || assistantMessage.role !== "assistant") {
      toast({ title: "アシスタントの応答のみ再生成できます", variant: "destructive" });
      return;
    }

    setStreamingStatus("再生成中...");

    // --- DB同期 (ステップ1) ---
    try {
      await db.deleteMessagesAfter(messageId, conversationId);
    } catch (error) {
      console.error("Failed to delete messages for regenerate:", error);
      toast({ title: "履歴の更新に失敗しました", variant: "destructive" });
      setStreamingStatus(null);
      return;
    }

    const historyToResend = messages.slice(0, messageIndex);

    const assistantMessageId = `msg_asst_${Date.now()}`;
    const assistantMessageShell: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      conversationId,
      modelResponses: [],
    };
    setMessages([...historyToResend, assistantMessageShell]);

    await executeStreamAndSync(conversationId, historyToResend, assistantMessageShell);
  };

  /**
   * ユーザーメッセージを編集し、そこから会話をやり直します。
   */
  const handleEditAndRetry = async () => {
    if (isLoading || !selectedConversationData || !editingMessageId) return;

    const conversationId = selectedConversationData.id;
    const newContent = editingContent.trim();
    if (!newContent) {
      toast({ title: "メッセージは空にできません", variant: "destructive" });
      return;
    }

    setStreamingStatus("編集して再生成中...");
    const originalMessageId = editingMessageId;

    // UIの編集モードを解除（楽観的更新）
    setEditingMessageId(null);
    setEditingContent("");

    const messageIndex = messages.findIndex((m) => m.id === originalMessageId);
    const nextMessage = messages[messageIndex + 1];

    // --- DB同期 (ステップ1) ---
    try {
      if (nextMessage) {
        await db.deleteMessagesAfter(nextMessage.id, conversationId);
      }
      await db.updateMessageContent(originalMessageId, newContent);
    } catch (error) {
      console.error("Failed to update message history:", error);
      toast({ title: "メッセージの更新に失敗しました", variant: "destructive" });
      setStreamingStatus(null);
      // エラー時は編集モードに戻すことも検討できるが、ここでは最低限の状態復帰のみ行う
      return;
    }

    // DBから最新の履歴を再取得して整合性を担保
    const historyToResend = await db.getMessages(conversationId);

    const assistantMessageId = `msg_asst_${Date.now()}`;
    const assistantMessageShell: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      conversationId,
      modelResponses: [],
    };
    setMessages([...historyToResend, assistantMessageShell]);

    await executeStreamAndSync(conversationId, historyToResend, assistantMessageShell);
  };

  /**
   * システムプロンプト入力欄からフォーカスが外れた際に、変更を保存します。
   */
  const saveSystemPrompt = () => {
    if (selectedConversationData && selectedConversationData.systemPrompt !== currentSystemPrompt) {
      onUpdateConversationSystemPrompt(selectedConversationData.id, currentSystemPrompt);
      toast({ title: "システムプロンプトを保存しました", duration: 2000 });
    }
  };

  /**
   * クリップボードへのコピーハンドラ
   * @param {string} content - コピーするテキスト
   */
  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    toast({
      title: "コピーしました",
      duration: 2000,
    });
  };

  /**
   * 個別応答の開閉状態をトグルします。
   * @param {string} messageId - 対象のアシスタントメッセージID
   */
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

  /**
   * ユーザーメッセージの「編集」ボタンクリックハンドラ
   * @param {Message} message - 編集対象のユーザーメッセージ
   */
  const handleEditClick = (message: Message) => {
    setEditingMessageId(message.id);
    setEditingContent(message.content);
  };

  /**
   * 編集モードをキャンセルします。
   */
  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingContent("");
  };

  const selectedMode = AGENT_MODES.find((m) => m.id === agentMode) || AGENT_MODES[0];

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* --- ヘッダー --- */}
      <header className="h-14 border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSidebar}
            aria-label="サイドバーを開く"
            className="flex-shrink-0"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-base font-semibold truncate">
            {selectedConversationData ? selectedConversationData.title : "新規チャット"}
          </h1>
        </div>
        <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="設定を開く" className="flex-shrink-0">
          <Settings className="h-5 w-5" />
        </Button>
      </header>

      {/* --- システムプロンプト入力欄 --- */}
      {selectedConversationData && (
        <div className="p-4 border-b border-border">
          <Textarea
            placeholder="システムプロンプト (この会話にのみ適用されます)"
            className="text-xs max-h-[100px] min-h-[50px] resize-none"
            value={currentSystemPrompt}
            onChange={(e) => setCurrentSystemPrompt(e.target.value)}
            onBlur={saveSystemPrompt}
            disabled={isLoading || editingMessageId !== null}
          />
        </div>
      )}

      {/* --- メッセージ表示エリア --- */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.length === 0 && !selectedConversationData && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm text-center">
            メッセージを送信して会話を開始しましょう
          </div>
        )}

        {messages.map((message) => {
          const isStreamingShell = message.role === "assistant" && message.content === "" && isLoading;

          return (
            <React.Fragment key={message.id}>
              {message.role === "system" ? (
                <div className="flex items-center justify-center">
                  <div className="max-w-[70%] rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground italic">
                    <MarkdownRenderer content={message.content} className="text-xs" />
                  </div>
                </div>
              ) : (
                <div className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}>
                  {message.role === "assistant" && (
                    <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
                      <Bot className="w-5 h-5 text-primary-foreground" />
                    </div>
                  )}

                  <div className="relative max-w-[70%] group">
                    {editingMessageId === message.id ? (
                      <div className="w-full space-y-2">
                        <Textarea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          className="min-h-[80px]"
                          autoFocus
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                            キャンセル
                          </Button>
                          <Button size="sm" onClick={handleEditAndRetry} disabled={isLoading}>
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存して再生成"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "px-4 py-3 rounded-lg",
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-card text-card-foreground border border-border",
                        )}
                      >
                        {isStreamingShell ? (
                          <div className="flex items-center gap-2 text-sm">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>{streamingStatus || "思考中..."}</span>
                          </div>
                        ) : (
                          <MarkdownRenderer content={message.content} className="text-sm" />
                        )}

                        {!isStreamingShell &&
                          message.role === "assistant" &&
                          message.modelResponses &&
                          message.modelResponses.length > 0 && (
                            <Collapsible
                              open={expandedMessages.has(message.id)}
                              onOpenChange={() => toggleExpanded(message.id)}
                              className="mt-4"
                            >
                              <CollapsibleTrigger asChild>
                                <Button variant="outline" size="sm" className="w-full justify-between bg-transparent">
                                  <span className="text-xs">
                                    個別モデルの応答を表示 ({message.modelResponses.length})
                                  </span>
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
                                  <div key={index} className="border border-border rounded-md overflow-hidden">
                                    {/* モデルヘッダー */}
                                    <div className="bg-muted/50 px-3 py-2 border-b border-border flex items-center justify-between">
                                      <span className="text-xs font-semibold text-muted-foreground">
                                        {response.model}
                                      </span>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() => handleCopy(response.content)}
                                      >
                                        <Copy className="h-3 w-3" />
                                      </Button>
                                    </div>

                                    <div className="p-3 bg-card space-y-3">
                                      {/* 思考プロセスがある場合は視覚的に分離して表示 */}
                                      {response.thought && (
                                        <div className="text-xs bg-muted/30 p-2 rounded border border-border/50">
                                          <div className="font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                                            <Sparkles className="w-3 h-3" /> 思考プロセス
                                          </div>
                                          <div className="opacity-90 text-muted-foreground whitespace-pre-wrap">
                                            {response.thought}
                                          </div>
                                        </div>
                                      )}

                                      {/* 回答コンテンツ */}
                                      <div>
                                        {response.thought && (
                                          <div className="font-semibold text-xs text-muted-foreground mb-1">
                                            最終回答
                                          </div>
                                        )}
                                        <MarkdownRenderer content={response.content} className="text-xs" />
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </CollapsibleContent>
                            </Collapsible>
                          )}
                      </div>
                    )}

                    {!isLoading && !editingMessageId && !isStreamingShell && (
                      <>
                        {message.role === "assistant" && (
                          <div className="absolute -bottom-8 left-0 flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleCopy(message.content)}
                              title="コピー"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleRegenerate(message.id)}
                              title="再生成"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                        {message.role === "user" && (
                          <div className="absolute -bottom-8 right-0 flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleCopy(message.content)}
                              title="コピー"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleEditClick(message)}
                              title="編集して再生成"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2 mb-2">
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={popoverOpen}
                className="w-full justify-between bg-transparent md:w-[280px]"
                disabled={isLoading || editingMessageId !== null}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="truncate">{selectedMode.name}</span>
                </div>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0 md:w-[350px]">
              <Command>
                <CommandInput placeholder="モードを検索..." />
                <CommandList>
                  <CommandEmpty>見つかりません。</CommandEmpty>
                  <CommandGroup>
                    {AGENT_MODES.map((mode) => (
                      <CommandItem
                        key={mode.id}
                        value={mode.id}
                        onSelect={(currentValue) => {
                          setAgentMode(currentValue as AgentModeId);
                          setPopoverOpen(false);
                        }}
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{mode.name}</span>
                          <span className="text-xs text-muted-foreground">{mode.description}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={editingMessageId ? "メッセージを編集中..." : "メッセージを送信..."}
            className="min-h-[44px] max-h-[200px] resize-none"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isMobile) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            disabled={editingMessageId !== null || isLoading || !selectedConversationData}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isLoading || editingMessageId !== null || !selectedConversationData}
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
