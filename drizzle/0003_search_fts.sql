-- Custom, hand-written migration (not drizzle-kit generated — same pattern as
-- 0002_version_control.sql). Replaces OpenSearch-based document search
-- (formerly src/search/, docker-compose service `opensearch`) with Postgres
-- native full-text search: no separate search cluster/JVM, one less container
-- to run on a low-spec host, and search stays inside the same transaction/
-- backup story as everything else instead of a second copy of document state
-- that can drift out of sync.
--
-- documents.extracted_text / documents.entities are a denormalized cache of
-- the CURRENT version's OCR/NER output — see the comment on those columns in
-- src/db/schema/documents.js.
--
-- search_vector is maintained by a BEFORE INSERT/UPDATE trigger rather than a
-- STORED GENERATED column: Postgres refuses `GENERATED ALWAYS AS (... to_tsvector
-- ...) STORED` with "generation expression is not immutable" — to_tsvector is
-- only IMMUTABLE when explicitly cast to regconfig, and even then generated-
-- column validation is stricter than a plain index/trigger context accepts in
-- practice. A trigger sidesteps that restriction entirely, and it's the same
-- technique 0002_version_control.sql already uses to keep a derived column in
-- sync (documents.current_version_id) — same convention, not a new one.
--
-- Weights mirror the old OpenSearch field boosts (title^3/title.exact^2,
-- tags^2, description + entities unboosted, extractedText unboosted):
--   A (highest) = title
--   B            = tags
--   C            = description, entities
--   D (lowest)  = extracted_text

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

ALTER TABLE documents
  ADD COLUMN extracted_text text,
  ADD COLUMN entities text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN search_vector tsvector;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION documents_update_search_vector()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.entities, ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.extracted_text, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER documents_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, tags, description, entities, extracted_text
  ON documents
  FOR EACH ROW
  EXECUTE FUNCTION documents_update_search_vector();
--> statement-breakpoint

-- Backfill: the trigger only fires on rows inserted/updated from here on, so
-- force it once for anything already in the table (harmless self-assignment;
-- a no-op on a table with no existing rows, e.g. a fresh dev database).
UPDATE documents SET title = title;
--> statement-breakpoint

CREATE INDEX documents_search_vector_idx ON documents USING gin (search_vector);
--> statement-breakpoint

-- Typo-tolerant title matching (stands in for the old mapping's
-- `fuzziness: AUTO`). Deliberately scoped to title only, not extracted_text —
-- a trigram index over full OCR bodies gets large and expensive to maintain
-- for a benefit that mostly matters on short fields like a title, where a
-- user is likeliest to fat-finger a search term.
CREATE INDEX documents_title_trgm_idx ON documents USING gin (title gin_trgm_ops);
