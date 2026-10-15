<p align="center"><img src="brand/logo-animated.svg" width="96" alt="OWL logo"></p>
<h1 align="center">OWL</h1>
<p align="center"><b>Orchestrator for Work &amp; LLMs</b><br>
Local-first orchestrator of AI coding agents · English · <a href="README.pt-BR.md">Português (BR)</a></p>

<p align="center">
<a href="https://github.com/renato-figueiredo/owl-orchestrator/actions/workflows/ci.yml"><img src="https://github.com/renato-figueiredo/owl-orchestrator/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
<img src="https://img.shields.io/badge/status-pre--alpha-orange" alt="pre-alpha">
</p>

<!-- Screenshots go here once captured: put the PNGs in docs/images/ (see docs/images/README.md) and reference them, e.g.
<p align="center"><img src="docs/images/chat-dark.png" width="820" alt="OWL chat with the run panel"></p> -->

OWL runs the **official CLIs** you already use (Claude Code, Codex) and, later, local models (Ollama) as subprocesses on **your
own machine**, with a local web UI. It never reads, copies or stores your credentials: each CLI keeps its own login.

> **Status: pre-alpha, the chat core works.** Memory, attachments, agent teams and the board are planned. See the [roadmap](docs/roadmap.md).

## What works today
- Streaming chat with **Claude Code** and **Codex**, with Markdown, copyable code blocks and a cancel button.
- **Projects**: each one has its own folder and instructions, and conversations never leak between projects.
- **Improve prompt**: a refiner agent rewrites your request, you can edit it before it runs, and if the refiner fails (for
  example the Codex limit) OWL asks which model to use instead of switching silently.
- **Memory**: pinned facts per project and an editable, incremental conversation summary; switching provider mid-conversation warns you and hands the new CLI the summary.
- A run panel with the tools used, tokens, cost (when the CLI reports it) and the chained steps of a pipeline.
- Light and dark themes, full keyboard navigation of the conversation list.
- Safe by default: loopback only, DNS-rebinding and cross-site protection, agents confined to folders you allow.

## Coming next
Attachments and screenshots · trash and encrypted backup · agents as files, teams and a local
Linear-style board with approval gates · git worktrees per agent · cost-aware routing · optional Linear mirror and Ollama.
Details in the [roadmap](docs/roadmap.md).

## Quick start
```bash
git clone https://github.com/renato-figueiredo/owl-orchestrator.git
cd owl-orchestrator
pnpm install
pnpm dev          # then open http://127.0.0.1:5173
```
You need Node 22+, pnpm, and the `claude` and/or `codex` CLI installed and logged in.
Step by step: **[Getting started](docs/guide/getting-started.md)**.

## Documentation
| | |
|---|---|
| [Getting started](docs/guide/getting-started.md) | Install, run, first conversation |
| [How to use](docs/guide/how-to-use.md) | Projects, chat, improve prompt, run panel, keyboard |
| [Configuration](docs/guide/configuration.md) | Environment variables and the safety model |
| [Troubleshooting](docs/guide/troubleshooting.md) | Common errors and fixes |
| [Development](docs/guide/development.md) | Layout, tests, how the project is built |
| [Roadmap](docs/roadmap.md) · [Design docs](docs/README.md) | Where it is going and why (design docs are in Brazilian Portuguese) |

## Contributing
Read [CONTRIBUTING](CONTRIBUTING.md) and [`CLAUDE.md`](CLAUDE.md). Security reports: [SECURITY](SECURITY.md).
Docs are currently written in Brazilian Portuguese; English translations are welcome.

## Disclaimer
Not affiliated with Anthropic, OpenAI or Linear. OWL only runs the official CLIs you installed and authenticated.
You are responsible for complying with each provider's terms; subscription rules change often.

## License
[MIT](LICENSE)
