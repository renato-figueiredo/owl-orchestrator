# 05 — Anexos e imagens (prints)

## Armazenamento
- Arquivo em disco, **nunca dentro do banco**: `data/attachments/ab/abcdef….webp`
  (duas primeiras letras do hash como subpasta).
- Banco guarda hash, caminho, mime, tamanho, dimensões, descrição e OCR.
- **Deduplicação por hash** (SHA-256 do arquivo processado): mesma imagem = um arquivo só.

## Processamento ao receber
1. Converter com `sharp` para WebP (ou JPEG), lado maior ~1500 px.
   Prints de 0,5–2 MB costumam cair para 100–300 KB.
2. Calcular hash; se já existe, reaproveitar.
3. Na primeira vez que a imagem for enviada a um modelo, pedir **descrição em texto** (e OCR se houver texto)
   e gravar no banco.
4. Nos turnos seguintes, usar a descrição em texto, não a imagem.
   Reenviar a imagem só se o usuário pedir ou a tarefa exigir.

## Envio às CLIs
- Claude Code: referenciar o caminho do arquivo no prompt (a CLI lê imagens). Validar no `--help`/docs.
- Codex: verificar suporte a imagem em `codex exec --help`.

## Interface
- Colar (Ctrl+V) e arrastar; miniatura na mensagem; clique abre em tamanho real.

## Retenção opcional
Configurável: manter original por N dias e depois só a versão reduzida + descrição.

## Como está implementado (prompt 08)
- **Upload**: `POST /attachments?nome=...` recebe a imagem como corpo bruto (`image/png|jpeg|webp`, sem multipart). O formato
  vem dos **bytes** (sharp), não do `Content-Type` nem do nome. Limite `OWL_MAX_ATTACHMENT_MB` (413 `too_large`), GIF/SVG/outros → 415/400.
  Converte para WebP (lado maior 1500 px, qualidade 82, EXIF aplicado e depois removido), hash SHA-256 do arquivo processado,
  grava `attachments/ab/<hash>.webp` (relativo à pasta de dados) e faz upsert em `blobs`. O nome original é só rótulo
  (`cleanName`: sem pastas, sem caracteres de controle, 200 caracteres) e nunca compõe caminho.
- **Servir**: `GET /attachments/:hash` valida o hash (64 hex), confere a linha em `blobs` e que o caminho resolvido fica dentro da pasta.
- **Vínculo**: `POST /sessions/:id/messages` aceita `anexos: [{hash, nome?}]` (até 10); texto pode ficar vazio se houver imagem.
  `GET /sessions/:id` devolve `anexos` em cada mensagem.
- **Envio às CLIs**: Claude recebe `--add-dir <pasta>` + `--allowedTools Read` e o prompt lista os caminhos; Codex recebe `--image <arquivo>`
  (depois do `-`, porque a flag é variádica e engoliria o marcador do stdin). Verificado com as CLIs reais.
- **Descrição**: imagem sem descrição vai como arquivo; ao fim da run `ok` um modelo barato (o `resumidor` das configurações de memória) devolve
  `{descricao, ocr}`, gravado em `blobs`. Falhou? tenta de novo no próximo uso. Imagem com descrição vai como **texto** (`[Imagem anexa ..., já vista antes. Descrição: ...]`),
  no turno atual e no histórico (bloco de memória e resumos). A descrição trata o conteúdo da imagem como dado.
- **Pendências**: retenção do original por N dias (nunca se guarda o original, só a versão reduzida); coleta de blobs órfãos e uploads nunca enviados (prompt 09).
