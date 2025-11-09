"use client";

import type React from "react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Pencil, Trash2, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/db";

// 必要なコンポーネントをインポート
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

interface ConversationSidebarProps {
  isDark: boolean;
  toggleDarkMode: () => void;
  selectedConversation: string | null;
  setSelectedConversation: (id: string) => void;
  conversations: Conversation[];
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onUpdateConversationTitle: (id: string, title: string) => void;
}

export function ConversationSidebar({
  isDark,
  toggleDarkMode,
  selectedConversation,
  setSelectedConversation,
  conversations,
  onNewConversation,
  onDeleteConversation,
  onUpdateConversationTitle,
}: ConversationSidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const cancelRenameRef = useRef(false);
  const { toast } = useToast();

  const handleDeleteClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTargetId(id);
  };

  const confirmDelete = () => {
    if (deleteTargetId) {
      onDeleteConversation(deleteTargetId);
    }
    setDeleteTargetId(null);
  };

  const handleRenameClick = (conversation: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    cancelRenameRef.current = false;
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  };

  const handleSaveRename = () => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      setEditingId(null);
      setEditingTitle("");
      return;
    }

    if (!editingId) {
      setEditingId(null);
      setEditingTitle("");
      return;
    }

    if (editingTitle.trim() === "") {
      toast({
        title: "タイトルは空にできません",
        variant: "destructive",
        duration: 3000,
      });
      // 編集モードを終了し、元のタイトルに戻す
      setEditingId(null);
      setEditingTitle("");
      return;
    }

    onUpdateConversationTitle(editingId, editingTitle.trim());
    cancelRenameRef.current = false;
    setEditingId(null);
    setEditingTitle("");
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSaveRename();
    } else if (e.key === "Escape") {
      cancelRenameRef.current = true;
      e.preventDefault();
      setEditingId(null);
      setEditingTitle("");
    }
  };

  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <>
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
                <div
                  role="button"
                  tabIndex={0}
                  key={conversation.id}
                  onClick={() => {
                    if (editingId !== conversation.id) {
                      setSelectedConversation(conversation.id);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      if (editingId !== conversation.id) {
                        setSelectedConversation(conversation.id);
                      }
                    }
                  }}
                  onMouseEnter={() => setHoveredId(conversation.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-md transition-colors relative group outline-none",
                    "hover:bg-sidebar-accent focus:bg-sidebar-accent",
                    selectedConversation === conversation.id
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground",
                  )}
                >
                  {editingId === conversation.id ? (
                    <Input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={handleSaveRename}
                      onKeyDown={handleRenameKeyDown}
                      onClick={stopPropagation}
                      autoFocus
                      className="h-7 text-sm"
                    />
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm truncate pr-16">{conversation.title}</span>
                      {(hoveredId === conversation.id || selectedConversation === conversation.id) && (
                        <div className="absolute right-2 flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => handleRenameClick(conversation, e)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
                            onClick={(e) => handleDeleteClick(conversation.id, e)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
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

      <AlertDialog
        open={!!deleteTargetId}
        onOpenChange={(open: boolean) => {
          // 'open' が false（モーダルが閉じられた）場合、
          // state (deleteTargetId) を null にリセットする
          if (!open) {
            setDeleteTargetId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>会話を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              この操作は取り消せません。全ての会話履歴が完全に削除されます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
