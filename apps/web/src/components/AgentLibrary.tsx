import { Button, ProviderDot } from '@owl/ui';
import { FileWarning, Plus, Save } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { AgentLibrary as Library, AgentSummary } from '../lib/types';
import { Label, ScreenHeader, field } from './desk/ScreenHeader';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');
const NAME = /^[a-z0-9][a-z0-9-]*$/;

const template = (nome: string) => `---
nome: ${nome}
descricao: Em uma linha, o que este agente faz.
papel: dev
provedor: claude-cli
modelo: sonnet
ferramentas: [Read, Grep, Glob]
---
Você é ... Descreva aqui o papel, o que fazer e o que não fazer.
`;

type Editing = { nome: string; texto: string; origem: 'usuario' | 'exemplo' | 'novo' };

const originTag = (a: AgentSummary) => (a.origem === 'usuario' ? (a.sobrescreve ? 'sua cópia' : 'seu') : 'exemplo');

/** The agent library: agents are files; this lists them, shows broken ones with the reason, and edits the user's copies. */
/** `onClose` is still passed by the app but unused: the design has no "back" button on this screen. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function AgentLibrary(_props: { onClose?: () => void }) {
  const [lib, setLib] = useState<Library | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [creating, setCreating] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.agents().then(setLib).catch((e) => setError(message(e))), []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      await load();
    }
  };

  const open = useCallback(async (nome: string) => {
    setSel(nome);
    setDuplicating(false);
    setConfirmDelete(false);
    setEditorError(null);
    try {
      const src = await api.agentSource(nome);
      setEditing({ nome, texto: src.texto, origem: src.origem });
    } catch (e) {
      setError(message(e));
    }
  }, []);

  // The editor always shows an agent: the first one, until the user picks another.
  const first = lib?.agents[0]?.nome;
  useEffect(() => {
    if (!sel && first) void open(first);
  }, [sel, first, open]);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setEditorError(null);
    try {
      await api.saveAgent(editing.nome, editing.texto);
      await load();
      await open(editing.nome);
    } catch (e) {
      setEditorError(message(e)); // stays open: the text is not lost
    } finally {
      setBusy(false);
    }
  };

  const submitNew = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const nome = String(new FormData(e.currentTarget).get('nome') ?? '').trim();
    if (!NAME.test(nome)) return setError('Use só letras minúsculas, números e hífens no nome.');
    if (lib?.agents.some((a) => a.nome === nome)) return setError(`Já existe um agente chamado "${nome}".`);
    setError(null);
    setCreating(false);
    setEditorError(null);
    setSel(nome);
    setEditing({ nome, texto: template(nome), origem: 'novo' });
  };

  const submitDuplicate = (e: FormEvent<HTMLFormElement>, from: string) => {
    e.preventDefault();
    const novo = String(new FormData(e.currentTarget).get('novo') ?? '').trim();
    void run(async () => {
      await api.duplicateAgent(from, novo);
      setDuplicating(false);
      await load();
      await open(novo);
    });
  };

  const agents = lib?.agents ?? [];
  const current = agents.find((a) => a.nome === sel) ?? null;
  const count = agents.length;

  return (
    <main aria-label="Biblioteca de agentes" className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ScreenHeader eyebrow={`BIBLIOTECA · ${count} ${count === 1 ? 'AGENTE' : 'AGENTES'}`} title="Agentes">
          <span className="flex-1" />
          <span className="max-w-xs text-xs text-muted [text-wrap:pretty]">Cada agente é um arquivo; a sua cópia vale mais do que o exemplo de mesmo nome.</span>
          <Button variant="primary" icon={Plus} aria-expanded={creating} onClick={() => setCreating((v) => !v)}>
            Novo agente
          </Button>
        </ScreenHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-6 py-4">
          {error && (
            <p role="alert" className="m-0 rounded-md border border-danger bg-danger-wash px-3 py-2.5 text-xs text-danger">
              {error}
            </p>
          )}

          {creating && (
            <form onSubmit={submitNew} className="flex items-end gap-2 rounded-md border border-line bg-panel p-3 text-xs">
              <label className="flex flex-col gap-1.5 font-medium">
                Nome do arquivo
                <input name="nome" required maxLength={64} placeholder="meu-agente" className={`${field} font-mono`} />
              </label>
              <Button type="submit" variant="primary">
                Criar
              </Button>
            </form>
          )}

          {lib && lib.problemas.length > 0 && (
            <div role="group" aria-label="Arquivos com problema" className="flex flex-col gap-2">
              {lib.problemas.map((p) => (
                <div key={`${p.origem}:${p.arquivo}`} role="alert" className="flex items-center gap-2.5 rounded-md border border-danger bg-danger-wash px-3 py-2.5 text-xs">
                  <FileWarning size={14} aria-hidden="true" className="flex-none text-danger" />
                  <code className="font-mono text-xs">{p.arquivo}</code>
                  <span className="text-muted">
                    ({p.origem === 'usuario' ? 'seu' : 'exemplo'}) não pôde ser lido: {p.erro}
                  </span>
                </div>
              ))}
            </div>
          )}

          {lib && count === 0 && <p className="m-0 text-muted">Nenhum agente ainda.</p>}
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5 p-0">
            {agents.map((a) => {
              const on = a.nome === sel;
              return (
                <li key={a.nome}>
                  <button
                    type="button"
                    onClick={() => void open(a.nome)}
                    aria-label={`Editar ${a.nome}`}
                    aria-pressed={on}
                    className={`flex h-full w-full flex-col gap-2 rounded-md border p-3 text-left text-fg transition-colors duration-[120ms] hover:border-line-strong ${on ? 'border-line-strong bg-raised' : 'border-line bg-panel'}`}
                  >
                    <span className="flex items-center gap-2">
                      <ProviderDot provider={a.provedor} />
                      <span className="truncate font-mono text-[13px] font-semibold">{a.nome}</span>
                      <span className="rounded-sm border border-line px-1.5 text-[11px] text-muted">{originTag(a)}</span>
                    </span>
                    {a.descricao && <span className="text-[13px] leading-snug [text-wrap:pretty]">{a.descricao}</span>}
                    <span className="font-mono text-[11px] text-muted">
                      {a.provedor}
                      {a.modelo ? ` · ${a.modelo}` : ''}
                    </span>
                    <span className="truncate font-mono text-[11px] text-muted">
                      {a.ferramentas.length ? `Ferramentas: ${a.ferramentas.join(', ')}` : 'Sem ferramentas'}
                      {a.skills.length > 0 && ` · Skills: ${a.skills.join(', ')}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <aside aria-label="Editor de agente" className="flex min-h-0 flex-none flex-col border-t border-line bg-panel lg:w-[480px] lg:border-l lg:border-t-0">
        {editing ? (
          <>
            <div className="flex flex-col gap-1.5 border-b border-line px-4 py-3.5">
              <div className="flex items-center gap-2">
                {current && <ProviderDot provider={current.provedor} />}
                <h2 className="m-0 font-mono text-sm font-semibold">{editing.nome}</h2>
                <span className="flex-1" />
                <span className="font-mono text-[11px] text-muted">{editing.origem === 'novo' ? 'novo' : `agents/${editing.nome}.md`}</span>
              </div>
              <span className="text-xs text-muted">
                {editing.origem === 'novo'
                  ? 'Novo agente: ainda não salvo.'
                  : editing.origem === 'exemplo'
                    ? 'Ao salvar, cria a sua cópia; o exemplo continua intacto.'
                    : current?.sobrescreve
                      ? 'Sua cópia, no lugar do exemplo de mesmo nome.'
                      : 'Arquivo seu.'}
              </span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-4 py-3.5">
              {current && (
                <>
                  <dl className="m-0 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
                    {[
                      ['PAPEL', current.papel ?? '—'],
                      ['ADAPTADOR', current.provedor],
                      ['MODELO', current.modelo ?? 'padrão'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex flex-col gap-0.5 bg-raised px-2.5 py-2">
                        <dt className="owl-label text-[10px]">{k}</dt>
                        <dd className="m-0 font-mono text-xs">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="flex flex-col gap-2">
                    <Label>FERRAMENTAS · ESCOPO</Label>
                    <ul aria-label="Ferramentas" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                      {current.ferramentas.map((t) => (
                        <li key={t} className="rounded-sm border border-line bg-raised px-[7px] py-[3px] font-mono text-[11px]">
                          {t}
                        </li>
                      ))}
                      {current.skills.map((s) => (
                        <li key={s} className="rounded-sm border border-line bg-raised px-[7px] py-[3px] font-mono text-[11px]">
                          skill: {s}
                        </li>
                      ))}
                      {current.podeAprovar && <li className="rounded-sm border border-line bg-raised px-[7px] py-[3px] font-mono text-[11px]">pode aprovar</li>}
                    </ul>
                    {current.ferramentas.length === 0 && <span className="text-xs text-muted">Sem ferramentas: só responde texto.</span>}
                    <span className="text-xs leading-normal text-muted">Escreve só no worktree do ticket. Push, merge, instalar e apagar sempre pedem aprovação.</span>
                  </div>
                </>
              )}

              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <Label>DEFINIÇÃO</Label>
                <label className="flex min-h-0 flex-1 flex-col">
                  <span className="sr-only">Arquivo do agente {editing.nome}</span>
                  <textarea
                    value={editing.texto}
                    onChange={(e) => setEditing({ ...editing, texto: e.target.value })}
                    rows={14}
                    spellCheck={false}
                    className="min-h-60 w-full flex-1 resize-y rounded-md border border-line bg-bg px-3 py-2.5 font-mono text-xs leading-[1.65] text-fg outline-none focus:border-accent"
                  />
                </label>
              </div>

              {editorError && (
                <p role="alert" className="m-0 text-[13px] text-danger">
                  {editorError}
                </p>
              )}

              {duplicating && current && (
                <form onSubmit={(e) => submitDuplicate(e, current.nome)} className="flex items-end gap-2 text-xs">
                  <label className="flex flex-col gap-1.5 font-medium">
                    Nome da cópia
                    <input name="novo" required maxLength={64} defaultValue={`${current.nome}-2`} className={`${field} font-mono`} />
                  </label>
                  <Button type="submit" variant="primary" disabled={busy}>
                    Criar cópia
                  </Button>
                </form>
              )}
            </div>

            <div className="flex gap-2 border-t border-line px-4 py-3">
              <Button variant="primary" icon={Save} disabled={busy} onClick={() => void save()}>
                Salvar
              </Button>
              {current && (
                <Button disabled={busy} aria-label={`Duplicar ${current.nome}`} aria-expanded={duplicating} onClick={() => setDuplicating((v) => !v)}>
                  Duplicar
                </Button>
              )}
              <span className="flex-1" />
              {current?.origem === 'usuario' &&
                (confirmDelete ? (
                  <Button variant="danger" disabled={busy} style={{ color: 'var(--c-danger)', borderColor: 'var(--c-danger)', background: 'var(--c-danger-wash)' }} onClick={() => void run(async () => { await api.deleteAgent(current.nome); setConfirmDelete(false); setSel(null); setEditing(null); })}>
                    {current.sobrescreve ? 'Confirmar: voltar ao exemplo' : 'Confirmar exclusão'}
                  </Button>
                ) : (
                  <Button variant="danger" disabled={busy} aria-label={`Excluir ${current.nome}`} onClick={() => setConfirmDelete(true)}>
                    {current.sobrescreve ? 'Voltar ao exemplo' : 'Excluir'}
                  </Button>
                ))}
            </div>
          </>
        ) : (
          <p className="m-0 p-4 text-[13px] text-muted">Escolha um agente para ver a definição.</p>
        )}
      </aside>
    </main>
  );
}
