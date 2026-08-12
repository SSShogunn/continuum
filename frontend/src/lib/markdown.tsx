import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { encodeWikilinks, WIKILINK_SCHEME } from "@/lib/wikilink";

export interface MemoryMarkdownProps {
  content: string;
  onWikilink?: (name: string) => void;
  exists?: (name: string) => boolean;
}

export function MemoryMarkdown({ content, onWikilink, exists }: MemoryMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a({ node: _node, href, children, ...props }) {
          if (href?.startsWith(WIKILINK_SCHEME)) {
            const target = decodeURIComponent(href.slice(WIKILINK_SCHEME.length));
            const missing = exists ? !exists(target) : false;
            return (
              <button
                onClick={() => onWikilink?.(target)}
                title={missing ? `${target} — not saved yet` : target}
                className={
                  missing
                    ? "text-muted-foreground/70 underline decoration-dashed underline-offset-2 hover:text-foreground"
                    : "text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                }
              >
                {children}
              </button>
            );
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2 break-words"
              {...props}
            >
              {children}
            </a>
          );
        },
        p: ({ node: _node, ...props }) => <p className="leading-relaxed" {...props} />,
        ul: ({ node: _node, ...props }) => (
          <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground" {...props} />
        ),
        ol: ({ node: _node, ...props }) => (
          <ol className="list-decimal space-y-1 pl-5 marker:text-muted-foreground" {...props} />
        ),
        li: ({ node: _node, ...props }) => <li className="leading-relaxed" {...props} />,
        h1: ({ node: _node, ...props }) => <h1 className="text-base font-semibold" {...props} />,
        h2: ({ node: _node, ...props }) => <h2 className="text-base font-semibold" {...props} />,
        h3: ({ node: _node, ...props }) => <h3 className="text-sm font-semibold" {...props} />,
        h4: ({ node: _node, ...props }) => <h4 className="text-sm font-semibold" {...props} />,
        blockquote: ({ node: _node, ...props }) => (
          <blockquote className="border-l-2 pl-3 text-muted-foreground italic" {...props} />
        ),
        hr: ({ node: _node, ...props }) => <hr className="border-border" {...props} />,
        pre: ({ node: _node, ...props }) => (
          <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-xs" {...props} />
        ),
        code: ({ node: _node, className, children, ...props }) =>
          className?.includes("language-") ? (
            <code className={className} {...props}>
              {children}
            </code>
          ) : (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props}>
              {children}
            </code>
          ),
        table: ({ node: _node, ...props }) => (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs" {...props} />
          </div>
        ),
        th: ({ node: _node, ...props }) => (
          <th className="border px-2 py-1 text-left font-medium" {...props} />
        ),
        td: ({ node: _node, ...props }) => <td className="border px-2 py-1 align-top" {...props} />,
        input: ({ node: _node, ...props }) => (
          <input className="mr-1 align-middle" disabled {...props} />
        ),
      }}
    >
      {encodeWikilinks(content)}
    </ReactMarkdown>
  );
}
