import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { AgentLibrary as Library, AgentSummary } from '../lib/types';

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

interface Props {
  onClose: () => void;
}

/** The agent library: agents are files; this lists them, shows broken ones with the reason, and edits the user's copies. */
export function AgentLibrary({ onClose }: Props) {
  const [lib, setLib] = useState<Library | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [creating, setCreating] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
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

  const edit = (a: AgentSummary) =>
    void run(async () => {
      const src = await api.agentSource(a.nome);
      setEditorError(null);
      setEditing({ nome: a.nome, texto: src.texto, origem: src.origem });
    });

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setEditorError(null);
    try {
      await api.saveAgent(editing.nome, editing.texto);
      setEditing(null);
      await load();
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
    setEditing({ nome, texto: template(nome), origem: 'novo' });
  };

  const submitDuplicate = (e: FormEvent<HTMLFormElement>, from: string) => {
    e.preventDefault();
    const novo = String(new FormData(e.currentTarget).get('novo') ?? '').trim();
    void run(async () => {
      await api.duplicateAgent(from, novo);
      setDuplicating(null);
    });
  };

  return (
    <section aria-label="Biblioteca de agentes" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-line p-4">
        <h1 className="text-lg font-semibold">Agentes</h1>
        <span className="text-sm text-muted">Cada agente é um arquivo; a sua cópia vale mais do que o exemplo de mesmo nome.</span>
        <button type="button" onClick={() => setCreating((v) => !v)} aria-expanded={creating} className="ml-auto rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg">
          Novo agente
        </button>
        <button type="button" onClick={onClose} className="rounded border border-line px-3 py-1.5 text-sm hover:bg-raised">
          Voltar às conversas
        </button>
      </header>

      <div className="space-y-4 p-4">
        {error && (
          <p role="alert" className="rounded border border-danger p-2 text-sm text-danger">
            {error}
          </p>
        )}

        {creating && (
          <form onSubmit={submitNew} className="flex items-end gap-2 rounded border border-line bg-raised p-3 text-sm">
            <label className="block">
              Nome do arquivo
              <input name="nome" required maxLength={64} placeholder="meu-agente" className="mt-1 block rounded border border-line bg-bg px-2 py-1" />
            </label>
            <button type="submit" className="rounded bg-accent px-3 py-1 font-medium text-accent-fg">
              Criar
            </button>
          </form>
        )}

        {editing && (
          <div className="rounded border border-line bg-raised p-3">
            <h2 className="font-medium">
              {editing.origem === 'novo' ? 'Novo agente' : `Editar ${editing.nome}`}
              {editing.origem === 'exemplo' && <span className="ml-2 text-sm font-normal text-muted">Ao salvar, cria a sua cópia; o exemplo continua intacto.</span>}
            </h2>
            <label className="mt-2 block text-sm">
              <span className="sr-only">Arquivo do agente {editing.nome}</span>
              <textarea
                value={editing.texto}
                onChange={(e) => setEditing({ ...editing, texto: e.target.value })}
                rows={16}
                spellCheck={false}
                className="w-full rounded border border-line bg-bg p-2 font-mono text-sm"
              />
            </label>
            {editorError && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {editorError}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={busy} onClick={() => void save()} className="rounded bg-accent px-3 py-1 text-sm font-medium text-accent-fg">
                Salvar
              </button>
              <button type="button" onClick={() => setEditing(null)} className="rounded border border-line px-3 py-1 text-sm hover:bg-bg">
                Cancelar
              </button>
            </div>
          </div>
        )}

        {lib && lib.problemas.length > 0 && (
          <div role="alert" aria-label="Arquivos com problema" className="rounded border border-danger p-3 text-sm">
            <h2 className="font-medium text-danger">{lib.problemas.length === 1 ? '1 arquivo não pôde ser lido' : `${lib.problemas.length} arquivos não puderam ser lidos`}</h2>
            <ul className="mt-1 space-y-1">
              {lib.problemas.map((p) => (
                <li key={`${p.origem}:${p.arquivo}`}>
                  <code>{p.arquivo}</code> <span className="text-muted">({p.origem === 'usuario' ? 'seu' : 'exemplo'})</span>: {p.erro}
                </li>
              ))}
            </ul>
          </div>
        )}

        {lib?.agents.length === 0 && <p className="text-muted">Nenhum agente ainda.</p>}
        <ul className="grid gap-3 md:grid-cols-2">
          {lib?.agents.map((a) => (
            <li key={a.nome} className="rounded border border-line bg-panel p-3">
              <div className="flex items-center gap-2">
                <h2 className="truncate font-medium">{a.nome}</h2>
                <span className="rounded border border-line px-1.5 text-xs text-muted">{a.origem === 'usuario' ? (a.sobrescreve ? 'sua cópia' : 'seu') : 'exemplo'}</span>
                <span className="ml-auto text-xs text-muted">
                  {a.provedor}
                  {a.modelo ? ` · ${a.modelo}` : ''}
                </span>
              </div>
              {a.descricao && <p className="mt-1 text-sm">{a.descricao}</p>}
              <p className="mt-1 text-xs text-muted">
                {a.ferramentas.length ? `Ferramentas: ${a.ferramentas.join(', ')}` : 'Sem ferramentas'}
                {a.skills.length > 0 && ` · Skills: ${a.skills.join(', ')}`}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                <button type="button" disabled={busy} onClick={() => edit(a)} aria-label={`Editar ${a.nome}`} className="rounded border border-line px-2 py-0.5 hover:bg-raised">
                  Editar
                </button>
                <button type="button" disabled={busy} onClick={() => setDuplicating(duplicating === a.nome ? null : a.nome)} aria-label={`Duplicar ${a.nome}`} className="rounded border border-line px-2 py-0.5 hover:bg-raised">
                  Duplicar
                </button>
                {a.origem === 'usuario' &&
                  (confirmDelete === a.nome ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(async () => { await api.deleteAgent(a.nome); setConfirmDelete(null); })}
                      className="rounded bg-danger px-2 py-0.5 text-white"
                    >
                      {a.sobrescreve ? 'Confirmar: voltar ao exemplo' : 'Confirmar exclusão'}
                    </button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => setConfirmDelete(a.nome)} aria-label={`Excluir ${a.nome}`} className="rounded border border-line px-2 py-0.5 text-danger hover:bg-raised">
                      {a.sobrescreve ? 'Voltar ao exemplo' : 'Excluir'}
                    </button>
                  ))}
              </div>
              {duplicating === a.nome && (
                <form onSubmit={(e) => submitDuplicate(e, a.nome)} className="mt-2 flex items-end gap-2 text-sm">
                  <label>
                    Nome da cópia
                    <input name="novo" required maxLength={64} defaultValue={`${a.nome}-2`} className="mt-1 block rounded border border-line bg-bg px-2 py-1" />
                  </label>
                  <button type="submit" disabled={busy} className="rounded bg-accent px-3 py-1 font-medium text-accent-fg">
                    Duplicar
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
