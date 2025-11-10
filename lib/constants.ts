// lib/constants.ts

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
