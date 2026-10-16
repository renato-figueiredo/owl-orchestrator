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

## Measured notes on local models (2026-10-15)

One 16 GB-VRAM AMD GPU, 32 GB RAM, `think:false`, the example refiner and router agents (`examples/agents`). Small sample (4 refiner requests, 3 router requests per model): take it as a starting point, not a benchmark.

| Model | Speed | Refiner | Router |
|---|---|---|---|
| `gemma4:26b` (MoE, q4_K_M, 18 GB) | ~59 tok/s | Best: follows the rules, asks about gaps | 3/3, clean JSON |
| `gemma4:e2b` | ~129 tok/s | Correct, terse | 3/3 |
| `ministral-3:3b` | ~123 tok/s | **Not recommended**: invents requirements the user never asked for | Right classes, but returned the key `confiança` (accented), which the parser rejects |
| `qwen2.5-coder:7b` | ~90 tok/s | **Not recommended**: often returns only the objective, drops the other sections | **Not recommended**: rated a multi-tenant migration "media" instead of "alta" |

Second round (same cases): 

| Model | Speed per call | Refiner | Router |
|---|---|---|---|
| `gemma4:e4b` | ~0.5-1.3 s | Good, asks about gaps | 3/3 |
| `qwen3:8b` | ~0.5-1.7 s | Good | 3/3 |
| `qwen3.5:9b` | ~1.4-6.8 s | Most detailed | 3/3 |
| `gemma4:12b` | ~3-12 s (~18 tok/s) | Good | 3/3, but too slow for a shared PC |
| `qwen3:4b` | 9-34 s | **Not recommended**: ignores `think:false`; 2,700-3,800 tokens of reasoning end up in the reply | Same: no JSON, only reasoning text |

Pitfalls found:
- A model larger than the VRAM (the 18 GB one) hangs or crawls with the default mmap loading (~3 tok/s prompt processing, requests over 5 minutes). Set `OLLAMA_USE_MMAP=0`.
- Some models (seen with `qwen3:4b`) ignore `think:false` and put the reasoning in the reply; the adapter does not filter it, so check a new model before using it.
- Pick the model per role: a small fast one for classification and monitoring, a larger one for rewriting prompts.
- A loaded model keeps its VRAM until the server's keep-alive expires (5 minutes by default).

## Original plan
- Adapter `ollama` implementing `ProviderAdapter` over the local HTTP API (see `build/prompts/18-ollama.md`).
- Router tier `pequeno` prefers Ollama when reachable; falls back to a small hosted model otherwise.
