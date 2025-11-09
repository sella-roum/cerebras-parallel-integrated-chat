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
import { db } from "@/lib/db"; // ApiKey
import { useToast } from "@/hooks/use-toast";

export function ApiDataTab() {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { toast } = useToast();

  // APIキー関連の useEffect や loadApiKey はすべて削除

  const handleExport = async () => {
    try {
      const conversations = await db.getConversations();
      const allMessages = await Promise.all(
        conversations.map(async (conv) => ({
          conversation: conv,
          messages: await db.getMessages(conv.id),
        })),
      );

      const data = JSON.stringify(allMessages, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chat-history-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);

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

  const handleDeleteAll = async () => {
    try {
      const conversations = await db.getConversations();
      await Promise.all(conversations.map((conv) => db.deleteConversation(conv.id)));
      setShowDeleteDialog(false);
      toast({
        title: "全会話を削除しました",
      });
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
      {/* APIキー設定のセクションは削除 */}

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
