"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    // ▼ 修正点 1: "break-words" を追加 ▼
    <div className={cn("prose prose-sm dark:prose-invert max-w-none break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // カスタムコンポーネント
          code: ({ node, inline, className, children, ...props }: any) => {
            if (inline) {
              return (
                <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="block bg-muted p-3 rounded-md text-sm font-mono overflow-x-auto" {...props}>
                {children}
              </code>
            );
          },
          pre: ({ node, children, ...props }: any) => {
            return (
              // ▼ 修正点 2: "max-w-full" を追加 ▼
              <pre className="bg-muted p-3 rounded-md overflow-x-auto my-2 max-w-full" {...props}>
                {children}
              </pre>
            );
          },
          a: ({ node, children, ...props }: any) => {
            return (
              <a
                className="text-primary underline hover:no-underline"
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            );
          },
          ul: ({ node, children, ...props }: any) => {
            return (
              <ul className="list-disc pl-6 my-2 space-y-1" {...props}>
                {children}
              </ul>
            );
          },
          ol: ({ node, children, ...props }: any) => {
            return (
              <ol className="list-decimal pl-6 my-2 space-y-1" {...props}>
                {children}
              </ol>
            );
          },
          h1: ({ node, children, ...props }: any) => {
            return (
              <h1 className="text-2xl font-bold mt-6 mb-3" {...props}>
                {children}
              </h1>
            );
          },
          h2: ({ node, children, ...props }: any) => {
            return (
              <h2 className="text-xl font-bold mt-5 mb-2" {...props}>
                {children}
              </h2>
            );
          },
          h3: ({ node, children, ...props }: any) => {
            return (
              <h3 className="text-lg font-semibold mt-4 mb-2" {...props}>
                {children}
              </h3>
            );
          },
          p: ({ node, children, ...props }: any) => {
            return (
              <p className="my-2 leading-relaxed" {...props}>
                {children}
              </p>
            );
          },
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
