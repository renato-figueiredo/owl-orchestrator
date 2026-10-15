import { randomUUID } from 'node:crypto';
import type { Db } from '../connection.js';

/** Files are stored on disk (deduplicated by hash); only metadata lives in the database. */
export interface Blob {
  hash: string;
  caminho: string;
  mime: string;
  bytes: number;
  largura: number | null;
  altura: number | null;
  descricao: string | null;
  ocr: string | null;
  criadoEm: string;
}

export interface Attachment {
  id: string;
  messageId: number;
  blobHash: string;
  nomeOriginal: string | null;
}

export interface AttachmentInfo extends Attachment {
  mime: string;
  bytes: number;
  largura: number | null;
  altura: number | null;
  descricao: string | null;
  ocr: string | null;
}

const BLOB_COLS = `hash, caminho, mime, bytes, largura, altura, descricao, ocr, criado_em AS criadoEm`;

export function blobsRepo(db: Db) {
  const get = (hash: string) =>
    db.prepare(`SELECT ${BLOB_COLS} FROM blobs WHERE hash = ?`).get(hash) as Blob | undefined;
  return {
    get,
    /** Inserts the blob if its hash is new; returns the stored row either way (dedupe). */
    upsert(input: {
      hash: string;
      caminho: string;
      mime: string;
      bytes: number;
      largura?: number;
      altura?: number;
    }): Blob {
      db.prepare(
        `INSERT INTO blobs (hash, caminho, mime, bytes, largura, altura) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(hash) DO NOTHING`,
      ).run(input.hash, input.caminho, input.mime, input.bytes, input.largura ?? null, input.altura ?? null);
      return get(input.hash)!;
    },
    /** Caches the model-generated description (and OCR) so the same image is never re-described. */
    setDescription(hash: string, descricao: string, ocr?: string): void {
      db.prepare('UPDATE blobs SET descricao = ?, ocr = ? WHERE hash = ?').run(descricao, ocr ?? null, hash);
    },
    /** Blobs no longer referenced by any attachment: candidates for file + row deletion. */
    orphans(): Blob[] {
      return db
        .prepare(
          `SELECT ${BLOB_COLS} FROM blobs WHERE hash NOT IN (SELECT blob_hash FROM attachments)`,
        )
        .all() as Blob[];
    },
    delete(hash: string): void {
      db.prepare('DELETE FROM blobs WHERE hash = ?').run(hash);
    },
  };
}

export function attachmentsRepo(db: Db) {
  const COLS = 'id, message_id AS messageId, blob_hash AS blobHash, nome_original AS nomeOriginal';
  return {
    add(input: { messageId: number; blobHash: string; nomeOriginal?: string }): Attachment {
      const id = randomUUID();
      db.prepare('INSERT INTO attachments (id, message_id, blob_hash, nome_original) VALUES (?, ?, ?, ?)').run(
        id,
        input.messageId,
        input.blobHash,
        input.nomeOriginal ?? null,
      );
      return db.prepare(`SELECT ${COLS} FROM attachments WHERE id = ?`).get(id) as Attachment;
    },
    /** Attachments of several messages with the blob data the interface and the prompt need, in message order. */
    forMessages(messageIds: number[]): AttachmentInfo[] {
      if (messageIds.length === 0) return [];
      const marks = messageIds.map(() => '?').join(',');
      return db
        .prepare(
          `SELECT a.id, a.message_id AS messageId, a.blob_hash AS blobHash, a.nome_original AS nomeOriginal,
                  b.mime, b.bytes, b.largura, b.altura, b.descricao, b.ocr
           FROM attachments a JOIN blobs b ON b.hash = a.blob_hash
           WHERE a.message_id IN (${marks}) ORDER BY a.rowid`,
        )
        .all(...messageIds) as AttachmentInfo[];
    },
    listByMessage(messageId: number): Attachment[] {
      return db
        .prepare(`SELECT ${COLS} FROM attachments WHERE message_id = ? ORDER BY rowid`)
        .all(messageId) as Attachment[];
    },
  };
}
