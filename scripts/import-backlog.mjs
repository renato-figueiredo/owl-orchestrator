#!/usr/bin/env node
// Imports docs/backlog-dogfood.md into an OWL project: one ticket per "### N. title" plus the `bloqueia` relations
// from the "Correntes" section. Idempotent by title (tickets already on the board are reused, not duplicated).
//
//   OWL_COOKIE=<value of the owl_session cookie of a paired browser> node scripts/import-backlog.mjs --project <name|id> [--url http://127.0.0.1:4317] [--dry-run]
//
// The API only answers a paired browser session (apps/server/src/auth.ts); this script never pairs by itself.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dry = args.includes('--dry-run');
const base = flag('url') ?? 'http://127.0.0.1:4317';
const projectRef = flag('project');
const cookie = process.env.OWL_COOKIE;

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'backlog-dogfood.md');
const md = readFileSync(file, 'utf8');

// --- parse tickets
const tickets = [];
for (const block of md.split(/^### /m).slice(1)) {
  const head = /^(\d+)\.\s+(.+)$/m.exec(block.split('\n')[0] ?? '');
  if (!head) continue;
  const field = (name) => {
    const m = new RegExp(`^- \\*\\*${name}:\\*\\*\\s*([\\s\\S]*?)(?=\\n- \\*\\*|\\n\\n|\\n## |$)`, 'm').exec(block);
    return m?.[1]?.replace(/\s*\n\s*/g, ' ').trim();
  };
  const agentLine = field('Agente') ?? '';
  const [agentPart, ondePart] = agentLine.split('·').map((s) => s.trim());
  const onde = ondePart?.replace(/^\*\*Onde:\*\*\s*/, '') ?? field('Onde');
  tickets.push({
    n: Number(head[1]),
    titulo: head[2].trim(),
    agente: pickAgent(agentPart ?? ''),
    humano: /Humano decide/.test(agentLine),
    descricao: [field('Descrição'), onde ? `**Onde mexer:** ${onde}` : undefined, `Origem: docs/backlog-dogfood.md, item ${head[1]}.`].filter(Boolean).join('\n\n'),
    criteriosAceite: field('Aceite'),
  });
}

/** First agent named in the line; `arquiteto` plans and `dev-back` executes; `qa-testes` is the library's `qa`. */
function pickAgent(text) {
  if (/^tech-lead/.test(text)) return 'tech-lead';
  const first = /(dev-back|dev-front|qa-testes|arquiteto)/.exec(text)?.[1];
  if (first === 'qa-testes') return 'qa';
  if (first === 'arquiteto') return 'dev-back';
  return first;
}

// --- dependencies (A -> B: A blocks B), from the "Correntes" section of the backlog
const chains = [[1, 2, 3, 5], [2, 6], [7, 10, 11], [8, 9, 10, 17], [10, 20], [16, 18, 19], [16, 20], [12, 27, 22], [13, 14], [10, 14], [11, 14], [22, 25], [14, 25], [21, 28], [23, 28]];
const edges = chains.flatMap((c) => c.slice(1).map((b, i) => [c[i], b]));

if (dry) {
  for (const t of tickets) console.log(`${String(t.n).padStart(2)}  ${t.agente ?? '(sem agente)'}${t.humano ? ' +aprovação' : ''}  ${t.titulo}  [aceite: ${t.criteriosAceite ? 'ok' : 'FALTA'}]`);
  console.log(`${tickets.length} tickets, ${edges.length} relações`);
  const missing = edges.flat().filter((n) => !tickets.some((t) => t.n === n));
  if (missing.length) console.log('relações apontam para tickets inexistentes:', [...new Set(missing)]);
  process.exit(0);
}

if (!cookie || !projectRef) {
  console.error('usage: OWL_COOKIE=<owl_session value> node scripts/import-backlog.mjs --project <name|id> [--url ...] [--dry-run]');
  process.exit(2);
}

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { cookie: `owl_session=${cookie}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json?.error?.code ?? ''} ${json?.error?.message ?? text}`);
  return json;
}

const { projects } = await api('GET', '/projects');
const project = projects.find((p) => p.id === projectRef || p.nome === projectRef);
if (!project) throw new Error(`project not found: ${projectRef} (have: ${projects.map((p) => p.nome).join(', ')})`);
const { agents } = await api('GET', '/agents');
const known = new Set(agents.map((a) => a.nome));

const collect = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((x) => collect(x, out));
  else if (node && typeof node === 'object') {
    if (typeof node.titulo === 'string' && typeof node.id === 'string') out.push(node);
    Object.values(node).forEach((x) => collect(x, out));
  }
  return out;
};
const existing = new Map(collect(await api('GET', `/projects/${project.id}/board`)).map((t) => [t.titulo, t]));

const ids = new Map();
for (const t of tickets) {
  const found = existing.get(t.titulo);
  if (found) {
    ids.set(t.n, found.id);
    console.log(`= ${t.n} já existe (${found.identificador ?? found.id})`);
    continue;
  }
  const responsavel = t.agente && known.has(t.agente) ? t.agente : undefined;
  if (t.agente && !responsavel) console.warn(`! ${t.n}: agente "${t.agente}" não está na biblioteca; ticket sem responsável`);
  const { ticket } = await api('POST', `/projects/${project.id}/tickets`, {
    titulo: t.titulo,
    descricao: t.descricao,
    ...(t.criteriosAceite ? { criteriosAceite: t.criteriosAceite } : {}),
    ...(responsavel ? { responsavel } : {}),
    ...(t.humano ? { requerAprovacao: true } : {}),
  });
  ids.set(t.n, ticket.id);
  console.log(`+ ${t.n} ${ticket.identificador ?? ticket.id}  ${t.titulo}`);
}

for (const [a, b] of edges) {
  const from = ids.get(a);
  const to = ids.get(b);
  if (!from || !to) continue;
  try {
    await api('POST', `/tickets/${from}/relations`, { relacionadoId: to, tipo: 'bloqueia' });
    console.log(`  ${a} bloqueia ${b}`);
  } catch (e) {
    console.warn(`  ${a} -> ${b}: ${e.message}`); // most likely already related from a previous run
  }
}
