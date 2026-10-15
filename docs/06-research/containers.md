# Containers

## Dev container (available)
`.devcontainer/` gives a reproducible Node 22 + pnpm environment (VS Code Dev Containers, Codespaces, or
`devcontainer up` with podman/docker). It contains **no credentials**.

Note: the server binds `127.0.0.1` inside the container; the dev container forwards the ports to the host.
To reach it from the host without forwarding, use the editor's port forwarding rather than binding `0.0.0.0`.

## Why the app itself is not containerized
OWL runs the official `claude`/`codex` CLIs with the login that lives in the user's home, on the user's project
folders. Mounting those credential directories into a container would widen their exposure (golden rule 1).
Local models (Ollama) are the exception: they hold no credentials and run in a container (see `ollama.md`).

## Planned: agent sandbox (roadmap, prompt 14)
Optional per-agent container that mounts only that agent's git worktree, with no access to the user's home and
no CLI credentials; suited to local models or API-key mode. Never on by default for subscription CLIs.
