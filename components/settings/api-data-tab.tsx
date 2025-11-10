"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import { db } from "@/lib/db";
import { useToast } from "@/hooks/use-toast";

/**
 * 設定ダイアログ内の「APIとデータ」タブ
 * IndexedDBからのデータのエクスポートと削除を管理します。
 */
export function ApiDataTab() {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { toast } = useToast();

  // APIキー関連のロジックは、サーバーサイド管理（.env.local）に
  // 移行したため、クライアント側からは削除されています。

  /**
   * IndexedDBに保存されているすべての会話とメッセージを
   * JSONファイルとしてエクスポートします。
   */
  const handleExport = async () => {
    try {
      const conversations = await db.getConversations();
      // すべての会話と、それに紐づくメッセージを非同期で取得
      const allMessages = await Promise.all(
        conversations.map(async (conv) => ({
          conversation: conv,
          messages: await db.getMessages(conv.id),
        })),
      );

      const data = JSON.stringify(allMessages, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      // ダウンロードリンクを作成して自動クリック
      const a = document.createElement("a");
      a.href = url;
      a.download = `chat-history-${Date.now()}.json`;
      a.click();

      setTimeout(() => URL.revokeObjectURL(url), 0); // メモリリーク防止

      toast({
        title: "履歴をエクスポートしました",
      });
    } catch (error) {
      console.error("Failed to export:", error);
      toast({
        title: "エクスポートに失敗しました",
        variant: "destructive",
      });
    }
  };

  /**
   * IndexedDBからすべての会話とメッセージを削除します。
   * (注: モデル設定は削除されません)
   */
  const handleDeleteAll = async () => {
    try {
      const conversations = await db.getConversations();
      // db.deleteConversation はメッセージも同時に削除する
      await Promise.all(conversations.map((conv) => db.deleteConversation(conv.id)));

      setShowDeleteDialog(false);
      toast({
        title: "全会話を削除しました",
      });
      // アプリケーションをリロードして変更を反映
      window.location.reload();
    } catch (error) {
      console.error("Failed to delete all:", error);
      toast({
        title: "削除に失敗しました",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* APIキー設定のセクションは意図的に削除されています */}

      {/* データ管理 */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">データ管理</h3>
        <div className="space-y-3">
          <Button variant="outline" className="w-full justify-start bg-transparent" onClick={handleExport}>
            履歴をエクスポート
          </Button>
          <Button variant="destructive" className="w-full justify-start" onClick={() => setShowDeleteDialog(true)}>
            全会話を削除
          </Button>
        </div>
      </div>

      {/* 全削除 確認ダイアログ */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>全会話を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              この操作は取り消せません。全ての会話履歴が完全に削除されます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
