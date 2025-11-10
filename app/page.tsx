"use client";

import { useState, useEffect } from "react";
import { ConversationSidebar } from "@/components/conversation-sidebar";
import { ChatView } from "@/components/chat-view";
import { SettingsDialog } from "@/components/settings-dialog";
import { useMobile } from "@/hooks/use-mobile";
import { db, type Conversation } from "@/lib/db";
import { useToast } from "@/hooks/use-toast";

/**
 * アプリケーションのメインページコンポーネント
 * 全体の状態管理とレイアウトを担当します。
 */
export default function Home() {
  const [isDark, setIsDark] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const isMobile = useMobile();
  const { toast } = useToast();

  /**
   * 現在選択されている会話の完全なデータオブジェクト
   */
  const selectedConversationData = conversations.find((c) => c.id === selectedConversationId) || null;

  // アプリケーションマウント時にダークモードの初期化とDBの初期化を実行
  useEffect(() => {
    const isDarkMode = document.documentElement.classList.contains("dark");
    setIsDark(isDarkMode);
    initializeApp();
  }, []);

  // モバイル表示が切り替わった際にサイドバーの開閉状態を自動調整
  useEffect(() => {
    setIsSidebarOpen(!isMobile);
  }, [isMobile]);

  /**
   * IndexedDBを初期化し、会話リストを読み込みます。
   */
  const initializeApp = async () => {
    try {
      await db.init();
      // DBから読み込む時点で既に降順ソートされています
      const loadedConversations = await db.getConversations();
      setConversations(loadedConversations);
      console.log("App initialized");
    } catch (error) {
      console.error("Failed to initialize app:", error);
    }
  };

  /**
   * ダークモードのON/OFFを切り替えます。
   */
  const toggleDarkMode = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle("dark");
  };

  /**
   * サイドバーの表示/非表示を切り替えます。
   */
  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  /**
   * 新しい会話を作成し、DBに保存します。
   */
  const handleNewConversation = async () => {
    const newConversation: Conversation = {
      id: `conv_${Date.now()}`,
      title: "新規チャット",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      systemPrompt: "",
    };
    await db.createConversation(newConversation);
    setConversations((prev) => [newConversation, ...prev]);
    setSelectedConversationId(newConversation.id);
  };

  /**
   * 指定されたIDの会話を削除します。
   * @param {string} id - 削除する会話のID
   */
  const handleDeleteConversation = async (id: string) => {
    await db.deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    // 削除した会話が選択中だった場合、選択を解除
    if (selectedConversationId === id) {
      setSelectedConversationId(null);
    }
  };

  /**
   * 会話のタイトルを更新します。
   * @param {string} id - 更新する会話のID
   * @param {string} title - 新しいタイトル
   */
  const handleUpdateConversationTitle = async (id: string, title: string) => {
    const conversation = conversations.find((c) => c.id === id);
    if (conversation) {
      const updatedAt = Date.now();
      const updated = { ...conversation, title, updatedAt };
      await db.updateConversation(updated);
      setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
    }
  };

  /**
   * 会話固有のシステムプロンプトを更新します。
   * @param {string} id - 更新する会話のID
   * @param {string} systemPrompt - 新しいシステムプロンプト
   */
  const handleUpdateConversationSystemPrompt = async (id: string, systemPrompt: string) => {
    const conversation = conversations.find((c) => c.id === id);
    if (conversation) {
      const updatedAt = Date.now();
      const updated = { ...conversation, systemPrompt, updatedAt };
      await db.updateConversation(updated);
      setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
    }
  };

  /**
   * 既存の会話（履歴と設定を含む）を複製します。
   * @param {string} id - 複製元の会話ID
   */
  const handleDuplicateConversation = async (id: string) => {
    try {
      const newConversation = await db.duplicateConversation(id);

      setConversations((prev) => [newConversation, ...prev]);

      // 新しく複製した会話を選択状態にする
      setSelectedConversationId(newConversation.id);

      toast({
        title: "会話を複製しました",
      });
    } catch (error) {
      console.error("Failed to duplicate conversation:", error);
      toast({
        title: "複製の作成に失敗しました",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      {/* --- デスクトップ用サイドバー --- */}
      {!isMobile && isSidebarOpen && (
        <ConversationSidebar
          isDark={isDark}
          toggleDarkMode={toggleDarkMode}
          selectedConversation={selectedConversationId}
          setSelectedConversation={setSelectedConversationId}
          conversations={conversations}
          onNewConversation={handleNewConversation}
          onDeleteConversation={handleDeleteConversation}
          onUpdateConversationTitle={handleUpdateConversationTitle}
          onDuplicateConversation={handleDuplicateConversation}
        />
      )}

      {/* --- モバイル用ドロワー --- */}
      {isMobile && isSidebarOpen && (
        <>
          {/* オーバーレイ */}
          <div className="fixed inset-0 bg-black/50 z-40" onClick={toggleSidebar} />
          <div className="fixed inset-y-0 left-0 z-50 w-[280px] bg-background">
            <ConversationSidebar
              isDark={isDark}
              toggleDarkMode={toggleDarkMode}
              selectedConversation={selectedConversationId}
              setSelectedConversation={(id) => {
                setSelectedConversationId(id);
                toggleSidebar(); // 項目選択時にドロワーを閉じる
              }}
              conversations={conversations}
              onNewConversation={async () => {
                await handleNewConversation();
                toggleSidebar(); // 新規作成時にドロワーを閉じる
              }}
              onDeleteConversation={handleDeleteConversation}
              onUpdateConversationTitle={handleUpdateConversationTitle}
              onDuplicateConversation={handleDuplicateConversation}
            />
          </div>
        </>
      )}

      {/* --- メインチャットエリア --- */}
      <ChatView
        selectedConversationData={selectedConversationData}
        onOpenSidebar={toggleSidebar}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onUpdateConversationTitle={handleUpdateConversationTitle}
        onNewConversation={handleNewConversation}
        onUpdateConversationSystemPrompt={handleUpdateConversationSystemPrompt}
      />

      {/* --- 設定モーダル --- */}
      <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </div>
  );
}
