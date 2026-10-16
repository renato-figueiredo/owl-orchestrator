import { StreamCaret } from '@owl/ui';
import { Check, Copy } from 'lucide-react';
import { Children, isValidElement, useState, type ComponentType, type ReactNode } from 'react';
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
      className="flex items-center gap-1 rounded-sm px-1 font-mono text-[11px] text-muted transition-colors hover:text-fg"
    >
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      {copied ? 'copiado' : 'copiar'}
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

/** What the code block header says: the file after the language on the fence (```ts src/a.ts), else the language, else "código". */
function headerOf(kids: ReactNode): string {
  const first = Children.toArray(kids)[0];
  if (!isValidElement(first)) return 'código';
  const p = first.props as { className?: string; node?: { data?: { meta?: string | null } } };
  const meta = p.node?.data?.meta?.trim();
  const lang = /language-(\S+)/.exec(p.className ?? '')?.[1];
  return meta || lang || 'código';
}

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Puts the streaming caret at the end of the last paragraph/item, so it sits inline with the text. */
function caretPlugin() {
  return (tree: HastNode) => {
    const marker: HastNode = { type: 'element', tagName: 'owl-caret', properties: {}, children: [] };
    let host: HastNode = tree;
    for (;;) {
      const last = [...(host.children ?? [])].reverse().find((c) => c.type === 'element');
      if (!last || !last.tagName) break;
      if (['ul', 'ol', 'li', 'blockquote'].includes(last.tagName)) {
        host = last;
        continue;
      }
      if (/^(p|h[1-6])$/.test(last.tagName)) host = last;
      break;
    }
    (host.children ??= []).push(marker);
  };
}

/**
 * Markdown for chat messages. Raw HTML in the text is NOT rendered (react-markdown escapes it) and link
 * protocols are filtered by its default URL transform, so model output cannot inject markup or scripts.
 * `caret` draws the amber streaming caret at the end of the text.
 */
export function Markdown({ children, caret = false }: { children: string; caret?: boolean }) {
  const components = {
    a: (props: object) => <a {...withoutNode(props)} target="_blank" rel="noopener noreferrer" />,
    p: (props: object) => <p {...withoutNode(props)} className="text-pretty" />,
    pre: ({ children: kids }: { children?: ReactNode }) => {
      const code = textOf(kids).replace(/\n$/, '');
      return (
        <div className="overflow-hidden rounded-md border border-line bg-chrome">
          <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5 font-mono text-[11px] text-muted">
            <span className="truncate">{headerOf(kids)}</span>
            <CopyButton text={code} />
          </div>
          <pre className="overflow-x-auto px-3 py-2.5 font-mono text-xs leading-[1.6] [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-xs">{kids}</pre>
        </div>
      );
    },
    code: ({ className, children: kids, ...props }: { className?: string; children?: ReactNode }) => (
      <code className={className ? className : 'rounded-sm bg-raised px-[5px] py-px font-mono text-[12.5px]'} {...withoutNode(props)}>
        {kids}
      </code>
    ),
    'owl-caret': StreamCaret as ComponentType,
  };
  return (
    <div className="space-y-2.5 break-words text-sm leading-[1.6] [&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:block [&_table]:overflow-x-auto [&_table]:font-mono [&_table]:text-xs [&_td]:border [&_td]:border-line [&_td]:px-2 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_ul]:list-disc [&_ul]:pl-6">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={caret ? [caretPlugin] : []} components={components as never}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
