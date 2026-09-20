import {SCHEMA_SQL} from './schema.js'
import {postgresSchemaFrom as convert} from '@sislexa/identity/storage-sql/schema'
export {postgresColumnUpgradePlan} from '@sislexa/identity/storage-sql/schema'
export type {PostgresColumn,PostgresSchema} from '@sislexa/identity/storage-sql/schema'
export const PG_EXTRA_SQL = `
ALTER TABLE messages ADD COLUMN IF NOT EXISTS text_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED;
CREATE INDEX IF NOT EXISTS idx_messages_text_tsv ON messages USING GIN (text_tsv);
CREATE OR REPLACE FUNCTION messages_cost_dirty() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE conversations SET cost_dirty = 1 WHERE id = OLD.conversation_id;
  ELSE
    UPDATE conversations SET cost_dirty = 1 WHERE id = NEW.conversation_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_messages_cost_dirty ON messages;
CREATE TRIGGER trg_messages_cost_dirty AFTER INSERT OR UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_cost_dirty();
`
export const postgresSchemaFrom = (sql: string) => convert(sql,PG_EXTRA_SQL)
export const PG_SCHEMA = postgresSchemaFrom(SCHEMA_SQL)
