"use client";

// Inspired by react-hot-toast library
import * as React from "react";
import type { ToastActionElement, ToastProps } from "@/components/ui/toast";

/** 画面に同時に表示できるトーストの最大数 */
const TOAST_LIMIT = 1;
/** トーストが閉じた後にDOMから削除されるまでの遅延時間 (非常に長く設定) */
const TOAST_REMOVE_DELAY = 1000000;

/**
 * `useToast` フックの内部で使用されるトーストオブジェクトの型
 */
type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

/**
 * `reducer` で使用されるアクションの型定義
 */
const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const;

/** グローバルなトーストID生成用のカウンター */
let count = 0;

/**
 * ユニークなトーストIDを生成します。
 * @returns {string} トーストID
 */
function genId(): string {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

type ActionType = typeof actionTypes;

/**
 * `reducer` にディスパッチされるアクションの型
 */
type Action =
  | {
      type: ActionType["ADD_TOAST"];
      toast: ToasterToast;
    }
  | {
      type: ActionType["UPDATE_TOAST"];
      toast: Partial<ToasterToast>;
    }
  | {
      type: ActionType["DISMISS_TOAST"];
      toastId?: ToasterToast["id"];
    }
  | {
      type: ActionType["REMOVE_TOAST"];
      toastId?: ToasterToast["id"];
    };

/**
 * トーストのグローバルな状態
 */
interface State {
  toasts: ToasterToast[];
}

/** 閉じたトーストを削除キューに入れるためのタイマーマップ */
const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * トーストを（遅延後に）削除するキューに追加します。
 * @param {string} toastId - 削除対象のトーストID
 */
const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

/**
 * グローバルなトースト状態を更新するためのReducer関数
 * @param {State} state - 現在の状態
 * @param {Action} action - ディスパッチされたアクション
 * @returns {State} 新しい状態
 */
export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      // 新しいトーストを配列の先頭に追加し、最大数 (TOAST_LIMIT) で切り捨てる
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };

    case "UPDATE_TOAST":
      // 特定のトーストIDのプロパティを更新
      return {
        ...state,
        toasts: state.toasts.map((t) => (t.id === action.toast.id ? { ...t, ...action.toast } : t)),
      };

    case "DISMISS_TOAST": {
      // トーストを「閉じる」状態 (open: false) にする
      const { toastId } = action;

      // 副作用: 閉じたトーストを削除キューに追加
      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        // IDが指定されない場合はすべてのトーストを閉じる
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false, // open: false に設定
              }
            : t,
        ),
      };
    }
    case "REMOVE_TOAST":
      // 削除キューによって呼び出され、トーストをDOMから（stateから）削除
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

/** 状態の変更を購読（listen）するコンポーネント（useToast）のリスト */
const listeners: Array<(state: State) => void> = [];

/** モジュールスコープで保持されるグローバルな状態 */
let memoryState: State = { toasts: [] };

/**
 * グローバルな `reducer` を呼び出し、
 * 購読しているすべてのリスナーに新しい状態を通知します。
 * @param {Action} action - 実行するアクション
 */
function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

/** `toast()` 関数で受け取るPropsの型 */
type Toast = Omit<ToasterToast, "id">;

/**
 * プログラムでトーストを表示するためのグローバル関数
 * @param {Toast} props - トーストのプロパティ (title, description など)
 * @returns {{ id: string, dismiss: () => void, update: (props: ToasterToast) => void }}
 * 表示されたトーストを制御するためのオブジェクト
 */
export function toast({ ...props }: Toast) {
  const id = genId();

  const update = (props: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    });
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id });

  // トーストを追加するアクションをディスパッチ
  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        // shadcn/uiのToastコンポーネントが
        // スワイプや閉じるボタンで非表示になったときに呼び出される
        if (!open) dismiss();
      },
    },
  });

  return {
    id: id,
    dismiss,
    update,
  };
}

/**
 * グローバルなトースト状態にアクセスするためのReactフック
 * @returns {{ toasts: ToasterToast[], toast: typeof toast, dismiss: (toastId?: string) => void }}
 * 現在のトースト配列と、トーストを操作するための関数
 */
export function useToast() {
  // コンポーネントのローカルstateとしてグローバルな `memoryState` を初期値に設定
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    // 1. マウント時にこのコンポーネントの `setState` をリスナー配列に追加
    listeners.push(setState);

    // 2. アンマウント時にリスナー配列から削除
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]); // stateの参照が変わることはないが、Reactの規約に従う

  return {
    ...state, // 現在の { toasts: [] } を展開
    toast, // toast() 関数を返す
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }), // dismiss() 関数を返す
  };
}
