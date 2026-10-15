# Solução de problemas

[← Guia](README.pt-BR.md) · [English](troubleshooting.md) · Português (BR)

| Sintoma | Causa e solução |
|---|---|
| Um provedor aparece como **(indisponível)** | O servidor não conseguiu rodar `<cli> --version`. Instale a CLI e confirme que ela está no `PATH` do terminal em que você rodou `pnpm dev`. Teste com `claude --version` / `codex --version` e reinicie o `pnpm dev`. |
| O run falha na hora com mensagem de login/autenticação | A CLI não está logada. Faça login pelo fluxo da própria CLI num terminal e tente de novo. O OWL nunca mexe nas suas credenciais. |
| `403 forbidden_host` / `403 forbidden_origin` | Você abriu o app por um endereço diferente de `http://127.0.0.1:5173` ou `http://localhost:5173` (outro IP, um nome de host, um túnel). O acesso remoto ainda não é suportado. |
| `403 folder_not_allowed` ao criar um projeto | A pasta está fora de `OWL_WORKSPACE_ROOTS` (padrão: sua pasta pessoal), ou tem uma pasta oculta no caminho. Escolha outra pasta ou amplie as raízes. |
| `400 invalid_folder` | A pasta não existe (ou foi removida depois de criar o projeto). |
| `pnpm dev` diz que a porta está em uso | Outro processo usa a 4317 ou a 5173. Libere, ou defina `OWL_PORT` / `OWL_WEB_PORT`. A porta web é estrita de propósito. |
| Cartão "Falha ao melhorar o prompt" | O refinador falhou (muitas vezes o limite de uso do Codex). Escolha **Tentar com haiku**, **Executar sem melhorar** ou **Descartar**. |
| "…o refinador não devolveu nenhum texto" | O refinador respondeu vazio. Mesmas opções acima. |
| "The server restarted since this step" (410) | Um cartão de revisão/falha estava esperando quando o servidor reiniciou; o estado dele ficava em memória. Envie o pedido de novo. |
| "…o resumidor respondeu algo inválido; o resumo anterior foi mantido" | O modelo que escreve os resumos não devolveu o JSON esperado. Nada se perdeu. Tente **Resumir agora** de novo, ou escolha outro resumidor em *Configurações da memória*. |
| O modelo ignora um fato | Só os fatos **fixados** são enviados, e uma conversa que retoma a mesma sessão da CLI só recebe os fatos criados depois da última mensagem. Fixe-o (Fixar) e envie de novo. |
| A resposta para no meio ou termina com erro | Veja o run no painel à direita (status e mensagem). Cancele e tente de novo, ou use outro modelo. |
| As conversas sumiram depois de mudar `OWL_DATA_DIR` | Você está olhando outro banco. Aponte `OWL_DATA_DIR` de volta, ou procure o arquivo antigo (`owl.sqlite`). |

## Continua travado?
- `curl http://127.0.0.1:4317/health` deve responder `{"status":"ok","name":"owl"}`.
- Rode as verificações: `pnpm typecheck && pnpm lint && pnpm test`.
- Abra uma issue com a versão do OWL (commit), seu sistema, `node --version` e o que o painel de execução diz. **Não cole tokens nem o conteúdo da configuração das suas CLIs.**
