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
