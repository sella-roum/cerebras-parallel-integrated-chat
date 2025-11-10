"use client";

import type React from "react";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
// Avatar, AvatarFallback は不要になったため削除
import { Plus, Pencil, Trash2, Sun, Moon, CopyPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/db";
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

/**
 * ConversationSidebarコンポーネントのProps
 */
interface ConversationSidebarProps {
  /** 現在ダークモードか否か */
  isDark: boolean;
  /** ダークモードのトグル関数 */
  toggleDarkMode: () => void;
  /** 選択中の会話ID */
  selectedConversation: string | null;
  /** 会話を選択するコールバック */
  setSelectedConversation: (id: string) => void;
  /** 表示する会話のリスト (親コンポーネントでソート済み) */
  conversations: Conversation[];
  /** 新規会話作成のコールバック */
  onNewConversation: () => void;
  /** 会話削除のコールバック */
  onDeleteConversation: (id: string) => void;
  /** 会話タイトル更新のコールバック */
  onUpdateConversationTitle: (id: string, title: string) => void;
  /** 会話複製のコールバック */
  onDuplicateConversation: (id: string) => void;
}

/**
 * 会話履歴を表示・管理するサイドバー
 * @param {ConversationSidebarProps} props
 */
export function ConversationSidebar({
  isDark,
  toggleDarkMode,
  selectedConversation,
  setSelectedConversation,
  conversations,
  onNewConversation,
  onDeleteConversation,
  onUpdateConversationTitle,
  onDuplicateConversation,
}: ConversationSidebarProps) {
  // ホバー中の会話ID（ボタン表示用）
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // 名前編集中の会話ID
  const [editingId, setEditingId] = useState<string | null>(null);
  // 名前編集中のテキスト
  const [editingTitle, setEditingTitle] = useState<string>("");
  // 削除確認ダイアログの対象ID
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  // ESCキーでの編集キャンセルを検知するためのRef
  const cancelRenameRef = useRef(false);
  const { toast } = useToast();

  /**
   * 削除ボタンクリック時のハンドラ
   * @param {string} id - 削除対象のID
   * @param {React.MouseEvent} e - イベント
   */
  const handleDeleteClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 親の onClick が発火しないように
    setDeleteTargetId(id);
  };

  /**
   * 削除確認ダイアログで「削除」を押したときの処理
   */
  const confirmDelete = () => {
    if (deleteTargetId) {
      onDeleteConversation(deleteTargetId);
    }
    setDeleteTargetId(null);
  };

  /**
   * 名前変更ボタンクリック時のハンドラ
   * @param {Conversation} conversation - 編集対象の会話オブジェクト
   * @param {React.MouseEvent} e - イベント
   */
  const handleRenameClick = (conversation: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    cancelRenameRef.current = false;
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  };

  /**
   * 複製ボタンクリック時のハンドラ
   * @param {string} id - 複製対象のID
   * @param {React.MouseEvent} e - イベント
   */
  const handleDuplicateClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDuplicateConversation(id);
  };

  /**
   * 名前の変更を保存する処理 (InputのonBlur時に発火)
   */
  const handleSaveRename = () => {
    // ESCキーが押されていた場合は、保存せずに編集モードを終了
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

    // タイトルが空の場合はエラーを表示し、編集モードを終了
    if (editingTitle.trim() === "") {
      toast({
        title: "タイトルは空にできません",
        variant: "destructive",
        duration: 3000,
      });
      setEditingId(null);
      setEditingTitle("");
      return;
    }

    // 親コンポーネントに変更を通知
    onUpdateConversationTitle(editingId, editingTitle.trim());
    cancelRenameRef.current = false;
    setEditingId(null);
    setEditingTitle("");
  };

  /**
   * 名前変更Inputでのキーボードイベントハンドラ
   * @param {React.KeyboardEvent<HTMLInputElement>} e
   */
  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Enterで保存
      handleSaveRename();
    } else if (e.key === "Escape") {
      // Escapeでキャンセル
      cancelRenameRef.current = true;
      e.preventDefault();
      setEditingId(null);
      setEditingTitle("");
    }
  };

  /**
   * イベントの伝播を停止する (Inputクリック用)
   * @param {React.MouseEvent} e
   */
  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <>
      <div className="w-[280px] h-full flex flex-col bg-sidebar border-r border-sidebar-border">
        {/* --- ヘッダー (新規チャットボタン) --- */}
        <div className="p-4 border-b border-sidebar-border">
          <Button onClick={onNewConversation} className="w-full justify-start gap-2 bg-transparent" variant="outline">
            <Plus className="w-4 h-4" />
            新規チャット
          </Button>
        </div>

        {/* --- 会話リスト --- */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm px-4 text-center">
              ここにチャット履歴が表示されます
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {/* 会話リストは親からソート済みで渡される */}
              {conversations.map((conversation) => (
                <div
                  role="button"
                  tabIndex={0}
                  key={conversation.id}
                  onClick={() => {
                    // 編集モード中は会話の切り替えを無効化
                    if (editingId !== conversation.id) {
                      setSelectedConversation(conversation.id);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
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
                  {/* 名前編集中 */}
                  {editingId === conversation.id ? (
                    <Input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={handleSaveRename}
                      onKeyDown={handleRenameKeyDown}
                      onClick={stopPropagation} // Inputクリックで会話が切り替わらないように
                      autoFocus
                      className="h-7 text-sm"
                    />
                  ) : (
                    // 通常表示
                    <div className="flex items-center justify-between">
                      <span className="text-sm truncate pr-16">{conversation.title}</span>
                      {/* ホバー中または選択中に操作ボタンを表示 */}
                      {(hoveredId === conversation.id || selectedConversation === conversation.id) && (
                        <div className="absolute right-2 flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => handleDuplicateClick(conversation.id, e)}
                            title="複製"
                          >
                            <CopyPlus className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => handleRenameClick(conversation, e)}
                            title="名前の変更"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
                            onClick={(e) => handleDeleteClick(conversation.id, e)}
                            title="削除"
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

        {/* --- フッター (ダークモード切替) --- */}
        <div className="p-4 border-t border-sidebar-border flex items-center justify-between">
          <div className="w-full flex justify-end">
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
      </div>

      {/* --- 削除確認ダイアログ --- */}
      <AlertDialog
        open={!!deleteTargetId}
        onOpenChange={(open: boolean) => {
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
