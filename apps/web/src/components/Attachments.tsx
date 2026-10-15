import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { api, API } from '../lib/api';
import type { Attachment } from '../lib/types';

export const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_PER_MESSAGE = 10;

export interface Pending {
  key: number;
  nome: string;
  /** Local preview while (and after) the upload. */
  preview: string;
  status: 'uploading' | 'ready' | 'failed';
  hash?: string;
  error?: string;
}

const imagesOf = (files: Iterable<File>) => [...files].filter((f) => ACCEPTED.includes(f.type));

/** Images waiting to be sent with the next message: added by paste, drag and drop or the file picker. */
export function useComposerImages() {
  const [items, setItems] = useState<Pending[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const next = useRef(0);
  const live = useRef(true);
  const urls = useRef(new Set<string>());
  const itemsRef = useRef<Pending[]>([]);
  const update = useCallback((fn: (cur: Pending[]) => Pending[]) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  useEffect(() => {
    live.current = true;
    const created = urls.current;
    return () => {
      live.current = false;
      created.forEach((u) => URL.revokeObjectURL?.(u));
    };
  }, []);

  const add = useCallback((files: Iterable<File>) => {
    const all = [...files];
    const images = imagesOf(all);
    setNotice(images.length < all.length ? 'Só imagens PNG, JPEG ou WebP podem ser anexadas.' : null);
    for (const file of images) {
      // The upload starts here, never inside a state updater (React may run those twice).
      if (itemsRef.current.length >= MAX_PER_MESSAGE) {
        setNotice(`No máximo ${MAX_PER_MESSAGE} imagens por mensagem.`);
        break;
      }
      const key = next.current++;
      const preview = URL.createObjectURL?.(file) ?? '';
      if (preview) urls.current.add(preview);
      update((cur) => [...cur, { key, nome: file.name || 'imagem', preview, status: 'uploading' }]);
      const patch = (p: Partial<Pending>) => live.current && update((cur) => cur.map((x) => (x.key === key ? { ...x, ...p } : x)));
      api
        .uploadAttachment(file)
        .then((a) => patch({ status: 'ready', hash: a.hash }))
        .catch((e: unknown) => patch({ status: 'failed', error: e instanceof Error ? e.message : String(e) }));
    }
  }, [update]);

  return {
    items,
    notice,
    add,
    remove: (key: number) => update((c) => c.filter((p) => p.key !== key)),
    clear: () => update(() => []),
    uploading: items.some((p) => p.status === 'uploading'),
    /** What goes in the message: only the images that finished uploading. */
    ready: items.filter((p) => p.status === 'ready' && p.hash).map((p) => ({ hash: p.hash!, nome: p.nome })),
    onPaste: (e: ClipboardEvent) => {
      const files = [...e.clipboardData.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => f !== null);
      if (imagesOf(files).length === 0) return; // plain text paste: leave it alone
      e.preventDefault();
      add(files);
    },
    onDrop: (e: DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      add(e.dataTransfer.files);
    },
  };
}

export function PendingStrip({ items, onRemove }: { items: Pending[]; onRemove: (key: number) => void }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Imagens anexadas" className="mb-2 flex flex-wrap gap-2">
      {items.map((p) => (
        <li key={p.key} className="relative">
          {p.preview ? <img src={p.preview} alt={p.nome} className={`h-16 w-16 rounded-lg border border-line object-cover ${p.status === 'failed' ? 'opacity-40' : ''}`} /> : <span className="grid h-16 w-16 place-items-center rounded-lg border border-line text-xs">{p.nome}</span>}
          {p.status === 'uploading' && <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/40 text-xs text-white">Enviando…</span>}
          {p.status === 'failed' && (
            <span role="alert" className="absolute inset-x-0 bottom-0 truncate rounded-b-lg bg-danger px-1 text-xs text-white" title={p.error}>
              {p.error ?? 'Falhou'}
            </span>
          )}
          <button type="button" aria-label={`Remover ${p.nome}`} onClick={() => onRemove(p.key)} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-panel text-xs">
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Thumbnails inside a message; a click opens the picture at full size. */
export function Thumbs({ anexos }: { anexos: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null);
  return (
    <>
      <ul aria-label="Imagens da mensagem" className="mb-2 flex flex-wrap gap-2">
        {anexos.map((a) => (
          <li key={a.hash}>
            <button type="button" aria-label={`Ampliar ${a.nome ?? 'imagem'}`} onClick={() => setOpen(a)}>
              <img src={`${API}${a.url}`} alt={a.nome ?? 'imagem anexada'} loading="lazy" className="h-24 w-24 rounded-lg border border-line object-cover" />
            </button>
          </li>
        ))}
      </ul>
      {open && <Lightbox a={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Lightbox({ a, onClose }: { a: Attachment; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={a.nome ?? 'Imagem'} onClick={onClose} className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
      <img src={`${API}${a.url}`} alt={a.nome ?? 'imagem anexada'} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded-lg" />
      <button ref={closeRef} type="button" aria-label="Fechar" onClick={onClose} className="absolute right-4 top-4 rounded-full bg-panel px-3 py-1 text-lg">
        ×
      </button>
    </div>
  );
}
