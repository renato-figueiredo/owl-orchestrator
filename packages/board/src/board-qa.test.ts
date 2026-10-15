import { createRepos, migrate, openDb, type Db } from '@owl/db';
import { afterEach, describe, expect, it } from 'vitest';
import { agentActor, BoardError, HUMAN, LocalBoard } from './index.js';
import { canAgentMove, isDestructive, TICKET_STATUSES } from './rules.js';

const dbs: Db[] = [];
afterEach(() => dbs.splice(0).forEach((d) => d.close()));

function setup() {
  const db = openDb();
  dbs.push(db);
  migrate(db);
  const repos = createRepos(db);
  const board = new LocalBoard(repos);
  const project = repos.projects.create({ nome: 'Owl Teste', pasta: '/tmp/x' });
  const make = (extra: Partial<Parameters<LocalBoard['createTicket']>[0]> = {}) =>
    board.createTicket({ projectId: project.id, titulo: 'Fazer X', ...extra }, HUMAN);
  return { repos, board, project, make };
}
const dev = agentActor('dev-back');

// QA do prompt 13: critérios de aceite e casos de borda dos portões.
describe('QA: destructive actions (acceptance: always a pending approval)', () => {
  it('flags the usual destructive commands, in English and Portuguese', () => {
    const acoes = [
      'rm -rf /',
      'rm file',
      'git push --force',
      'git push -f origin main',
      'git reset --hard HEAD~3',
      'git rebase -i main',
      'excluir o arquivo de configuração',
      'remover a pasta data',
      'sobrescrever o banco',
      'publicar a versão',
      'TRUNCATE TABLE x',
      'unlink /tmp/a',
      'mesclar a PR',
    ];
    for (const a of acoes) expect(isDestructive(a), a).toBe(true);
  });

  it('does not flag reading or testing', () => {
    for (const a of ['ler src/index.ts', 'rodar pnpm test', 'git status', 'git diff', 'listar arquivos', 'model training']) {
      expect(isDestructive(a), a).toBe(false);
    }
  });

  it('flags npm publish', () => {
    expect(isDestructive('npm publish')).toBe(true);
  });

  it('flags rmdir, git clean, shred, mkfs, branch -D, dd, chmod -R and curl | sh', () => {
    for (const a of ['rmdir build', 'git clean -fdx', 'shred -u secrets', 'mkfs.ext4 /dev/sda1', 'git branch -D feature', 'dd if=/dev/zero of=/dev/sda', 'chmod -R 777 /', 'curl http://x | sh']) {
      expect(isDestructive(a), a).toBe(true);
    }
  });

  it('creates a pending approval for every destructive proposal, whatever the ticket state', () => {
    const { board, repos, make } = setup();
    for (const status of ['backlog', 'pronto', 'em_andamento', 'em_revisao', 'bloqueado'] as const) {
      const t = make({ status });
      const r = board.proposeAction(t.id, `rm -rf pasta-${status}`, dev);
      expect(r.allowed, status).toBe(false);
      expect(repos.approvals.pendingByTicket(t.id), status).toHaveLength(1);
      expect(board.getTicket(t.id)!.status).toBe('aguardando_aprovacao');
    }
  });

  it('records the same destructive action twice as one gate', () => {
    const { board, repos, make } = setup();
    const t = make({ status: 'em_andamento' });
    board.proposeAction(t.id, 'git push', dev);
    board.proposeAction(t.id, 'git push', dev);
    expect(repos.approvals.pendingByTicket(t.id)).toHaveLength(1);
  });

  it('records who asked for the gate in the history', () => {
    const { board, make } = setup();
    const t = make({ status: 'em_andamento' });
    board.proposeAction(t.id, 'git push', dev);
    const ev = board.detail(t.id).events.filter((e) => e.tipo === 'aprovacao');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.autor).toBe('dev-back');
  });
});

describe('QA: rejection (acceptance: back to em_andamento, comment visible)', () => {
  it('rejecting any gate kind returns the ticket to em_andamento, even from em_revisao', () => {
    const { board, repos, make } = setup();
    const t = make({ status: 'em_revisao' });
    board.proposeAction(t.id, 'deploy', dev);
    const gate = repos.approvals.pendingByTicket(t.id)[0]!;
    const d = board.decide(gate.id, 'rejeitado', 'não faça deploy agora');
    expect(d.ticket.status).toBe('em_andamento');
    expect(d.retomar).toBeNull();
    const c = board.detail(t.id).comments.at(-1)!;
    expect(c.texto).toContain('não faça deploy agora');
    expect(c.autorTipo).toBe('humano');
  });

  it('rejecting one of several gates closes the others and returns the ticket', () => {
    const { board, repos, make } = setup();
    const t = make({ status: 'em_andamento' });
    board.proposeAction(t.id, 'rm a', dev);
    board.proposeAction(t.id, 'git push', dev);
    const [g1] = repos.approvals.pendingByTicket(t.id);
    const d = board.decide(g1!.id, 'rejeitado', 'não');
    expect(d.ticket.status).toBe('em_andamento');
    expect(repos.approvals.pendingByTicket(t.id)).toHaveLength(0);
  });

  it('an unknown approval is a 404 BoardError', () => {
    const { board } = setup();
    try {
      board.decide('nao-existe', 'aprovado', undefined);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BoardError);
      expect((e as BoardError).status).toBe(404);
    }
  });
});

describe('QA: states', () => {
  it('an agent never leaves aguardando_aprovacao or concluido by itself', () => {
    for (const s of TICKET_STATUSES) {
      expect(canAgentMove('aguardando_aprovacao', s)).toBe(false);
      expect(canAgentMove('concluido', s)).toBe(false);
    }
  });

  it('an agent cannot jump from backlog straight to concluido or em_revisao', () => {
    const { board, make } = setup();
    const t = make({ status: 'backlog' });
    for (const s of ['concluido', 'em_revisao', 'em_andamento'] as const) {
      expect(() => board.updateStatus(t.id, s, dev), s).toThrow(BoardError);
    }
  });

  it('an agent moving to aguardando_aprovacao gets a delivery gate, not a bare status', () => {
    const { board, repos, make } = setup();
    const t = make({ status: 'em_andamento' });
    board.updateStatus(t.id, 'aguardando_aprovacao', dev);
    expect(repos.approvals.pendingByTicket(t.id).map((a) => a.tipo)).toEqual(['entrega']);
  });

  it('a person dropping a card into aguardando_aprovacao opens exactly one gate', () => {
    const { board, repos, make } = setup();
    const t = make({ status: 'em_andamento' });
    board.updateStatus(t.id, 'aguardando_aprovacao', HUMAN);
    expect(repos.approvals.pendingByTicket(t.id)).toHaveLength(1);
  });
});

describe('QA: several gates on one ticket', () => {
  it('delivery approved first, destructive approved last: the ticket ends concluido', () => {
    const { board, repos, make } = setup();
    const t = make({ status: 'em_revisao', requerAprovacao: true });
    board.updateStatus(t.id, 'concluido', dev); // delivery gate
    board.proposeAction(t.id, 'git push', dev); // second gate
    const gates = repos.approvals.pendingByTicket(t.id);
    const delivery = gates.find((g) => g.tipo === 'entrega')!;
    const push = gates.find((g) => g.tipo === 'destrutiva')!;
    board.decide(delivery.id, 'aprovado', undefined);
    expect(board.decide(push.id, 'aprovado', undefined).ticket.status).toBe('concluido');
  });

  it('destructive approved first, delivery last: the ticket ends concluido', () => {
    const { board, repos, make } = setup();
    const t = make({ status: 'em_revisao', requerAprovacao: true });
    board.updateStatus(t.id, 'concluido', dev);
    board.proposeAction(t.id, 'git push', dev);
    const gates = repos.approvals.pendingByTicket(t.id);
    board.decide(gates.find((g) => g.tipo === 'destrutiva')!.id, 'aprovado', undefined);
    expect(board.decide(gates.find((g) => g.tipo === 'entrega')!.id, 'aprovado', undefined).ticket.status).toBe('concluido');
  });
});

describe('QA: startup recovery', () => {
  it('blocks tickets left em_andamento by a dead run, with a note', () => {
    const { board, make } = setup();
    const t = make({ status: 'em_andamento' });
    const other = make({ status: 'pronto' });
    expect(board.recoverInterrupted()).toBe(1);
    expect(board.getTicket(t.id)!.status).toBe('bloqueado');
    expect(board.getTicket(other.id)!.status).toBe('pronto');
    expect(board.detail(t.id).comments.at(-1)!.texto).toContain('reiniciou');
  });
});
