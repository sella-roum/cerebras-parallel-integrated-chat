"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";
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
import { db, type ApiKey } from "@/lib/db";
import { llmService } from "@/lib/llm-service";
import { useToast } from "@/hooks/use-toast";

export function ApiDataTab() {
  const [apiKey, setApiKey] = useState<ApiKey | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [newKey, setNewKey] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    loadApiKey();
  }, []);

  const loadApiKey = async () => {
    try {
      const keys = await db.getApiKeys();
      const cerebrasKey = keys.find((k) => k.provider === "cerebras");
      setApiKey(cerebrasKey || null);
      if (cerebrasKey) {
        llmService.setApiKey(cerebrasKey.key);
      }
      console.log("[v0] Loaded API key:", cerebrasKey ? "Found" : "Not found");
    } catch (error) {
      console.error("[v0] Failed to load API key:", error);
    }
  };

  const handleSaveApiKey = async () => {
    if (!newKey.trim()) {
      toast({
        title: "APIキーを入力してください",
        variant: "destructive",
      });
      return;
    }

    try {
      const key: ApiKey = {
        id: "cerebras_api_key",
        provider: "cerebras",
        key: newKey,
      };
      await db.saveApiKey(key);
      llmService.setApiKey(newKey);
      setApiKey(key);
      setNewKey("");
      toast({
        title: "APIキーを保存しました",
      });
      console.log("[v0] API key saved");
    } catch (error) {
      console.error("[v0] Failed to save API key:", error);
      toast({
        title: "APIキーの保存に失敗しました",
        variant: "destructive",
      });
    }
  };

  const handleDeleteApiKey = async () => {
    if (!apiKey) return;

    try {
      await db.deleteApiKey(apiKey.id);
      setApiKey(null);
      setNewKey("");
      toast({
        title: "APIキーを削除しました",
      });
    } catch (error) {
      console.error("[v0] Failed to delete API key:", error);
      toast({
        title: "APIキーの削除に失敗しました",
        variant: "destructive",
      });
    }
  };

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
      console.error("[v0] Failed to export:", error);
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
      console.error("[v0] Failed to delete all:", error);
      toast({
        title: "削除に失敗しました",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* APIキー設定 */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Cerebras API設定</h3>

        {/* 既存のAPIキー表示 */}
        {apiKey && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 p-3 border rounded-lg">
              <div className="flex-1">
                <div className="text-sm font-medium">Cerebras API Key</div>
                <div className="text-xs text-muted-foreground font-mono">
                  {showApiKey ? apiKey.key : "••••••••••••••••••••••••••••••••••••"}
                </div>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => setShowApiKey(!showApiKey)}>
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <Button variant="destructive" className="w-full" onClick={handleDeleteApiKey}>
              APIキーを削除
            </Button>
          </div>
        )}

        {/* 新しいAPIキーを設定 */}
        {!apiKey && (
          <div className="space-y-3 p-4 border rounded-lg bg-card">
            <Label>Cerebras APIキー</Label>
            <Input
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="csk-..."
              className="font-mono"
            />
            <Button onClick={handleSaveApiKey} className="w-full">
              APIキーを保存
            </Button>
            <p className="text-xs text-muted-foreground">
              APIキーは{" "}
              <a href="https://cloud.cerebras.ai" target="_blank" rel="noopener noreferrer" className="underline">
                Cerebras Cloud
              </a>{" "}
              で取得できます
            </p>
          </div>
        )}
      </div>

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
