import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="rounded border border-line px-2 py-0.5 text-xs text-muted hover:text-fg"
    >
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  );
}

/** react-markdown passes its AST `node` to every renderer; it must not reach the DOM element. */
function withoutNode<T extends object>(props: T): Omit<T, 'node'> {
  const rest = { ...props } as T & { node?: unknown };
  delete rest.node;
  return rest;
}

/** Plain text of a React node tree (what the user expects on the clipboard). */
function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: unknown } }).props.children);
  return '';
}

/**
 * Markdown for chat messages. Raw HTML in the text is NOT rendered (react-markdown escapes it) and link
 * protocols are filtered by its default URL transform, so model output cannot inject markup or scripts.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 break-words leading-relaxed [&_a]:text-accent [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:border-line [&_td]:px-2 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...withoutNode(props)} target="_blank" rel="noopener noreferrer" />,
          pre: ({ children: kids }) => {
            const code = textOf(kids).replace(/\n$/, '');
            return (
              <div className="overflow-hidden rounded-lg border border-line bg-bg">
                <div className="flex justify-end border-b border-line px-2 py-1">
                  <CopyButton text={code} />
                </div>
                <pre className="overflow-x-auto p-3 text-sm">{kids}</pre>
              </div>
            );
          },
          code: ({ className, children: kids, ...props }) => (
            <code className={`${className ?? ''} ${className ? '' : 'rounded bg-bg px-1 py-0.5 text-[0.9em]'}`} {...withoutNode(props)}>
              {kids}
            </code>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
