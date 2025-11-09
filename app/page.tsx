"use client";

import { useState, useEffect } from "react";
import { ConversationSidebar } from "@/components/conversation-sidebar";
import { ChatView } from "@/components/chat-view";
import { SettingsDialog } from "@/components/settings-dialog";
import { useMobile } from "@/hooks/use-mobile";
import { db, type Conversation } from "@/lib/db";

export default function Home() {
  const [isDark, setIsDark] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const isMobile = useMobile();

  const selectedConversationData = conversations.find((c) => c.id === selectedConversationId) || null;

  useEffect(() => {
    const isDarkMode = document.documentElement.classList.contains("dark");
    setIsDark(isDarkMode);
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      await db.init();
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

  const handleNewConversation = async () => {
    const newConversation: Conversation = {
      id: `conv_${Date.now()}`,
      title: "新規チャット",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      systemPrompt: "",
    };
    await db.createConversation(newConversation);
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

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      {/* 左サイドバー (デスクトップ用) */}
      {!isMobile && (
        <ConversationSidebar
          isDark={isDark}
          toggleDarkMode={toggleDarkMode}
          selectedConversation={selectedConversationId}
          setSelectedConversation={setSelectedConversationId}
          conversations={conversations}
          onNewConversation={handleNewConversation}
          onDeleteConversation={handleDeleteConversation}
          onUpdateConversationTitle={handleUpdateConversationTitle} // <-- 1箇所目
        />
      )}

      {/* モバイル用ドロワー */}
      {isMobile && isSidebarOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setIsSidebarOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 w-[280px] bg-background">
            <ConversationSidebar
              isDark={isDark}
              toggleDarkMode={toggleDarkMode}
              selectedConversation={selectedConversationId}
              setSelectedConversation={(id) => {
                setSelectedConversationId(id);
                setIsSidebarOpen(false);
              }}
              conversations={conversations}
              onNewConversation={async () => {
                await handleNewConversation();
                setIsSidebarOpen(false);
              }}
              onDeleteConversation={handleDeleteConversation}
              onUpdateConversationTitle={handleUpdateConversationTitle} // <-- ▼ 修正箇所 (2箇所目) ▼
            />
          </div>
        </>
      )}

      {/* メインチャットエリア */}
      <ChatView
        selectedConversationData={selectedConversationData}
        onOpenSidebar={() => setIsSidebarOpen(true)}
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
