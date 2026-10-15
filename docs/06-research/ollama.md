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

## Integration
- Adapter `ollama` implementing `ProviderAdapter` over the local HTTP API (see `build/prompts/18-ollama.md`).
- Router tier `pequeno` prefers Ollama when reachable; falls back to a small hosted model otherwise.
