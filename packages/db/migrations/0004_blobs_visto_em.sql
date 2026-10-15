-- 0004_blobs_visto_em: last time an upload produced (or re-produced) this blob. The orphan sweep leaves recent blobs
-- alone: an image is uploaded before the message that attaches it exists.
ALTER TABLE blobs ADD COLUMN visto_em TEXT;
