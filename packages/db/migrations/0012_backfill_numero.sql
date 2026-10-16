-- 0012_backfill_numero: tickets created before 0008 have numero NULL (no identifier). Number them per project, after the
-- highest number already used, in creation order.
UPDATE tickets
SET numero = (SELECT COALESCE(MAX(t2.numero), 0) FROM tickets t2 WHERE t2.project_id = tickets.project_id)
  + (SELECT COUNT(*) FROM tickets t3 WHERE t3.project_id = tickets.project_id AND t3.numero IS NULL AND t3.rowid <= tickets.rowid)
WHERE numero IS NULL;
