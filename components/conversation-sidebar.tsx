"use client";

import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Pencil, Trash2, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/db";

interface ConversationSidebarProps {
  isDark: boolean;
  toggleDarkMode: () => void;
  selectedConversation: string | null;
  setSelectedConversation: (id: string) => void;
  conversations: Conversation[];
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
}

export function ConversationSidebar({
  isDark,
  toggleDarkMode,
  selectedConversation,
  setSelectedConversation,
  conversations,
  onNewConversation,
  onDeleteConversation,
}: ConversationSidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteConversation(id);
  };

  const handleRename = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // 名称変更ロジック（実装省略）
    console.log("Rename:", id);
  };

  return (
    <div className="w-[280px] h-full flex flex-col bg-sidebar border-r border-sidebar-border">
      {/* ヘッダー */}
      <div className="p-4 border-b border-sidebar-border">
        <Button onClick={onNewConversation} className="w-full justify-start gap-2 bg-transparent" variant="outline">
          <Plus className="w-4 h-4" />
          新規チャット
        </Button>
      </div>

      {/* 会話リスト */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm px-4 text-center">
            ここにチャット履歴が表示されます
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                onClick={() => setSelectedConversation(conversation.id)}
                onMouseEnter={() => setHoveredId(conversation.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-md transition-colors relative group",
                  "hover:bg-sidebar-accent",
                  selectedConversation === conversation.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm truncate pr-16">{conversation.title}</span>
                  {(hoveredId === conversation.id || selectedConversation === conversation.id) && (
                    <div className="absolute right-2 flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => handleRename(conversation.id, e)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
                        onClick={(e) => handleDelete(conversation.id, e)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* フッター */}
      <div className="p-4 border-t border-sidebar-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">AI</AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium text-sidebar-foreground">ユーザー</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleDarkMode}
          aria-label={isDark ? "ライトモードに切り替え" : "ダークモードに切り替え"}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
