import { Button } from '@owl/ui';
import { KeyRound, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

type Key = { id: string; nome: string; criadoEm: string; expiraEm: string };
const message = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

/** Access keys for programs you trust (an agent session, a script). They cannot decide gates; the secret shows once. */
export function AccessKeys() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [nome, setNome] = useState('claude');
  const [dias, setDias] = useState(30);
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .accessKeys()
      .then((r) => setKeys(r.chaves))
      .catch((e) => setErr(message(e)));
  }, []);
  useEffect(load, [load]);

  const create = () =>
    api
      .createAccessKey(nome.trim(), dias)
      .then((r) => {
        setFresh(r.key);
        setErr(null);
        load();
      })
      .catch((e) => setErr(message(e)));

  return (
    <section aria-label="Chaves de acesso" className="flex flex-col gap-3 border-line p-6 text-[13px] xl:border-l">
      <h2 className="owl-label m-0 font-medium">Chaves de acesso</h2>
      <p className="m-0 text-xs text-muted">Para um programa de confiança usar a API sem você. A chave não decide aprovações, não muda agentes nem orçamento e não cria outras chaves.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="key-name">Nome da chave</label>
        <input id="key-name" value={nome} onChange={(e) => setNome(e.target.value)} className="h-8 w-32 rounded-md border border-line bg-raised px-2.5 text-xs" />
        <label className="sr-only" htmlFor="key-days">Validade em dias</label>
        <input id="key-days" type="number" min={1} max={365} value={dias} onChange={(e) => setDias(Number(e.target.value) || 30)} className="h-8 w-16 rounded-md border border-line bg-raised px-2 text-xs" />
        <span className="text-xs text-muted">dias</span>
        <Button icon={KeyRound} disabled={!nome.trim()} onClick={() => void create()}>
          Gerar chave
        </Button>
      </div>
      {fresh && (
        <p role="status" className="m-0 break-all rounded-md border border-line bg-raised p-2.5 font-mono text-xs">
          {fresh}
          <br />
          <span className="font-sans text-muted">Copie agora: ela não aparece de novo.</span>
        </p>
      )}
      {err && <p role="alert" className="m-0 text-xs text-danger">{err}</p>}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {keys.length === 0 && <li className="text-muted">Nenhuma chave.</li>}
        {keys.map((k) => (
          <li key={k.id} className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2">
            <span className="font-mono text-xs">{k.nome}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">vale até {k.expiraEm.slice(0, 10)}</span>
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => void api.revokeAccessKey(k.id).then(load).catch((e) => setErr(message(e)))}>
              Revogar
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
