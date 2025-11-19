/**
 * Cerebras AI SDKで利用可能なモデル名のデフォルトリスト。
 * このリストは、設定画面の「モデル名」ComboBoxで
 * サジェストとして使用されます。
 * (ユーザーはこれ以外のカスタムモデル名も入力可能です)
 */
export const DEFAULT_CEREBRAS_MODELS = [
  "gpt-oss-120b",
  "llama-3.3-70b",
  "llama3.1-8b",
  "qwen-3-235b-a22b-instruct-2507",
  "qwen-3-235b-a22b-thinking-2507",
  "qwen-3-32b",
  "zai-glm-4.6",
];

/**
 * 利用可能なエージェントの思考モードを定義します。
 * クライアント (chat-view.tsx) と サーバー (lib/agents/index.ts) の
 * 両方からインポートされるため、ここに定義します。
 * @since AgentUpdate
 */
export const AGENT_MODES = [
  { id: "standard", name: "標準モード", description: "並列推論と標準的な統合を行います。" },
  { id: "expert_team", name: "エキスパート・チーム（役割）", description: "各専門家が回答し、リーダーが統合します。" },
  { id: "deep_thought", name: "深層思考（CoT）", description: "思考プロセスをレビューし、回答を生成します。" },
  { id: "critique", name: "生成と批評", description: "AIが草稿を書き、別のAIが批評・改善します。" },
  { id: "dynamic_router", name: "動的ルーター", description: "質問に最適なAIチームを自動で編成します。" },
  { id: "manager", name: "階層型マネージャー", description: "タスクを分解し、並列処理して統合します。" },
  { id: "reflection_loop", name: "自己反省ループ", description: "AIが内部で回答をレビューし、改訂します。" },
  { id: "hypothesis", name: "投機的実行（複数仮説）", description: "あいまいな質問の解釈を複数検証します。" },
  { id: "emotion_analysis", name: "感情・トーン分析", description: "ユーザーの感情を分析し、伝え方を調整します。" },
] as const;

export type AgentModeId = (typeof AGENT_MODES)[number]["id"];
