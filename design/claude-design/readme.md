# OWL — Design System

**OWL — Orchestrator for Work & LLMs.** Ferramenta local (127.0.0.1) de uso diário de um desenvolvedor: orquestra agentes de IA (claude-cli, codex-cli, ollama), mostra a execução ao vivo, guarda tudo em SQLite e coordena o trabalho num quadro. Personalidade: a coruja que vigia — calma, atenta, precisa, noturna.

Fontes: `uploads/design-system-brief.md` (brief do usuário) e o repo GitHub **renato-figueiredo/owl-orchestrator@main** (`apps/web/src/index.css`, `components/Sidebar.tsx`, `RunPanel.tsx`, `lib/types.ts`, `packages/ui/src/primitives.tsx`, `docs/05-ui/motion-and-animation.md`, `brand/*.svg`).

Direção escolhida (rodada 1, `OWL Direções.dc.html`): **1a Observatório** (faixa Vigia + trilho + linha do tempo de run) com o **Quadro da 1c** (zonas por quem está com a bola). Rodada 2: paleta trocada para **navy puro + creme + âmbar** (escuro) e **creme quente + marrom + laranja queimado** (claro), a pedido — sem o azul-arroxeado #1B1B3A.

## Índice
- `styles.css` — entrada única (só @import)
- `tokens/` — colors, typography, spacing, motion, fonts, base
- `guidelines/` — cards de fundamentos (Colors, Type, Spacing, Brand)
- `components/core` — Button, IconButton, Kbd, Input, Tabs, Switch
- `components/status` — OwlEyes, StatusPill, AgentTag
- `components/owl` — RunStep, TicketCard, GateCard
- `OWL App.dc.html` — UI kit clicável: Chat com run, Quadro, Detalhe de ticket, Aprovações, Agentes, Pipelines, Memória, Métricas, Lixeira/Armazenamento/Backup, Pareamento
- `OWL Estados.dc.html` — vazio, carregando, erro (FailureCard) e variação celular (aprovações + pareamento, 390px)
- `OWL Direções.dc.html` — as 3 direções da rodada 1 (histórico, cores antigas)
- `OWL Marca.dc.html` — marca v2 (disco facial, íris âmbar, bico facetado), tamanhos, estados animados, plataformas, assinaturas
- `OWL Projetos.dc.html` — separação de projetos (seletor ⌘P na Vigia, trilho projeto/mesa, tela Projetos) e fluxo Novo projeto (pasta, GitHub, URL git, vazio)
- `OWL Site.dc.html` — site: hero com app ao vivo, download por plataforma, IA local (Pro), servidores GPU, preços
- `assets/owl/` — SVGs v2: mark, mark-light, app-icon (sem cantos, p/ máscaras), mono-cream/ink, favicon, tray(+alert), anim-idle/watching/thinking/waiting/sync/done/error/sleep/splash
- `brand/` — SVGs originais do repo · `assets/` — mesmos SVGs recoloridos para a nova paleta
- `SKILL.md`, `github.md`

## CONTENT FUNDAMENTALS
- **pt-BR**, labels curtos e diretos, verbo no infinitivo para ações: “Aprovar”, “Reprovar com motivo”, “Cancelar”, “Nova conversa”.
- Fala com **você** (“Esperando você”, “Nada roda até você decidir.”, “na sua mesa”). O agente fala em 1ª pessoa no chat (“Encontrei 3 chamadas…”).
- Caixa de frase em tudo; CAIXA-ALTA só em rótulos mono de seção (TEMPO, VIGIA, WORKTREE) com tracking 0.08em.
- Nomes de provedor (claude-cli, codex-cli, ollama) **só como dado**, em mono pequeno: “adaptador: claude-cli · sonnet”. Nunca no nome do produto.
- Números em pt-BR: `$0,042`, `18,4k`, `1,4s`; tempos `01:12`; ids `OWL-138`. Sempre tabular-nums.
- Sem emoji. Estados vazios curtos e factuais: “Nenhuma execução ainda.”, “Nada esperando você”.

## VISUAL FOUNDATIONS
- **Cor**: escuro é nativo. Navy #010736 de fundo, superfícies sobem por luminosidade (chrome → bg → panel → raised → overlay), borda #283C6E. Texto creme #FBF0CF. **Âmbar #F5B055 é a única cor de atenção/ação** (botão primário, foco, cursor, contador e moldura do que espera o humano). Vermelho só falha/destrutivo, verde só concluído/aprovado. Provedores: quadradinho 6px em oklch(0.74 0.11 h), nunca fundo. Nada de roxo nem gradiente.
- **Rodando ≠ âmbar**: rodando é creme com os olhos “••” piscando (assinatura da coruja). Âmbar fica para quem precisa de você.
- **Tipo**: Hanken Grotesk (UI, 13px base densa; 14px texto do chat; 24–28 títulos) + JetBrains Mono (ids, tempos, custos, comandos, logs — usada generosamente). Ligaduras de código desligadas.
- **Layout assinatura**: barra **Vigia** (44px) com cada run viva + botão âmbar de aprovações (⌘A); **trilho** de ícones 56px; painel de **Execução** 380px à direita com linha do tempo vertical, tempo relativo na margem (log de voo). Quadro em 3 zonas: Com os agentes · **Com você** (moldura âmbar + wash 7%) · Feito.
- **Espaço**: grade 4px (4/8/12/16/24/32/48). Densidade calma: muito dado, poucos ornamentos.
- **Forma**: raio 4 (chips/kbd), 6 (controles, tickets), 10 (painéis, gates). Nada de pílula — inclusive o Switch é quadrado.
- **Bordas, não sombras**: 1px --c-line. Sombra só em overlay (--shadow-overlay). Cards de ticket sem borda; a zona dá o contexto.
- **Fundos**: chapados. Sem imagens, texturas, blobs ou blur. Transparência só nos washes (accent/ok/danger ≤ 9%).
- **Hover**: superfície sobe um nível (raised → overlay) ou texto muted → fg; borda → line-strong. Destrutivo só tinge de vermelho no hover. **Press**: translateY(1px). **Foco**: anel âmbar 2px, offset 2px.
- **Movimento**: explica estado. 120 (hover) / 180 (aparecer) / 250 (painéis) / 400ms (tela). ease-out ao aparecer, ease-in ao sumir, spring para card entre colunas. Passos de ferramenta deslizam (owl-slide-in); gate chega com **um** pulso âmbar (owl-pulse) e fica estável; cursor ▍ âmbar no streaming. reduced-motion → instantâneo.
- **Gate** é o elemento mais forte: moldura âmbar enquanto pendente, comando em mono grande, risco em barras (3 = vermelho), alvos de 40px, Reprovar exige motivo.

## ICONOGRAPHY
- **Lucide** (traço 2px, currentColor, 16/18px). Em código: `lucide-react`. Nos protótipos: fonte `lucide-static` via CDN (`<i class="icon-shield-alert">`), importada em `tokens/fonts.css`.
- Glifos unicode como **forma de status** (ao lado de texto, nunca sozinhos): ✓ concluído, ✕ falhou, ▲ aguardando você, ○ na fila, ◐ revisão, ⊘ bloqueado, — cancelado, ▍ cursor. “••” (OwlEyes) = rodando.
- Logo: `assets/logo-mark.svg` (24px no Vigia), `logo-animated.svg` para carregando/vazio. Sem emoji. Sem ilustrações genéricas.

## Notas para o código
- Tokens mantêm os nomes `--c-*`; novos: --c-chrome, --c-overlay, --c-line-strong, --c-faint, --c-accent-hover, --c-*-wash, --c-status-*, --c-gate-*, --c-prov-*, --c-diff-*.
- **Mudança**: `:root` agora é o escuro; claro é `[data-theme='light']` (o código hoje faz o inverso — ajustar `useTheme`).
- Componentes aqui usam estilo inline com tokens para prototipagem; no app, traduzir para utilitários Tailwind (`bg-panel`, `text-muted`…).

## Intentional additions
- **OwlEyes**, **AgentTag**, **RunStep**: necessários para a assinatura (status por olhos, marcador de provedor, timeline) — não há equivalente isolado no repo.
