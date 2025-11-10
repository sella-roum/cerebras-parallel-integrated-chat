"use client";

import { useState, useEffect } from "react";
import { ConversationSidebar } from "@/components/conversation-sidebar";
import { ChatView } from "@/components/chat-view";
import { SettingsDialog } from "@/components/settings-dialog";
import { useMobile } from "@/hooks/use-mobile";
import { db, type Conversation } from "@/lib/db";
import { useToast } from "@/hooks/use-toast"; // ▼ 変更点 (フェーズ2)： useToast をインポート

export default function Home() {
  const [isDark, setIsDark] = useState(false);
  // ▼ 変更点 (フェーズ2)： デフォルトを true に
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const isMobile = useMobile();
  const { toast } = useToast(); // ▼ 変更点 (フェーズ2)： toast を初期化

  const selectedConversationData = conversations.find((c) => c.id === selectedConversationId) || null;

  useEffect(() => {
    const isDarkMode = document.documentElement.classList.contains("dark");
    setIsDark(isDarkMode);
    initializeApp();
  }, []);

  // ▼ 変更点 (フェーズ2)： isMobile の変更に応じてサイドバーの開閉を制御
  useEffect(() => {
    setIsSidebarOpen(!isMobile);
  }, [isMobile]);

  const initializeApp = async () => {
    try {
      await db.init();
      // ▼ 変更点 (フェーズ2)： db.ts 側でソートされる
      const loadedConversations = await db.getConversations();
      setConversations(loadedConversations);
      console.log("App initialized");
    } catch (error) {
      console.error("Failed to initialize app:", error);
    }
  };

  const toggleDarkMode = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle("dark");
  };

  // ▼ 変更点 (フェーズ2)： サイドバー開閉ロジック
  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const handleNewConversation = async () => {
    const newConversation: Conversation = {
      id: `conv_${Date.now()}`,
      title: "新規チャット",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      systemPrompt: "",
    };
    await db.createConversation(newConversation);
    // (ソート対応) 降順の先頭に追加
    setConversations([newConversation, ...conversations]);
    setSelectedConversationId(newConversation.id);
  };

  const handleDeleteConversation = async (id: string) => {
    await db.deleteConversation(id);
    setConversations(conversations.filter((c) => c.id !== id));
    if (selectedConversationId === id) {
      setSelectedConversationId(null);
    }
  };

  const handleUpdateConversationTitle = async (id: string, title: string) => {
    const conversation = conversations.find((c) => c.id === id);
    if (conversation) {
      const updated = { ...conversation, title, updatedAt: Date.now() };
      await db.updateConversation(updated);
      setConversations(conversations.map((c) => (c.id === id ? updated : c)));
    }
  };

  const handleUpdateConversationSystemPrompt = async (id: string, systemPrompt: string) => {
    const conversation = conversations.find((c) => c.id === id);
    if (conversation) {
      const updated = { ...conversation, systemPrompt, updatedAt: Date.now() };
      await db.updateConversation(updated);
      setConversations(conversations.map((c) => (c.id === id ? updated : c)));
    }
  };

  // ▼ 変更点 (フェーズ2)： 複製ハンドラ
  const handleDuplicateConversation = async (id: string) => {
    try {
      const newConversation = await db.duplicateConversation(id);

      // 新しい会話をリストの先頭に追加 (降順ソートのため)
      setConversations([newConversation, ...conversations]);

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
      {/* 左サイドバー (デスクトップ用) */}
      {/* ▼ 変更点 (フェーズ2)： !isMobile かつ isSidebarOpen で表示 */}
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
          onDuplicateConversation={handleDuplicateConversation} // ▼ 変更点 (フェーズ2)
        />
      )}

      {/* モバイル用ドロワー */}
      {isMobile && isSidebarOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={toggleSidebar} />
          <div className="fixed inset-y-0 left-0 z-50 w-[280px] bg-background">
            <ConversationSidebar
              isDark={isDark}
              toggleDarkMode={toggleDarkMode}
              selectedConversation={selectedConversationId}
              setSelectedConversation={(id) => {
                setSelectedConversationId(id);
                toggleSidebar(); // ▼ 変更点 (フェーズ2)
              }}
              conversations={conversations}
              onNewConversation={async () => {
                await handleNewConversation();
                toggleSidebar(); // ▼ 変更点 (フェーズ2)
              }}
              onDeleteConversation={handleDeleteConversation}
              onUpdateConversationTitle={handleUpdateConversationTitle}
              onDuplicateConversation={handleDuplicateConversation} // ▼ 変更点 (フェーズ2)
            />
          </div>
        </>
      )}

      {/* メインチャットエリア */}
      <ChatView
        selectedConversationData={selectedConversationData}
        onOpenSidebar={toggleSidebar} // ▼ 変更点 (フェーズ2)： toggleSidebar を渡す
        onOpenSettings={() => setIsSettingsOpen(true)}
        onUpdateConversationTitle={handleUpdateConversationTitle}
        onNewConversation={handleNewConversation}
        onUpdateConversationSystemPrompt={handleUpdateConversationSystemPrompt}
      />

      {/* 設定モーダル */}
      <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </div>
  );
}
