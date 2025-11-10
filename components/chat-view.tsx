"use client";

import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Menu, Settings, Send, Bot, Copy, RefreshCw, Loader2, ChevronDown, Pencil } from "lucide-react";
import { useMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { db, type Message, type Conversation } from "@/lib/db";
import { llmService } from "@/lib/llm-service";
import { useToast } from "@/hooks/use-toast";
import { MarkdownRenderer } from "./markdown-renderer";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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
  /** 会話タイトルを更新するためのコールバック */
  onUpdateConversationTitle: (id: string, title: string) => void;
  /** 新規会話を作成するためのコールバック */
  onNewConversation: () => void;
  /** 会話のシステムプロンプトを更新するためのコールバック */
  onUpdateConversationSystemPrompt: (id: string, systemPrompt: string) => void;
}

/**
 * メインのチャット表示・操作エリア
 * @param {ChatViewProps} props
 */
export function ChatView({
  selectedConversationData,
  onOpenSidebar,
  onOpenSettings,
  onUpdateConversationTitle,
  onNewConversation,
  onUpdateConversationSystemPrompt,
}: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [currentSystemPrompt, setCurrentSystemPrompt] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMobile = useMobile();
  const { toast } = useToast();

  // 選択中の会話が変更されたら、メッセージリストとシステムプロンプトを再読み込み
  useEffect(() => {
    if (selectedConversationData) {
      loadMessages(selectedConversationData.id);
      setCurrentSystemPrompt(selectedConversationData.systemPrompt || "");
    } else {
      // 会話が選択されていない場合（初期状態など）はリセット
      setMessages([]);
      setCurrentSystemPrompt("");
    }
  }, [selectedConversationData]);

  // メッセージリストが更新されたら、一番下にスクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /**
   * IndexedDBから指定された会話のメッセージを読み込みます。
   * @param {string} conversationId - 読み込む会話のID
   */
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

  /**
   * メッセージ送信フォームのハンドラ
   * @param {React.FormEvent} e - フォームイベント
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const conversationId = selectedConversationData?.id;
    if (!conversationId) {
      // もし会話が選択されていなければ、新しい会話を作成してから処理を続行
      // (このケースは通常、`onNewConversation` が先に呼ばれるため稀)
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
      // 1. ユーザーメッセージをDBとStateに追加
      await db.addMessage(userMessage);
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      setInput("");
      setIsLoading(true);

      // 2. 会話の最初のメッセージの場合、自動でタイトルを更新
      if (nextMessages.length === 1) {
        const title = input.slice(0, 30) + (input.length > 30 ? "..." : "");
        onUpdateConversationTitle(conversationId, title);
      }

      // 3. DBから最新のモデル設定を取得
      const modelSettings = await db.getModelSettings();
      const appSettings = await db.getAppSettings();

      // 4. APIに送信する総文字数を計算（要約トリガー判定用）
      const totalContentLength = nextMessages.reduce((acc, msg) => acc + msg.content.length, 0);

      // 5. サーバーAPIを呼び出し
      const { content, modelResponses, summaryExecuted, newHistoryContext } =
        await llmService.generateResponseWithDetails(
          nextMessages,
          modelSettings,
          appSettings || {},
          currentSystemPrompt,
          totalContentLength,
        );

      // 6. アシスタントの応答メッセージを作成
      const assistantMessage: Message = {
        id: `msg_${Date.now() + 1}`,
        role: "assistant",
        content,
        timestamp: Date.now(),
        conversationId,
        modelResponses,
      };

      // 7. サーバー側で要約が実行された場合の処理
      if (summaryExecuted && newHistoryContext) {
        console.log("[Sync] サーバー側で要約が実行されました。クライアントの履歴を同期します。");
        // DBの履歴をサーバー側の新しい履歴（要約＋ユーザー＋アシスタント）で完全に置き換え
        const newFullHistory = [...newHistoryContext, userMessage, assistantMessage];
        await db.replaceHistory(conversationId, newFullHistory);
        setMessages(newFullHistory);
      } else {
        // 8. 通常の応答処理
        await db.addMessage(assistantMessage);
        setMessages((prev) => [...prev, assistantMessage]);
      }

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

  /**
   * システムプロンプト入力欄の変更ハンドラ
   * @param {React.ChangeEvent<HTMLTextAreaElement>} e
   */
  const handleSystemPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentSystemPrompt(e.target.value);
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
   * AIの応答を再生成します。
   * @param {string} messageId - 再生成するアシスタントメッセージのID
   */
  const handleRegenerate = async (messageId: string) => {
    if (isLoading || !selectedConversationData) return;

    const messageIndex = messages.findIndex((m) => m.id === messageId);
    // ユーザー/アシスタントのペアが見つからない場合は終了
    if (messageIndex < 1) {
      return;
    }

    const assistantMessage = messages[messageIndex];
    const userMessage = messages[messageIndex - 1];

    if (userMessage.role !== "user" || assistantMessage.role !== "assistant") {
      toast({ title: "このメッセージは再生成できません", variant: "destructive" });
      return;
    }

    const conversationId = selectedConversationData.id;
    // 再生成対象のアシスタントメッセージ *より前* の履歴をAPIに送信する
    const historyToResend = messages.slice(0, messageIndex);

    setIsLoading(true);

    try {
      // 1. DBとStateから、再生成対象のメッセージ *以降* を削除
      await db.deleteMessagesAfter(messageId, conversationId);
      setMessages(historyToResend);

      // 2. モデル設定を取得
      const modelSettings = await db.getModelSettings();
      const appSettings = await db.getAppSettings();

      // 3. 総文字数を計算
      const totalContentLength = historyToResend.reduce((acc, msg) => acc + msg.content.length, 0);

      // 4. APIを呼び出し
      const { content, modelResponses, summaryExecuted, newHistoryContext } =
        await llmService.generateResponseWithDetails(
          historyToResend,
          modelSettings,
          appSettings || {},
          currentSystemPrompt,
          totalContentLength,
        );

      // 5. 新しいアシスタントメッセージを作成
      const newAssistantMessage: Message = {
        id: `msg_${Date.now() + 1}`,
        role: "assistant",
        content,
        timestamp: Date.now(),
        conversationId,
        modelResponses,
      };

      // 6. 再生成中に要約がトリガーされた場合の処理
      if (summaryExecuted && newHistoryContext) {
        console.warn("[Regenerate] 再生成中に要約がトリガーされました。履歴を同期します。");

        // historyToResend の最後のメッセージ（＝ユーザーの質問）を履歴に含める
        const lastUserMessage = historyToResend.at(-1);
        const historyWithSummary =
          lastUserMessage && lastUserMessage.role === "user"
            ? [...newHistoryContext, lastUserMessage, newAssistantMessage]
            : [...newHistoryContext, newAssistantMessage]; // フォールバック

        await db.replaceHistory(conversationId, historyWithSummary);
        setMessages(historyWithSummary);
      } else {
        // 7. 通常の再生成処理
        await db.addMessage(newAssistantMessage);
        setMessages((prev) => [...prev, newAssistantMessage]);
        console.log("Response regenerated successfully");
      }
    } catch (error) {
      console.error("Failed to regenerate response:", error);
      toast({
        title: "再生成に失敗しました",
        description: error instanceof Error ? error.message : "エラーが発生しました",
        variant: "destructive",
      });
      // エラーが発生した場合は、DBから最新の状態を再読み込みして復元
      await loadMessages(conversationId);
    } finally {
      setIsLoading(false);
    }
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

    setIsLoading(true);
    const messageIndex = messages.findIndex((m) => m.id === editingMessageId);
    if (messageIndex === -1) {
      setIsLoading(false);
      return;
    }

    try {
      // 1. 編集対象メッセージの *次* のメッセージ（AIの応答）が存在すれば、それ以降をDBから削除
      const nextMessage = messages[messageIndex + 1];
      if (nextMessage) {
        await db.deleteMessagesAfter(nextMessage.id, conversationId);
      }

      // 2. 編集対象メッセージの内容を更新
      await db.updateMessageContent(editingMessageId, newContent);

      // 3. DBから最新の履歴（編集済み）を読み込み
      const historyToResend = await db.getMessages(conversationId);
      setMessages(historyToResend);

      // 4. モデル設定を取得
      const modelSettings = await db.getModelSettings();
      const appSettings = await db.getAppSettings();
      const totalContentLength = historyToResend.reduce((acc, msg) => acc + msg.content.length, 0);

      // 5. APIを呼び出し
      const { content, modelResponses, summaryExecuted, newHistoryContext } =
        await llmService.generateResponseWithDetails(
          historyToResend,
          modelSettings,
          appSettings || {},
          currentSystemPrompt,
          totalContentLength,
        );

      // 6. 新しいアシスタントメッセージを作成
      const assistantMessage: Message = {
        id: `msg_${Date.now() + 1}`,
        role: "assistant",
        content,
        timestamp: Date.now(),
        conversationId,
        modelResponses,
      };

      // 7. 編集・やり直し中に要約がトリガーされた場合の処理
      if (summaryExecuted && newHistoryContext) {
        console.warn("[EditRetry] 編集・やり直し中に要約がトリガーされました。履歴を同期します。");

        // historyToResend の最後のメッセージ（＝編集済みのユーザー質問）を履歴に含める
        const editedUserMessage = historyToResend.at(-1);
        const newFullHistory =
          editedUserMessage && editedUserMessage.role === "user"
            ? [...newHistoryContext, editedUserMessage, assistantMessage]
            : [...newHistoryContext, assistantMessage]; // フォールバック

        await db.replaceHistory(conversationId, newFullHistory);
        setMessages(newFullHistory);
      } else {
        // 8. 通常のやり直し処理
        await db.addMessage(assistantMessage);
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (error) {
      console.error("Failed to edit and retry:", error);
      toast({ title: "やり直しに失敗しました", variant: "destructive" });
      await loadMessages(conversationId); // エラー時はDBから復元
    } finally {
      setIsLoading(false);
      setEditingMessageId(null);
      setEditingContent("");
    }
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

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* --- ヘッダー --- */}
      <header className="h-14 border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onOpenSidebar} aria-label="サイドバーを開く">
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-base font-semibold">
            {selectedConversationData ? selectedConversationData.title : "新規チャット"}
          </h1>
        </div>
        <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="設定を開く">
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
            onChange={handleSystemPromptChange}
            onBlur={saveSystemPrompt} // フォーカスが外れたら自動保存
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
        {messages.map((message) => (
          <React.Fragment key={message.id}>
            {/* 要約などのシステムメッセージ */}
            {message.role === "system" ? (
              <div className="flex items-center justify-center">
                <div className="max-w-[70%] rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground italic">
                  <MarkdownRenderer content={message.content} className="text-xs" />
                </div>
              </div>
            ) : (
              // ユーザーまたはアシスタントのメッセージ
              <div
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
                  {/* ユーザーメッセージ編集中 */}
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
                    // 通常のメッセージ表示
                    <div
                      className={cn(
                        "px-4 py-3 rounded-lg",
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-card-foreground border border-border",
                      )}
                    >
                      {/* メッセージ本文 */}
                      {message.role === "assistant" ? (
                        <MarkdownRenderer content={message.content} className="text-sm" />
                      ) : (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                      )}

                      {/* 個別応答の折りたたみ */}
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
                  )}

                  {/* アシスタント用操作ボタン */}
                  {message.role === "assistant" && !isLoading && (
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

                  {/* ユーザー用操作ボタン */}
                  {message.role === "user" && !isLoading && !editingMessageId && (
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
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
        {/* スクロール用の終端要素 */}
        <div ref={messagesEndRef} />
      </div>

      {/* --- 入力フォーム --- */}
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
              // Shift+Enter 以外でのEnterキーで送信
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            disabled={editingMessageId !== null} // ユーザーメッセージ編集中は入力不可
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isLoading || editingMessageId !== null} // ローディング中、編集中は送信不可
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
