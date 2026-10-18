import { Button } from '@owl/ui';
import { ArrowUp, Folder } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { GhRepo, GhState } from '../lib/types';
import { field } from './desk/ScreenHeader';

export type GitOrigin = 'github' | 'url' | 'empty';

export interface GitOriginValue {
  repo: string;
  url: string;
  parent: string;
  nome: string;
  publicar: boolean;
  visibilidade: 'privado' | 'publico';
}
export const EMPTY_GIT: GitOriginValue = { repo: '', url: '', parent: '', nome: '', publicar: false, visibilidade: 'privado' };

/** The folder name a source suggests: `owner/repo` and `https://host/x/repo.git` both give `repo`. */
export const suggestName = (source: string): string => source.trim().replace(/\.git$/, '').split(/[/:]/).filter(Boolean).pop() ?? '';
export const validName = (nome: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(nome);

/** Can the first step go on with what was filled in? */
export function gitReady(origin: GitOrigin, v: GitOriginValue): boolean {
  if (!v.parent || !validName(v.nome)) return false;
  if (origin === 'github') return v.repo !== '';
  if (origin === 'url') return /^(https:\/\/|ssh:\/\/|git@)/.test(v.url.trim());
  return true;
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

/**
 * What the first step asks for on the three git origins: a GitHub repository to clone (from the account `gh` is logged in
 * with), any git URL, or a new empty folder (optionally also created on GitHub, which waits for an approval).
 */
export function GitOriginForm({ origin, value, onChange }: { origin: GitOrigin; value: GitOriginValue; onChange: (v: GitOriginValue) => void }) {
  const [dirs, setDirs] = useState<{ pai: string | null; pastas: Array<{ nome: string; caminho: string }> } | null>(null);
  const [gh, setGh] = useState<GhState | null>(null);
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<GitOriginValue>) => onChange({ ...value, ...patch });

  // The folder picker: what is inside the chosen folder (the first allowed root until one is chosen).
  useEffect(() => {
    let alive = true;
    void api
      .gitDirs(value.parent || undefined)
      .then((d) => {
        if (!alive) return;
        setError(null);
        setDirs(d);
        if (d.pasta !== value.parent) onChange({ ...value, parent: d.pasta });
      })
      .catch((e) => alive && setError(message(e)));
    return () => {
      alive = false;
    };
    // `value` is only read to keep what the person already typed; the folder is what triggers a reload
  }, [value.parent]);
  useEffect(() => {
    let alive = true;
    void api.ghState().then((s) => alive && setGh(s)).catch(() => alive && setGh({ instalado: false, logado: false, usuario: null }));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (origin !== 'github' || !gh?.logado || repos) return;
    let alive = true;
    void api.ghRepos().then((r) => alive && setRepos(r)).catch((e) => alive && setError(message(e)));
    return () => {
      alive = false;
    };
  }, [origin, gh, repos]);

  const ghOk = gh?.logado === true;
  const ghHelp = gh === null ? 'Verificando o gh…' : !gh.instalado ? 'O `gh` não está instalado neste computador.' : 'Entre com `gh auth login` no terminal e abra esta janela de novo.';
  return (
    <div className="flex flex-col gap-3">
      {origin === 'github' &&
        (ghOk ? (
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            Repositório da conta {gh?.usuario}
            <select
              value={value.repo}
              onChange={(e) => set({ repo: e.target.value, nome: suggestName(e.target.value) })}
              disabled={!repos}
              aria-label="Repositório do GitHub"
              className={`${field} h-9 bg-bg font-mono`}
            >
              <option value="">{repos ? 'Escolha um repositório…' : 'Carregando…'}</option>
              {(repos ?? []).map((r) => (
                <option key={r.nomeCompleto} value={r.nomeCompleto}>
                  {r.privado ? '🔒 ' : ''}
                  {r.nomeCompleto}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="m-0 text-xs text-muted">{ghHelp}</p>
        ))}
      {origin === 'url' && (
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          URL do repositório
          <input
            value={value.url}
            onChange={(e) => set({ url: e.target.value, nome: value.nome && value.nome !== suggestName(value.url) ? value.nome : suggestName(e.target.value) })}
            placeholder="https://gitlab.com/time/projeto.git"
            autoComplete="off"
            spellCheck={false}
            aria-label="URL git"
            className={`${field} h-9 bg-bg font-mono`}
          />
          <span>https://, ssh:// ou git@host:caminho. Pastas locais não entram aqui: use "Pasta no computador".</span>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5 text-xs text-muted">
          <span>Criar dentro de</span>
          <div className="flex gap-2">
            <Button type="button" size="sm" icon={ArrowUp} disabled={!dirs?.pai} onClick={() => dirs?.pai && set({ parent: dirs.pai })} aria-label="Subir uma pasta">
              Subir
            </Button>
            <input readOnly value={value.parent} aria-label="Pasta onde criar" className={`${field} h-8 min-w-0 flex-1 bg-bg font-mono`} />
          </div>
          <ul aria-label="Pastas" className="m-0 flex max-h-36 list-none flex-col overflow-auto rounded-md border border-line bg-bg p-1">
            {dirs && dirs.pastas.length === 0 && <li className="px-2 py-1">Nenhuma subpasta aqui: o projeto vai direto nesta.</li>}
            {(dirs?.pastas ?? []).map((d) => (
              <li key={d.caminho}>
                <button type="button" onClick={() => set({ parent: d.caminho })} className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left font-mono text-fg hover:bg-raised">
                  <Folder size={13} aria-hidden="true" className="flex-none text-muted" />
                  {d.nome}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Nome da pasta
          <input value={value.nome} onChange={(e) => set({ nome: e.target.value })} placeholder="meu-projeto" autoComplete="off" spellCheck={false} aria-label="Nome da pasta" className={`${field} h-9 bg-bg font-mono`} />
          {value.nome !== '' && !validName(value.nome) && <span className="text-danger">Letras, números, ponto, hífen e sublinhado; sem espaços.</span>}
        </label>
      </div>
      {origin === 'empty' && (
        <fieldset className="m-0 flex flex-col gap-2 rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-medium">GitHub</legend>
          <label className={`flex items-center gap-2 text-[13px] ${ghOk ? '' : 'text-muted'}`}>
            <input type="checkbox" checked={value.publicar} disabled={!ghOk} onChange={(e) => set({ publicar: e.target.checked })} aria-label="Criar também no GitHub" />
            Criar também o repositório no GitHub
          </label>
          {value.publicar && (
            <select value={value.visibilidade} onChange={(e) => set({ visibilidade: e.target.value as 'privado' | 'publico' })} aria-label="Visibilidade do repositório" className={`${field} h-9 w-48 bg-bg`}>
              <option value="privado">Privado</option>
              <option value="publico">Público</option>
            </select>
          )}
          <p className="m-0 text-xs text-muted">{ghOk ? 'Nada vai para o GitHub sem a sua aprovação: o OWL abre um pedido com o nome e a visibilidade.' : ghHelp}</p>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
