import { Button } from '@owl/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';

/** The pairing form: one field for the code the server printed in its console (or took from `?pair=`), and the button. */
export function PairForm({ onDone, device = 'navegador' }: { onDone: () => void; device?: 'navegador' | 'celular' }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const tried = useRef(false);

  const pair = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.pair(value.trim());
      history.replaceState(null, '', location.pathname); // the code is single-use: do not leave it in the address bar
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível parear');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const fromUrl = new URLSearchParams(location.search).get('pair');
    if (fromUrl && !tried.current) {
      tried.current = true;
      void pair(fromUrl);
    }
  }, []);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void pair(code);
  };

  return (
    <form onSubmit={submit} aria-label={`Parear ${device}`} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 text-xs font-medium">
        Código de pareamento
        <input
          name="codigo"
          required
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={error ? true : undefined}
          className={`h-[52px] rounded-md border bg-raised px-3.5 font-mono text-lg text-fg outline-none focus:border-accent max-sm:h-14 ${error ? 'border-danger' : 'border-line'}`}
        />
      </label>
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" loading={busy} className="max-sm:!h-12 max-sm:!text-[15px]">
        Parear
      </Button>
      <span className="text-xs text-muted">
        Ou abra o endereço com <code className="font-mono text-xs">?pair=…</code>: o código vale uma vez.
      </span>
    </form>
  );
}

/** Shown before the app when the server asks this browser to pair. Desktop: a card; narrow screens (~390px): the full-height mobile page. */
export function Pairing({ onDone }: { onDone: () => void }) {
  return (
    <main className="flex h-full justify-center overflow-auto bg-bg p-6 max-sm:items-start max-sm:px-5 max-sm:pb-9 max-sm:pt-24 sm:items-center">
      <section aria-labelledby="pair-title" className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-line bg-panel p-6 max-sm:max-w-none max-sm:gap-[18px] max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:p-0">
        <img src="/brand/anim-sync.svg" alt="" className="size-10 max-sm:size-12" />
        <h1 id="pair-title" className="m-0 text-2xl font-semibold leading-tight max-sm:text-[26px]">
          Parear este navegador
        </h1>
        <p className="m-0 text-sm leading-relaxed text-muted [text-wrap:pretty] max-sm:text-[15px]">
          O servidor imprimiu um código no terminal onde ele roda. Cole-o aqui. Isso garante que decisões como aprovar um portão venham de você, e não de um programa na mesma máquina.
        </p>
        <PairForm onDone={onDone} />
      </section>
    </main>
  );
}
