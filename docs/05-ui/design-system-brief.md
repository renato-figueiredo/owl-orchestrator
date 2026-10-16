# OWL — Design System Brief (para o Claude Design)

> Cole este documento inteiro no Claude Design como instrução do design system. Depois, conecte o MCP para
> puxar as páginas geradas para o código (ver "Como trazer de volta" no fim).

## 1. Produto e tom

**OWL — Orchestrator for Work & LLMs.** Ferramenta local, de uso diário por um desenvolvedor, que orquestra agentes
de IA (Claude CLI, Codex CLI, Ollama), mostra a execução em tempo real, guarda tudo em SQLite e coordena o trabalho
num quadro estilo Linear. Roda em `127.0.0.1`; não é um SaaS.

**Personalidade:** a coruja que vigia. Calma, atenta, precisa, noturna. Um "centro de observação" para quem delega
trabalho a agentes e precisa **enxergar o que está acontecendo e aprovar o que importa**. Não é um chat bonitinho,
nem um dashboard corporativo.

**Problema atual (o que NÃO queremos):** hoje a UI parece qualquer app de IA/Linear/Notion: sidebar cinza + cards
brancos arredondados + sombra suave + fonte do sistema. Evitar:
- sidebar + lista + painel direito genérico, com tudo em cards idênticos de raio 12px e borda 1px;
- roxo/azul "AI gradient", glassmorphism, ícones de brilho (✨), fundo com blobs;
- tipografia só `system-ui`; hierarquia só por peso e tamanho;
- badges coloridos pastel em todo lugar; estados vazios com ilustração genérica.

## 2. Princípios

1. **Observabilidade primeiro.** O estado de cada agente/execução/gate deve ser legível em 1 segundo (o que roda,
   o que espera humano, o que falhou).
2. **O humano decide o que é perigoso.** Aprovações (gates) são o elemento mais forte da interface: push, merge,
   deploy, exclusão. Têm peso visual próprio, nunca parecem "só mais um card".
3. **Densidade calma.** Muita informação, pouco ruído: grid disciplinado, espaçamento consistente, poucas cores
   semânticas, contraste alto.
4. **Movimento explica estado**, não decora (ver §8).
5. **Noite é o modo nativo.** Modo escuro é o design principal; o claro é a versão "papel creme", não um cinza
   inverso.
6. **Assinatura própria:** a coruja (olhos, sobrancelha em "W", bico) e o âmbar como luz no escuro — usados com
   parcimônia, mas reconhecíveis.

## 3. Marca (fixa, não alterar)

- Paleta de marca: **azul-noite `#1B1B3A`**, **creme `#F4F1EA`**, **âmbar `#F5B942`**.
- Logo: `brand/logo-mark.svg` (quadrado arredondado azul-noite, sobrancelha "W" âmbar, dois olhos creme, bico
  âmbar), `brand/logo.svg`, `brand/logo-animated.svg` (piscada nos olhos, classe `.owl-eyes`).
- Nome do produto: **OWL**. Nunca usar "Claude" ou "GPT" em nome/título de produto (marcas registradas); nomes de
  provedores só aparecem como dado (ex.: "adaptador: claude-cli") em texto pequeno.
- Idioma da UI: **português (pt-BR)**. Labels curtos e diretos.

## 4. Cor

Manter **exatamente estes nomes de token** (já usados no código via Tailwind v4 `@theme inline`); pode **ajustar
valores** se justificar, e **adicionar** tokens, mas sem renomear os existentes.

| Token | Escuro (principal) | Claro | Uso |
|---|---|---|---|
| `--c-bg` | `#12122a` | `#f4f1ea` | fundo da aplicação |
| `--c-panel` | `#1b1b3a` | `#fbf9f4` | superfícies (painéis, colunas) |
| `--c-raised` | `#24244a` | `#ffffff` | elementos elevados (cards, menus, inputs) |
| `--c-line` | `#34345e` | `#ddd6c6` | bordas e divisórias |
| `--c-fg` | `#f4f1ea` | `#1b1b3a` | texto principal |
| `--c-muted` | `#a9a7c4` | `#5d5b78` | texto secundário |
| `--c-accent` | `#f5b942` | `#b87d0b` | ação primária, foco, "ao vivo" |
| `--c-accent-fg` | `#1b1b3a` | `#ffffff` | texto sobre accent |
| `--c-user` | `#2b2b55` | `#e9e3d3` | bolha/mensagem do usuário |
| `--c-danger` | `#ff8a80` | `#b42318` | erro, reprovação, destrutivo |
| `--c-ok` | `#5fd39a` | `#1a7f4b` | sucesso, aprovado |

Pedir ao design system, **adicionalmente**:
- tokens semânticos de **status de execução** (`--c-status-running`, `-waiting-human`, `-queued`, `-failed`,
  `-done`, `-cancelled`) e de **gate** (`--c-gate-pending`, `-approved`, `-rejected`);
- uma escala de superfície com 4 níveis de profundidade (`bg < panel < raised < overlay`) definida por **luminosidade
  e borda**, não por sombra pesada;
- cor por **agente/provedor** em modo discreto (um pequeno marcador, não um fundo colorido);
- regras: âmbar é a única cor de "atenção/ação"; vermelho só para falha/destrutivo; verde só para concluído/aprovado.
  Nada de roxo/gradiente decorativo.
- contraste mínimo **WCAG AA** (4.5:1 texto, 3:1 componentes) nos dois temas.

## 5. Tipografia

Sair do `system-ui`. Propor **um par** de fontes livres (Google Fonts / OFL), com carregamento `font-display: swap`:
- **UI/texto:** uma sans com personalidade e boa legibilidade em tamanhos pequenos (ex.: família tipo *Inter Tight*,
  *Geist*, *Hanken Grotesk*, *Instrument Sans* — escolher uma e justificar);
- **Dados/código/IDs/logs/streaming:** uma mono de qualidade (ex.: *JetBrains Mono*, *Geist Mono*, *IBM Plex Mono*)
  — usada generosamente: identificadores de ticket, hashes, custos, durações, saída de ferramentas;
- (opcional) uma display para títulos de tela/estados vazios, desde que combine com a sobrancelha "W" da marca.

Escala sugerida (rem): 11 · 12 · 13 (base de UI densa) · 14 · 16 · 20 · 24 · 32. Entrelinha 1.4–1.6 em texto
corrido, 1.2 em títulos. Números tabulares (`font-variant-numeric: tabular-nums`) em custos, contagens e tempos.

## 6. Layout, espaçamento, forma

- Grade de **4px**; espaçamentos 4/8/12/16/24/32/48.
- Raio: pequeno e **consistente** (sugestão 6px controles, 10px painéis); evitar "tudo pílula".
- Bordas finas `--c-line` em vez de sombras; sombra só em overlays (menus, modais, toasts).
- Ícones: um único conjunto de traço (ex.: Lucide), 16/20px, `currentColor`. Nada de emoji como ícone funcional.
- Responsivo: desktop primeiro (≥1280), mas utilizável em ≥768 (painéis colapsam). Acesso remoto via celular é
  caso secundário (tela de pareamento/aprovações deve funcionar em ~390px).
- Foco visível sempre (anel `--c-accent`, 2px, offset 2px). Alvos de toque ≥ 40px nas telas de aprovação.

## 7. Componentes a definir (com todos os estados: default, hover, focus, active, disabled, loading, erro)

Primitivos: Button (primário âmbar, secundário, fantasma, destrutivo), IconButton, Input, Textarea (com contador /
anexos), Select, Switch, Tabs, Tooltip, Menu/Popover, Modal/Drawer, Toast, Badge/Chip, Avatar de agente, Kbd,
Skeleton, Divider.

Específicos do OWL:
- **Sidebar/Navegação** — projetos (com `ProjectSwitcher`), times, seções: Chat, Quadro, Agentes, Pipelines,
  Memória, Métricas, Lixeira, Armazenamento, Pareamento. Colapsável.
- **Chat** — mensagem do usuário, mensagem do agente com **streaming** (cursor, fade por chunk), Markdown
  completo (código com copiar, tabelas, listas), anexos (imagens/arquivos, miniatura, remover), "prompt refinado".
- **Execução / RunPanel** — **linha do tempo** de uma run: passos, chamadas de ferramenta (expansíveis, com
  entrada/saída em mono), pensamento, custo/tokens/duração, botão cancelar, estado de falha (**FailureCard** com
  causa e ação sugerida).
- **Kanban** — colunas por status, **TicketCard** (id mono, título, labels, responsável/agente, prioridade, sinal
  de gate/bloqueio, progresso de subtickets), arrastar com placeholder e destino, filtros, cycles, relações
  (bloqueia/bloqueado por), visão de lista alternativa.
- **Ticket / detalhe** — descrição Markdown, atividade, execuções vinculadas, anexos, relações.
- **Gate / Fila de aprovações** — o componente de maior peso: o que será feito (diff/comando/alvo), quem pediu, risco,
  botões **Aprovar** / **Reprovar com motivo**; versão compacta inline no ticket e versão página cheia. Estado
  pendente chama atenção uma vez (pulso único), depois fica estável.
- **Editor de Agentes e Pipelines** — biblioteca de agentes (cards com provedor, modelo, ferramentas, escopo),
  editor de definição (frontmatter YAML + prompt), editor visual de pipeline (nós/etapas, entradas e saídas).
- **Memória** — fatos fixados, resumos, busca (FTS), origem de cada item de contexto.
- **Métricas** — custo por projeto/agente/dia, tokens, tempo, taxa de falha; gráficos sóbrios (barras/linhas/
  sparklines), mesma paleta do sistema, sem 3D.
- **Lixeira, Armazenamento, Backup, Pareamento remoto (QR/código)** — telas utilitárias; mesma linguagem.
- **Estados vazios, carregando, erro** — usam a coruja (piscando ao carregar; dormindo quando vazio) em vez de
  ilustração genérica.
- **Status pill de execução** — ponto + rótulo (rodando com "pulso de olhos", aguardando humano em âmbar, falhou
  em danger, concluído em ok).

## 8. Movimento

Movimento explica mudança de estado; respeita `prefers-reduced-motion` (instantâneo ou só opacidade).
- Durações: 120–250 ms para feedback de UI; até 400 ms para transição de página. Spring em movimentos físicos
  (card mudando de coluna), ease-out ao aparecer, ease-in ao sumir. Só `transform`/`opacity`.
- Bibliotecas já adotadas (não propor outras): **Motion** (layout/shared-layout), **AutoAnimate** (listas),
  **dnd-kit** (arrastar). Primitivos existentes: `FadeIn`, `Pulse` (anel único), `ListAnimated`, `StreamCaret`.
- Onde: texto em streaming (cursor + fade suave, sem layout shift); ferramentas deslizando para a timeline; card
  viajando entre colunas; gate chegando com pulso único; coruja piscando em loading/vazio.

## 9. Acessibilidade e idioma

AA nos dois temas; navegação completa por teclado (atalhos para trocar de projeto, abrir fila de aprovações,
enviar mensagem, cancelar run); `aria-live` educado para streaming e mudança de status; nada comunicado só por
cor (status sempre com ícone/forma + texto). Textos em pt-BR.

## 10. Restrições técnicas (para o código gerado ser aproveitável)

- Stack do front: **React + Vite + Tailwind CSS v4** (tokens em `@theme inline`, tema por `data-theme="dark|light"`
  no `<html>`, `@custom-variant dark`). Sem CSS-in-JS, sem outra lib de componentes de UI pesada.
- Entregar tokens como **variáveis CSS** com os nomes da §4 e componentes **React + TypeScript (strict)**,
  estilizados com classes utilitárias Tailwind que usem os tokens (`bg-panel`, `text-muted`, `border-line`…).
- Fontes via Google Fonts (ou `@fontsource`), sem CDN proprietário. Ícones: Lucide (`lucide-react`).
- Sem dependências com licença restritiva. Sem qualquer código/asset proprietário de terceiros (ex.: não copiar o
  bundle de Linear, Notion etc.) — inspirar-se em princípios, não em cópia.
- Componentes puros e testáveis; props tipadas; sem fetch dentro de componente visual (dados entram por props).
- Servidor local em `127.0.0.1`; a UI não deve depender de serviços externos em runtime (exceto fontes, que devem
  ter fallback e poder ser servidas localmente).

## 11. O que quero que você entregue

1. **Fundamentos:** tokens (cor, tipografia, espaçamento, raio, borda, sombra, movimento) em claro e escuro.
2. **Biblioteca de componentes** da §7 com todos os estados.
3. **Páginas** (desktop + 1 variação estreita): Chat com run em streaming · Quadro Kanban · Detalhe de ticket ·
   Fila de aprovações · Biblioteca/Editor de agente · Editor de pipeline · Memória · Métricas · Pareamento ·
   Estados vazio/erro/carregando.
4. **Uma direção visual clara e distintiva** (não genérica), explicando em 5 linhas as decisões (layout
   assinatura, uso do âmbar, tipografia, como a coruja aparece).

---

## Como trazer de volta para o código (checklist)

1. Gerar e aprovar no Claude Design; conectar o MCP e puxar tokens + páginas.
2. Aplicar primeiro os **tokens** em `apps/web/src/index.css` (mantendo os nomes `--c-*`), depois fontes.
3. Componentes visuais genéricos → `packages/ui`; telas → `apps/web/src/components` (substituindo, sem mudar a
   lógica/props de dados). Manter `data-testid`/roles usados nos testes (`*.test.tsx`, `e2e/`).
4. Rodar `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @owl/web test:e2e`.
5. Atualizar `docs/05-ui/` e marcar o item no `docs/roadmap.md`.
