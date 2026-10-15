# 08 — Anexos e prints

**Agente:** `backend` (upload/UI com `frontend`, tabelas com `banco-de-dados`)  ·  **Verificação:** `qa-testes`, `revisor`
**Ler antes:** `docs/03-data/attachments-and-images.md`

## Tarefa
1. `POST /attachments`: aceitar PNG/JPEG/WebP até um limite configurável; converter com sharp
   (WebP, lado maior ~1500 px); hash SHA-256; deduplicar em `blobs`; salvar em `data/attachments/ab/hash.webp`.
2. Vincular anexos à mensagem.
3. Na primeira vez que a imagem for a um modelo: pedir descrição + OCR e gravar em `blobs`.
   Nos turnos seguintes: usar a descrição.
4. Passar a imagem às CLIs conforme suporte verificado (caminho no prompt para o Claude Code).
5. Interface: colar (Ctrl+V), arrastar, miniatura, ampliar.

## Critérios de aceite
- Mesma imagem enviada duas vezes gera um único arquivo.
- Teste de segurança: nomes de arquivo maliciosos não escapam da pasta (path traversal).
- Segundo turno não reenvia a imagem quando há descrição.
