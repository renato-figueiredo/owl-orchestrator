import { FileWarning } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Label } from '../components/desk/ScreenHeader';
import { pipelinesApi } from '../lib/api';

type Library = Awaited<ReturnType<typeof pipelinesApi>>;
const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');
const stepsText = (n: number) => `${n} ${n === 1 ? 'etapa' : 'etapas'}`;

/** The pipelines of the library: the list on the left, the selected one as a chain of steps. The API exposes names and step ids only. */
export function PipelinesScreen() {
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);

  useEffect(() => {
    void pipelinesApi().then(setLib).catch((e) => setError(message(e)));
  }, []);

  const pipelines = lib?.pipelines ?? [];
  const current = pipelines.find((p) => p.nome === sel) ?? pipelines[0] ?? null;
  const chosen = current?.etapas.find((id) => id === step) ?? current?.etapas[0] ?? null;
  const index = current && chosen ? current.etapas.indexOf(chosen) : -1;

  return (
    <main aria-label="Pipelines" className="flex min-h-0 min-w-0 flex-1">
      <nav aria-label="Lista de pipelines" className="flex w-60 flex-none flex-col gap-1 overflow-auto border-r border-line px-3 py-5">
        <h1 className="mx-2 mb-3 mt-0 text-xl font-semibold">Pipelines</h1>
        {lib && pipelines.length === 0 && <p className="m-0 px-2 text-xs text-muted">Nenhuma pipeline ainda.</p>}
        {pipelines.map((p) => {
          const on = p.nome === current?.nome;
          return (
            <button
              key={p.nome}
              type="button"
              aria-current={on || undefined}
              onClick={() => {
                setSel(p.nome);
                setStep(null);
              }}
              className={`flex flex-col gap-0.5 rounded-md p-2 text-left text-fg transition-colors duration-[120ms] hover:bg-raised ${on ? 'bg-raised' : 'bg-transparent'}`}
            >
              <span className="font-mono text-xs">{p.nome}</span>
              <span className="font-mono text-[11px] text-muted">
                {stepsText(p.etapas.length)} · {p.origem === 'usuario' ? 'seu' : 'exemplo'}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {error && (
          <p role="alert" className="m-4 rounded-md border border-danger bg-danger-wash px-3 py-2.5 text-xs text-danger">
            {error}
          </p>
        )}
        {lib && lib.problemas.length > 0 && (
          <div className="flex flex-col gap-2 px-6 pt-4">
            {lib.problemas.map((p) => (
              <div key={`${p.origem}:${p.arquivo}`} role="alert" className="flex items-center gap-2.5 rounded-md border border-danger bg-danger-wash px-3 py-2.5 text-xs">
                <FileWarning size={14} aria-hidden="true" className="flex-none text-danger" />
                <code className="font-mono text-xs">{p.arquivo}</code>
                <span className="text-muted">não pôde ser lido: {p.erro}</span>
              </div>
            ))}
          </div>
        )}

        {current ? (
          <>
            <div className="flex items-center gap-3 border-b border-line px-6 pb-3.5 pt-5">
              <h2 className="m-0 font-mono text-sm font-semibold">{current.nome}</h2>
              <span className="font-mono text-[11px] text-muted">pipelines/{current.nome}.yaml</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-auto px-8 py-10">
              <ol aria-label={`Etapas de ${current.nome}`} className="m-0 flex list-none items-stretch overflow-x-auto p-0">
                <li className="flex flex-none flex-col justify-center gap-1 rounded-md border border-dashed border-line-strong px-3.5 py-2.5 font-mono text-[11px] text-muted">
                  <span className="text-fg">pedido</span>
                  entrada
                </li>
                {current.etapas.map((id, i) => {
                  const on = id === chosen;
                  return (
                    <li key={id} className="flex min-w-0 flex-1 items-stretch">
                      <span aria-hidden="true" className="h-px w-7 flex-none self-center bg-line-strong" />
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setStep(id)}
                        className={`flex min-w-36 flex-1 flex-col gap-2 rounded-lg border px-3.5 py-3 text-left text-fg transition-colors duration-[120ms] hover:border-line-strong ${on ? 'border-line-strong bg-raised' : 'border-line bg-panel'}`}
                      >
                        <span className="font-mono text-[11px] text-muted">{String(i + 1).padStart(2, '0')}</span>
                        <span className="font-mono text-[15px] font-semibold">{id}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              {chosen && (
                <section aria-label={`Etapa ${chosen}`} className="flex max-w-2xl flex-col gap-3">
                  <Label>ETAPA · {chosen}</Label>
                  <p className="m-0 text-sm leading-relaxed text-fg [text-wrap:pretty]">
                    Etapa {index + 1} de {current.etapas.length}
                    {index > 0 ? `, depois de ${current.etapas[index - 1]}` : ', a primeira a rodar'}.
                  </p>
                  <p className="m-0 text-xs leading-normal text-muted">
                    Agente, entrada e saída de cada etapa estão no arquivo da pipeline; o servidor ainda não os expõe. Por enquanto esta tela mostra a ordem das etapas.
                  </p>
                </section>
              )}
            </div>
          </>
        ) : (
          lib && <p className="m-6 text-muted">Nenhuma pipeline na biblioteca.</p>
        )}
      </div>
    </main>
  );
}
