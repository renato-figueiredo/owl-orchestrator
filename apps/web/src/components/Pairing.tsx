import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Logo } from './Logo';

/** Asks for the pairing code the server printed in its console (or takes it from `?pair=` and trades it right away). */
export function Pairing({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);

  const pair = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.pair(code.trim());
      history.replaceState(null, '', location.pathname); // the code is single-use: do not leave it in the address bar
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível parear');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const code = new URLSearchParams(location.search).get('pair');
    if (code && !tried.current) {
      tried.current = true;
      void pair(code);
    }
  }, []);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void pair(String(new FormData(e.currentTarget).get('codigo') ?? ''));
  };

  return (
    <main className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} aria-label="Parear navegador" className="w-full max-w-md space-y-3 rounded border border-line bg-raised p-5">
        <Logo />
        <h1 className="text-lg font-semibold">Parear este navegador</h1>
        <p className="text-sm text-muted">
          O servidor imprimiu um código no terminal onde ele roda. Cole-o aqui (ou abra o endereço com <code>?pair=…</code>). Isso garante que
          decisões como aprovar um portão venham de você, e não de um programa na mesma máquina.
        </p>
        <label className="block text-sm">
          Código de pareamento
          <input name="codigo" required autoComplete="off" className="mt-1 block w-full rounded border border-line bg-bg px-2 py-1 font-mono" />
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-50">
          Parear
        </button>
      </form>
    </main>
  );
}
