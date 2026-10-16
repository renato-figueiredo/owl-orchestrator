# Ollama (local models) — optional

Ollama is **not part of this repository**. It is an optional external service the user runs on their own machine;
OWL only talks to it through a local HTTP adapter (`OLLAMA_URL`, default `http://127.0.0.1:11434`).

## Why
Cheap tier for the router (classify, summarize, rewrite prompts): zero token cost, offline, private.
Local inference does not consume a subscription or API quota; the cost is GPU/CPU time and electricity.

## Running it (rootless, no host packages)
```bash
podman run -d --name ollama --device /dev/kfd --device /dev/dri \
  --group-add keep-groups --security-opt label=disable \
  -v "$HOME/LLMs/ollama:/root/.ollama" -p 127.0.0.1:11434:11434 docker.io/ollama/ollama:rocm
```
NVIDIA users: use the default image with the NVIDIA container toolkit. Always publish on `127.0.0.1` only.

## Model sizing
- 16 GB VRAM: 7–8B models run fully on GPU at interactive speed; ~14B quantized also fits.
- Start small, measure, then add. Keep models in a folder outside the repo.

## Integration (prompt 18, implemented)
- Adapter `ollama` (`packages/core/src/adapters/ollama.ts`): `POST /api/chat` with streamed JSON lines → `text`, `usage` (prompt/eval counts), `end`. Text only and one turn per run: no sessions (`resumeSessionId` ignored, OWL's memory layer carries context), no tools (`allowedTools` ignored), images refused. Cancelling aborts the HTTP request.
- **Thinking is off by default** (`think: false`); a model that rejects the field is retried without it. Reasoning text is never shown as the answer.
- Safety: the URL (`OLLAMA_URL`) must be loopback unless `OWL_OLLAMA_ALLOW_REMOTE=1` (prompts would leave the machine), http(s) only, no credentials in the URL. Model names are validated like the CLI adapters'. `OLLAMA_MODEL` is the default model. `OLLAMA_USE_MMAP=0` sends `options.use_mmap=false`: needed for a model larger than the VRAM (an 18 GB MoE on 16 GB ran at ~3 tok/s prompt processing and hung with mmap, ~59 tok/s without).
- Without Ollama the adapter reports `available: false` and everything else works unchanged.
- Router: with `localPequeno.ativo` (default off: opt-in) the tier `pequeno` goes to Ollama when the last check (startup, every 30 s, and when the settings screen opens) found it up with a model, **only for steps without tools** (the classifier, tool-less agents). Steps with tools keep the tier's configured provider. The model is the one chosen in the settings if installed, else `OLLAMA_MODEL`, else the first installed. If Ollama dies between checks, or the step fails before any text (images attached, unreachable), the executor marks the local model down, reruns the step on the tier's configured provider and records it (system message, run provider). Requests never follow redirects, a reply is capped (4 MiB of text) and a server silent for 120 s is cut. Local runs still count in the daily token budget (see the roadmap).

## Original plan
- Adapter `ollama` implementing `ProviderAdapter` over the local HTTP API (see `build/prompts/18-ollama.md`).
- Router tier `pequeno` prefers Ollama when reachable; falls back to a small hosted model otherwise.
