-- 0013_facts_atualizado_em: when a fact was last pinned or edited. A conversation resumed with --resume only hears
-- about facts changed after its previous run, and `criado_em` alone misses a fact pinned days after it was created.
ALTER TABLE facts ADD COLUMN atualizado_em TEXT;
