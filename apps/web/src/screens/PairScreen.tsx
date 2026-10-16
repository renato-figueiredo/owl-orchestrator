import { useEffect, useState } from 'react';
import { authStatusApi } from '../lib/api';

type Status = { required: boolean; authenticated: boolean } | null;

/** Pairing as a settings page: tells whether this browser is paired and how to pair another. The server offers no list of devices or QR code. */
export function PairScreen() {
  const [status, setStatus] = useState<Status>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void authStatusApi().then(setStatus).catch(() => setFailed(true));
  }, []);

  return (
    <main aria-label="Pareamento" className="flex min-w-0 flex-1 justify-center overflow-auto px-6 py-12">
      <div className="grid h-fit w-full max-w-3xl grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section aria-label="Estado do pareamento" className="flex flex-col gap-4 rounded-lg border border-line bg-panel p-6">
          <img src="/brand/anim-sync.svg" alt="" className="size-10" />
          <h1 className="m-0 text-2xl font-semibold leading-tight">Pareamento</h1>
          {failed && (
            <p role="alert" className="m-0 text-[13px] text-danger">
              Não foi possível consultar o servidor.
            </p>
          )}
          {status && (
            <div role="status" className="flex items-center gap-2.5 rounded-md border border-line bg-raised px-3.5 py-3 text-sm">
              <span aria-hidden="true" className="font-mono text-ok">
                {status.required && !status.authenticated ? '▲' : '✓'}
              </span>
              {!status.required
                ? 'Este servidor não pede pareamento: qualquer navegador na máquina pode aprovar portões.'
                : status.authenticated
                  ? 'Pareado. Este navegador já pode aprovar portões.'
                  : 'Este navegador ainda não está pareado.'}
            </div>
          )}
          <p className="m-0 text-sm leading-relaxed text-muted [text-wrap:pretty]">
            O pareamento garante que decisões como aprovar um portão venham de você, e não de um programa na mesma máquina.
          </p>
        </section>

        <section aria-label="Parear outro navegador" className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-[18px]">
          <h2 className="m-0 text-[15px] font-semibold">Parear outro navegador</h2>
          <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-normal text-muted">
            <li>Abra o endereço do OWL no outro navegador.</li>
            <li>Digite o código que o servidor mostra no terminal onde ele roda.</li>
            <li>O código vale uma vez; a cada pareamento o servidor gera outro.</li>
          </ol>
          <p className="m-0 text-xs leading-normal text-muted">As sessões pareadas ficam na memória do servidor: ao reiniciá-lo, é preciso parear de novo.</p>
        </section>
      </div>
    </main>
  );
}
