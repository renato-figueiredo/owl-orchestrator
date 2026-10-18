import { Button } from '@owl/ui';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { GhRepo, GitStatus } from '../lib/types';
import { field } from './desk/ScreenHeader';
import { validName } from './GitOriginForm';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');
const baseName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';

/**
 * A project's git: branch, remote, what is pending, the branches. A project with no remote can be linked to a repository
 * that exists (nothing is sent) or published as a new GitHub repository (which only asks: a person approves it first).
 */
export function GitCard({ projectId, pasta }: { projectId: string; pasta: string }) {
  const [s, setS] = useState<GitStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [url, setUrl] = useState('');
  const [nome, setNome] = useState(baseName(pasta));
  const [visibilidade, setVisibilidade] = useState<'privado' | 'publico'>('privado');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    return api.projectGit(projectId).then(setS).catch((e) => setLoadError(message(e)));
  }, [projectId]);
  useEffect(() => {
    setS(null);
    setNote(null);
    setError(null);
    void load();
  }, [load]);
  useEffect(() => {
    if (s?.repositorio && !s.remoto && repos === null) void api.ghRepos().then(setRepos).catch(() => setRepos([]));
  }, [s, repos]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const link = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    void run(async () => {
      setS(await api.projectGitRemote(projectId, url.trim()));
      setNote('Repositório vinculado como origin. Nada foi enviado.');
      setUrl('');
    });
  };
  const publish = () =>
    run(async () => {
      const r = await api.projectGitPublish(projectId, { nome, visibilidade });
      setNote(`Pedi a sua aprovação para criar o repositório ${visibilidade === 'publico' ? 'público' : 'privado'} "${nome}" no GitHub (${r.ticket.identificador}). Ele só é criado depois que você aprovar.`);
    });

  return (
    <section aria-label="Git do projeto" className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
      <h2 className="m-0 text-[15px] font-semibold">Git</h2>
      {!s && <p className="m-0 text-xs text-muted">{loadError ? `Não consegui ler o git desta pasta: ${loadError}` : 'Lendo…'}</p>}
      {s && !s.repositorio && <p className="m-0 text-xs text-muted">Esta pasta ainda não é um repositório git. Crie projetos novos por "Começar vazio" ou rode `git init` nela.</p>}
      {s?.repositorio && (
        <>
          <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted">Branch</dt>
            <dd className="m-0 font-mono">{s.branch ?? 'HEAD solto'}</dd>
            <dt className="text-muted">Remoto</dt>
            <dd className="m-0 break-all font-mono">{s.remoto ?? 'nenhum (só nesta máquina)'}</dd>
            <dt className="text-muted">Situação</dt>
            <dd className="m-0 font-mono">
              {s.alteracoes === 0 ? 'limpo' : `${s.alteracoes} alteração(ões) sem commit`}
              {s.adiante !== null && s.atras !== null ? ` · ${s.adiante} à frente, ${s.atras} atrás do remoto` : ''}
            </dd>
            <dt className="text-muted">Último commit</dt>
            <dd className="m-0 font-mono">{s.ultimoCommit ?? '—'}</dd>
            <dt className="text-muted">Branches</dt>
            <dd className="m-0 flex flex-wrap gap-1.5 font-mono">
              {s.branches.map((b) => (
                <span key={b} className="rounded-sm border border-line px-1.5 py-0.5">
                  {b}
                </span>
              ))}
            </dd>
          </dl>
          {!s.remoto && (
            <div className="flex flex-col gap-3 border-t border-line pt-3">
              <form onSubmit={link} className="flex flex-col gap-1.5 text-xs text-muted">
                <label className="flex flex-col gap-1.5">
                  Vincular a um repositório que já existe
                  <div className="flex gap-2">
                    <input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      list="gh-repos"
                      placeholder="https://github.com/dono/repositorio.git"
                      aria-label="URL do repositório"
                      autoComplete="off"
                      spellCheck={false}
                      className={`${field} h-9 flex-1 bg-bg font-mono`}
                    />
                    <Button type="submit" disabled={busy || !url.trim()}>
                      Vincular
                    </Button>
                  </div>
                </label>
                <datalist id="gh-repos">
                  {(repos ?? []).map((r) => (
                    <option key={r.nomeCompleto} value={`https://github.com/${r.nomeCompleto}.git`} />
                  ))}
                </datalist>
                <span>Só guarda o endereço como origin; nada é enviado.</span>
              </form>
              <div className="flex flex-col gap-1.5 text-xs text-muted">
                Ou criar um repositório novo no GitHub
                <div className="flex flex-wrap items-center gap-2">
                  <input value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Nome do repositório" spellCheck={false} className={`${field} h-9 w-56 bg-bg font-mono`} />
                  <select value={visibilidade} onChange={(e) => setVisibilidade(e.target.value as 'privado' | 'publico')} aria-label="Visibilidade" className={`${field} h-9 w-36 bg-bg`}>
                    <option value="privado">Privado</option>
                    <option value="publico">Público</option>
                  </select>
                  <Button disabled={busy || !validName(nome) || s.ultimoCommit === null} onClick={() => void publish()}>
                    Pedir criação
                  </Button>
                </div>
                <span>Abre um pedido de aprovação com o nome e a visibilidade; só depois de aprovado o OWL cria o repositório e envia (push).</span>
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="m-0 text-xs text-danger">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="m-0 text-xs text-muted">
          {note}
        </p>
      )}
    </section>
  );
}
