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

## Memory
The right panel has two tabs: **Execução** and **Memória**.

- **Resumo da conversa**: a short summary OWL keeps up to date (after every N messages, or when you press **Resumir agora**). You can edit it,
  and **Desfazer** brings back the previous version. A summary that fails never replaces a good one.
- **Fatos**: short statements that must hold from now on ("use pnpm", "answer in Portuguese"). They belong to the **project**, so every
  conversation of the project shares them and no other project sees them. **Only pinned facts (Fixar) are sent to the model.** When the summarizer spots a
  decision it proposes it as a fact, *not pinned*, for you to review.
- **Configurações da memória**: how many recent messages (N), when to summarize, the context budget in tokens, automatic summaries, related snippets,
  and who writes the summaries (default: Claude haiku, to spare a small Codex limit).

When does the model receive the memory? When the CLI has **no session to resume**: a new conversation in a project, or after a provider switch. A
conversation that keeps resuming the same CLI session only gets the *new* pinned facts.

### Switching provider in the middle of a conversation
Each CLI keeps its own internal session (tool results, cache). Changing from Claude to Codex (or back) **does not carry that over**, so OWL asks first:
- **Resumir e trocar**: updates the summary, then sends. The new provider receives pinned facts, the summary and the last messages.
- **Trocar sem resumir**: sends now, with whatever summary already exists.
- **Cancelar**: nothing is sent and your text stays in the box.
If the summary fails, OWL does not switch by itself: it tells you why and lets you choose.

## Images and screenshots
Paste (**Ctrl+V**), drag a file onto the message box, or click 📎. PNG, JPEG and WebP up to the configured limit.
- OWL shrinks each image to WebP (longest side 1500 px) and strips its metadata. The same image sent twice is stored once.
- The first time an image goes to a model, the model sees the picture itself. Afterwards a cheap model (the same one that writes summaries) describes it and reads its text; from then on the **description goes instead of the picture**, which saves tokens.
- Click a thumbnail in the conversation to see it full size (**Esc** closes).
- An image alone is a valid message.

## Trash, deletion and backup
- Hover a conversation and click **✕**: it goes to the **Trash** (bottom of the sidebar), hidden but recoverable. A conversation with a run in progress cannot be moved: cancel the run first.
- In the Trash: **Restore**, **Delete for good** (asks a second time) or **Empty trash**. Deleting for good removes messages, runs, the facts the summarizer extracted from that conversation (pinned facts stay) and any image no other conversation uses.
- After the retention period (30 days by default, see **Storage and backup**) OWL purges the trash by itself. You can turn that off.
- **Your CLI keeps its own copy.** `claude` and `codex` store their conversation history in their own folders (`~/.claude/`, `~/.codex/`). Deleting in OWL does **not** touch those; OWL tells you when that applies. It never deletes files in folders it does not own.
- **Storage and backup** (bottom of the sidebar): trash retention, an optional automatic database backup (off by default) and *Clean unused files*, which removes images nobody uses anymore. See [Configuration](configuration.md#backup) for encryption and sending the copy somewhere.

## Keyboard and themes
- In the session list: **↑ / ↓** move, **Enter** opens, **Tab** leaves the list.
- The ☾ / ☀ button switches light and dark (it starts from your system setting and remembers your choice).

## What agents can and cannot do today
- Codex runs in a **read-only sandbox**. Claude runs without any tool pre-approved, and in non-interactive mode the CLI denies the rest.
  In practice agents **read and explain, they do not edit your files yet**. Safe write access (git worktrees, approvals) is on the [roadmap](../roadmap.md).
- Deleting conversations is not available yet; images you attach stay on disk until then.
