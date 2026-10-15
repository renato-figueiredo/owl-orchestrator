# How to use

[← Guide](README.md) · English · [Português (BR)](how-to-use.pt-BR.md)

## Projects and conversations
- A **project** is a name, a working **folder** and optional **instructions**. Everything in a project stays in that project:
  conversations run inside its folder and receive its instructions, and nothing leaks to other projects.
- Conversations are listed in the left sidebar, grouped by project (**Sem projeto** = no project, they run in the server's folder).
  The title comes from your first message.
- Create a conversation with **Nova conversa** (no project) or the **+** beside a project.

## Chatting
- **Enter** sends, **Shift+Enter** adds a line.
- **Provider**: `claude-cli` or `codex-cli`. One that is not installed is disabled.
- **Model**: optional. Leave empty for the CLI's default, or type one (for Claude: `haiku`, `sonnet`, `opus`).
- Answers stream in, with Markdown and code blocks that have a **Copiar** button.
- **Cancelar** stops a running answer; the process is killed and the run is marked as cancelled.
- Reload the page any time: the history comes back, and a run that is still going is picked up again.
- Follow-up messages continue the same native CLI session (`--resume`), so the CLI keeps its own context.

## The run panel (right side)
- **Status**, provider and model of the current run.
- **Ferramentas**: the tools the agent used (for example, a shell command), as they happen.
- **Tokens** (and cost, when the CLI reports it: Claude does, Codex does not).
- **Execuções da conversa**: every run with its tokens, plus the **session total**. Pipeline steps appear chained and indented.
- Use the arrow at the top to collapse it.

## Improve prompt
Tick **Melhorar prompt** and a *refiner* agent rewrites your request (goal, context, constraints, output format) before the
real run. The refined prompt is what the main provider receives; your original message stays in the history.

- **Refinador**: the default is Codex. Pick **haiku** (Claude) to use your Claude subscription instead, for example when the Codex limit is over.
- **Editar antes de executar**: the flow stops after the rewrite. You get a card with the refined prompt in an editable box:
  - **Executar** (or **Executar com a minha edição**): runs it; *your edit* is what runs.
  - **Melhorar de novo …**: rewrite again with another model.
  - **Descartar**: drops the request, nothing else runs.
- Without that option the two steps run back to back and show up chained in the panel, each with its own tokens.
- If the refiner **fails** (limit reached, CLI missing) or answers with nothing, OWL does **not** switch model on its own. It shows the
  reason and asks: try with another model, **run without improving**, or discard.

The refiner is an ordinary file: [`examples/agents/refinador-de-prompt.md`](../../examples/agents/refinador-de-prompt.md), and the flow is
[`examples/pipelines/melhorar-e-executar.yaml`](../../examples/pipelines/melhorar-e-executar.yaml). Edit them and the next request uses the change (no restart).

## Keyboard and themes
- In the session list: **↑ / ↓** move, **Enter** opens, **Tab** leaves the list.
- The ☾ / ☀ button switches light and dark (it starts from your system setting and remembers your choice).

## What agents can and cannot do today
- Codex runs in a **read-only sandbox**. Claude runs without any tool pre-approved, and in non-interactive mode the CLI denies the rest.
  In practice agents **read and explain, they do not edit your files yet**. Safe write access (git worktrees, approvals) is on the [roadmap](../roadmap.md).
- Deleting conversations, attachments/images and memory across conversations are not available yet.
