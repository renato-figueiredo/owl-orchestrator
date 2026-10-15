# 02 — Regras e conformidade

> Informações levantadas em out/2026. As regras dos provedores mudam: confira as fontes oficiais.

## O que aconteceu com o OpenClaw
- Desde 4/abr/2026, assinaturas do Claude não cobrem uso em ferramentas de terceiros como o OpenClaw.
  Para usá-las com Claude é preciso chave de API ou pacotes de uso extra.
- Usar o token OAuth da assinatura (Free/Pro/Max) em ferramentas de terceiros viola os termos.

## Por que este projeto é diferente
A regra é sobre **credenciais**, não sobre rodar local ou remoto:
- ✅ Chamar o binário oficial `claude` (ou `codex`) como subprocesso, com o login gerenciado pela própria CLI.
- ❌ Ler o token da assinatura e chamar a API por conta própria (mesmo localmente).
- ❌ Compartilhar a assinatura com outras pessoas (servidor comum, acesso de terceiros).

## Cobrança do `claude -p`
- Em 2026 a Anthropic anunciou que, a partir de 15/jun, `claude -p` e o Agent SDK usariam um crédito
  mensal separado. Em 15/jun a mudança foi **pausada** (artigo de suporte
  "Use the Claude Agent SDK with your Claude plan"). Verificar o estado atual antes de depender disso.
- No plano Pro há limite de uso por janela de horas. Equipes de agentes gastam rápido:
  limitar concorrência e ter orçamento por ticket.
- Uso individual comum é o caso esperado. Automação pesada e paralela é zona cinzenta.

## Código vazado
Em 31/mar/2026 o código do Claude Code vazou por um source map no npm e foi republicado no GitHub.
**Não usar.** É proprietário (risco legal/DMCA) e forks "desbloqueados" são risco de malware.
Política para o `CONTRIBUTING.md`:
> Não aceitamos contribuições copiadas, traduzidas ou derivadas do código-fonte vazado do Claude Code
> ou de qualquer código proprietário. PRs nessa situação serão fechados.

## Aviso para o README público
> Este projeto não é afiliado à Anthropic nem à OpenAI. Ele apenas executa as CLIs oficiais instaladas
> e autenticadas por você. Você é responsável por respeitar os termos de uso de cada provedor.
> As regras de uso de assinaturas mudam com frequência.

## Privacidade e segurança
- Servidor só em `127.0.0.1`. Acesso remoto: VPN privada (ex.: Tailscale), nunca porta aberta.
- Backup opcional, desligado por padrão, com criptografia do lado do cliente.
- Lembrar que as CLIs guardam as próprias transcrições (ex.: em `~/.claude` e `~/.codex`, conferir caminhos).
- Agentes com ferramentas restritas (`--allowedTools`) e pasta de trabalho definida.
- Licença: MIT ou Apache-2.0. Evitar "Claude"/"GPT" no nome (marcas).
