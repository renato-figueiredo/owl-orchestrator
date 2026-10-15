# 01 — Visão geral

## Problema
Quem tem assinatura (ex.: Claude Pro, ChatGPT) mas não usa API quer combinar modelos:
por exemplo, o GPT melhora o pedido e o Claude executa. Ferramentas de terceiros que usavam o
token da assinatura (caso OpenClaw) foram bloqueadas pela Anthropic em abril de 2026.

## Solução
Um OWL **local** que chama as **CLIs oficiais** (`claude -p`, `codex exec`) como subprocessos.
Cada pessoa usa as próprias contas, na própria máquina. O projeto é de código aberto para que
qualquer um monte seu OWL pessoal.

## Funcionalidades
**Fase 1 — núcleo**
- Interface web local com chat e stream da execução em tempo real.
- Opção "melhorar prompt" (ex.: Codex reescreve, Claude executa).
- Memória em camadas em SQLite (fatos fixados, resumo, últimas mensagens, busca).
- Envio de prints com cache de descrição.
- Exclusão de chat que limpa também as imagens; lixeira; backup.

**Fase 2 — equipes**
- Agentes reutilizáveis (biblioteca global), usados em vários projetos.
- Equipes por projeto; um agente gerente pode estar em várias equipes.
- Quadro de tickets (kanban local ou Linear) como canal entre agentes.
- Portões de aprovação humana.
- Papéis: tech lead, PO, dev front, dev back, QA, memória/contexto, roteador.
- Roteamento por complexidade e custo, com métricas por execução.

**Futuro**
- Pacotes de domínio (ex.: vídeo com ffmpeg/Remotion), GitHub Issues, modelos locais (Ollama).

## Diferenciais frente a projetos existentes
Maestro e Maestri focam em rodar vários agentes de código em paralelo (ver `11-referencias.md`).
Este projeto foca na camada de **organização**: agentes reutilizáveis, equipes, tickets como fonte da
verdade, aprovação humana e controle de custo. Avaliar se vale integrar/estender em vez de refazer.

## Princípios
- Local primeiro, privado por padrão.
- Barato em tokens: guardar tudo, enviar pouco.
- Tudo auditável: quem fez o quê, com qual modelo, quanto custou.
- Configuração em arquivos simples e compartilháveis.
