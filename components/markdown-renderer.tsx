"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm"; // GitHub Flavored Markdown (テーブル, 取り消し線など) をサポート
import { cn } from "@/lib/utils";

/**
 * MarkdownRendererコンポーネントのProps
 */
interface MarkdownRendererProps {
  /** レンダリングするMarkdown文字列 */
  content: string;
  /** オプションの追加CSSクラス */
  className?: string;
}

/**
 * Markdown文字列をReactコンポーネントとして安全にレンダリングするコンポーネント。
 * Tailwind Typography (`prose`) を使用してスタイルを適用します。
 * @param {MarkdownRendererProps} props
 */
export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // HTMLタグをどのようにReactコンポーネントにマッピングするかを定義

          /**
           * インラインコード (`code`) とコードブロック (```code```)
           */
          code: ({ node, inline, className, children, ...props }: any) => {
            if (inline) {
              // インラインコード
              return (
                <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                  {children}
                </code>
              );
            }
            // コードブロック (preタグ内で使用される)
            return (
              <code
                className={cn("block bg-muted p-3 rounded-md text-sm font-mono overflow-x-auto", className)}
                {...props}
              >
                {children}
              </code>
            );
          },
          /**
           * コードブロックのラッパー (`<pre>`)
           */
          pre: ({ node, children, ...props }: any) => {
            return (
              <pre className="bg-muted p-3 rounded-md overflow-x-auto my-2 max-w-full" {...props}>
                {children}
              </pre>
            );
          },
          /**
           * リンク (`<a>`)
           */
          a: ({ node, children, ...props }: any) => {
            return (
              <a
                className="text-primary underline hover:no-underline"
                target="_blank" // 外部リンクは新しいタブで開く
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            );
          },
          /**
           * 順序なしリスト (`<ul>`)
           */
          ul: ({ node, children, ...props }: any) => {
            return (
              <ul className="list-disc pl-6 my-2 space-y-1" {...props}>
                {children}
              </ul>
            );
          },
          /**
           * 順序付きリスト (`<ol>`)
           */
          ol: ({ node, children, ...props }: any) => {
            return (
              <ol className="list-decimal pl-6 my-2 space-y-1" {...props}>
                {children}
              </ol>
            );
          },
          /**
           * 見出し (`<h1>`)
           */
          h1: ({ node, children, ...props }: any) => {
            return (
              <h1 className="text-2xl font-bold mt-6 mb-3" {...props}>
                {children}
              </h1>
            );
          },
          /**
           * 見出し (`<h2>`)
           */
          h2: ({ node, children, ...props }: any) => {
            return (
              <h2 className="text-xl font-bold mt-5 mb-2" {...props}>
                {children}
              </h2>
            );
          },
          /**
           * 見出し (`<h3>`)
           */
          h3: ({ node, children, ...props }: any) => {
            return (
              <h3 className="text-lg font-semibold mt-4 mb-2" {...props}>
                {children}
              </h3>
            );
          },
          /**
           * 段落 (`<p>`)
           */
          p: ({ node, children, ...props }: any) => {
            return (
              <p className="my-2 leading-relaxed" {...props}>
                {children}
              </p>
            );
          },
          /**
           * 引用 (`<blockquote>`)
           */
          blockquote: ({ node, children, ...props }: any) => {
            return (
              <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic my-3" {...props}>
                {children}
              </blockquote>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
