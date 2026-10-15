# Troubleshooting

[← Guide](README.md) · English · [Português (BR)](troubleshooting.pt-BR.md)

| Symptom | Cause and fix |
|---|---|
| A provider shows **(indisponível)** | The server could not run `<cli> --version`. Install the CLI and make sure it is on the `PATH` of the shell where you ran `pnpm dev`. Check with `claude --version` / `codex --version`, then restart `pnpm dev`. |
| A run fails right away with a login/auth message | The CLI is not logged in. Log in with the CLI's own flow in a terminal, then try again. OWL never handles your credentials. |
| `403 forbidden_host` / `403 forbidden_origin` | You opened the app from an address other than `http://127.0.0.1:5173` or `http://localhost:5173` (another IP, a hostname, a tunnel). Remote access is not supported yet. |
| `403 folder_not_allowed` when creating a project | The folder is outside `OWL_WORKSPACE_ROOTS` (default: your home), or has a hidden folder in its path. Pick another folder or widen the roots. |
| `400 invalid_folder` | The folder does not exist (or was removed since you created the project). |
| `pnpm dev` says the port is in use | Another process holds 4317 or 5173. Free it, or set `OWL_PORT` / `OWL_WEB_PORT`. The web port is strict on purpose. |
| "Falha ao melhorar o prompt" card | The refiner failed (often the Codex usage limit). Choose **Tentar com haiku**, **Executar sem melhorar**, or **Descartar**. |
| "…o refinador não devolveu nenhum texto" | The refiner answered with nothing. Same options as above. |
| "The server restarted since this step" (410) | A review/failure card was waiting when the server restarted; its state lived in memory. Send the request again. |
| "…the summarizer answered invalid JSON; the previous summary was kept" | The model that writes summaries did not return the expected JSON. Nothing was lost. Try **Resumir agora** again, or pick another summarizer in *Configurações da memória*. |
| The model ignores a fact | Only **pinned** facts are sent, and a conversation that resumes the same CLI session only gets facts created since its last message. Pin it (Fixar) and send again. |
| The answer stops mid-way or ends with an error | Look at the run in the right panel (status and message). Cancel and retry, or try another model. |
| Conversations vanished after changing `OWL_DATA_DIR` | You are looking at a different database. Point `OWL_DATA_DIR` back, or find the old file (`owl.sqlite`). |

## Still stuck?
- `curl http://127.0.0.1:4317/health` should answer `{"status":"ok","name":"owl"}`.
- Run the checks: `pnpm typecheck && pnpm lint && pnpm test`.
- Open an issue with the OWL version (commit), your OS, `node --version`, and what the run panel says. **Do not paste tokens or the contents of your CLI config.**
