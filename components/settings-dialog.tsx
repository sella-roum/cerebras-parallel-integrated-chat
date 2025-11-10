"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiDataTab } from "@/components/settings/api-data-tab";
import { ModelSettingsTab } from "@/components/settings/model-settings-tab";

/**
 * 設定ダイアログコンポーネントのProps
 */
interface SettingsDialogProps {
  /** ダイアログの開閉状態 */
  open: boolean;
  /** 開閉状態が変更されたときのコールバック */
  onOpenChange: (open: boolean) => void;
}

/**
 * アプリケーション全体の設定ダイアログ
 * APIキー、データ管理、モデル設定のタブを管理します。
 * @param {SettingsDialogProps} props
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState("api");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>設定</DialogTitle>
        </DialogHeader>

        {/* タブコンテナ */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="api">APIとデータ</TabsTrigger>
            <TabsTrigger value="models">モデル設定</TabsTrigger>
          </TabsList>

          {/* タブコンテンツ (スクロール可能エリア) */}
          <div className="flex-1 overflow-y-auto mt-4">
            {/* APIとデータ タブ */}
            <TabsContent value="api" className="mt-0">
              <ApiDataTab />
            </TabsContent>

            {/* モデル設定 タブ */}
            <TabsContent value="models" className="mt-0">
              <ModelSettingsTab />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
