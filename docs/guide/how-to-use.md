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
  memory tools on demand, and who writes the summaries (default: Claude haiku, to spare a small Codex limit).
- **Memory tools on demand** (off by default, Claude only): Claude can search the project's earlier messages, read summaries and list or save facts when it
  needs to, instead of receiving everything in the prompt. It only sees the current project (a conversation without a project sees only itself), facts it saves
  are never pinned (you decide), and the run panel shows which memory tools were called.

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

## Agents, skills and pipelines
Click **Agents** (sidebar) to open the library. An agent is a Markdown file with a short header (name, provider, model, tools, skills) and its instructions.
- **Where they live**: your own library in `~/.owl/agents/` (change it with `OWL_LIBRARY_DIR`) and the examples that ship with OWL (`po`, `tech-lead`, `dev-front`, `dev-back`, `qa`, `revisor`, `memoria`, `roteador`, `refinador-de-prompt`). A file of yours with the same name as an example wins.
- **Edit** an example and OWL saves *your copy*; the example is untouched, and **Back to the example** removes your copy. **Duplicate** copies any agent under a new name. **New agent** starts from a template.
- A file with a mistake does not break anything: it is listed with the reason (e.g. `ferramentas: Invalid input`) and skipped. Editing a file by hand takes effect on the next run.
- **Skills** are folders with a `SKILL.md` (same format as Claude Code's), in `skills/<name>/`. An agent lists the skills it uses and their instructions travel with its prompt.
- **Pipelines** (`pipelines/<name>.yaml`) chain steps. Each step can name an agent, run only `quando` a condition holds, take the previous step's output as input, retry (`tentativas`) and run on a provider different from an earlier step (`outroProvedorQue`). The example `refinar-executar-revisar` refines the prompt, runs it, and has the reviewer check the result on the other provider. Use it by sending `pipeline: "refinar-executar-revisar"` to the API; picking one in the message box is on the [roadmap](../roadmap.md).
- The example `dev-front`, `dev-back` and `qa` agents can **edit files and run your tests**, but only inside a ticket's own git worktree (see [Projects, teams and worktrees](#projects-teams-and-worktrees)). In a plain chat every agent can only read. Tools are checked when the file is loaded: a bare `Bash`, a command that deletes, pushes or merges, `pnpm install`, or any writing tool on a Codex agent makes the file invalid (it is listed with the reason).

## The board and approvals
In the sidebar, each project has a **Board** button. The board is the agents' message bus: they talk through tickets and comments, not to each other.
- **Columns**: Backlog → Ready → In progress → In review → Waiting for approval → Done, plus Blocked. **Drag** a card to another column (or use the keyboard: focus the card, Space, arrows, Space). Dropping on a card puts yours before it.
- **New ticket** creates one by hand (title, description, acceptance criteria, an agent as assignee, an optional token ceiling, and whether delivery needs your approval). **New goal** starts the example flow: the `po` agent writes the ticket, `tech-lead` splits it into sub-tasks, each `dev-*` executes its own, `qa` verifies, you approve the delivery and `memoria` records a summary and facts. The parent ticket closes when its last sub-task does.
- **Open a ticket** to see its comments (people and agents), a history of who did what, every run with tokens and cost, and to **run an agent** on it.
- **Approvals queue**: the board asks for your decision when a delivery needs approval, when the next step would pass the ticket's token ceiling, when an action is destructive (deleting files, push, deploy, merge…) or when a reviewer rejects the work. **Approve** (comment optional) or **Reject** (comment required): a rejected ticket goes back to *In progress* and the assigned agent reads your comment and tries again.
- An agent sees **only** the ticket (with its parent, sub-tasks and latest comments), the ticket's summary and the project's pinned facts, never your chat conversations. Its runs live in a hidden conversation per ticket.
- If an agent fails or answers in a format OWL cannot use, the ticket is **Blocked** with the reason in a comment; run the agent again when ready.

## Projects, teams and worktrees
In the sidebar, **Team** on a project opens its screen (the board has a button to it and a project selector).
- **Settings**: name, instructions, the *base branch* tickets start from and merge into (empty = the branch currently checked out in the folder), and how many runs of this project may go at once. Removing a project only forgets it in OWL (conversations, tickets, teams, memory); your folder is never touched, and you must type the project name.
- **Teams**: create teams, add agents from your library, give each a role *for this project*. While nobody is on a team, any agent may work on the project's tickets; once someone is, only members may. The same agent (a manager, say) can be on teams of several projects.
- **Memory per agent per project**: **Memory** next to a member lists what that agent remembers *in this project* (pinned facts go into its prompt on this project's tickets). The same agent has a separate list in every other project.
- **Worktrees**: an agent that writes (or runs commands) works in its own copy of the repository, on its own branch `owl/<ticket>-<title>`, created by OWL under `<OWL_DATA_DIR>/worktrees/`. Two tickets never touch the same files. When the agent finishes, OWL commits its changes to that branch; when the ticket is done the folder is removed and the branch stays with the work. The project folder must be a git repository with at least one commit (`git init`), otherwise the agent is not started and the ticket is blocked with that instruction.
- **Nothing reaches your branch by itself.** In the ticket, **Trabalho isolado** shows the branch and how many commits it is ahead. *Pedir mesclagem* and *Descartar trabalho* only add a request to the approvals queue; approving a merge does a `git merge --no-ff` into the base branch, and only if your folder is on that branch with no uncommitted changes (otherwise it tells you why and changes nothing). A conflict aborts the merge. Rejecting a merge does not reopen the ticket.
- **Limits**: `OWL_CONCURRENCY` (global) and the per-project limit both apply.

## Keyboard and themes
- In the session list: **↑ / ↓** move, **Enter** opens, **Tab** leaves the list.
- The ☾ / ☀ button switches light and dark (it starts from your system setting and remembers your choice).

## What agents can and cannot do today
- Codex runs in a **read-only sandbox**. Claude runs without any tool pre-approved, and in non-interactive mode the CLI denies the rest.
  Agents write only on board tickets, inside the ticket's git worktree and with writes confined to that folder (OWL rewrites `Edit`/`Write` to a path rule: a bare `Edit` lets the model write anywhere). Commands are limited to the allow-list above. Commands such as `pnpm test` run your project's own scripts, which OWL cannot confine; an optional container sandbox is on the [roadmap](../roadmap.md).
- Deleting conversations is not available yet; images you attach stay on disk until then.
